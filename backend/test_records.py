import json
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import patch

import archive
import catalog
import records
import settings
import test_transfers


class CatalogRecordsTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def query(self, view='files', q='', scope='all', page=1, page_size=50, event='all', device=''):
        response = records.catalog_records(view=view, q=q, scope=scope, page=page, page_size=page_size, event=event, device=device)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return json.loads(response.body)

    def test_event_tree_parent_child_device_and_pagination_are_independent(self):
        self.fixture.add_file('two', 'parent.MP4', b'parent')
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET event_id='parent',device='iPhone' WHERE id='two'")
        result = self.query(page_size=1)
        folders = {folder['id']: folder for folder in result['folders']}
        self.assertEqual(folders['parent']['name'], 'Trip')
        self.assertEqual(folders['child']['parent_id'], 'parent')
        self.assertEqual(folders['child']['count'], 2)
        self.assertEqual(folders['parent']['devices'], [{'name': 'iPhone', 'count': 1}])
        self.assertEqual(self.query(event='parent')['total'], 3)
        self.assertEqual(self.query(event='child')['total'], 2)
        self.assertEqual(self.query(event='parent', device='iPhone')['total'], 1)
        self.assertEqual(self.query(event='parent', device='GoPro HERO8 Black')['total'], 0)
        self.assertEqual(self.query(event='child', device='GoPro HERO8 Black', scope='xmp')['total'], 1)
        self.assertEqual(self.query(event='child', q='no-match')['folders'], result['folders'])
        self.assertEqual(self.query(event="parent' OR 1=1 --")['total'], 0)

    def test_archive_folders_follow_event_classification_and_unassigned(self):
        self.fixture.run_job(self.fixture.queue())
        result = self.query('archives', event='parent')
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['rows'][0]['event_id'], 'child')
        self.assertEqual(self.query('archives', event='child', device='GoPro HERO8 Black')['total'], 1)
        with catalog.database(write=True) as db:
            db.execute('UPDATE media SET event_id=NULL,device=NULL')
        self.assertEqual(self.query(event='unassigned')['total'], 2)
        self.assertEqual(self.query('archives', event='unassigned')['unassigned'], 1)

    def test_primary_sidecar_hashes_search_scopes_and_pagination(self):
        result = self.query()
        self.assertEqual(result['total'], 2)
        self.assertEqual({r['kind'] for r in result['rows']}, {'video', 'xmp'})
        self.assertEqual(len(result['rows'][0]['sha']), 64)
        prefix = result['rows'][0]['sha'][:16]
        self.assertEqual(self.query(q=prefix)['total'], 1)
        self.assertEqual(self.query(scope='xmp')['total'], 1)
        self.assertEqual(self.query(scope='incoming')['total'], 0)
        self.assertEqual(self.query(page_size=1)['pages'], 2)
        self.assertEqual(self.query(page=500, page_size=1)['page'], 2)
        self.fixture.add_file('special', "한글%_'.MP4", b'special')
        self.assertEqual(self.query(q='%_')['total'], 1)
        self.assertEqual(self.query(q="' OR 1=1 --")['total'], 0)

    def test_verified_archive_has_exact_path_hash_size_and_time(self):
        job = self.fixture.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}])
        self.fixture.run_job(job)
        result = self.query('archives', scope='verified')
        self.assertEqual(result['total'], 2)
        for row in result['rows']:
            self.assertEqual(row['outcome'], 'uploaded')
            self.assertEqual(row['archive_root'], str(self.fixture.remote))
            self.assertTrue(row['target'].startswith('Trip/Day/GoPro HERO8 Black/'))
            self.assertTrue(row['verified_at'])
            self.assertGreater(row['size'], 0)
        self.assertEqual(self.query(scope='verified')['total'], 2)
        self.assertNotIn('private-account', json.dumps(result))

    def test_partial_failure_does_not_hide_success_or_mark_failed_file_verified(self):
        self.fixture.add_file('two', 'other.MP4', b'second')
        target = self.fixture.remote / 'Trip/Day/GoPro HERO8 Black'
        target.mkdir(parents=True)
        (target / 'clip.MP4').write_bytes(b'other video')
        self.fixture.run_job(self.fixture.queue([{'id': 'one'}, {'id': 'two'}]))
        self.assertEqual(self.query('archives', scope='verified')['total'], 1)
        failed = self.query('archives', scope='failed')
        self.assertEqual(failed['total'], 1)
        self.assertIsNone(failed['rows'][0]['verified_at'])
        self.assertIn('덮어쓰지', failed['rows'][0]['error'])
        self.assertEqual(self.query(scope='verified')['rows'][0]['file_id'], 'two')

    def test_legacy_success_is_distinct_and_cancelled_manifest_is_unknown(self):
        job = self.fixture.queue()
        self.fixture.run_job(job)
        with catalog.database(write=True) as db:
            db.execute('DELETE FROM archive_entries')
        row = self.query('archives')['rows'][0]
        self.assertEqual(row['outcome'], 'legacy_verified')
        self.assertIsNone(row['archive_root'])
        self.assertTrue(row['verified_at'])
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='cancelled'")
        result = self.query('archives', scope='verified')
        self.assertEqual(result['total'], 0)
        row = self.query('archives', scope='unknown')['rows'][0]
        self.assertEqual(row['outcome'], 'unknown')
        self.assertIsNone(row['verified_at'])

    def test_incoming_history_missing_media_and_current_sha_are_distinguished(self):
        job = self.fixture.queue()
        self.fixture.run_job(job)
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='missing',sha=?", ('f'*64,))
            db.execute("INSERT INTO scan_files(scan_id,id,path,sha,size,status) VALUES (?,?,?,?,?,?)", (job['id'], 'incoming', 'incoming.MP4', 'a'*64, 10, 'duplicate'))
        result = self.query()
        self.assertEqual(result['total'], 3)
        self.assertEqual(self.query(scope='incoming')['total'], 1)
        self.assertEqual(self.query(scope='verified')['total'], 0)
        self.assertIn('missing', {r['status'] for r in result['rows']})

    def test_backup_restore_includes_archive_entries_and_accepts_old_backups(self):
        job = self.fixture.queue()
        self.fixture.run_job(job)
        backup = Path(self.fixture.temporary.name) / 'backup.sqlite3'
        with catalog.database() as source:
            destination = sqlite3.connect(backup)
            try:
                source.backup(destination)
            finally:
                destination.close()
        with catalog.database(write=True) as db:
            db.execute('DELETE FROM archive_entries')
        settings.restore_catalog_file(backup)
        self.assertEqual(self.query('archives')['rows'][0]['outcome'], 'uploaded')
        connection = sqlite3.connect(backup)
        try:
            connection.execute('DROP TABLE archive_entries')
            connection.commit()
        finally:
            connection.close()
        settings.restore_catalog_file(backup)
        self.assertEqual(self.query('archives')['rows'][0]['outcome'], 'legacy_verified')

    def test_archived_status_and_download_flags(self):
        job = self.fixture.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}])
        self.fixture.run_job(job)
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='archived' WHERE id='one'")
        with patch.object(archive, 'archive_config', return_value=self.fixture.config):
            files = self.query(view='files')
            archives = self.query(view='archives')
        self.assertTrue(all(row['status'] == 'archived' and row['can_download'] and row['download_path'] for row in files['rows']))
        self.assertTrue(all(row['can_download'] for row in archives['rows']))
        mismatch = {**self.fixture.config, 'root': '/other/root'}
        with patch.object(archive, 'archive_config', return_value=mismatch):
            self.assertFalse(any(row['can_download'] for row in self.query(view='files')['rows']))
            self.assertFalse(any(row['can_download'] for row in self.query(view='archives')['rows']))


if __name__ == '__main__':
    unittest.main()
