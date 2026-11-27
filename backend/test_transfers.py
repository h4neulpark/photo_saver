import hashlib
import io
import json
import os
import socket
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

import paramiko
from fastapi import HTTPException

import api
import catalog
import transfers
from media import fingerprint
from worker import store_analysis


class LocalFile:
    def __init__(self, stream, prefetch_log=None):
        self.stream = stream
        self.prefetch_log = prefetch_log
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.stream.close()
    def __getattr__(self, name):
        return getattr(self.stream, name)
    def set_pipelined(self, _enabled):
        pass
    def prefetch(self, file_size=None):
        if self.prefetch_log is not None:
            self.prefetch_log.append(file_size)


class LocalSFTP:
    """Filesystem-backed SFTP contract, including non-overwriting rename."""
    corrupt_reads = False
    def __init__(self):
        self.prefetch_calls = []
    def normalize(self, path):
        return str(Path(path).resolve(strict=True))
    def lstat(self, path):
        return Path(path).lstat()
    def mkdir(self, path):
        Path(path).mkdir()
    def remove(self, path):
        Path(path).unlink()
    def rename(self, old, new):
        os.link(old, new)
        Path(old).unlink()
    def open(self, path, mode):
        if self.corrupt_reads and mode == 'rb' and path.endswith('.part'):
            return io.BytesIO(b'corrupted')
        return LocalFile(open(path, 'xb' if mode == 'wx' else mode), self.prefetch_calls)


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.managed = root / 'managed'
        self.remote = root / 'remote'
        self.managed.mkdir()
        self.remote.mkdir()
        patcher = patch.object(catalog, 'DATA', root / 'data')
        patcher.start()
        self.addCleanup(patcher.stop)
        catalog.initialize()
        with catalog.database(write=True) as db:
            db.execute("INSERT INTO events(id,name,folder,folder_key) VALUES ('parent','Trip','Trip','trip')")
            db.execute("INSERT INTO events(id,name,folder,folder_key,parent_id) VALUES ('child','Day','Day','day','parent')")
        self.config = {'address': '127.0.0.1', 'account': 'private-account', 'root': str(self.remote), 'hostKey': 'pinned', 'identity': 'key'}
        patcher = patch.object(transfers, 'archive_config', return_value=self.config)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.sftp = LocalSFTP()
        @contextmanager
        def connection(_expected=None):
            yield self.sftp, self.config
        patcher = patch.object(transfers, 'archive_connection', side_effect=connection)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.add_file('one', 'clip.MP4', b'first video', xmp=True)

    def add_file(self, file_id, name, contents, xmp=False):
        directory = self.managed / file_id
        directory.mkdir()
        file = directory / name
        file.write_bytes(contents)
        sha = hashlib.sha256(contents).hexdigest()
        store_analysis(file_id, f'{file_id}/{name}', sha, file.stat(), ('video', {}, None, None, '', False, 'GoPro HERO8 Black'))
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET event_id='child', confirmed=1 WHERE id=?", (file_id,))
            if xmp:
                sidecar = file.with_suffix('.xmp')
                sidecar.write_bytes(b'<xmp/>')
                db.execute('UPDATE media SET xmp_path=?,xmp_sha=? WHERE id=?', (f'{file_id}/{sidecar.name}', hashlib.sha256(sidecar.read_bytes()).hexdigest(), file_id))
        return file

    def queue(self, items=None, source=None, destination='', allow_duplicates=False, offload_after_upload=False):
        request = transfers.TransferRequest(
            connection=transfers.config_identity(self.config),
            items=items or [{'id': 'one'}],
            source=source or [],
            destination=destination,
            allow_duplicates=allow_duplicates,
            offload_after_upload=offload_after_upload,
        )
        with catalog.database(write=True) as db:
            result = transfers.queue_transfer(db, request, api.device_folder)
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (result['id'],)).fetchone())

    def run_job(self, job):
        transfers.upload_selection(job, None, self.managed)
        with catalog.database() as db:
            record = db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone()
        return record['status'], json.loads(record['result'])

    def test_upload_offload_requires_media_and_xmp_or_existing_copy(self):
        with self.assertRaises(HTTPException) as error:
            self.queue([{'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        self.assertEqual(error.exception.status_code, 400)
        with self.assertRaises(transfers.MissingXmpOffloadError) as error:
            self.queue(offload_after_upload=True)
        self.assertEqual(error.exception.missing_xmp_media_ids, ['one'])
        self.run_job(self.queue([{'id': 'one', 'kind': 'xmp'}]))
        status, result = self.run_job(self.queue(offload_after_upload=True))
        self.assertEqual((status, result['offload']['offloaded']), ('done', 1))
        self.assertFalse((self.managed / 'one').exists())

    def test_upload_offload_success_and_crash_replay(self):
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with catalog.database() as db:
            self.assertEqual(catalog.active_offload_media_ids(db), {'one'})
        status, result = self.run_job(job)
        self.assertEqual((status, result['offload']['offloaded'], result['offload']['freedBytes']), ('done', 1, 17))
        with patch.object(transfers, 'send_file', side_effect=AssertionError('deleted local must not be re-uploaded')):
            status, result = self.run_job(job)
        self.assertEqual((status, result['uploaded'], result['offload']['offloaded']), ('done', 2, 1))
        self.assertEqual((result['totalBytes'], result['transferredBytes']), (17, 17))
        with catalog.database() as db:
            self.assertEqual(transfers.offload.upload_offload_candidates(db, job['id'])['ids'], [])

    def test_upload_offload_recovers_mid_delete_without_reupload(self):
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        def crash(*args, **kwargs):
            with catalog.database(write=True) as db:
                db.execute("UPDATE media SET status='offloading' WHERE id='one'")
            (self.managed / 'one/clip.MP4').unlink()
            raise SystemExit('worker crash')
        with patch.object(transfers.offload, 'offload_file', side_effect=crash), self.assertRaises(SystemExit):
            self.run_job(job)
        with patch.object(transfers, 'send_file', side_effect=AssertionError('must restore durable archive outcomes')):
            status, result = self.run_job(job)
        self.assertEqual((status, result['offload']['offloaded']), ('done', 1))
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT status FROM media WHERE id='one'").fetchone()[0], 'archived')

    def test_upload_offload_partial_failure_offloads_only_successful_media(self):
        self.add_file('two', 'second.MP4', b'second video')
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}, {'id': 'two'}], offload_after_upload=True)
        send = transfers.send_file
        def fail_one(*args, **kwargs):
            if args[3]['id'] == 'one':
                raise HTTPException(409, 'failed')
            return send(*args, **kwargs)
        with patch.object(transfers, 'send_file', side_effect=fail_one):
            status, result = self.run_job(job)
        self.assertEqual((status, result['offload']['offloaded'], result['offload']['skipped']), ('failed', 1, 1))
        self.assertTrue((self.managed / 'one/clip.MP4').exists())
        self.assertFalse((self.managed / 'two/second.MP4').exists())

    def test_upload_cancel_after_crash_rolls_back_or_finishes_atomic_file(self):
        for removed in (False, True):
            with self.subTest(removed=removed):
                job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
                # Complete upload only, simulating a crash before the followup result is saved.
                with patch.object(transfers.offload, 'offload_file', side_effect=SystemExit), self.assertRaises(SystemExit):
                    self.run_job(job)
                with catalog.database(write=True) as db:
                    db.execute("UPDATE media SET status='offloading' WHERE id='one'")
                    db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps({'cancelRequested': True}), job['id']))
                if removed:
                    (self.managed / 'one/clip.MP4').unlink()
                with patch.object(transfers, 'send_file', side_effect=AssertionError('cancel must not upload')):
                    status, result = self.run_job(job)
                self.assertEqual((status, result['offload']['phase']), ('cancelled', '중지됨'))
                with catalog.database() as db:
                    self.assertEqual(db.execute("SELECT status FROM media WHERE id='one'").fetchone()[0], 'archived' if removed else 'available')

    def test_missing_xmp_offload_http_error_and_missing_hash(self):
        from fastapi.testclient import TestClient
        response = TestClient(api.app).post('/api/archive/transfers', json={
            'connection': transfers.config_identity(self.config), 'items': [{'id': 'one'}], 'offload_after_upload': True,
        })
        self.assertEqual((response.status_code, response.json()['code'], response.json()['missingXmpMediaIds']), (409, 'missing_xmp_for_offload', ['one']))
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET xmp_sha=NULL WHERE id='one'")
        with self.assertRaises(HTTPException) as error:
            self.queue(offload_after_upload=True)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('해시', error.exception.detail)

    def test_upload_offload_partial_asset_failure_keeps_local(self):
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        send = transfers.send_file
        def fail_xmp(*args, **kwargs):
            if args[3]['kind'] == 'xmp':
                raise HTTPException(409, 'XMP failed')
            return send(*args, **kwargs)
        with patch.object(transfers, 'send_file', side_effect=fail_xmp):
            status, result = self.run_job(job)
        self.assertEqual((status, result['failed'], result['offload']['skipped']), ('failed', 1, 1))
        self.assertTrue((self.managed / 'one/clip.MP4').exists())

    def test_upload_offload_cancel_in_upload_and_followup(self):
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with patch.object(transfers, 'send_file', side_effect=transfers.UploadCancelled):
            status, result = self.run_job(job)
        self.assertEqual((status, result['offload']['phase'], result['offload']['offloaded']), ('cancelled', '건너뜀', 0))
        self.assertIn('비우지 않았습니다', result['error'])
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with patch.object(transfers.offload, 'offload_file', side_effect=transfers.UploadCancelled):
            status, result = self.run_job(job)
        self.assertEqual((status, result['offload']['phase'], result['offload']['completedFiles']), ('cancelled', '중지됨', 0))
        self.assertTrue((self.managed / 'one/clip.MP4').exists())

    def test_upload_offload_disconnect_never_starts_deletion(self):
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with patch.object(transfers, 'send_file', side_effect=BrokenPipeError), patch.object(transfers.offload, 'offload_file') as remove:
            status, result = self.run_job(job)
        remove.assert_not_called()
        self.assertEqual((status, result['offload']['phase']), ('failed', '건너뜀'))

    def test_upload_offload_keeper_rejected_and_individual_offload_failure(self):
        with catalog.database(write=True) as db:
            keeper = catalog.queue_job(db, 'duplicate-cleanup', {'files': [{'keeper': {'kind': 'managed', 'id': 'one'}}]})
        with self.assertRaises(HTTPException) as error:
            self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        self.assertEqual(error.exception.status_code, 409)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='done' WHERE id=?", (keeper,))
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with patch.object(transfers.offload, 'offload_file', side_effect=HTTPException(409, 'verification failed')):
            status, result = self.run_job(job)
        self.assertEqual((status, result['failed'], result['offload']['failed']), ('failed', 0, 1))
        self.assertEqual(result['offload']['errors'][0]['path'], 'one/clip.MP4')
        self.assertTrue(api.job_has_attention(status, result))
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with patch.object(transfers, 'active_duplicate_keeper_ids', return_value={'one'}):
            status, result = self.run_job(job)
        self.assertEqual((status, result['offload']['skipped']), ('done', 1))
        self.assertEqual(result['offload']['errors'][0]['path'], 'one/clip.MP4')

    def test_folder_structure_sidecar_hash_and_repeat_skip(self):
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}, {'id': 'one'}], destination='inbox')
        self.assertNotIn('private-account', job['payload'])
        self.assertEqual(len(json.loads(job['payload'])['files']), 2)
        status, result = self.run_job(job)
        self.assertEqual((status, result['uploaded']), ('done', 2))
        target = self.remote / 'inbox/Trip/Day/GoPro HERO8 Black'
        self.assertEqual((target / 'clip.MP4').read_bytes(), b'first video')
        self.assertEqual((target / 'clip.xmp').read_bytes(), b'<xmp/>')
        status, result = self.run_job(job)
        self.assertEqual((status, result['skipped']), ('done', 2))
        self.assertEqual(list(self.remote.rglob('*.part')), [])

    def test_source_folder_relative_upload(self):
        job = self.queue(source=['Trip', 'Day', 'GoPro HERO8 Black'], destination='selected folder')
        status, result = self.run_job(job)
        self.assertEqual(status, 'done')
        self.assertEqual((self.remote / 'selected folder/clip.MP4').read_bytes(), b'first video')

    def test_resume_cleans_only_its_own_staging_file(self):
        job = self.queue()
        payload = json.loads(job['payload'])
        directory = self.remote / 'Trip/Day/GoPro HERO8 Black'
        directory.mkdir(parents=True)
        staging = directory / f".photo-saver-{payload['token']}-0.part"
        staging.write_bytes(b'interrupted upload')
        unrelated = directory / '.photo-saver-unrelated.part'
        unrelated.write_bytes(b'keep')
        status, result = self.run_job(job)
        self.assertEqual((status, result['uploaded']), ('done', 1))
        self.assertFalse(staging.exists())
        self.assertEqual(unrelated.read_bytes(), b'keep')

    def test_conflicting_file_is_preserved_while_other_file_uploads(self):
        self.add_file('two', 'other.MP4', b'second')
        target = self.remote / 'Trip/Day/GoPro HERO8 Black'
        target.mkdir(parents=True)
        (target / 'clip.MP4').write_bytes(b'other video')
        status, result = self.run_job(self.queue([{'id': 'one'}, {'id': 'two'}]))
        self.assertEqual((status, result['uploaded'], result['failed']), ('failed', 1, 1))
        self.assertEqual((target / 'clip.MP4').read_bytes(), b'other video')
        self.assertEqual((target / 'other.MP4').read_bytes(), b'second')

    def test_symlink_parent_is_not_followed(self):
        outside = self.remote.parent / 'outside'
        outside.mkdir()
        (self.remote / 'Trip').symlink_to(outside, target_is_directory=True)
        status, result = self.run_job(self.queue())
        self.assertEqual((status, result['failed']), ('failed', 1))
        self.assertEqual(list(outside.iterdir()), [])

    def test_changed_local_source_is_not_uploaded(self):
        job = self.queue()
        (self.managed / 'one/clip.MP4').write_bytes(b'changed')
        status, result = self.run_job(job)
        self.assertEqual((status, result['failed']), ('failed', 1))
        self.assertEqual(list(self.remote.rglob('*.MP4')), [])

    def test_remote_checksum_failure_removes_temporary_file(self):
        self.sftp.corrupt_reads = True
        status, result = self.run_job(self.queue())
        self.assertEqual((status, result['failed']), ('failed', 1))
        self.assertEqual(list(self.remote.rglob('*.part')), [])
        self.assertEqual(list(self.remote.rglob('*.MP4')), [])

    def test_cancel_during_transfer_cleans_up_and_preserves_source(self):
        item = json.loads(self.queue()['payload'])['files'][0]
        def cancel(*_args):
            raise transfers.UploadCancelled()
        with self.assertRaises(transfers.UploadCancelled):
            transfers.send_file(self.sftp, self.remote, self.managed, item, '.cancel.part', cancel)
        self.assertEqual(list(self.remote.rglob('*.part')), [])
        self.assertEqual((self.managed / 'one/clip.MP4').read_bytes(), b'first video')

    def test_settings_change_stops_job_before_remote_write(self):
        job = self.queue()
        self.config['identity'] = 'new-key'
        status, result = self.run_job(job)
        self.assertEqual(status, 'failed')
        self.assertIn('SSH 설정', result['error'])
        self.assertEqual(list(self.remote.iterdir()), [])

    def test_stale_destination_connection_cannot_queue_upload(self):
        request = transfers.TransferRequest(connection=transfers.config_identity(self.config), items=[{'id': 'one'}])
        self.config['root'] = '/another/archive'
        with catalog.database(write=True) as db, self.assertRaises(HTTPException) as error:
            transfers.queue_transfer(db, request, api.device_folder)
        self.assertEqual(error.exception.status_code, 409)

    def test_unconfirmed_wrong_source_path_and_traversal_are_rejected(self):
        for kwargs in [{'source': ['Other']}, {'destination': '../escape'}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(HTTPException):
                self.queue(**kwargs)
        with catalog.database(write=True) as db:
            db.execute('UPDATE media SET confirmed=0')
        with self.assertRaises(HTTPException):
            self.queue()

    def test_cancel_queued_job_never_runs(self):
        job = self.queue()
        response = api.cancel_archive_upload(job['id'])
        self.assertEqual(response['status'], 'cancelled')
        self.assertTrue(response['result']['cancelRequested'])

    def test_duplicate_destination_is_rejected(self):
        self.add_file('two', 'clip.MP4', b'different')
        with self.assertRaises(HTTPException) as error:
            self.queue([{'id': 'one'}, {'id': 'two'}])
        self.assertEqual(error.exception.status_code, 409)

    def test_upload_and_skip_sync_remote_files(self):
        self.config['storageId'] = 'abcdef0123456789abcdef0123456789'
        job = self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}])
        status, _ = self.run_job(job)
        self.assertEqual(status, 'done')
        with catalog.database() as db:
            rows = [dict(row) for row in db.execute('SELECT * FROM remote_files ORDER BY path')]
            storages = [dict(row) for row in db.execute('SELECT * FROM storages')]
        self.assertEqual(len(storages), 1)
        self.assertEqual(storages[0]['id'], self.config['storageId'])
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['status'] == 'present' and row['archive_root'] == str(self.remote) and row['mtime_ns'] is not None for row in rows))
        status, result = self.run_job(job)
        self.assertEqual((status, result['skipped']), ('done', 2))

    def test_sftp_disconnect_aborts_remaining_files_without_repeating_failures(self):
        self.add_file('two', 'two.MP4', b'second')
        self.add_file('three', 'three.MP4', b'third')
        job = self.queue([{'id': 'one'}, {'id': 'two'}, {'id': 'three'}])
        with patch.object(self.sftp, 'lstat', side_effect=BrokenPipeError('connection dropped')):
            status, result = self.run_job(job)
        self.assertEqual(status, 'failed')
        self.assertEqual((result['completedFiles'], result['failed']), (3, 3))
        with catalog.database() as db:
            recorded = db.execute('SELECT count(*) FROM archive_entries WHERE job_id=?', (job['id'],)).fetchone()[0]
        self.assertEqual(recorded, 0)

    def test_cross_path_duplicate_is_blocked_unless_allowed_and_ignores_xmp_templates(self):
        self.config['storageId'] = 'abcdef0123456789abcdef0123456789'
        self.assertEqual(self.run_job(self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}]))[0], 'done')
        # Same target path is allowed (for re-upload / fast-skip).
        self.assertEqual(self.run_job(self.queue([{'id': 'one'}]))[0], 'done')

        # Different media with identical XMP bytes should not be flagged as duplicate.
        self.add_file('two', 'two.MP4', b'second video', xmp=True)
        with self.assertRaises(transfers.RemoteDuplicateError) as caught:
            self.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}, {'id': 'two'}, {'id': 'two', 'kind': 'xmp'}], destination='backup')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.duplicate_ids, ['one'])
        self.assertEqual(caught.exception.new_count, 2)
        self.assertEqual(caught.exception.duplicates[0]['existingPaths'], ['Trip/Day/GoPro HERO8 Black/clip.MP4'])

        # Uploading only the new file + identical XMP succeeds without allow_duplicates.
        self.assertEqual(self.run_job(self.queue([{'id': 'two'}, {'id': 'two', 'kind': 'xmp'}], destination='backup'))[0], 'done')
        # Explicitly allowing duplicates uploads to the new target path.
        self.assertEqual(self.run_job(self.queue([{'id': 'one'}], destination='backup', allow_duplicates=True))[0], 'done')
        self.assertEqual((self.remote / 'backup/Trip/Day/GoPro HERO8 Black/clip.MP4').read_bytes(), b'first video')

    def test_fast_skip_avoids_remote_hash_when_unchanged_and_rehashes_when_mtime_changes(self):
        self.config['storageId'] = 'abcdef0123456789abcdef0123456789'
        job = self.queue()
        self.assertEqual(self.run_job(job)[0], 'done')
        self.assertTrue(self.sftp.prefetch_calls)
        with patch.object(transfers, 'remote_hash', side_effect=AssertionError('fast-skip should avoid remote_hash')):
            status, result = self.run_job(self.queue())
        self.assertEqual((status, result['skipped']), ('done', 1))

        # Changing mtime on the remote copy forces re-hashing with prefetch.
        target = self.remote / 'Trip/Day/GoPro HERO8 Black/clip.MP4'
        stat_before = target.stat()
        os.utime(target, ns=(stat_before.st_atime_ns, stat_before.st_mtime_ns + 5_000_000_000))
        self.sftp.prefetch_calls.clear()
        with patch.object(transfers, 'remote_hash', wraps=transfers.remote_hash) as spy:
            status, result = self.run_job(self.queue())
        self.assertEqual((status, result['skipped']), ('done', 1))
        spy.assert_called_once()
        self.assertEqual(self.sftp.prefetch_calls, [len(b'first video')])

    def test_ssh_remote_hash_parses_output_handles_cancel_and_falls_back(self):
        expected_sha = hashlib.sha256(b'first video').hexdigest()
        target = self.remote / 'clip.MP4'
        target.write_bytes(b'first video')

        def fake_sftp(chunks, exit_code=0, open_error=None):
            exec_channel = MagicMock()
            exec_channel.recv.side_effect = list(chunks)
            exec_channel.recv_exit_status.return_value = exit_code
            transport = MagicMock()
            transport.is_active.return_value = True
            if open_error is not None:
                transport.open_session.side_effect = open_error
            else:
                transport.open_session.return_value = exec_channel
            sftp_chan = MagicMock()
            sftp_chan.get_transport.return_value = transport
            sftp = MagicMock()
            sftp.get_channel.return_value = sftp_chan
            sftp.open.side_effect = self.sftp.open
            return sftp, exec_channel

        # 1. Parses GNU/macOS output (including escaped backslash prefix) without reading via SFTP.
        sftp, exec_channel = fake_sftp([f'\\{expected_sha}  clip.MP4\n'.encode(), b''])
        ssh_state = {'supported': True}
        digest = transfers.remote_hash(sftp, target, lambda _n: None, file_size=11, ssh_state=ssh_state)
        self.assertEqual(digest, expected_sha)
        sftp.open.assert_not_called()
        command = exec_channel.exec_command.call_args.args[0]
        self.assertIn('sha256sum -- "$1"', command)
        self.assertIn('shasum -a 256 -- "$1"', command)

        # 2. Exit 127 / SFTP-only disables SSH exec for session and falls back to SFTP prefetch.
        sftp, _ = fake_sftp([b''], exit_code=127)
        ssh_state = {'supported': True}
        self.sftp.prefetch_calls.clear()
        progress_bytes = []
        digest = transfers.remote_hash(sftp, target, progress_bytes.append, file_size=11, ssh_state=ssh_state)
        self.assertEqual(digest, expected_sha)
        self.assertFalse(ssh_state['supported'])
        self.assertEqual(self.sftp.prefetch_calls, [11])
        self.assertEqual(progress_bytes[-1], 11)

        # 3. ChannelException also disables and falls back.
        sftp, _ = fake_sftp([], open_error=paramiko.ChannelException(1, 'denied'))
        ssh_state = {'supported': True}
        self.assertEqual(transfers.remote_hash(sftp, target, lambda _n: None, file_size=11, ssh_state=ssh_state), expected_sha)
        self.assertFalse(ssh_state['supported'])

        # 4. UploadCancelled closes exec channel immediately and propagates.
        sftp, exec_channel = fake_sftp([socket.timeout(), b''])
        with self.assertRaises(transfers.UploadCancelled):
            transfers.ssh_remote_hash(sftp, target, lambda: (_ for _ in ()).throw(transfers.UploadCancelled()), file_size=11)
        exec_channel.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
