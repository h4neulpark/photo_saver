import json
import unittest

from fastapi import HTTPException

import api
import catalog
import test_transfers


class EventFolderTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET start='2026-01-01',end='2026-01-02',zone='Asia/Tokyo' "
                       "WHERE id='parent'")

    def fields(self, name, start='2026-09-03', end='2026-09-05'):
        return api.EventFields(name=name, start=start, end=end, zone='Asia/Tokyo')

    def create(self, name, **kwargs):
        return api.new_event(api.NewEvent(**{**self.fields(name).model_dump(), **kwargs}))['event']

    def test_creation_uses_start_date_once(self):
        for name, expected in [('나고야', '260903_나고야'), ('260903_도쿄', '260903_도쿄'),
                               ('260902_교토', '260903_260902_교토')]:
            with self.subTest(name=name):
                self.assertEqual(self.create(name)['folder'], expected)

    def test_prefixed_and_unprefixed_names_cannot_share_folder(self):
        self.create('나고야')
        with self.assertRaises(HTTPException) as caught:
            self.create('260903_나고야')
        self.assertEqual(caught.exception.status_code, 409)

    def test_edit_repairs_legacy_duplicate_prefix_and_updates_folder_key(self):
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET name='260903_나고야',folder='260903_260903_나고야',"
                       "folder_key='260903_260903_나고야' WHERE id='parent'")
        event = api.edit_event('parent', self.fields('나고야'))
        self.assertEqual(event['folder'], '260903_나고야')
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT folder_key FROM events WHERE id='parent'").fetchone()[0],
                             '260903_나고야')
        event = api.edit_event('parent', self.fields('나고야', '2026-09-04'))
        self.assertEqual(event['folder'], '260904_나고야')

    def test_edit_folder_collision_rolls_back_all_fields(self):
        other = self.create('나고야')
        with self.assertRaises(HTTPException) as caught:
            api.edit_event('parent', self.fields('260903_나고야'))
        self.assertEqual(caught.exception.status_code, 409)
        with catalog.database() as db:
            event = db.execute("SELECT * FROM events WHERE id='parent'").fetchone()
            self.assertEqual((event['name'], event['folder'], event['start']), ('Trip', 'Trip', '2026-01-01'))
            self.assertEqual(api.get_event(db, other['id'])['folder'], '260903_나고야')

    def test_subcategory_cannot_collide_with_confirmed_parent_device(self):
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET event_id='parent'")
        with self.assertRaises(HTTPException) as caught:
            api.edit_event('child', api.EventFields(name='gopro hero8 black'))
        self.assertEqual(caught.exception.status_code, 409)
        with catalog.database() as db:
            self.assertEqual(api.get_event(db, 'child')['folder'], 'Day')

    def test_subcategory_cannot_collide_with_sibling(self):
        self.create('식당', parent_id='parent')
        with self.assertRaises(HTTPException) as caught:
            api.edit_event('child', api.EventFields(name='식당'))
        self.assertEqual(caught.exception.status_code, 409)

    def test_new_upload_paths_follow_parent_and_child_edits_preserving_archive(self):
        first = self.fixture.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}])
        self.assertEqual(self.fixture.run_job(first)[0], 'done')
        with catalog.database() as db:
            old_records = [dict(row) for row in db.execute('SELECT * FROM archive_entries')]
            old_media = dict(db.execute("SELECT * FROM media WHERE id='one'").fetchone())
        api.edit_event('parent', self.fields('260903_나고야'))
        child = api.edit_event('child', api.EventFields(name='식당'))
        self.assertEqual(child['folder'], '식당')
        second = self.fixture.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}])
        targets = [item['target'] for item in json.loads(second['payload'])['files']]
        self.assertEqual(targets, ['260903_나고야/식당/GoPro HERO8 Black/clip.MP4',
                                   '260903_나고야/식당/GoPro HERO8 Black/clip.xmp'])
        self.assertEqual(self.fixture.run_job(second)[0], 'done')
        for record, target in zip(old_records, targets):
            self.assertEqual((self.fixture.remote / record['target']).read_bytes(),
                             (self.fixture.remote / target).read_bytes())
        with catalog.database() as db:
            self.assertEqual([dict(row) for row in db.execute(
                'SELECT * FROM archive_entries WHERE job_id=?', (first['id'],))], old_records)
            self.assertEqual(dict(db.execute("SELECT * FROM media WHERE id='one'").fetchone()), old_media)

    def test_queued_upload_keeps_reserved_paths_during_edit(self):
        job = self.fixture.queue()
        api.edit_event('parent', self.fields('나고야'))
        api.edit_event('child', api.EventFields(name='식당'))
        with catalog.database() as db:
            self.assertEqual(db.execute('SELECT payload FROM jobs WHERE id=?', (job['id'],)).fetchone()[0],
                             job['payload'])
        self.assertEqual(self.fixture.run_job(job)[0], 'done')
        self.assertTrue((self.fixture.remote / 'Trip/Day/GoPro HERO8 Black/clip.MP4').is_file())


if __name__ == '__main__':
    unittest.main()
