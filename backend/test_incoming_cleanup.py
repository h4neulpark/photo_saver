import hashlib
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import paramiko
from fastapi import HTTPException

import catalog
import incoming_cleanup
import media
import worker
from test_transfers import LocalSFTP


class IncomingCleanupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.incoming, self.managed, self.remote = (root / name for name in ("incoming", "managed", "remote"))
        for folder in (self.incoming, self.managed, self.remote):
            folder.mkdir()
        self.patch(catalog, "DATA", root / "data")
        self.patch(media, "THUMBNAILS", root / "thumbnails")
        catalog.initialize()
        self.config = {"address": "127.0.0.1", "account": "user", "root": str(self.remote), "storageId": "omv"}
        self.patch(incoming_cleanup, "archive_config", lambda: self.config.copy())
        self.sftp = LocalSFTP()

        @contextmanager
        def connection(expected):
            self.assertEqual(expected, self.config)
            yield self.sftp, self.config.copy()

        self.patch(incoming_cleanup, "archive_connection", connection)
        self.scan_id = self.new_scan()

    def patch(self, module, name, replacement):
        patcher = patch.object(module, name, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)

    def new_scan(self):
        with catalog.database(write=True) as db:
            scan_id = catalog.queue_job(db, "scan", {})
            worker.finish(db, scan_id, {})
        return scan_id

    def add_incoming(self, file_id, content=b"footage", status="duplicate", suffix=".MP4"):
        path = self.incoming / (file_id + suffix)
        path.write_bytes(content)
        with catalog.database(write=True) as db:
            db.execute(
                """INSERT INTO scan_files (scan_id,id,path,sha,size,fingerprint,status)
                   VALUES (?,?,?,?,?,?,?)""",
                (self.scan_id, file_id, path.name, hashlib.sha256(content).hexdigest(),
                 len(content), media.fingerprint(path.stat()), status),
            )
        return path

    def add_managed(self, file_id="managed-keeper", content=b"footage"):
        path = self.managed / f"{file_id}.MP4"
        path.write_bytes(content)
        worker.store_analysis(file_id, path.name, hashlib.sha256(content).hexdigest(), path.stat(),
                              ("video", {}, None, None, "", False, "GoPro"))
        return path

    def add_remote(self, path="keeper.MP4", content=b"footage", *, storage_id=None, archive_root=None, verified=True):
        target = self.remote / path
        target.write_bytes(content)
        with catalog.database(write=True) as db:
            catalog.upsert_remote_file(
                db, storage_id or self.config["storageId"], path, archive_root or self.config["root"],
                hashlib.sha256(content).hexdigest(), len(content), verified_at=catalog.now() if verified else None,
            )
        return target

    def plan(self, *ids):
        with catalog.database() as db:
            return incoming_cleanup.plan_duplicate_cleanup(db, ids)["groups"]

    def request(self, file_id, keeper):
        return {"id": file_id, "keeperKind": keeper["kind"], "keeperId": keeper["id"]}

    def queue(self, *items):
        with catalog.database(write=True) as db:
            job_id = incoming_cleanup.queue_duplicate_cleanup(db, items)["id"]
            return dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def run_job(self, job):
        incoming_cleanup.cleanup_duplicates(job, self.incoming, self.managed, refresh_group=worker.refresh_deleted_group)
        with catalog.database() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
        self.assertEqual(row["status"], "done")
        return json.loads(row["result"])

    def scan_row(self, file_id):
        with catalog.database() as db:
            return dict(db.execute("SELECT * FROM scan_files WHERE id=?", (file_id,)).fetchone())

    def test_remote_verified_scope_and_live_cleanup_of_video_preserves_sidecars(self):
        source = self.add_incoming("incoming-copy")
        keeper_path = self.add_remote()
        self.add_remote("other-storage.MP4", storage_id="different-omv")
        self.add_remote("other-root.MP4", archive_root="/previous-root")
        self.add_remote("unverified.MP4", verified=False)
        sidecars = [source.with_suffix(extension) for extension in (".xmp", ".THM", ".LRV")]
        for sidecar in sidecars:
            sidecar.write_bytes(b"sidecar")
        with catalog.database(write=True) as db:
            companions = [{"path": path.name, "disposition": "link"} for path in sidecars]
            db.execute("UPDATE scan_files SET companions=? WHERE id='incoming-copy'", (json.dumps(companions),))

        group, = self.plan("incoming-copy")
        keeper, = group["keepers"]
        self.assertEqual((keeper["kind"], keeper["path"]), ("remote", "keeper.MP4"))
        self.assertEqual(group["files"], [{"id": "incoming-copy", "path": source.name, "sizeBytes": 7}])
        self.assertTrue(keeper["verifiedAt"])
        output = self.run_job(self.queue(self.request("incoming-copy", keeper)))
        self.assertEqual((output["cleaned"], output["review"], output["freedBytes"]), (1, 0, 7))
        self.assertFalse(source.exists())
        self.assertEqual(keeper_path.read_bytes(), b"footage")
        self.assertTrue(all(item.read_bytes() == b"sidecar" for item in sidecars))
        self.assertEqual([(item["path"], item["disposition"]) for item in output["items"][0]["companions"]],
                         [(path.name, "keep") for path in sidecars])
        self.assertEqual(self.sftp.prefetch_calls, [7])
        self.assertEqual(self.scan_row("incoming-copy")["status"], "deleted")

    def test_live_hash_mismatch_at_same_size_keeps_incoming_video(self):
        source = self.add_incoming("same-size")
        remote = self.add_remote()
        keeper = self.plan("same-size")[0]["keepers"][0]
        job = self.queue(self.request("same-size", keeper))
        remote.write_bytes(b"changed")
        result = self.run_job(job)
        self.assertEqual((result["cleaned"], result["review"]), (0, 1))
        self.assertIn("내용이 일치하지", result["items"][0]["reason"])
        self.assertEqual(source.read_bytes(), b"footage")
        self.assertEqual(self.scan_row("same-size")["status"], "review")

    def test_unreachable_remote_keeps_remote_targets_and_still_cleans_local_group(self):
        unavailable = self.add_incoming("remote-copy")
        self.add_remote()
        local_copy = self.add_incoming("photo-copy", b"image", suffix=".JPEG")
        self.add_managed(content=b"image")

        @contextmanager
        def offline(_config):
            raise HTTPException(502, "아카이브에 연결할 수 없습니다.")
            yield

        self.patch(incoming_cleanup, "archive_connection", offline)
        remote_group, local_group = self.plan("remote-copy", "photo-copy")
        result = self.run_job(self.queue(self.request("remote-copy", remote_group["keepers"][0]),
                                         self.request("photo-copy", local_group["keepers"][0])))
        self.assertEqual((result["cleaned"], result["review"]), (1, 1))
        self.assertTrue(unavailable.exists())
        self.assertFalse(local_copy.exists())
        self.assertEqual([item["status"] for item in result["items"]], ["review", "cleaned"])

    def test_selection_cannot_include_an_incoming_keeper(self):
        first = self.add_incoming("first")
        second = self.add_incoming("second")
        group, = self.plan("first", "second")
        keeper = next(item for item in group["keepers"] if item["id"] == "first")
        with self.assertRaises(HTTPException) as error:
            self.queue(self.request("first", keeper), self.request("second", keeper))
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("제외", error.exception.detail)
        result = self.run_job(self.queue(self.request("second", keeper)))
        self.assertEqual(result["cleaned"], 1)
        self.assertTrue(first.exists())
        self.assertFalse(second.exists())
        self.assertEqual(self.scan_row("first")["status"], "ready")

    def test_keeper_from_an_old_snapshot_or_different_config_cannot_be_queued(self):
        self.add_incoming("duplicate")
        self.add_remote()
        group, = self.plan("duplicate")
        self.config["address"] = "127.0.0.2"
        with self.assertRaises(HTTPException) as error:
            self.queue(self.request("duplicate", group["keepers"][0]))
        self.assertEqual(error.exception.status_code, 409)
        self.new_scan()
        with self.assertRaises(HTTPException) as error:
            self.plan("duplicate")
        self.assertEqual(error.exception.status_code, 409)

    def test_managed_keeper_disappearing_after_plan_preserves_source(self):
        source = self.add_incoming("incoming-copy")
        managed = self.add_managed()
        keeper = self.plan("incoming-copy")[0]["keepers"][0]
        job = self.queue(self.request("incoming-copy", keeper))
        managed.unlink()
        result = self.run_job(job)
        self.assertEqual((result["cleaned"], result["review"]), (0, 1))
        self.assertTrue(source.exists())

    def test_changed_incoming_file_is_not_removed(self):
        source = self.add_incoming("incoming-copy")
        keeper = self.add_managed()
        group, = self.plan("incoming-copy")
        job = self.queue(self.request("incoming-copy", group["keepers"][0]))
        source.write_bytes(b"different source")
        result = self.run_job(job)
        self.assertEqual(result["review"], 1)
        self.assertEqual(source.read_bytes(), b"different source")
        self.assertEqual(keeper.read_bytes(), b"footage")

    def test_restart_recovers_removed_target_and_rechecks_staged_existing_target(self):
        first = self.add_incoming("first")
        second = self.add_incoming("second")
        remote = self.add_remote()
        group, = self.plan("first", "second")
        keeper = group["keepers"][0]
        job = self.queue(self.request("first", keeper), self.request("second", keeper))
        with catalog.database(write=True) as db:
            db.execute("UPDATE scan_files SET status='deleting' WHERE scan_id=?", (self.scan_id,))
        first.unlink()
        remote.unlink()
        result = self.run_job(job)
        self.assertEqual((result["cleaned"], result["review"]), (1, 1))
        self.assertTrue(second.exists())
        self.assertEqual(self.scan_row("first")["status"], "deleted")
        self.assertEqual(self.scan_row("second")["status"], "review")

    def test_duplicate_without_separate_copy_exposes_block_reason(self):
        file = self.add_incoming("last-copy")
        group, = self.plan("last-copy")
        self.assertEqual(group["keepers"], [])
        self.assertIn("남길 사본", group["reason"])
        with self.assertRaises(HTTPException):
            self.queue(self.request("last-copy", {"kind": "incoming", "id": "last-copy"}))
        self.assertTrue(file.exists())

    def test_mid_batch_sftp_disconnect_fails_remaining_remote_items_and_preserves_local_and_cleanup_result(self):
        sources = [self.add_incoming(name) for name in ("first", "second", "third")]
        self.add_remote()
        local = self.add_incoming("local", b"image", suffix=".JPEG")
        self.add_managed(content=b"image")
        remote_group, local_group = self.plan("first", "second", "third", "local")
        requests = [self.request(name, remote_group["keepers"][0]) for name in ("first", "second", "third")]
        requests.append(self.request("local", local_group["keepers"][0]))
        job = self.queue(*requests)

        for transport_error in (paramiko.SSHException("channel lost"), EOFError("channel lost"), OSError("channel lost")):
            # Each subcase gets fresh rows and source files; no dead channel may be reused.
            with self.subTest(error=type(transport_error).__name__):
                for source in sources:
                    source.write_bytes(b"footage")
                local.write_bytes(b"image")
                with catalog.database(write=True) as db:
                    db.execute("UPDATE scan_files SET status='duplicate', reason=''")
                    payload = json.loads(job["payload"])
                    for item in payload["files"]:
                        item["fingerprint"] = media.fingerprint((self.incoming / item["path"]).stat())
                        db.execute("UPDATE scan_files SET fingerprint=? WHERE id=?", (item["fingerprint"], item["id"]))
                    db.execute("UPDATE jobs SET status='queued' WHERE id=?", (job["id"],))
                    job["payload"] = json.dumps(payload)
                dead = False
                original_hash = incoming_cleanup.remote_hash

                def read_remote(*args, **kwargs):
                    nonlocal dead
                    self.assertFalse(dead, "dead SFTP channel reused")
                    if hash_remote.call_count == 2:
                        dead = True
                        raise transport_error
                    return original_hash(*args, **kwargs)

                def resolve(*args):
                    self.assertFalse(dead, "dead SFTP channel reused")
                    return original_resolve(*args)

                @contextmanager
                def connection(_config):
                    try:
                        yield self.sftp, self.config.copy()
                    finally:
                        self.sftp.close()

                original_resolve = incoming_cleanup.resolve_remote_file
                with patch.object(incoming_cleanup, "archive_connection", connection), \
                     patch.object(self.sftp, "close", side_effect=EOFError("close failed"), create=True) as close, \
                     patch.object(incoming_cleanup, "sftp_disconnected", side_effect=lambda _sftp, _error: dead), \
                     patch.object(incoming_cleanup, "resolve_remote_file", side_effect=resolve), \
                     patch.object(incoming_cleanup, "remote_hash", side_effect=read_remote) as hash_remote, \
                     patch.object(worker, "refresh_deleted_group", wraps=worker.refresh_deleted_group) as refresh, \
                     self.assertLogs(incoming_cleanup.log, level="WARNING"):
                    result = self.run_job(job)
                close.assert_called_once()
                self.assertEqual(hash_remote.call_count, 2)
                self.assertEqual((result["cleaned"], result["review"], result["completedFiles"]), (2, 2, 4))
                self.assertEqual(result["freedBytes"], len(b"footage") + len(b"image"))
                self.assertEqual([item["status"] for item in result["items"]], ["cleaned", "review", "review", "cleaned"])
                for item in result["items"][1:3]:
                    self.assertIn("연결이 끊어졌습니다", item["reason"])
                self.assertEqual({call.args[1] for call in refresh.call_args_list},
                                 {hashlib.sha256(content).hexdigest() for content in (b"footage", b"image")})
                self.assertFalse(sources[0].exists())
                self.assertTrue(all(source.exists() for source in sources[1:]))
                self.assertFalse(local.exists())

    def test_recheck_404_converts_to_409_review_message(self):
        source = self.add_incoming("copy")
        self.add_remote()
        keeper = self.plan("copy")[0]["keepers"][0]
        job = self.queue(self.request("copy", keeper))
        original = incoming_cleanup.resolve_remote_file

        def disappear(*args):
            if resolve.call_count >= 3:
                raise HTTPException(404, "remote file missing")
            return original(*args)

        with patch.object(incoming_cleanup, "resolve_remote_file", side_effect=disappear) as resolve, \
             patch.object(incoming_cleanup._RemoteVerification, "_handle_transport_error") as transport, \
             patch.object(incoming_cleanup, "fail", wraps=incoming_cleanup.fail) as fail:
            result = self.run_job(job)
        self.assertEqual(resolve.call_count, 3)
        transport.assert_not_called()
        self.assertEqual((result["cleaned"], result["review"]), (0, 1))
        self.assertEqual(result["items"][0]["reason"], "남길 원격 사본을 찾을 수 없습니다. 원격 인덱스를 다시 확인하세요.")
        fail.assert_called_once_with(409, result["items"][0]["reason"])
        self.assertEqual(source.read_bytes(), b"footage")
        self.assertEqual(self.scan_row("copy")["status"], "review")
