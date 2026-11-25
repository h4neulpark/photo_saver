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

    def test_date_prefixed_event_labels_search_and_folder_metadata(self):
        self.fixture.add_file('top', 'top.MP4', b'top')
        self.fixture.run_job(self.fixture.queue())
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET name='나고야',folder='260903_나고야',start='2026-09-03',zone='Asia/Tokyo' WHERE id='parent'")
            db.execute("UPDATE events SET name='1일차',folder='1일차' WHERE id='child'")
            db.execute("UPDATE media SET event_id='parent',original_path='camera/top.MP4' WHERE id='top'")
            db.execute("UPDATE media SET original_path='camera/clip.MP4' WHERE id='one'")
        result = self.query()
        rows = {row['record_key']: row for row in result['rows']}
        self.assertEqual(rows['managed:top']['event_name'], '260903_나고야')
        self.assertEqual(rows['managed:one']['event_name'], '260903_나고야 / 1일차')
        self.assertEqual(rows['xmp:one']['event_name'], rows['managed:one']['event_name'])
        folders = {row['id']: row for row in result['folders']}
        self.assertEqual((folders['parent']['name'], folders['parent']['folder'], folders['parent']['zone']), ('나고야', '260903_나고야', 'Asia/Tokyo'))
        for query in ('260903', '260903_나고야', '나고야', '1일차'):
            with self.subTest(query=query):
                self.assertGreater(self.query(q=query)['total'], 0)
                archive_row = self.query('archives', q=query)['rows'][0]
                self.assertEqual(archive_row['event_name'], '260903_나고야 / 1일차')
                self.assertEqual(archive_row['original_path'], 'camera/clip.MP4')
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET folder='' WHERE id='parent'")
        self.assertEqual(self.query(q='나고야')['rows'][0]['event_name'], '나고야 / 1일차')

    def test_captured_at_precedence_sidecar_inheritance_and_incoming_nulls(self):
        job = self.fixture.queue()
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET zone='Asia/Tokyo' WHERE id='parent'")
            db.execute("UPDATE events SET zone='UTC' WHERE id='child'")
            db.execute("INSERT INTO scan_files(scan_id,id,path,sha,size,status) VALUES (?,?,?,?,?,?)", (job['id'], 'new', 'new.MP4', 'a'*64, 10, 'ready'))
        for user, capture, metadata, expected in [
            ('2026-09-03T01:00:00Z', '2026-09-02T01:00:00Z', '{"date":{"time":"2026-09-01T01:00:00Z"}}', '2026-09-03T01:00:00Z'),
            (None, '2026-09-02T01:00:00Z', '{"date":{"time":"2026-09-01T01:00:00Z"}}', '2026-09-02T01:00:00Z'),
            (None, None, '{"date":{"time":"2026-09-01T01:00:00Z"}}', '2026-09-01T01:00:00Z'),
            (None, None, '{broken', None), (None, None, None, None),
        ]:
            with self.subTest(user=user, capture=capture, metadata=metadata):
                with catalog.database(write=True) as db:
                    db.execute('UPDATE media SET user_time=?,capture_time=?,xmp_metadata=?', (user, capture, metadata))
                rows = self.query()['rows']
                self.assertEqual(len(rows), 3)
                for row in rows:
                    self.assertEqual(row['captured_at'], expected if row['location'] == 'managed' else None)
                    self.assertEqual(row['event_zone'], 'Asia/Tokyo' if row['location'] == 'managed' else None)

    def test_remote_batch_event_links_primary_sidecar_mixed_and_excluded_statuses(self):
        for file_id in ('two', 'unassigned', 'missing', 'offloading'):
            self.fixture.add_file(file_id, file_id + '.MP4', b'first video')
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET folder='260903_Trip',start='2026-09-03' WHERE id='parent'")
            db.execute("INSERT INTO events(id,name,folder,folder_key,start) VALUES ('other','Other','261001_Other','other','2026-10-01')")
            db.execute("UPDATE media SET event_id='other' WHERE id='two'")
            db.execute("UPDATE media SET status='archived' WHERE id='one'")
            db.execute("UPDATE media SET event_id=NULL WHERE id='unassigned'")
            for status in ('missing', 'offloading'):
                db.execute('UPDATE media SET status=?,sha=? WHERE id=?', (status, status, status))
            media = db.execute("SELECT sha,xmp_sha FROM media WHERE id='one'").fetchone()
            db.execute("INSERT INTO storages(id,created_at,last_seen_at) VALUES ('storage','2026-11-01','2026-11-01')")
            for name, sha in [('a.MP4', media['sha']), ('b.MP4', media['sha']), ('side.xmp', media['xmp_sha']), ('null.MP4', None), ('missing.MP4', 'missing'), ('offloading.MP4', 'offloading'), ('only.MP4', 'only')]:
                db.execute("INSERT INTO remote_files(storage_id,path,archive_root,sha,size,mtime_ns,status,first_seen_at,last_seen_at) VALUES ('storage',?,'/NAS',?,10,0,'present','2026-11-01','2026-11-01')", (name, sha))
        from contextlib import contextmanager
        statements = []
        original_database = records.database
        @contextmanager
        def traced_database():
            with original_database() as db:
                db.set_trace_callback(statements.append)
                yield db
        with patch.object(records, 'database', traced_database):
            result = self.query('remote')
        rows = {row['name']: row for row in result['rows']}
        linked = rows['a.MP4']
        self.assertEqual(linked['catalog_events'], ['261001_Other', '260903_Trip / Day'])
        self.assertEqual(linked['catalog_event_name'], '261001_Other')
        self.assertEqual(linked['catalog_match_count'], 3)
        self.assertTrue(linked['catalog_has_unassigned'])
        self.assertEqual(set(linked['catalog_file_ids']), {'one', 'two', 'unassigned'})
        self.assertEqual(rows['b.MP4']['catalog_file_ids'], linked['catalog_file_ids'])
        self.assertEqual(rows['side.xmp']['catalog_events'], ['260903_Trip / Day'])
        self.assertEqual(rows['side.xmp']['catalog_file_ids'], ['one'])
        for name in ('null.MP4', 'missing.MP4', 'offloading.MP4', 'only.MP4'):
            self.assertFalse(rows[name]['in_catalog'])
            self.assertEqual(rows[name]['catalog_events'], [])
            self.assertEqual(rows[name]['catalog_file_ids'], [])
            self.assertEqual(rows[name]['catalog_match_count'], 0)
            self.assertFalse(rows[name]['catalog_has_unassigned'])
            self.assertIsNone(rows[name]['catalog_event_name'])
        self.assertEqual(result['summary']['remoteOnly'], 4)
        self.assertEqual(self.query('remote', scope='remote_only')['total'], 4)
        self.assertEqual(len([sql for sql in statements if 'SELECT m.id,m.sha,m.xmp_sha,m.event_id,' in sql]), 1)
        self.assertFalse(any(sql.lstrip().upper().startswith(('UPDATE', 'INSERT', 'DELETE')) for sql in statements))
        self.assertEqual(self.query('remote', page_size=1)['rows'][0]['catalog_events'], linked['catalog_events'])
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET xmp_sha=sha WHERE id='one'")
            db.execute("UPDATE media SET event_id='child' WHERE id='two'")
        same_event = self.query('remote', q='a.MP4')['rows'][0]
        self.assertEqual(same_event['catalog_events'], ['260903_Trip / Day'])
        self.assertEqual(same_event['catalog_match_count'], 3)
        with catalog.database(write=True) as db:
            db.execute('UPDATE media SET event_id=NULL')
        unassigned = self.query('remote', q='a.MP4')['rows'][0]
        self.assertTrue(unassigned['in_catalog'])
        self.assertEqual(unassigned['catalog_events'], [])
        self.assertIsNone(unassigned['catalog_event_name'])
        self.assertTrue(unassigned['catalog_has_unassigned'])

    def test_active_archive_root_is_nullable_and_preserves_response_contract(self):
        required = {'view', 'rows', 'total', 'page', 'pages', 'pageSize', 'summary', 'folders', 'unassigned', 'remoteFolders', 'remoteRootCount'}
        for view in ('files', 'archives', 'remote'):
            for active_root in (None, '/NAS/archive'):
                with self.subTest(view=view, root=active_root), patch.object(records, 'active_storage_scope', return_value=('storage', active_root)):
                    result = self.query(view)
                    self.assertTrue(required.issubset(result))
                    self.assertEqual(result['activeArchiveRoot'], active_root)


if __name__ == '__main__':
    unittest.main()
