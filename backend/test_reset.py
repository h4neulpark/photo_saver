import json
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

import api
import catalog
import devices
import media
import records
import resets
import os
import settings
import test_transfers
import worker


class CatalogResetTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temporary.name)
        self.incoming = self.root / 'incoming'
        self.incoming.mkdir()
        (self.incoming / 'duplicate.MP4').write_bytes(b'first video')
        self.settings_dir = self.root / 'settings'
        (self.settings_dir / 'ssh').mkdir(parents=True)
        (self.settings_dir / 'address').write_text('192.0.2.10')
        (self.settings_dir / 'remote-root').write_text('/archive')
        (self.settings_dir / 'storage-id').write_text('11112222333344445555666677778888')
        (self.settings_dir / 'ssh' / 'id_ed25519').write_bytes(b'test private key')
        (self.settings_dir / 'ssh' / 'id_ed25519.pub').write_bytes(b'test public key')
        (self.settings_dir / 'ssh' / 'public_key_copied').touch()
        self.thumbnails = self.root / 'thumbnails'
        self.thumbnails.mkdir()
        (self.thumbnails / 'cached-v1.jpg').write_bytes(b'test cache')
        for module, name, value in (
            (settings, 'SETTINGS_DIR', self.settings_dir),
            (settings, 'DATA', catalog.DATA),
            (resets, 'DATA', catalog.DATA),
            (resets, 'THUMBNAILS', self.thumbnails),
            (catalog, 'THUMBNAILS', self.thumbnails),
            (worker, 'THUMBNAILS', self.thumbnails),
            (media, 'THUMBNAILS', self.thumbnails),
        ):
            patcher = patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET start='2026-01-01',end='2026-12-31',zone='Asia/Seoul' WHERE id='parent'")
        devices.rename_device(devices.DeviceName(source='GoPro HERO8 Black', name='GoPro8'))
        self.fixture.run_job(self.fixture.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}]))
        with catalog.database(write=True) as db:
            scan_id = catalog.queue_job(db, 'scan', {})
            db.execute("UPDATE jobs SET status='done' WHERE id=?", (scan_id,))
            db.execute("INSERT INTO scan_files(scan_id,id,path,status) VALUES (?,'scanned','duplicate.MP4','duplicate')", (scan_id,))
            db.execute("INSERT INTO scan_xmp(id,scan_id,file,candidates) VALUES ('xmp',?,?,'[]')",
                       (scan_id, json.dumps({"path": "orphan.xmp", "metadata": {}})))

    def queue(self):
        response = settings.reset_catalog(settings.CatalogReset(confirmation='모든 데이터 삭제'))
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return json.loads(response.body)['id']

    def run_reset(self, job_id):
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())
        resets.reset_local_data(job, self.incoming, self.fixture.managed)

    def rows(self):
        with catalog.database() as db:
            return {table: [tuple(row) for row in db.execute(f'SELECT * FROM {table}')]
                    for table in catalog.CATALOG_TABLES}

    def test_deletes_managed_and_history_preserves_all_incoming_ssh_and_remote(self):
        with catalog.database(write=True) as db:
            db.execute("INSERT INTO thumbnail_cache(sha,status,updated_at) VALUES (?,'failed','now')", ('a' * 64,))
        protected = {str(p): p.read_bytes() for root in (self.settings_dir, self.fixture.remote)
                     for p in root.rglob('*') if p.is_file()}
        (self.root / '.env').write_text('deployment config')
        (self.incoming / 'returned-old/nested').mkdir(parents=True)
        (self.incoming / 'returned-old/nested/.hidden').write_bytes(b'hidden')
        (self.incoming / 'sidecar.xmp').write_bytes(b'xmp')
        (self.incoming / 'aux.LRV').write_bytes(b'aux')
        (self.incoming / 'edits.AAE').write_bytes(b'apple edits')
        (self.fixture.managed / 'edits.AAE').write_bytes(b'old apple edits')
        (catalog.DATA / 'leftover.sqlite3').write_bytes(b'old backup')
        (catalog.DATA / 'temp/sub').mkdir(parents=True)
        (catalog.DATA / 'temp/sub/leftover').write_bytes(b'temp')
        (catalog.DATA / 'worker.lock').touch()
        db_path = catalog.DATA / 'catalog.sqlite3'
        inode = db_path.stat().st_ino
        incoming_files = {str(p.relative_to(self.incoming)): p.read_bytes() for p in self.incoming.rglob('*') if p.is_file()}
        incoming_dirs = {str(p.relative_to(self.incoming)) for p in self.incoming.rglob('*') if p.is_dir()}
        job_id = self.queue()
        self.assertTrue(api.state()['managed'])  # registering does not delete files
        self.run_reset(job_id)
        for root in (self.fixture.managed, self.thumbnails):
            self.assertTrue(root.is_dir())
            self.assertEqual(list(root.iterdir()), [])
        self.assertEqual({str(p.relative_to(self.incoming)): p.read_bytes() for p in self.incoming.rglob('*') if p.is_file()}, incoming_files)
        self.assertEqual({str(p.relative_to(self.incoming)) for p in self.incoming.rglob('*') if p.is_dir()}, incoming_dirs)
        self.assertTrue(all(not rows for rows in self.rows().values()))
        self.assertEqual(db_path.stat().st_ino, inode)
        self.assertTrue({p.name for p in catalog.DATA.iterdir()}.issubset(resets.CATALOG_FILES))
        self.assertEqual({name: Path(name).read_bytes() for name in protected}, protected)
        self.assertEqual((self.root / '.env').read_text(), 'deployment config')
        self.assertIsNone(api.state()['job'])
        self.assertEqual(api.state()['incoming'], [])
        self.assertEqual(api.state()['managed'], [])
        self.assertEqual(devices.get_devices()['devices'], [])
        self.assertFalse(api.reset_in_progress())
        with catalog.database(write=True) as db:
            self.assertIsNotNone(catalog.queue_job(db, 'scan', {}))

    def test_blocks_all_active_jobs_without_changing_data(self):
        for kind in ('scan', 'move', 'delete', 'xmp-link', 'upload', 'offload', 'remote-index', 'reset-all'):
            for status in ('queued', 'running'):
                with self.subTest(kind=kind, status=status):
                    with catalog.database(write=True) as db:
                        job_id = catalog.queue_job(db, kind, {})
                        db.execute('UPDATE jobs SET status=? WHERE id=?', (status, job_id))
                    before = self.rows()
                    with self.assertRaises(HTTPException) as error:
                        self.queue()
                    self.assertEqual(error.exception.status_code, 409)
                    self.assertEqual(self.rows(), before)
                    self.assertEqual(api.reset_in_progress(), kind == 'reset-all')
                    with catalog.database(write=True) as db:
                        db.execute('DELETE FROM jobs WHERE id=?', (job_id,))

    def test_old_confirmation_is_rejected(self):
        before = self.rows()
        for body in ({}, {'confirmation':'초기화'}, {'confirmation':'모든 데이터 삭제 '}, {'confirmation':''}):
            with self.subTest(body=body), self.assertRaises(ValidationError):
                settings.CatalogReset(**body)
        self.assertEqual(self.rows(), before)

    def test_symlinks_and_special_files_are_removed_without_following_targets(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'keep').write_bytes(b'outside')
        (self.incoming / 'file-link').symlink_to(outside / 'keep')
        (self.incoming / 'dir-link').symlink_to(outside, target_is_directory=True)
        os.mkfifo(self.incoming / 'fifo')
        (self.fixture.managed / 'file-link').symlink_to(outside / 'keep')
        (self.fixture.managed / 'dir-link').symlink_to(outside, target_is_directory=True)
        os.mkfifo(self.fixture.managed / 'fifo')
        self.run_reset(self.queue())
        self.assertEqual((outside / 'keep').read_bytes(), b'outside')
        self.assertTrue((self.incoming / 'file-link').is_symlink())
        self.assertTrue((self.incoming / 'dir-link').is_symlink())
        self.assertTrue((self.incoming / 'fifo').exists())
        self.assertEqual(list(self.fixture.managed.iterdir()), [])
        self.assertEqual((self.incoming / 'duplicate.MP4').read_bytes(), b'first video')
        self.assertTrue(all(not rows for rows in self.rows().values()))

    def test_process_interruption_resumes_idempotently(self):
        job_id = self.queue()
        unlink = resets.os.unlink
        def interrupt(*args, **kwargs):
            unlink(*args, **kwargs)
            raise KeyboardInterrupt('simulated process stop')
        with patch.object(resets.os, 'unlink', side_effect=interrupt), self.assertRaises(KeyboardInterrupt):
            self.run_reset(job_id)
        self.assertTrue(api.reset_in_progress())
        self.run_reset(job_id)
        self.assertTrue(all(not rows for rows in self.rows().values()))
        self.assertEqual((self.incoming / 'duplicate.MP4').read_bytes(), b'first video')
        self.assertEqual(list(self.fixture.managed.iterdir()), [])

    def test_partial_failure_is_reported_and_retry_finishes(self):
        job_id = self.queue()
        unlink = resets.os.unlink
        def fail_after_delete(*args, **kwargs):
            unlink(*args, **kwargs)
            raise OSError('simulated deletion error')
        with patch.object(resets.os, 'unlink', side_effect=fail_after_delete):
            self.run_reset(job_id)
        with catalog.database() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            self.assertEqual(row['status'], 'failed')
            self.assertIn('이미 삭제된 파일은 복구되지 않습니다', json.loads(row['result'])['error'])
        self.run_reset(self.queue())
        self.assertTrue(all(not rows for rows in self.rows().values()))

    def test_db_failure_keeps_failure_visible_without_claiming_file_rollback(self):
        with catalog.database(write=True) as db:
            db.execute("CREATE TRIGGER fail_reset BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'test failure'); END")
        job_id = self.queue()
        self.run_reset(job_id)
        self.assertEqual((self.incoming / 'duplicate.MP4').read_bytes(), b'first video')
        self.assertEqual(list(self.fixture.managed.iterdir()), [])
        with catalog.database() as db:
            self.assertEqual(db.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()[0], 'failed')
            self.assertTrue(db.execute('SELECT 1 FROM events').fetchone())
        with catalog.database(write=True) as db:
            db.execute('DROP TRIGGER fail_reset')
        self.run_reset(self.queue())
        self.assertTrue(all(not rows for rows in self.rows().values()))

    def test_overlapping_roots_refused_before_any_deletion(self):
        with patch.object(resets, 'THUMBNAILS', self.incoming):
            self.run_reset(self.queue())
        self.assertTrue((self.incoming / 'duplicate.MP4').exists())
        self.assertTrue((self.fixture.managed / 'one/clip.MP4').exists())

    def test_preserved_incoming_can_be_collected_again_after_reset(self):
        self.run_reset(self.queue())
        with catalog.database(write=True) as db:
            scan_id = catalog.queue_job(db, 'scan', {})
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (scan_id,)).fetchone())
        worker.scan_incoming(job, self.incoming, self.fixture.managed)
        snapshot = api.state()
        self.assertEqual(snapshot['managed'], [])
        self.assertEqual(len(snapshot['incoming']), 1)
        self.assertEqual(snapshot['incoming'][0]['status'], 'ready')
        self.assertEqual((self.incoming / 'duplicate.MP4').read_bytes(), b'first video')

    def test_empty_reset_is_repeatable(self):
        self.run_reset(self.queue())
        self.run_reset(self.queue())
        self.assertTrue(all(not rows for rows in self.rows().values()))


if __name__ == '__main__':
    unittest.main()
