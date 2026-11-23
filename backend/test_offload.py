import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import api
import archive
import catalog
import devices
import media
import offload
import settings
import test_transfers
import transfers
import worker


class OffloadAndArchiveModelTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temporary.name)
        self.settings_dir = self.root / "settings"
        self.settings_dir.mkdir()
        self.thumbnails = self.root / "thumbnails"
        self.thumbnails.mkdir()
        self.storage_id = "11112222333344445555666677778888"
        (self.settings_dir / "storage-id").write_text(self.storage_id, encoding="utf-8")
        self.fixture.config["storageId"] = self.storage_id
        @contextmanager
        def connection(_expected=None):
            yield self.fixture.sftp, self.fixture.config
        for module, name, value in (
            (settings, "SETTINGS_DIR", self.settings_dir),
            (settings, "ADDRESS_FILE", self.settings_dir / "address"),
            (settings, "STORAGE_ROOT_FILE", self.settings_dir / "remote-root"),
            (settings, "PENDING_HOST_KEY", self.settings_dir / "pending-host-key.json"),
            (catalog, "THUMBNAILS", self.thumbnails),
            (media, "THUMBNAILS", self.thumbnails),
            (worker, "THUMBNAILS", self.thumbnails),
            (archive, "archive_config", None),
            (offload, "archive_config", None),
        ):
            if name == "archive_config":
                patcher = patch.object(module, name, return_value=self.fixture.config)
            else:
                patcher = patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for module in (archive, offload):
            patcher = patch.object(module, "archive_connection", side_effect=connection)
            patcher.start()
            self.addCleanup(patcher.stop)
        with catalog.database(write=True) as db:
            db.execute("UPDATE events SET start='2026-01-01',end='2026-12-31',zone='Asia/Seoul' WHERE id='parent'")

    def upload_all(self, items=None):
        job = self.fixture.queue(items or [{"id": "one"}, {"id": "one", "kind": "xmp"}])
        status, result = self.fixture.run_job(job)
        self.assertEqual(status, "done")
        return result

    def run_offload(self, ids=None):
        queued = api.offload_files(offload.OffloadRequest(ids=ids or ["one"]))
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (queued["id"],))
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone())
        offload.offload_selection(job, None, self.fixture.managed)
        with catalog.database() as db:
            record = db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone()
        return record["status"], json.loads(record["result"])

    def test_stable_storage_id_persists_across_ip_and_key_changes(self):
        (self.settings_dir / "storage-id").unlink()
        first = settings.ensure_storage_id()
        self.assertEqual(len(first), 32)
        settings.save_storage(settings.StorageAddress(address="192.0.2.10"))
        settings.save_storage_root(settings.StorageRoot(path="/archive"))
        settings.save_storage(settings.StorageAddress(address="192.0.2.20"))
        self.assertEqual(settings.ensure_storage_id(), first)
        self.assertEqual(settings.read_storage_id(), first)

        self.fixture.config["storageId"] = first
        self.upload_all()
        self.fixture.config["address"] = "192.0.2.20"
        self.fixture.config["identity"] = "rotated-key"
        self.fixture.add_file("two", "second.MP4", b"second video")
        self.upload_all([{"id": "two"}])
        with catalog.database() as db:
            storages = [row["id"] for row in db.execute("SELECT id FROM storages")]
            remote_ids = {row["storage_id"] for row in db.execute("SELECT storage_id FROM remote_files")}
        self.assertEqual(storages, [first])
        self.assertEqual(remote_ids, {first})

    def test_backfill_remote_files_from_legacy_backup_and_offloading_recovery_on_restore(self):
        self.upload_all()
        backup = self.root / "legacy.sqlite3"
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='offloading' WHERE id='one'")
        with catalog.database() as db:
            destination = sqlite3.connect(backup)
            try:
                db.backup(destination)
            finally:
                destination.close()
        legacy = sqlite3.connect(backup)
        try:
            legacy.execute("DROP TABLE remote_files")
            legacy.execute("DROP TABLE storages")
            legacy.commit()
        finally:
            legacy.close()
        settings.restore_catalog_file(backup)
        with catalog.database() as db:
            media_status = db.execute("SELECT status FROM media WHERE id='one'").fetchone()[0]
            remotes = db.execute("SELECT storage_id, path, status FROM remote_files ORDER BY path").fetchall()
        self.assertEqual(media_status, "available")
        self.assertEqual(len(remotes), 2)
        self.assertTrue(all(row["storage_id"] == self.storage_id and row["status"] == "present" for row in remotes))

    def test_offload_verifies_remote_live_removes_local_preserves_db_and_thumbnail(self):
        with catalog.database(write=True) as db:
            sha = db.execute("SELECT sha FROM media WHERE id='one'").fetchone()[0]
            thumb_name = f"{sha}-v1.jpg"
            (self.thumbnails / thumb_name).write_bytes(b"thumb-bytes")
            db.execute("UPDATE media SET thumbnail=?, xmp_metadata=? WHERE id='one'", (thumb_name, json.dumps({"title": "제주"})))
        self.upload_all()
        before = api.state()["managed"][0]
        self.assertEqual((before["status"], before["archived"], before["canDownload"], before["canOffload"]), ("available", True, True, True))

        status, result = self.run_offload(["one"])
        self.assertEqual((status, result["offloaded"], result["failed"]), ("done", 1, 0))
        self.assertFalse((self.fixture.managed / "one").exists())
        self.assertTrue((self.fixture.remote / "Trip/Day/GoPro HERO8 Black/clip.MP4").is_file())
        self.assertTrue((self.fixture.remote / "Trip/Day/GoPro HERO8 Black/clip.xmp").is_file())

        worker.index_managed(self.fixture.managed)
        worker.index_managed_xmp(self.fixture.managed)
        worker.refresh_deleted_group(self.fixture.managed, sha)
        self.assertTrue((self.thumbnails / thumb_name).is_file())

        after = api.state()["managed"][0]
        self.assertEqual((after["status"], after["archived"], after["canDownload"], after["canOffload"]), ("archived", True, True, False))
        self.assertEqual(after["thumbnail"], f"/thumbnails/{thumb_name}")
        self.assertEqual(after["xmp"]["title"], "제주")
        self.assertEqual(devices.get_devices()["devices"][0]["count"], 1)

        with self.assertRaises(HTTPException) as confirm_error:
            api.confirm_placements(api.Selection(ids=["one"]))
        self.assertEqual(confirm_error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as upload_error:
            self.fixture.queue([{"id": "one"}])
        self.assertEqual(upload_error.exception.status_code, 409)

        api.edit_media(api.MediaEdit(ids=["one"], device="수동 카메라"))
        self.assertEqual(api.state()["managed"][0]["device"], "수동 카메라")

    def test_offload_rejects_unarchived_primary_or_unarchived_xmp(self):
        with self.assertRaises(HTTPException) as missing_primary:
            api.offload_files(offload.OffloadRequest(ids=["one"]))
        self.assertEqual(missing_primary.exception.status_code, 409)

        self.upload_all([{"id": "one"}])  # primary uploaded, XMP not uploaded
        self.assertFalse(api.state()["managed"][0]["canOffload"])
        with self.assertRaises(HTTPException) as missing_xmp:
            api.offload_files(offload.OffloadRequest(ids=["one"]))
        self.assertEqual(missing_xmp.exception.status_code, 409)
        self.assertIn("XMP", missing_xmp.exception.detail)

    def test_offload_preserves_local_on_remote_missing_size_mismatch_symlink_or_local_change(self):
        self.upload_all()
        remote_clip = self.fixture.remote / "Trip/Day/GoPro HERO8 Black/clip.MP4"

        # 1. Remote file missing
        remote_clip.unlink()
        status, result = self.run_offload(["one"])
        self.assertEqual((status, result["failed"]), ("failed", 1))
        self.assertTrue((self.fixture.managed / "one/clip.MP4").is_file())
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT status FROM media WHERE id='one'").fetchone()[0], "available")
            self.assertEqual(
                db.execute("SELECT status FROM remote_files WHERE path='Trip/Day/GoPro HERO8 Black/clip.MP4'").fetchone()[0],
                "missing",
            )

        # Restore remote and re-upload so remote_files is present again
        self.upload_all([{"id": "one"}])
        # 2. Remote size mismatch
        remote_clip.write_bytes(b"short")
        status, _ = self.run_offload(["one"])
        self.assertEqual(status, "failed")
        self.assertTrue((self.fixture.managed / "one/clip.MP4").is_file())

        # Restore remote and test symlink
        remote_clip.unlink()
        self.upload_all([{"id": "one"}])
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"first video")
        remote_clip.unlink()
        remote_clip.symlink_to(outside)
        status, _ = self.run_offload(["one"])
        self.assertEqual(status, "failed")
        self.assertTrue((self.fixture.managed / "one/clip.MP4").is_file())

        # Restore real remote file and test modified local copy
        remote_clip.unlink()
        remote_clip.write_bytes(b"first video")
        with catalog.database(write=True) as db:
            db.execute("UPDATE remote_files SET status='present'")
        (self.fixture.managed / "one/clip.MP4").write_bytes(b"modified locally")
        status, _ = self.run_offload(["one"])
        self.assertEqual(status, "failed")
        self.assertEqual((self.fixture.managed / "one/clip.MP4").read_bytes(), b"modified locally")

    def test_offload_crash_recovery_from_offloading_status(self):
        self.upload_all()
        queued = api.offload_files(offload.OffloadRequest(ids=["one"]))
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='offloading' WHERE id='one'")
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (queued["id"],))
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone())
        (self.fixture.managed / "one/clip.MP4").unlink()
        offload.offload_selection(job, None, self.fixture.managed)
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE id=?", (queued["id"],)).fetchone()[0], "done")
            self.assertEqual(db.execute("SELECT status FROM media WHERE id='one'").fetchone()[0], "archived")
        self.assertFalse((self.fixture.managed / "one").exists())

    def test_offload_stops_on_settings_change_and_sftp_disconnect(self):
        self.fixture.add_file("two", "second.MP4", b"second video")
        self.upload_all([{"id": "one"}, {"id": "one", "kind": "xmp"}, {"id": "two"}])
        queued = api.offload_files(offload.OffloadRequest(ids=["one", "two"]))
        self.fixture.config["identity"] = "changed-key"
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (queued["id"],))
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone())
        offload.offload_selection(job, None, self.fixture.managed)
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT status FROM jobs WHERE id=?", (queued["id"],)).fetchone()[0], "failed")
        self.assertTrue((self.fixture.managed / "one/clip.MP4").is_file())
        self.assertTrue((self.fixture.managed / "two/second.MP4").is_file())

        # Now disconnect mid-offload
        queued = api.offload_files(offload.OffloadRequest(ids=["one", "two"]))
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (queued["id"],))
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone())
        with patch.object(self.fixture.sftp, "lstat", side_effect=BrokenPipeError("connection lost")):
            offload.offload_selection(job, None, self.fixture.managed)
        with catalog.database() as db:
            record = db.execute("SELECT status, result FROM jobs WHERE id=?", (queued["id"],)).fetchone()
        self.assertEqual(record["status"], "failed")
        self.assertEqual(json.loads(record["result"])["failed"], 2)
        self.assertTrue((self.fixture.managed / "one/clip.MP4").is_file())
        self.assertTrue((self.fixture.managed / "two/second.MP4").is_file())

    def test_incoming_scan_move_and_delete_detect_remote_archive_duplicates(self):
        incoming = self.root / "incoming"
        incoming.mkdir()
        # Upload and offload 'one' so it exists ONLY in remote_files (not in managed).
        self.upload_all()
        status, _ = self.run_offload(["one"])
        self.assertEqual(status, "done")
        self.assertFalse((self.fixture.managed / "one").exists())

        # Re-introduce identical files (as photos so we can also test delete refresh) into incoming.
        (incoming / "copy1.JPG").write_bytes(b"first video")
        (incoming / "copy2.JPG").write_bytes(b"first video")
        with catalog.database(write=True) as db:
            scan_id = catalog.queue_job(db, "scan", {})
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (scan_id,)).fetchone())
        with patch.object(worker.time, "sleep"):
            worker.scan_incoming(job, incoming, self.fixture.managed)
        with catalog.database() as db:
            scanned = {row["path"]: dict(row) for row in db.execute("SELECT * FROM scan_files WHERE scan_id=?", (scan_id,))}
        for name in ("copy1.JPG", "copy2.JPG"):
            self.assertEqual(scanned[name]["status"], "duplicate")
            self.assertIn("원격 아카이브", scanned[name]["reason"])
            self.assertIn("Trip/Day/GoPro HERO8 Black/clip.MP4", scanned[name]["reason"])

        # Deleting one duplicate copy must NOT promote the remaining copy to 'ready'.
        with catalog.database(write=True) as db:
            del_id = catalog.queue_job(db, "delete", {"ids": [scanned["copy1.JPG"]["id"]]})
            del_job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (del_id,)).fetchone())
        worker.delete_selection(del_job, incoming, self.fixture.managed)
        with catalog.database() as db:
            remaining = db.execute("SELECT status, reason FROM scan_files WHERE id=?", (scanned["copy2.JPG"]["id"],)).fetchone()
        self.assertEqual(remaining["status"], "duplicate")
        self.assertIn("원격 아카이브", remaining["reason"])

        # Even if a row was 'ready' before archive finished, import_selection blocks moving it.
        with catalog.database(write=True) as db:
            db.execute("UPDATE scan_files SET status='ready', reason='' WHERE id=?", (scanned["copy2.JPG"]["id"],))
            move_id = catalog.queue_job(db, "move", {"ids": [scanned["copy2.JPG"]["id"]]})
            move_job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (move_id,)).fetchone())
        worker.import_selection(move_job, incoming, self.fixture.managed)
        with catalog.database() as db:
            moved = db.execute("SELECT status, reason FROM scan_files WHERE id=?", (scanned["copy2.JPG"]["id"],)).fetchone()
        self.assertEqual(moved["status"], "duplicate")
        self.assertIn("원격 아카이브", moved["reason"])
        self.assertTrue((incoming / "copy2.JPG").is_file())


if __name__ == "__main__":
    unittest.main()
