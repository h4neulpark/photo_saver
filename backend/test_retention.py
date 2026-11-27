"""Retention is opt-in, scoped to verified copies, and never deletes by itself."""
import json
import sqlite3
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
import catalog
import offload
import resets
import settings
import test_offload


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_offload.OffloadAndArchiveModelTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.file = self.fixture.settings_dir / 'local-retention.json'
        for module, name, value in ((settings, 'LOCAL_RETENTION_FILE', self.file), (settings, 'DATA', catalog.DATA)):
            p = patch.object(module, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(api.app)

    def upload(self):
        self.fixture.upload_all()
        with catalog.database(write=True) as db:
            db.execute("UPDATE remote_files SET verified_at='2020-01-01T00:00:00+00:00'")

    def candidates(self):
        with catalog.database() as db:
            return offload.retention_candidates(db)

    def test_get_put_validation_private_file_and_no_store(self):
        self.assertEqual(self.client.get('/api/settings').json()['localRetention'], {'mode': 'manual', 'days': None})
        for value in (0, 7, 3650):
            response = self.client.put('/api/settings/retention', json={'mode': 'days', 'days': value})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.json()['localRetention'], {'mode': 'days', 'days': value})
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)
        for policy in ({'mode': 'days'}, {'mode': 'days', 'days': -1}, {'mode': 'days', 'days': 3651},
                       {'mode': 'days', 'days': True}, {'mode': 'days', 'days': False}, {'mode': 'days', 'days': 1.5},
                       {'mode': 'days', 'days': '7'}, {'mode': 'manual', 'days': 0}, {'mode': 'invalid'}):
            with self.subTest(policy=policy):
                response = self.client.put('/api/settings/retention', json=policy)
                self.assertIn(response.status_code, (400, 422))
                self.assertEqual(settings.read_local_retention(), {'mode': 'days', 'days': 3650})

    def test_corrupt_policy_fails_safe(self):
        for text in ('{', 'null', '[]', '{"mode":"days","days":true}', '{"mode":"manual","days":2}', '{"mode":"days","days":null}'):
            self.file.write_text(text)
            self.assertEqual(settings.read_local_retention(), {'mode': 'manual', 'days': None})

    def test_verified_at_not_capture_or_seen_and_zero_day(self):
        self.upload()
        settings.save_local_retention('days', 7)
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET capture_time='2099-01-01T00:00:00Z'")
            db.execute("UPDATE remote_files SET last_seen_at='2099-01-01T00:00:00Z'")
        result = self.candidates()
        self.assertEqual((result['ids'], result['totalBytes']), (['one'], 17))
        self.assertEqual(result['samples'][0]['archivedAt'], '2020-01-01T00:00:00+00:00')
        settings.save_local_retention('days', 0)
        with catalog.database(write=True) as db:
            db.execute("UPDATE remote_files SET verified_at='2099-01-01T00:00:00Z'")
        self.assertEqual(self.candidates()['ids'], ['one'])
        settings.save_local_retention('manual', None)
        self.assertEqual(self.candidates()['ids'], [])

    def test_min_copies_max_xmp_and_storage_preference(self):
        row = {'status': 'available', 'xmp_path': 'one.xmp', 'xmp_sha': 'x'}
        copies = [{'storage_id': 'a', 'verified_at': '2026-01-03'}, {'storage_id': 'a', 'verified_at': '2026-01-01'}, {'storage_id': 'b', 'verified_at': '2010-01-01'}]
        xmp = [{'storage_id': 'a', 'verified_at': '2026-01-02'}]
        result = offload.compute_media_retention(row, copies, xmp, {'mode': 'days', 'days': 7}, datetime(2026, 1, 8, tzinfo=timezone.utc), active_storage_id='a')
        self.assertEqual(result['archivedAt'], '2026-01-02T00:00:00+00:00')
        self.assertEqual(result['retentionDueAt'], '2026-01-09T00:00:00+00:00')
        self.assertFalse(result['retentionEligible'])
        self.assertEqual(offload.parse_utc_iso('2026-01-01T09:00:00+09:00').isoformat(), '2026-01-01T00:00:00+00:00')
        for value in ('', None, 'bad', 42):
            self.assertIsNone(offload.parse_utc_iso(value))

    def test_null_remote_hash_cannot_verify_an_xmp_with_no_hash(self):
        self.upload()
        settings.save_local_retention('days', 0)
        with catalog.database(write=True) as db:
            db.execute("UPDATE remote_files SET sha=NULL WHERE path LIKE '%.xmp'")
            db.execute("UPDATE media SET xmp_sha=NULL WHERE id='one'")
        with catalog.database() as db:
            storage_id, _, copies, _ = offload.candidate_context(db)
            self.assertNotIn(None, copies)
            row = db.execute("SELECT * FROM media WHERE id='one'").fetchone()
            unknown_xmp = [dict(db.execute('SELECT * FROM remote_files WHERE sha IS NULL').fetchone())]
            info = offload.compute_media_retention(row, copies[row['sha']], unknown_xmp,
                {'mode': 'days', 'days': 0}, datetime.now(timezone.utc), active_storage_id=storage_id)
        self.assertIsNone(info['archivedAt'])
        self.assertIsNone(info['retentionDueAt'])
        self.assertFalse(info['retentionEligible'])
        self.assertEqual(self.candidates()['ids'], [])
        file = api.state()['managed'][0]
        self.assertIsNone(file['archivedAt'])
        self.assertFalse(file['retentionEligible'])

    def test_state_reuses_policy_and_time_for_media_and_retention_summary(self):
        self.upload()
        policy = {'mode': 'days', 'days': 7}
        stamp = datetime(2020, 1, 8, tzinfo=timezone.utc)
        with patch.object(api, 'read_local_retention', return_value=policy) as read_policy, \
                patch.object(api, 'datetime') as clock, \
                patch.object(offload, 'read_local_retention', side_effect=AssertionError('must use state policy snapshot')), \
                patch.object(offload, 'retention_candidates', wraps=offload.retention_candidates) as candidates:
            clock.now.return_value = stamp
            state = api.state()
        read_policy.assert_called_once_with()
        clock.now.assert_called_once_with(timezone.utc)
        self.assertIs(candidates.call_args.kwargs['policy'], policy)
        self.assertIs(candidates.call_args.kwargs['now_dt'], stamp)
        self.assertTrue(state['managed'][0]['retentionEligible'])
        self.assertEqual(state['retention']['eligibleCount'], 1)

    def test_null_or_bad_verified_at_fails_closed_including_remote_index(self):
        self.upload()
        settings.save_local_retention('days', 0)
        for asset in ('media', 'xmp'):
            for value in (None, '', 'not a date'):
                with catalog.database(write=True) as db:
                    db.execute("UPDATE remote_files SET verified_at='2020-01-01'")
                    sha = db.execute('SELECT sha,xmp_sha FROM media').fetchone()[0 if asset == 'media' else 1]
                    db.execute('UPDATE remote_files SET verified_at=? WHERE sha=?', (value, sha))
                result = self.candidates()
                self.assertEqual((result['ids'], result['missingVerifiedAtCount']), ([], 1))
        # A remote-index verification is sufficient; no archive_entries join is required.
        with catalog.database(write=True) as db:
            db.execute('DELETE FROM archive_entries')
            db.execute("UPDATE remote_files SET verified_at='2020-01-01'")
        self.assertEqual(self.candidates()['ids'], ['one'])

    def test_missing_xmp_other_root_or_unconfigured_and_keeper(self):
        self.upload()
        settings.save_local_retention('days', 0)
        with patch.object(offload, 'active_storage_scope', return_value=(None, None)):
            result = self.candidates()
            self.assertFalse(result['storageConfigured'])
            self.assertEqual(result['ids'], [])
        with patch.object(offload, 'active_storage_scope', return_value=('other', '/different')):
            self.assertEqual(self.candidates()['ids'], [])
        with catalog.database(write=True) as db:
            db.execute("UPDATE remote_files SET status='missing' WHERE path LIKE '%.xmp'")
        self.assertEqual((self.candidates()['ids'], self.candidates()['missingVerifiedAtCount']), ([], 0))
        with catalog.database(write=True) as db:
            db.execute("UPDATE remote_files SET status='present'")
            catalog.queue_job(db, 'duplicate-cleanup', {'files': [{'keeper': {'kind': 'managed', 'id': 'one'}}]})
        self.assertEqual((self.candidates()['ids'], self.candidates()['blockedByKeeperCount']), ([], 1))

    def test_candidates_api_state_upload_exclusions_and_not_found(self):
        self.fixture.upload_all([{'id': 'one'}])
        state = api.state()
        job_id = state['jobs']['remote']['id']
        self.assertEqual(state['latestUploadOffload']['excludedMissingXmp'], 1)
        self.fixture.upload_all([{'id': 'one', 'kind': 'xmp'}])
        job_id = api.state()['jobs']['remote']['id']
        response = self.client.get(f'/api/archive/transfers/{job_id}/offload-candidates')
        self.assertEqual(response.json()['ids'], ['one'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        settings.save_local_retention('days', 0)
        state = api.state()
        self.assertEqual(state['retention']['eligibleCount'], 1)
        file = state['managed'][0]
        self.assertEqual((file['sizeBytes'], file['xmpSizeBytes'], file['retentionEligible']), (11, 6, True))
        self.assertIsInstance(file['size'], float)
        self.assertEqual(self.client.get('/api/offload/retention-candidates').json()['ids'], ['one'])
        self.assertEqual(self.client.get('/api/archive/transfers/999999/offload-candidates').status_code, 404)
        self.assertEqual(self.client.post('/api/jobs/offload/999999/cancel').status_code, 404)

    def test_candidate_order_and_cap(self):
        self.upload()
        settings.save_local_retention('days', 0)
        with catalog.database(write=True) as db:
            # Multiple catalog placements may share one verified remote hash.
            row = dict(db.execute("SELECT * FROM media WHERE id='one'").fetchone())
            fields = list(row)
            db.executemany(f"INSERT INTO media ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", [
                tuple((f'id-{i:05}' if k == 'id' else f'copy-{i:05}' if k == 'name' else f'copy/{i}' if k == 'path' else row[k]) for k in fields)
                for i in range(10001)
            ])
        result = self.candidates()
        self.assertEqual((len(result['ids']), result['totalEligibleCount'], result['truncated'], len(result['samples'])), (10000, 10002, True, 50))
        self.assertEqual(result['ids'][:2], ['one', 'id-00000'])
        self.assertEqual(result['totalBytes'], 10002 * 17)

    def test_catalog_restore_and_reset_keep_policy(self):
        settings.save_local_retention('days', 14)
        backup = self.fixture.root / 'backup.sqlite3'
        with catalog.database() as db:
            target = sqlite3.connect(backup)
            db.backup(target)
            target.close()
        settings.restore_catalog_file(backup)
        self.assertEqual(settings.read_local_retention()['days'], 14)
        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, 'reset-all', {})
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())
        with patch.object(resets, 'DATA', catalog.DATA), patch.object(resets, 'THUMBNAILS', self.fixture.thumbnails):
            resets.reset_local_data(job, self.fixture.root / 'incoming', self.fixture.fixture.managed)
        self.assertEqual(settings.read_local_retention()['days'], 14)


if __name__ == '__main__':
    unittest.main()
