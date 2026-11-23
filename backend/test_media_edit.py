import json
import unittest
from datetime import datetime, timezone

from fastapi import HTTPException

import api
import catalog
import test_transfers
import worker


class BulkMediaEditTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.add_file('two', 'two.MP4', b'second')
        self.fixture.add_file('three', 'three.MP4', b'third')
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET start='2026-11-01',end='2026-11-30',zone='Asia/Seoul' WHERE id='parent'")
            db.execute("UPDATE media SET user_time='2020-01-01T00:00:00+00:00',user_time_source='manual'")
            db.execute("UPDATE media SET device='iPhone' WHERE id='two'")
        self.first = self.fixture.managed / 'one/clip.xmp'
        self.first.write_text('<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"><photoshop:DateCreated>2026-11-23T10:00:00+09:00</photoshop:DateCreated></x:xmpmeta>')
        second = self.fixture.managed / 'two/two.xmp'
        second.write_text('<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:DateTimeOriginal="2026:11:24 11:00:00"/>')
        worker.index_managed_xmp(self.fixture.managed)

    def rows(self):
        with catalog.database() as db:
            return {row['id']: dict(row) for row in db.execute('SELECT * FROM media ORDER BY id')}

    def test_assigns_existing_device_without_changing_any_capture_time(self):
        before = self.rows()
        existing = next(f['device'] for f in api.state()['managed'] if f['id'] == 'two')
        result = api.edit_media(api.MediaEdit(ids=['one','three'],device=existing))
        self.assertEqual(result, {'count':2,'timeUpdated':0,'timeSkipped':0})
        for key in ('one','three'):
            row = self.rows()[key]
            self.assertEqual(row['user_device'], 'iPhone')
            self.assertEqual(row['user_time'], before[key]['user_time'])
            self.assertEqual(row['user_time_source'], before[key]['user_time_source'])
            self.assertEqual(row['event_id'], before[key]['event_id'])
            self.assertFalse(row['confirmed'])

    def test_reads_real_xmp_files_and_applies_individual_times_with_timezone(self):
        result = api.edit_media(api.MediaEdit(ids=['one','two','three'],time_mode='xmp',skip_missing_xmp=True,zone='America/Los_Angeles'))
        self.assertEqual(result, {'count':3,'timeUpdated':2,'timeSkipped':1})
        rows = self.rows()
        self.assertEqual(datetime.fromisoformat(rows['one']['user_time']).astimezone(timezone.utc).isoformat(), '2026-11-23T01:00:00+00:00')
        self.assertEqual(datetime.fromisoformat(rows['two']['user_time']).astimezone(timezone.utc).isoformat(), '2026-11-24T19:00:00+00:00')
        self.assertEqual(rows['three']['user_time'], '2020-01-01T00:00:00+00:00')
        self.assertEqual(rows['three']['user_time_source'], 'manual')
        self.assertEqual(rows['one']['user_time_source'], 'xmp')
        self.assertEqual(rows['two']['user_time_source'], 'xmp')
        self.assertTrue(all(row['confirmed'] for row in rows.values()))
        self.assertTrue(all(row['event_id'] == 'child' for row in rows.values()))

    def test_device_applies_to_all_selected_while_xmp_only_applies_where_present(self):
        result = api.edit_media(api.MediaEdit(ids=['one','three'],device='iPhone',time_mode='xmp',skip_missing_xmp=True))
        self.assertEqual(result['timeUpdated'],1)
        self.assertEqual(result['timeSkipped'],1)
        for key in ('one','three'):
            self.assertEqual(self.rows()[key]['user_device'],'iPhone')
            self.assertFalse(self.rows()[key]['confirmed'])
        self.assertEqual(self.rows()['three']['user_time'],'2020-01-01T00:00:00+00:00')

    def test_strict_mode_retains_original_atomic_validation(self):
        before = self.rows()
        with self.assertRaises(HTTPException) as error:
            api.edit_media(api.MediaEdit(ids=['one','three'],device='iPhone',time_mode='xmp'))
        self.assertEqual(error.exception.status_code,400)
        self.assertEqual(self.rows(),before)

    def test_no_usable_xmp_rejects_before_device_or_time_changes(self):
        before = self.rows()
        with self.assertRaises(HTTPException) as error:
            api.edit_media(api.MediaEdit(ids=['three'],device='iPhone',time_mode='xmp',skip_missing_xmp=True))
        self.assertEqual(error.exception.status_code,400)
        self.assertEqual(self.rows(),before)

    def test_skip_flag_only_allowed_for_xmp(self):
        before = self.rows()
        with self.assertRaises(HTTPException):
            api.edit_media(api.MediaEdit(ids=['one'],device='iPhone',skip_missing_xmp=True))
        self.assertEqual(self.rows(),before)

    def test_rescanned_xmp_updates_available_time_before_explicit_application(self):
        self.first.write_text('<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:DateCreated="2026-11-25T12:00:00Z"/>')
        worker.index_managed_xmp(self.fixture.managed)
        self.assertEqual(self.rows()['one']['user_time'],'2020-01-01T00:00:00+00:00')
        self.assertEqual(json.loads(self.rows()['one']['xmp_metadata'])['date']['raw'],'2026-11-25T12:00:00Z')
        api.edit_media(api.MediaEdit(ids=['one'],time_mode='xmp'))
        self.assertEqual(datetime.fromisoformat(self.rows()['one']['user_time']).astimezone(timezone.utc).isoformat(),'2026-11-25T12:00:00+00:00')


if __name__ == '__main__':
    unittest.main()
