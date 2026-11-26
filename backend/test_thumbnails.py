"""Exercise real cache files and DBs; remote transport stays in a temporary tree."""
import io
import json
import sqlite3
import subprocess
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import api
import archive
import catalog
import media
import settings
import test_transfers
import thumbnails as thumbs
import worker


class ThumbnailTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temporary.name)
        self.cache = self.root / 'thumbs'
        self.cache.mkdir()
        self.incoming = self.root / 'incoming'
        self.incoming.mkdir()
        for module in (catalog, media):
            self.enterContext(patch.object(module, 'THUMBNAILS', self.cache))
        self.scope = ('test-storage', str(self.fixture.remote))
        self.enterContext(patch.object(thumbs, 'active_storage_scope', return_value=self.scope))
        self.enterContext(patch.object(thumbs, 'archive_config', return_value=self.fixture.config))
        self.client = TestClient(api.app)
        self.addCleanup(self.client.close)

    def photo(self):
        path = self.fixture.add_file('photo', 'photo.jpg', self.jpeg())
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET kind='photo' WHERE id='photo'")
            return db.execute("SELECT sha FROM media WHERE id='photo'").fetchone()[0], path

    def test_archive_folder_plan_respects_exact_job_and_id_bounds(self):
        sha,path = self.photo()
        with catalog.database(write=True) as db:
            jobs = []
            for files in ([{'id':'photo','kind':'media','local':'photo/photo.jpg','sha':sha}], []):
                jobs.append(db.execute("INSERT INTO jobs(kind,lane,status,payload,created_at) VALUES ('upload','remote','done',?,'now')",(json.dumps({'files':files}),)).lastrowid)
            first,_ = thumbs.plan_thumbnails(db,thumbs.ThumbnailRequest(scope='folder',view='archives',job_id=jobs[0]))
            empty,_ = thumbs.plan_thumbnails(db,thumbs.ThumbnailRequest(scope='folder',view='archives',job_id=jobs[1]))
        self.assertEqual(first['total'],1)
        self.assertEqual(empty['total'],0)
        for value in (0,-1,2**63):
            self.assertEqual(self.client.post('/api/thumbnails/plan',json={'scope':'folder','view':'archives','job_id':value}).status_code,422)

    def jpeg(self):
        output = io.BytesIO()
        Image.new('RGB', (800, 600), 'blue').save(output, format='JPEG')
        return output.getvalue()

    def remote(self, name='remote.jpg', size=None):
        path = self.fixture.remote / name
        path.write_bytes(self.jpeg())
        sha = 'a' * 64
        with catalog.database(write=True) as db:
            catalog.upsert_remote_file(db, self.scope[0], name, self.scope[1], sha, size or path.stat().st_size)
        return sha, path

    def plan(self, **kwargs):
        with catalog.database() as db:
            return thumbs.plan_thumbnails(db, thumbs.ThumbnailRequest(**kwargs))

    def item(self, sha):
        return self.plan(scope='shas', shas=[sha])[1][0]

    def extract(self, item, **kwargs):
        return thumbs.extract_thumbnail_for_item(item, self.incoming, self.fixture.managed,
            sftp=self.fixture.sftp, base=self.fixture.remote, **kwargs)

    def test_disk_pattern_symlink_and_ready_over_failed(self):
        sha, _ = self.photo()
        (self.cache / f'{sha}-v1.jpg').write_bytes(self.jpeg())
        (self.cache / ('b' * 64 + '-v1.jpg')).symlink_to(self.cache / f'{sha}-v1.jpg')
        (self.cache / 'invalid-v1.jpg').write_bytes(b'no')
        thumbs.record_result(dict(sha=sha, media_kind='photo'), 'failed', '', 'old error')
        with catalog.database() as db:
            ctx = thumbs.context(db)
        state = thumbs.resolve_thumbnail_state('photo', sha, **ctx)
        self.assertEqual(state['thumbnail_status'], 'ready')
        self.assertFalse(state['can_generate_thumbnail'])
        self.assertEqual(list(ctx['disk_shas']), [sha])

    def test_states_non_media_unavailable_failed_generating(self):
        sha, _ = self.photo()
        with catalog.database() as db:
            ctx = thumbs.context(db)
        for kind, digest, expected in [('xmp', sha, 'non_media'), ('photo', 'bad', 'unavailable'), ('photo', sha, 'missing')]:
            self.assertEqual(thumbs.resolve_thumbnail_state(kind, digest, **ctx)['thumbnail_status'], expected)
        ctx['generating_shas'].add(sha)
        self.assertEqual(thumbs.resolve_thumbnail_state('photo', sha, **ctx)['thumbnail_status'], 'generating')
        ctx['generating_shas'].clear()
        ctx['cache_rows'][sha] = dict(status='failed', error='decode error')
        self.assertEqual(thumbs.resolve_thumbnail_state('photo', sha, **ctx)['thumbnail_error'], 'decode error')

    def test_local_photo_atomic_reuse_and_column_sync(self):
        sha, _ = self.photo()
        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, 'scan', {})
            db.execute("UPDATE jobs SET status='done' WHERE id=?", (job_id,))
            db.execute("INSERT INTO scan_files(scan_id,id,path,sha,status) VALUES (?,'photo-scan','photo.jpg',?,'duplicate')", (job_id, sha))
        item = self.item(sha)
        with patch.object(self.fixture.sftp, 'open', wraps=self.fixture.sftp.open) as opened:
            self.assertEqual(self.extract(item)['source'], 'local')
            self.assertEqual(self.extract(item)['status'], 'reused')
            opened.assert_not_called()
        with Image.open(media.thumbnail_path(sha)) as image:
            self.assertLessEqual(image.width, 360)
            self.assertLessEqual(image.height, 240)
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT thumbnail FROM media WHERE id='photo'").fetchone()[0], f'{sha}-v1.jpg')
            self.assertEqual(db.execute("SELECT thumbnail FROM scan_files WHERE id='photo-scan'").fetchone()[0], f'{sha}-v1.jpg')
        self.assertFalse(list(self.cache.glob('.*.jpg')))

    def test_local_source_wins_even_remote_item(self):
        sha, _ = self.photo()
        item = self.item(sha)
        item.update(source_kind='remote_photo', remote_path='absent.jpg')
        with patch.object(self.fixture.sftp, 'open', side_effect=AssertionError('remote access')):
            self.assertEqual(self.extract(item)['source'], 'local')

    def test_remote_photo_reencodes_and_fingerprint_change_falls_back(self):
        sha, path = self.remote()
        self.assertEqual(self.extract(self.item(sha))['source'], 'remote_photo')
        self.assertNotEqual(media.thumbnail_path(sha).read_bytes(), path.read_bytes())
        self.assertEqual(self.plan(scope='shas', shas=[sha])[0]['alreadyReady'], 1)

    def test_none_incoming_root_uses_remote_fallback_with_string_sftp_root(self):
        sha, path = self.remote()
        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, 'scan', {})
            db.execute("UPDATE jobs SET status='done' WHERE id=?", (job_id,))
            db.execute("INSERT INTO scan_files(scan_id,id,path,sha,status) VALUES (?,'incoming','photo.jpg',?,'ready')", (job_id, sha))
        item = self.item(sha)
        normalize = self.fixture.sftp.normalize
        def strict_normalize(root):
            self.assertIsInstance(root, str)
            return normalize(root)
        with patch.object(self.fixture.sftp, 'normalize', side_effect=strict_normalize):
            result = thumbs.extract_thumbnail_for_item(item, None, self.fixture.managed,
                sftp=self.fixture.sftp, base=self.fixture.remote)
        self.assertEqual((result['status'], result['source']), ('generated', 'remote_photo'))

    def test_explicit_cancel_exception_is_rethrown_without_failed_cache(self):
        sha, _ = self.remote()
        class ConsumerCancelled(Exception):
            pass
        with patch.object(thumbs, 'resolve_remote_file', side_effect=ConsumerCancelled):
            with self.assertRaises(ConsumerCancelled):
                self.extract(self.item(sha), cancel_exc=ConsumerCancelled)
        with catalog.database() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM thumbnail_cache WHERE sha=?', (sha,)).fetchone())

    def test_remote_ssh_video_reencodes(self):
        sha, _ = self.remote('movie.mp4')
        with patch.object(thumbs, 'ssh_ffmpeg', return_value=self.jpeg()) as ssh:
            outcome = self.extract(self.item(sha))
        self.assertEqual(outcome['source'], 'remote_video_ssh')
        ssh.assert_called_once()
        with Image.open(media.thumbnail_path(sha)) as image:
            self.assertEqual(image.size, (320, 240))

    def test_real_local_video_and_sftp_video_fallback(self):
        path = self.fixture.managed / 'small.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=480x320:d=0.1',
                        '-c:v', 'libx264', '-threads', '1', '-y', str(path)], check=True)
        digest, info = media.hash_file(self.fixture.managed, 'small.mp4')
        worker.store_analysis('small', 'small.mp4', digest, info, ('video', {}, None, None, '', False, ''))
        outcome = self.extract(self.item(digest))
        self.assertEqual(outcome['status'], 'generated')
        self.assertEqual(outcome['source'], 'local')
        media.thumbnail_path(digest).unlink()
        remote = self.fixture.remote / 'small.mp4'
        remote.write_bytes(path.read_bytes())
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='archived' WHERE id='small'")
            catalog.upsert_remote_file(db, self.scope[0], 'small.mp4', self.scope[1], digest, remote.stat().st_size)
        with patch.object(thumbs, 'ssh_ffmpeg', return_value=None):
            outcome = self.extract(self.item(digest))
        self.assertEqual(outcome['source'], 'remote_video_sftp')
        self.assertEqual(outcome['status'], 'generated')

    def test_cancel_during_sftp_preserves_prior_cache_and_removes_temp(self):
        sha, _ = self.photo()
        self.extract(self.item(sha))
        remote_sha, _ = self.remote()
        item = self.item(remote_sha)
        checks = 0
        def tick():
            nonlocal checks
            checks += 1
            if checks >= 3:
                raise thumbs.UploadCancelled()
        with self.assertRaises(thumbs.UploadCancelled):
            self.extract(item, tick=tick)
        self.assertTrue(media.thumbnail_path(sha).exists())
        self.assertFalse(media.thumbnail_path(remote_sha).exists())
        self.assertFalse(list(self.cache.glob('thumb-*')))

    def test_inactive_remote_root_cannot_generate(self):
        sha, _ = self.remote()
        with patch.object(thumbs, 'active_storage_scope', return_value=('another', '/other')):
            plan, _ = self.plan(scope='shas', shas=[sha])
            self.assertEqual((plan['total'], plan['unavailable']), (0, 1))

    def test_changed_local_fingerprint_is_not_published(self):
        sha, path = self.photo()
        item = self.item(sha)
        path.write_bytes(self.jpeg() + b'changed')
        self.assertEqual(self.extract(item)['status'], 'failed')
        self.assertFalse(media.thumbnail_path(sha).exists())

    def test_sftp_video_limit_never_downloads_large_by_default(self):
        sha, _ = self.remote('large.mp4', thumbs.REMOTE_VIDEO_SFTP_LIMIT_BYTES + 1)
        item = self.item(sha)
        info = self.fixture.sftp.lstat(str(self.fixture.remote / 'large.mp4'))
        fake_info = MagicMock(st_size=thumbs.REMOTE_VIDEO_SFTP_LIMIT_BYTES + 1)
        with patch.object(thumbs, 'resolve_remote_file', return_value=(self.fixture.remote / 'large.mp4', fake_info)), patch.object(thumbs, 'ssh_ffmpeg', return_value=None), patch.object(self.fixture.sftp, 'open') as opened:
            outcome = self.extract(item)
            opened.assert_not_called()
        self.assertEqual(outcome['status'], 'skipped_large')
        self.assertEqual(self.plan(scope='shas', shas=[sha])[0]['skippedLarge'], 1)
        def video(stream, destination, tick):
            with Image.open(io.BytesIO(self.jpeg())) as image:
                media.save_image_preview_atomic(image, destination)
        with patch.object(thumbs, 'resolve_remote_file', return_value=(self.fixture.remote / 'large.mp4', fake_info)), patch.object(thumbs, 'ssh_ffmpeg', return_value=None), patch.object(media, 'video_thumbnail', side_effect=video), patch.object(self.fixture.sftp, 'open', wraps=self.fixture.sftp.open) as opened:
            outcome = self.extract(item, allow_large_sftp_fallback=True)
            opened.assert_called_once()
        self.assertEqual(outcome['status'], 'generated')

    def test_sftp_video_small_and_explicit_large_fallback(self):
        sha, _ = self.remote('movie.mp4')
        def video(stream, destination, tick):
            tick()
            with Image.open(io.BytesIO(self.jpeg())) as image:
                media.save_image_preview_atomic(image, destination)
        for allow in (False, True):
            with self.subTest(allow=allow), patch.object(thumbs, 'ssh_ffmpeg', return_value=None), patch.object(media, 'video_thumbnail', side_effect=video):
                outcome = self.extract(self.item(sha), allow_large_sftp_fallback=allow)
                self.assertEqual(outcome['source'], 'remote_video_sftp')
                media.thumbnail_path(sha).unlink()

    def test_ssh_command_quotes_metacharacters_and_caps_output(self):
        channel = MagicMock()
        channel.recv_ready.side_effect = [True, False]
        channel.recv.return_value = self.jpeg()
        channel.recv_stderr_ready.return_value = False
        channel.exit_status_ready.return_value = True
        channel.recv_exit_status.return_value = 0
        sftp = MagicMock()
        sftp.get_channel.return_value.get_transport.return_value.open_session.return_value = channel
        path = "/NAS/a ' ; $(id)\n.mp4"
        state = {}
        self.assertEqual(thumbs.ssh_ffmpeg(sftp, path, lambda: None, state), self.jpeg())
        command = channel.exec_command.call_args.args[0]
        import shlex
        self.assertEqual(shlex.split(command)[-1], path)
        script = shlex.split(command)[2]
        self.assertIn('-protocol_whitelist file', script)
        self.assertIn('PATH="${PATH:+$PATH:}/opt/homebrew/bin:/usr/local/bin";', script)
        channel.close.assert_called_once()
        channel.recv_ready.side_effect = [True]
        channel.recv.return_value = b'x' * (thumbs.REMOTE_FFMPEG_STDOUT_LIMIT + 1)
        with self.assertRaises(ValueError):
            thumbs.ssh_ffmpeg(sftp, path, lambda: None, {})

    def test_ssh_missing_is_cached(self):
        channel = MagicMock()
        channel.recv_ready.return_value = channel.recv_stderr_ready.return_value = False
        channel.exit_status_ready.return_value = True
        channel.recv_exit_status.return_value = 127
        sftp = MagicMock()
        sftp.get_channel.return_value.get_transport.return_value.open_session.return_value = channel
        state = {}
        self.assertIsNone(thumbs.ssh_ffmpeg(sftp, '/NAS/a.mp4', lambda: None, state))
        self.assertIsNone(thumbs.ssh_ffmpeg(sftp, '/NAS/b.mp4', lambda: None, state))
        self.assertFalse(state['supported'])
        channel.exec_command.assert_called_once()

    def test_remote_escape_and_symlink_rejected(self):
        sha, path = self.remote()
        for remote_path in ('../remote.jpg', '/etc/passwd', 'link.jpg'):
            if remote_path == 'link.jpg':
                (path.parent / remote_path).symlink_to(path)
            item = dict(self.item(sha), remote_path=remote_path)
            self.assertEqual(self.extract(item)['status'], 'failed')
            self.assertFalse(media.thumbnail_path(sha).exists())

    def test_cancel_queued_running_and_idempotent_restart(self):
        sha, _ = self.photo()
        response = self.client.post('/api/jobs/thumbnails', json=dict(scope='shas', shas=[sha]))
        self.assertEqual(response.status_code, 202)
        job_id = response.json()['id']
        self.assertEqual(self.client.post(f'/api/jobs/thumbnails/{job_id}/cancel').json()['status'], 'cancelled')
        response = self.client.post('/api/jobs/thumbnails', json=dict(scope='shas', shas=[sha]))
        job_id = response.json()['id']
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())
        self.client.post(f'/api/jobs/thumbnails/{job_id}/cancel')
        thumbs.generate_thumbnails(job, self.incoming, self.fixture.managed)
        with catalog.database() as db:
            self.assertEqual(db.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()[0], 'cancelled')
        thumbs.generate_thumbnails(dict(job, payload=json.dumps(dict(items=json.loads(job['payload'])['items']))), self.incoming, self.fixture.managed)
        self.assertFalse(media.thumbnail_path(sha).exists())

    def test_worker_reentry_reuses_completed_cache(self):
        sha, _ = self.photo()
        item = self.item(sha)
        self.extract(item)
        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, 'thumbnails-local', dict(items=[item]))
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())
        thumbs.generate_thumbnails(job, self.incoming, self.fixture.managed)
        thumbs.generate_thumbnails(job, self.incoming, self.fixture.managed)
        with catalog.database() as db:
            result = json.loads(db.execute('SELECT result FROM jobs WHERE id=?', (job_id,)).fetchone()[0])
        self.assertEqual(result['reused'], 1)

    def test_api_plan_lanes_conflict_noop_and_invalid_sha(self):
        sha, _ = self.photo()
        request = dict(scope='shas', shas=[sha])
        plan = self.client.post('/api/thumbnails/plan', json=request)
        self.assertEqual(plan.status_code, 200)
        self.assertEqual(plan.json()['lane'], 'local')
        result = self.client.post('/api/jobs/thumbnails', json=request)
        self.assertEqual(result.json()['kind'], 'thumbnails-local')
        self.assertEqual(self.client.post('/api/jobs/thumbnails', json=request).status_code, 409)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='done'")
            catalog.queue_job(db, 'scan', {})
        self.assertEqual(self.client.post('/api/jobs/thumbnails', json=request).status_code, 409)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='done'")
        self.extract(self.item(sha))
        self.assertEqual(self.client.post('/api/jobs/thumbnails', json=request).json()['status'], 'noop')
        self.assertEqual(self.client.post('/api/thumbnails/plan', json=dict(scope='shas', shas=['bad'])).status_code, 400)

    def test_remote_plan_and_unconfigured_enqueue(self):
        sha, _ = self.remote('remote.mp4', thumbs.REMOTE_VIDEO_SFTP_LIMIT_BYTES + 1)
        plan, _ = self.plan(scope='shas', shas=[sha])
        self.assertEqual((plan['lane'], plan['remoteVideosOverLimit']), ('remote', 1))
        with patch.object(thumbs, 'archive_config', side_effect=HTTPException(409, '설정 필요')):
            self.assertEqual(self.client.post('/api/jobs/thumbnails', json=dict(scope='shas', shas=[sha])).status_code, 400)
        response = self.client.post('/api/jobs/thumbnails', json=dict(scope='shas', shas=[sha]))
        self.assertEqual(response.json()['kind'], 'thumbnails-remote')

    def test_cleanup_reference_protection_busy_reset_failures_and_legacy_restore(self):
        sha, _ = self.remote()
        orphan = 'b' * 64
        for digest in (sha, orphan):
            (self.cache / f'{digest}-v1.jpg').write_bytes(b'cached')
        result = self.client.post('/api/settings/thumbnails/cleanup')
        self.assertEqual(result.json()['deleted'], 1)
        self.assertEqual(result.json()['stats']['cachedCount'], 1)
        self.assertEqual(result.json()['stats']['orphanCount'], 0)
        self.assertTrue(media.thumbnail_path(sha).exists())
        with catalog.database(write=True) as db:
            self.assertTrue(thumbs.sha_is_referenced(db, sha))
            catalog.queue_job(db, 'scan', {})
        self.assertEqual(self.client.post('/api/settings/thumbnails/cleanup').status_code, 409)
        thumbs.record_result(dict(sha=orphan, media_kind='photo'), 'failed', '', 'failed')
        self.assertEqual(self.client.post('/api/settings/thumbnails/reset-failures').json()['cleared'], 1)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='done'")
        with catalog.database() as db:
            source = sqlite3.connect(self.root / 'legacy.db')
            db.backup(source)
            source.execute('DROP TABLE thumbnail_cache')
            source.commit()
            self.assertNotIn('thumbnail_cache', settings.restore_columns(source, db))
            source.close()
        with patch.object(settings, 'DATA', catalog.DATA):
            settings.restore_catalog_file(self.root / 'legacy.db')
        with catalog.database() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM thumbnail_cache').fetchone()[0], 0)

    def test_temp_cleanup_only_known_temp_names(self):
        stale = self.cache / ('.' + '1' * 32 + '.tmp.jpg')
        stale.touch()
        (self.cache / 'thumb-leftover').mkdir()
        (self.cache / 'keep.txt').touch()
        thumbs.cleanup_temp_thumbnails()
        self.assertEqual([p.name for p in self.cache.iterdir()], ['keep.txt'])
