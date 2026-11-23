import asyncio
import hashlib
import json
import os
import sqlite3
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

import api
import archive
import catalog
import records
import remote_index
import settings
import test_transfers
import transfers
import worker


class WalkableLocalSFTP(test_transfers.LocalSFTP):
    def listdir_iter(self, path, read_aheads=1):
        for entry in sorted(Path(path).iterdir(), key=lambda p: p.name):
            info = entry.lstat()
            yield SimpleNamespace(
                filename=entry.name, st_mode=info.st_mode,
                st_size=info.st_size, st_mtime=info.st_mtime, st_mtime_ns=info.st_mtime_ns,
            )


class RemoteIndexTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_transfers.TransferTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = Path(self.fixture.temporary.name)
        self.settings_dir = self.root / "settings"
        self.settings_dir.mkdir()
        self.storage_id = "aaaa1111bbbb2222cccc3333dddd4444"
        (self.settings_dir / "storage-id").write_text(self.storage_id, encoding="utf-8")
        self.fixture.config["storageId"] = self.storage_id
        self.sftp = WalkableLocalSFTP()
        self.fixture.sftp = self.sftp
        @contextmanager
        def connection(_expected=None):
            yield self.sftp, self.fixture.config
        for module, name, value in (
            (settings, "SETTINGS_DIR", self.settings_dir),
            (settings, "ADDRESS_FILE", self.settings_dir / "address"),
            (settings, "STORAGE_ROOT_FILE", self.settings_dir / "remote-root"),
            (settings, "PENDING_HOST_KEY", self.settings_dir / "pending-host-key.json"),
        ):
            patcher = patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for module in (archive, transfers, remote_index):
            patcher = patch.object(module, "archive_config", return_value=self.fixture.config)
            patcher.start()
            self.addCleanup(patcher.stop)
            conn_patcher = patch.object(module, "archive_connection", side_effect=connection)
            conn_patcher.start()
            self.addCleanup(conn_patcher.stop)

    def write_remote(self, relative, contents):
        path = self.fixture.remote / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)
        return path

    def run_index(self, path="", full_rehash=False):
        request = remote_index.RemoteIndexRequest(
            connection=archive.archive_revision(self.fixture.config),
            path=path, full_rehash=full_rehash,
        )
        queued = api.start_remote_index(request)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (queued["id"],))
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone())
        remote_index.index_remote_archive(job, None, self.fixture.managed)
        with catalog.database() as db:
            row = db.execute("SELECT status, result FROM jobs WHERE id=?", (queued["id"],)).fetchone()
        return row["status"], json.loads(row["result"])

    def collect_stream(self, response):
        async def consume():
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            return b"".join(chunks)
        return asyncio.run(consume())

    def test_indexes_supported_media_and_skips_hidden_symlinks_and_unsupported(self):
        self.write_remote("2025_old/GoPro/old.MP4", b"old-gopro")
        self.write_remote("2025_old/GoPro/old.xmp", b"<xmp>old</xmp>")
        self.write_remote("root_photo.HEIC", b"heic-bytes")
        self.write_remote(".DS_Store", b"finder")
        self.write_remote("._root_photo.HEIC", b"appledouble")
        self.write_remote(".photo-saver-abc-0.part", b"partial")
        self.write_remote("2025_old/notes.txt", b"ignored text")
        self.write_remote(".hidden_dir/secret.MP4", b"hidden video")
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "leak.MP4").write_bytes(b"outside")
        (self.fixture.remote / "link.MP4").symlink_to(outside / "leak.MP4")
        (self.fixture.remote / "dir-link").symlink_to(outside, target_is_directory=True)

        status, result = self.run_index()
        self.assertEqual(status, "done")
        self.assertEqual((result["totalFiles"], result["hashed"], result["unchanged"], result["missing"], result["failed"]), (3, 3, 0, 0, 0))
        with catalog.database() as db:
            rows = {row["path"]: dict(row) for row in db.execute("SELECT * FROM remote_files")}
            storage = db.execute("SELECT * FROM storages WHERE id=?", (self.storage_id,)).fetchone()
        self.assertEqual(set(rows), {"2025_old/GoPro/old.MP4", "2025_old/GoPro/old.xmp", "root_photo.HEIC"})
        self.assertEqual(rows["2025_old/GoPro/old.MP4"]["sha"], hashlib.sha256(b"old-gopro").hexdigest())
        self.assertEqual(rows["root_photo.HEIC"]["status"], "present")
        self.assertIsNotNone(storage["last_indexed_at"])

    def test_incremental_scan_skips_unchanged_rehashes_modified_and_supports_full_rehash(self):
        first = self.write_remote("Trip/a.MP4", b"alpha")
        self.write_remote("Trip/b.JPG", b"bravo")

        status, result = self.run_index()
        self.assertEqual((status, result["hashed"], result["unchanged"]), ("done", 2, 0))

        # 2nd incremental run skips remote_hash completely.
        with patch.object(remote_index, "remote_hash", side_effect=AssertionError("should not rehash unchanged")):
            status, result = self.run_index()
        self.assertEqual((status, result["hashed"], result["unchanged"]), ("done", 0, 2))

        # Modify a.MP4 -> only a.MP4 rehashes.
        first.write_bytes(b"alpha-updated")
        stat_now = first.stat()
        os.utime(first, ns=(stat_now.st_atime_ns, stat_now.st_mtime_ns + 2_000_000_000))
        status, result = self.run_index()
        self.assertEqual((status, result["hashed"], result["unchanged"]), ("done", 1, 1))
        with catalog.database() as db:
            sha = db.execute("SELECT sha FROM remote_files WHERE path='Trip/a.MP4'").fetchone()[0]
        self.assertEqual(sha, hashlib.sha256(b"alpha-updated").hexdigest())

        # full_rehash=True rehashes both even when unchanged.
        status, result = self.run_index(full_rehash=True)
        self.assertEqual((status, result["hashed"], result["unchanged"]), ("done", 2, 0))

    def test_scoped_scan_marks_missing_only_within_scanned_folder(self):
        a1 = self.write_remote("EventA/a1.MP4", b"a1")
        a2 = self.write_remote("EventA/a2.MP4", b"a2")
        ax = self.write_remote("EventA_extra/x.MP4", b"ax")
        b1 = self.write_remote("EventB/b1.MP4", b"b1")
        self.assertEqual(self.run_index()[0], "done")

        a2.unlink()
        ax.unlink()
        b1.unlink()
        self.assertTrue(a1.exists())

        status, result = self.run_index(path="EventA")
        self.assertEqual((status, result["unchanged"], result["missing"]), ("done", 1, 1))
        with catalog.database() as db:
            statuses = {row["path"]: row["status"] for row in db.execute("SELECT path, status FROM remote_files")}
        self.assertEqual(statuses, {
            "EventA/a1.MP4": "present",
            "EventA/a2.MP4": "missing",
            "EventA_extra/x.MP4": "present",
            "EventB/b1.MP4": "present",
        })

        # Full scan marks remaining deleted files as missing.
        status, result = self.run_index()
        self.assertEqual((status, result["missing"]), ("done", 2))
        with catalog.database() as db:
            statuses = {row["path"]: row["status"] for row in db.execute("SELECT path, status FROM remote_files")}
        self.assertEqual(statuses["EventA_extra/x.MP4"], "missing")
        self.assertEqual(statuses["EventB/b1.MP4"], "missing")

    def test_cancel_and_disconnect_preserve_partial_hashes_without_marking_missing(self):
        self.write_remote("a.MP4", b"aaa")
        self.write_remote("b.MP4", b"bbb")
        self.write_remote("c.MP4", b"ccc")
        with catalog.database(write=True) as db:
            catalog.upsert_remote_file(
                db, self.storage_id, "old_gone.MP4", str(self.fixture.remote),
                hashlib.sha256(b"old").hexdigest(), 3, status="present", verified_at=catalog.now(),
            )

        # Cancel queued job directly
        queued = api.start_remote_index(remote_index.RemoteIndexRequest(
            connection=archive.archive_revision(self.fixture.config),
        ))
        cancelled = api.cancel_remote_index(queued["id"])
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertTrue(cancelled["result"]["cancelRequested"])

        # Cancel running job after hashing first file
        queued = api.start_remote_index(remote_index.RemoteIndexRequest(
            connection=archive.archive_revision(self.fixture.config),
        ))
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (queued["id"],))
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (queued["id"],)).fetchone())
        real_hash = remote_index.remote_hash
        calls = [0]
        def hash_then_cancel(*args, **kwargs):
            calls[0] += 1
            if calls[0] == 2:
                api.cancel_remote_index(queued["id"])
                raise remote_index.IndexCancelled()
            return real_hash(*args, **kwargs)
        with patch.object(remote_index, "remote_hash", side_effect=hash_then_cancel):
            remote_index.index_remote_archive(job, None, self.fixture.managed)
        with catalog.database() as db:
            record = db.execute("SELECT status, result FROM jobs WHERE id=?", (queued["id"],)).fetchone()
            statuses = {row["path"]: row["status"] for row in db.execute("SELECT path, status FROM remote_files")}
        self.assertEqual(record["status"], "cancelled")
        self.assertEqual(statuses["a.MP4"], "present")
        self.assertEqual(statuses["old_gone.MP4"], "present")

        # Disconnect mid-scan also preserves existing present records
        with patch.object(remote_index, "remote_hash", side_effect=BrokenPipeError("connection dropped")):
            status, _ = self.run_index()
        self.assertEqual(status, "failed")
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT status FROM remote_files WHERE path='old_gone.MP4'").fetchone()[0], "present")

    def test_toctou_remote_file_change_during_hashing_is_not_recorded(self):
        target = self.write_remote("live.MP4", b"before-edit")
        real_hash = remote_index.remote_hash
        def mutate_during_hash(*args, **kwargs):
            digest = real_hash(*args, **kwargs)
            target.write_bytes(b"changed-during-scan")
            return digest
        with patch.object(remote_index, "remote_hash", side_effect=mutate_during_hash):
            status, result = self.run_index()
        self.assertEqual((status, result["hashed"], result["failed"]), ("failed", 0, 1))
        with catalog.database() as db:
            self.assertIsNone(db.execute("SELECT 1 FROM remote_files WHERE path='live.MP4'").fetchone())

    def test_indexed_remote_only_file_integrates_with_duplicates_catalog_and_download(self):
        legacy_bytes = b"legacy-archive-footage-2024"
        self.write_remote("2024_trip/cam/legacy.MP4", legacy_bytes)
        self.write_remote("root_only.JPG", b"root-photo")
        status, _ = self.run_index()
        self.assertEqual(status, "done")

        # 1. Catalog remote view shows folder tree, remote_only scope, search, and download eligibility
        remote_data = json.loads(records.catalog_records(view="remote", q="", page=1, page_size=50).body)
        self.assertEqual(remote_data["total"], 2)
        self.assertEqual(remote_data["summary"]["remotePresent"], 2)
        self.assertEqual(remote_data["summary"]["remoteOnly"], 2)
        self.assertEqual(remote_data["remoteRootCount"], 1)
        self.assertEqual(remote_data["remoteFolders"][0]["path"], "2024_trip")
        self.assertEqual(remote_data["remoteFolders"][0]["children"][0]["path"], "2024_trip/cam")

        only_sub = json.loads(
            records.catalog_records(view="remote", q="legacy", folder="2024_trip/cam", scope="remote_only", page=1, page_size=50).body
        )
        self.assertEqual(only_sub["total"], 1)
        self.assertEqual(only_sub["rows"][0]["remote_path"], "2024_trip/cam/legacy.MP4")
        self.assertFalse(only_sub["rows"][0]["in_catalog"])
        self.assertTrue(only_sub["rows"][0]["can_download"])

        root_only = json.loads(records.catalog_records(view="remote", q="", folder="__root__", page=1, page_size=50).body)
        self.assertEqual([row["remote_path"] for row in root_only["rows"]], ["root_only.JPG"])

        # 2. Incoming scan flags identical file as remote duplicate
        incoming = self.root / "incoming"
        incoming.mkdir()
        (incoming / "reimported.MP4").write_bytes(legacy_bytes)
        with catalog.database(write=True) as db:
            scan_id = catalog.queue_job(db, "scan", {})
            scan_job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (scan_id,)).fetchone())
        with patch.object(worker.time, "sleep"):
            worker.scan_incoming(scan_job, incoming, self.fixture.managed)
        with catalog.database() as db:
            scanned = db.execute("SELECT status, reason FROM scan_files WHERE scan_id=?", (scan_id,)).fetchone()
        self.assertEqual(scanned["status"], "duplicate")
        self.assertIn("2024_trip/cam/legacy.MP4", scanned["reason"])

        # 3. Cross-path upload of identical managed file is blocked with RemoteDuplicateError,
        #    and remote_view reflects in_catalog=True once the matching SHA exists in media
        self.fixture.add_file("two", "duplicate_name.MP4", legacy_bytes)
        with self.assertRaises(transfers.RemoteDuplicateError) as caught:
            self.fixture.queue([{"id": "two"}])
        self.assertEqual(caught.exception.duplicates[0]["existingPaths"], ["2024_trip/cam/legacy.MP4"])

        after_match = json.loads(records.catalog_records(view="remote", q="", page=1, page_size=50).body)
        self.assertEqual(after_match["summary"]["remoteOnly"], 1)

        # 4. Direct download of pre-existing remote file works
        download = archive.download_archive_file(path="2024_trip/cam/legacy.MP4")
        self.assertEqual(self.collect_stream(download), legacy_bytes)

    def test_rejects_invalid_scope_symlink_stale_connection_and_restores_older_storages_backup(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.fixture.remote / "symdir").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(HTTPException) as bad_path:
            api.start_remote_index(remote_index.RemoteIndexRequest(
                connection=archive.archive_revision(self.fixture.config), path="../escape",
            ))
        self.assertEqual(bad_path.exception.status_code, 400)

        with self.assertRaises(HTTPException) as stale:
            api.start_remote_index(remote_index.RemoteIndexRequest(connection="0" * 64))
        self.assertEqual(stale.exception.status_code, 409)

        status, result = self.run_index(path="symdir")
        self.assertEqual(status, "failed")
        self.assertIn("심볼릭 링크", result["error"])

        # Active remote-index blocks SSH host key reset
        (self.settings_dir / "address").write_text("192.0.2.10", encoding="utf-8")
        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, "remote-index", {})
        with self.assertRaises(HTTPException) as guarded:
            settings.reset_host_key()
        self.assertEqual(guarded.exception.status_code, 409)
        with catalog.database(write=True) as db:
            db.execute("DELETE FROM jobs WHERE id=?", (job_id,))

        # Backup without storages.last_indexed_at restores cleanly
        self.write_remote("ok.MP4", b"ok-bytes")
        self.assertEqual(self.run_index()[0], "done")
        backup = self.root / "old_storages.sqlite3"
        with catalog.database() as source:
            dest = sqlite3.connect(backup)
            try:
                source.backup(dest)
            finally:
                dest.close()
        conn = sqlite3.connect(backup)
        try:
            conn.execute("PRAGMA foreign_keys=OFF")
            conn.execute("CREATE TABLE storages_old (id TEXT PRIMARY KEY, label TEXT NOT NULL, root_hint TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)")
            conn.execute("INSERT INTO storages_old SELECT id,label,root_hint,created_at,last_seen_at FROM storages")
            conn.execute("DROP TABLE storages")
            conn.execute("ALTER TABLE storages_old RENAME TO storages")
            conn.commit()
        finally:
            conn.close()
        settings.restore_catalog_file(backup)
        with catalog.database() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM remote_files WHERE path='ok.MP4'").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
