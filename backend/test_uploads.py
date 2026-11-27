import asyncio
import errno
import fcntl
import json
import os
import stat
import tempfile
import threading
import time
import unittest
import unicodedata
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect

import api
import catalog
import media
import uploads
import worker


class UploadTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.incoming, self.managed = root / "incoming", root / "managed"
        self.incoming.mkdir()
        self.managed.mkdir()
        self.enterContext(patch.object(uploads, "INCOMING_UPLOAD", self.incoming))
        self.enterContext(patch.object(catalog, "DATA", root / "data"))
        self.enterContext(patch.object(media, "THUMBNAILS", root / "thumbnails"))
        catalog.initialize()
        self.client = TestClient(api.app)

    def create(self, name="IMG_0001.HEIC", size=6, **kwargs):
        response = self.client.post("/api/incoming/uploads", json={"name": name, "size": size, **kwargs})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["uploadId"]

    def url(self, upload_id):
        return "/api/incoming/uploads/" + upload_id

    def put(self, upload_id, data, offset=0):
        return self.client.put(self.url(upload_id) + "/chunks", params={"offset": offset}, content=data)

    def complete(self, upload_id):
        return self.client.post(self.url(upload_id) + "/complete")

    def stage(self, upload_id, suffix=".part"):
        return self.incoming / uploads.STAGING_DIR_NAME / (upload_id + suffix)

    def test_multiple_chunks_atomic_publication_and_scan_isolation(self):
        upload_id = self.create(folder="trip/day")
        self.assertEqual(self.put(upload_id, b"abc").status_code, 200)
        self.assertEqual(list(media.scan_tree(self.incoming)), [])
        self.assertFalse((self.incoming / "trip").exists())
        self.assertEqual(self.complete(upload_id).status_code, 409)
        self.assertEqual(self.put(upload_id, b"def", 3).json()["receivedBytes"], 6)
        self.assertEqual(self.client.get(self.url(upload_id)).json()["receivedBytes"], 6)
        response = self.complete(upload_id)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual((self.incoming / response.json()["path"]).read_bytes(), b"abcdef")
        self.assertEqual(len(list(media.scan_tree(self.incoming))), 1)
        self.assertEqual(list(self.stage(upload_id).parent.iterdir()), [])
        self.assertEqual(self.client.get(self.url(upload_id)).status_code, 404)

    def test_extensions_validation_and_headers(self):
        for extension in uploads.UPLOAD_EXTENSIONS:
            upload_id = self.create("asset" + extension)
            self.client.delete(self.url(upload_id))
        for extension in (".dng", ".raw", ".exe"):
            response = self.client.post("/api/incoming/uploads", json={"name": "a" + extension, "size": 1})
            self.assertEqual(response.status_code, 415)
            self.assertIn("AAE", response.json()["detail"])
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        for size in (0, -1, True, 1.5):
            response = self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": size})
            self.assertEqual(response.status_code, 400)
        with patch.object(uploads, "MAX_FILE_BYTES", 3):
            self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 4}).status_code, 413)
        self.assertEqual(self.client.get(self.url("../bad")).status_code, 404)
        self.assertEqual(self.client.get(self.url("bad")).status_code, 400)

    def test_aae_uploads_are_published_as_companions_case_insensitively(self):
        for extension in (".aae", ".AAE"):
            with self.subTest(extension=extension):
                upload_id = self.create("edits" + extension)
                self.assertEqual(self.put(upload_id, b"abcdef").status_code, 200)
                response = self.complete(upload_id)
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()["kind"], "companion")
                self.assertEqual((self.incoming / response.json()["path"]).read_bytes(), b"abcdef")

    def test_path_hidden_unicode_and_symlink_security(self):
        for name in ("", ".", "..", ".a.jpg", "._a.jpg", "a/b.jpg", "a\\b.jpg", "a:.jpg", "x\x00.jpg", " .jpg", "가" * 74 + ".jpg"):
            with self.subTest(name=name):
                self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": name, "size": 1}).status_code, 400)
        for folder in ("/etc", "a\\b", "a//b", "a/../b", ".hidden", "a/.b", "a:b", "a/b/c/d/e/f/g", "a" * 181, "a/   /b", "a/ .hidden/b", "가" * 80):
            with self.subTest(folder=folder):
                self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 1, "folder": folder}).status_code, 400)
        upload_id = self.create(unicodedata.normalize("NFD", "사진.jpg"), folder=unicodedata.normalize("NFD", "여행/"))
        self.assertEqual(self.client.get(self.url(upload_id)).json()["name"], "사진.jpg")
        self.assertEqual(self.client.get(self.url(upload_id)).json()["folder"], "여행")
        (self.incoming / "link").symlink_to(self.managed, target_is_directory=True)
        (self.incoming / "file").write_text("keep")
        for folder in ("link/child", "file/child"):
            self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 1, "folder": folder}).status_code, 409)
        upload_id = self.create("late.jpg", size=1, folder="late")
        (self.incoming / "late").symlink_to(self.managed, target_is_directory=True)
        self.put(upload_id, b"x")
        self.assertEqual(self.complete(upload_id).status_code, 409)
        self.assertEqual(list(self.managed.iterdir()), [])

    def test_staging_and_part_symlinks_are_rejected(self):
        staging = self.incoming / uploads.STAGING_DIR_NAME
        staging.symlink_to(self.managed, target_is_directory=True)
        self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 1}).status_code, 409)
        staging.unlink()
        upload_id = self.create(size=1)
        self.stage(upload_id).unlink()
        keeper = self.managed / "keeper"
        keeper.write_bytes(b"safe")
        self.stage(upload_id).symlink_to(keeper)
        self.assertEqual(self.put(upload_id, b"x").status_code, 409)
        self.assertEqual(self.complete(upload_id).status_code, 409)
        self.assertEqual(keeper.read_bytes(), b"safe")

    def test_casefold_and_nfc_collision_rename_and_atomic_retry(self):
        (self.incoming / "img_0001.heic").write_bytes(b"existing")
        (self.incoming / "IMG_0001 (1).HEIC").write_bytes(b"existing2")
        upload_id = self.create(size=1)
        self.put(upload_id, b"x")
        rename = uploads.rename_noreplace
        calls = []

        def race(source, name, target, candidate):
            calls.append(candidate)
            if len(calls) == 1:
                raise FileExistsError(errno.EEXIST, "race")
            return rename(source, name, target, candidate)

        with patch.object(uploads, "rename_noreplace", side_effect=race):
            result = self.complete(upload_id).json()
        self.assertEqual(result["name"], "IMG_0001 (3).HEIC")
        self.assertTrue(result["renamed"])
        self.assertEqual((self.incoming / "img_0001.heic").read_bytes(), b"existing")
        (self.incoming / unicodedata.normalize("NFD", "사진.jpg")).write_bytes(b"keeper")
        upload_id = self.create("사진.jpg", size=1)
        self.put(upload_id, b"x")
        self.assertEqual(self.complete(upload_id).json()["name"], "사진 (1).jpg")

    def test_last_modified_preservation_and_range_defense(self):
        for modified in (315532800000, 1740000000000, -1, int(time.time() * 1000) + 2 * 86_400_000, None):
            upload_id = self.create("time.jpg", size=1, last_modified_ms=modified)
            self.put(upload_id, b"x")
            result = self.complete(upload_id).json()
            stamp = (self.incoming / result["path"]).stat().st_mtime
            if modified is not None and 315532800000 <= modified < time.time() * 1000:
                self.assertAlmostEqual(stamp, modified / 1000, places=3)
            else:
                self.assertLess(abs(stamp - time.time()), 5)

    def test_offset_limits_empty_chunks_and_rollback(self):
        upload_id = self.create(size=6)
        self.put(upload_id, b"ab")
        response = self.put(upload_id, b"cd", 0)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["expectedOffset"], 2)
        self.assertEqual(self.put(upload_id, b"", 2).status_code, 400)
        self.assertEqual(self.put(upload_id, b"abcde", 2).status_code, 400)
        with patch.object(uploads, "MAX_CHUNK_BYTES", 2):
            self.assertEqual(self.put(upload_id, b"abc", 2).status_code, 413)
        self.assertEqual(self.stage(upload_id).read_bytes(), b"ab")
        self.assertEqual(self.put(upload_id, b"c", -1).status_code, 400)

    def test_complete_flushes_modified_time_and_data_before_atomic_publication(self):
        modified = 1740000000000
        upload_id = self.create(size=1, last_modified_ms=modified)
        self.put(upload_id, b"x")
        events = []
        real_utime, real_fsync, real_rename = os.utime, os.fsync, uploads.rename_noreplace

        def utime(fd, **kwargs):
            events.append("utime")
            return real_utime(fd, **kwargs)

        def fsync(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                self.assertAlmostEqual(os.fstat(fd).st_mtime, modified / 1000, places=3)
                events.append("file_fsync")
            return real_fsync(fd)

        def rename(*args):
            events.append("rename")
            return real_rename(*args)

        with patch.object(uploads.os, "utime", side_effect=utime), patch.object(uploads.os, "fsync", side_effect=fsync), patch.object(uploads, "rename_noreplace", side_effect=rename):
            self.assertEqual(self.complete(upload_id).status_code, 201)
        self.assertEqual(events, ["utime", "file_fsync", "rename"])

    def test_disconnect_cancel_and_oserror_roll_back_written_bytes(self):
        for exception in (ClientDisconnect(), asyncio.CancelledError(), OSError(errno.ENOSPC, "full"), HTTPException(400, "bad")):
            upload_id = self.create(size=6)
            self.put(upload_id, b"ab")

            class BrokenRequest:
                async def stream(self):
                    yield b"cd"
                    raise exception

            with self.assertRaises(type(exception)):
                asyncio.run(uploads.upload_chunk(upload_id, BrokenRequest(), 2))
            self.assertEqual(self.stage(upload_id).read_bytes(), b"ab")

    def test_delete_idempotent_cleanup_ttl_and_active_lock(self):
        stale, active, recent = self.create(), self.create(), self.create()
        for upload_id in (stale, active):
            for suffix in (".part", ".json", ".lock"):
                os.utime(self.stage(upload_id, suffix), (time.time() - 8000,) * 2)
        with self.stage(active, ".lock").open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            uploads.cleanup_stale_uploads()
            self.assertFalse(self.stage(stale).exists())
            self.assertTrue(self.stage(active).exists())
            self.assertTrue(self.stage(recent).exists())
            self.assertEqual(self.put(active, b"x").status_code, 409)
            self.assertEqual(self.client.delete(self.url(active)).status_code, 409)
        for upload_id in (active, recent, stale):
            for _ in range(2):
                self.assertEqual(self.client.delete(self.url(upload_id)).json(), {"cancelled": True})
        self.assertEqual(list(self.stage(stale).parent.iterdir()), [])

    def test_disk_full_mount_and_reset_guard(self):
        with patch.object(uploads.shutil, "disk_usage", return_value=SimpleNamespace(free=0)):
            self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 1}).status_code, 507)
        with patch.object(uploads, "INCOMING_UPLOAD", self.incoming / "missing"):
            self.assertEqual(self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 1}).status_code, 503)
        upload_id = self.create(size=1)
        with patch.object(uploads.os, "write", side_effect=OSError(errno.ENOSPC, "full")):
            self.assertEqual(self.put(upload_id, b"x").status_code, 507)
        self.assertEqual(self.stage(upload_id).stat().st_size, 0)
        with catalog.database(write=True) as db:
            catalog.queue_job(db, "reset-all", {})
        self.assertEqual(self.put(upload_id, b"x").status_code, 409)
        response = self.client.post("/api/incoming/uploads", json={"name": "a.jpg", "size": 1})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get(self.url(upload_id)).status_code, 200)

    def test_real_worker_scan_concurrent_with_unfinished_upload(self):
        from PIL import Image
        Image.new("RGB", (4, 4)).save(self.incoming / "existing.jpg")
        upload_id = self.create("upload.jpg", size=6)
        self.put(upload_id, b"abc")
        started, release = threading.Event(), threading.Event()
        original_hash = worker.hash_file

        def blocked_hash(*args):
            started.set()
            self.assertTrue(release.wait(10))
            return original_hash(*args)

        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, "scan", {})
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
        errors = []

        def scan():
            try:
                worker.scan_incoming(job, self.incoming, self.managed)
            except BaseException as exc:
                errors.append(exc)

        with patch.object(worker, "hash_file", side_effect=blocked_hash), patch.object(worker, "preview_thumbnail", return_value=None):
            thread = threading.Thread(target=scan)
            thread.start()
            try:
                self.assertTrue(started.wait(10))
                self.assertEqual(self.put(upload_id, b"def", 3).status_code, 200)
                self.assertEqual(self.complete(upload_id).status_code, 201)
            finally:
                release.set()
                thread.join(15)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        with catalog.database() as db:
            paths = [row["path"] for row in db.execute("SELECT path FROM scan_files")]
        self.assertEqual(paths, ["existing.jpg"])
