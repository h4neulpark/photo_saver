import hashlib
import io
import json
import os
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import api
import catalog
import transfers
from media import fingerprint
from worker import store_analysis


class LocalFile:
    def __init__(self, stream):
        self.stream = stream
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.stream.close()
    def __getattr__(self, name):
        return getattr(self.stream, name)
    def set_pipelined(self, _enabled):
        pass


class LocalSFTP:
    """Filesystem-backed SFTP contract, including non-overwriting rename."""
    corrupt_reads = False
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
        return LocalFile(open(path, 'xb' if mode == 'wx' else mode))


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

    def queue(self, items=None, source=None, destination=''):
        request = transfers.TransferRequest(connection=transfers.config_identity(self.config), items=items or [{'id': 'one'}], source=source or [], destination=destination)
        with catalog.database(write=True) as db:
            result = transfers.queue_transfer(db, request, api.device_folder)
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (result['id'],)).fetchone())

    def run_job(self, job):
        transfers.upload_selection(job, None, self.managed)
        with catalog.database() as db:
            record = db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone()
        return record['status'], json.loads(record['result'])

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


if __name__ == '__main__':
    unittest.main()
