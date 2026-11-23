import json
import sqlite3
import unittest
from pathlib import Path

from fastapi import HTTPException

import api
import catalog
import devices
import records
import settings
import test_transfers
import worker


class DeviceNameTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.source = 'GoPro HERO8 Black'
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET start='2026-01-01',end='2026-12-31',zone='Asia/Seoul' WHERE id='parent'")

    def rename(self, name='GoPro8'):
        return devices.rename_device(devices.DeviceName(source=self.source, name=name))

    def query(self, **kwargs):
        options = dict(view='files', q='', scope='all', page=1, page_size=50, event='all', device='')
        options.update(kwargs)
        return json.loads(records.catalog_records(**options).body)

    def test_existing_new_reanalysis_and_restart_keep_rule(self):
        self.rename('나의 GoPro 8')
        self.fixture.add_file('two', 'new.MP4', b'new video')
        row = api.state()['managed'][0]
        with catalog.database() as db:
            old = db.execute("SELECT * FROM media WHERE id='one'").fetchone()
        info = (self.fixture.managed / old['path']).stat()
        worker.store_analysis('one', old['path'], old['sha'], info,
                              ('video', {}, None, None, '', False, self.source))
        catalog.initialize()
        self.assertEqual({item['device'] for item in api.state()['managed']}, {'나의 GoPro 8'})
        self.assertTrue(all(item['confirmed'] for item in api.state()['managed']))
        self.assertEqual(devices.get_devices()['devices'][0]['count'], 2)
        self.assertEqual(row['deviceFolder'], '나의 GoPro 8')
        self.rename('다시수정')
        self.assertEqual({item['device'] for item in api.state()['managed']}, {'다시수정'})
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT device FROM media WHERE id='one'").fetchone()[0], self.source)

    def test_manual_name_is_preserved(self):
        api.edit_media(api.MediaEdit(ids=['one'], device='내 카메라'))
        result = self.rename()
        self.assertEqual(result['devices'][0]['count'], 0)
        self.assertEqual(api.state()['managed'][0]['device'], '내 카메라')

    def test_records_filter_search_and_upload_share_name(self):
        self.rename()
        self.assertEqual(self.query(device='GoPro8')['total'], 2)  # source + XMP
        self.assertEqual(self.query(q='GoPro8')['total'], 2)
        job = self.fixture.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}])
        targets = [item['target'] for item in json.loads(job['payload'])['files']]
        self.assertEqual(targets, ['Trip/Day/GoPro8/clip.MP4', 'Trip/Day/GoPro8/clip.xmp'])
        self.assertEqual(self.fixture.run_job(job)[0], 'done')
        self.rename('次の名前')
        archives = self.query(view='archives')['rows']
        self.assertEqual({item['device'] for item in archives}, {'次の名前'})
        self.assertEqual({item['target'] for item in archives}, set(targets))

    def test_active_upload_rejects_change(self):
        self.fixture.queue()
        with self.assertRaises(HTTPException) as error:
            self.rename()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(devices.get_devices()['devices'][0]['name'], self.source)

    def test_invalid_and_missing_names(self):
        for name in ['', '   ', '..', 'a/b', 'a\\b', 'a\0b', 'a:b']:
            with self.subTest(name=name):
                if not name:
                    continue  # request model validates empty input
                with self.assertRaises(HTTPException) as error:
                    self.rename(name)
                self.assertEqual(error.exception.status_code, 400)
        with self.assertRaises(HTTPException) as error:
            devices.rename_device(devices.DeviceName(source='missing', name='Camera'))
        self.assertEqual(error.exception.status_code, 404)

    def test_other_device_and_manual_folder_collisions(self):
        self.fixture.add_file('two', 'two.MP4', b'two')
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET device='Other Camera' WHERE id='two'")
        with self.assertRaises(HTTPException):
            self.rename('other camera')
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET user_device='수동장비' WHERE id='two'")
        with self.assertRaises(HTTPException):
            self.rename('수동장비')
        with catalog.database() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM device_names').fetchone()[0], 0)

    def test_subcategory_conflict_and_confirmation_use_alias(self):
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET event_id='parent' WHERE id='one'")
        with self.assertRaises(HTTPException):
            self.rename('day')
        self.rename('Camera')
        with self.assertRaises(HTTPException):
            api.new_event(api.NewEvent(name='camera', parent_id='parent'))
        api.confirm_placements(api.Selection(ids=['one']))

    def test_backup_restore_and_old_backup(self):
        self.rename()
        backup = Path(self.fixture.temporary.name) / 'backup.sqlite3'
        with catalog.database() as source:
            target = sqlite3.connect(backup)
            source.backup(target)
            target.close()
        self.rename('Changed')
        settings.restore_catalog_file(backup)
        self.assertEqual(api.state()['managed'][0]['device'], 'GoPro8')
        with sqlite3.connect(backup) as old:
            old.execute('DROP TABLE device_names')
        old.close()
        settings.restore_catalog_file(backup)
        self.assertEqual(api.state()['managed'][0]['device'], self.source)


if __name__ == '__main__':
    unittest.main()
