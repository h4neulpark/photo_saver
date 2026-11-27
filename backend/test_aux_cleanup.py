"""Live auxiliary cleanup boundaries, ownership, receipts and restart recovery."""
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
import catalog
import incoming_cleanup as cleanup
import media
import worker
import test_incoming_workflow


class AuxCleanupTests(unittest.TestCase):
    def setUp(self):
        self.fx = test_incoming_workflow.IncomingWorkflowTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.incoming, self.managed = self.fx.incoming, self.fx.managed
        self.enterContext(patch.object(api, "INCOMING_PREVIEW", self.incoming))
        self.client = TestClient(api.app)
        self.addCleanup(self.client.close)

    def write(self, path, contents=b"auxiliary"):
        target = self.incoming / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents)
        return target

    def plan(self):
        with catalog.database() as db:
            return cleanup.plan_aux_cleanup(db, self.incoming)

    def queue(self, paths):
        items = [{"path": path, "fingerprint": media.fingerprint((self.incoming / path).stat())} for path in paths]
        with catalog.database(write=True) as db:
            response = cleanup.queue_aux_cleanup(db, self.incoming, items)
            return dict(db.execute("SELECT * FROM jobs WHERE id=?", (response["id"],)).fetchone())

    def run_job(self, job):
        cleanup.cleanup_aux_companions(job, self.incoming, self.managed)
        with catalog.database() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
        self.assertEqual(row["status"], "done")
        return json.loads(row["result"])

    def test_empty_database_and_hidden_symlinks_xmp_excluded(self):
        self.write("orphan.LRV")
        self.write("edits.XMP")
        self.write(".hidden.THM")
        self.write(".photo-saver-uploads/item.AAE")
        (self.incoming / "link.LRV").symlink_to(self.incoming / "orphan.LRV")
        plan = self.plan()
        self.assertIsNone(plan["scanId"])
        self.assertEqual([item["path"] for item in plan["items"]], ["orphan.LRV"])
        self.assertEqual(plan["items"][0]["orphanHint"], "unverified-orphan")
        self.assertEqual(plan["items"][0]["folder"], "")
        self.assertEqual(plan["items"][0]["reason"], "원본 보관 여부를 확인할 수 없는 고아 보조 파일입니다.")
        self.assertEqual(plan["summary"]["defaultSelectedBytes"], 9)

    def test_all_categories_hints_defaults_and_summary(self):
        for name in ("dup.MP4", "ready.MP4", "review.MP4", "amb.JPG", "amb.PNG", "processed.MP4", "archived.MP4"):
            self.write(name, name.encode())
        self.fx.run_job("scan", worker.scan_incoming)
        with catalog.database(write=True) as db:
            for stem, status in (("dup", "duplicate"), ("ready", "ready"), ("review", "review"), ("processed", "deleted")):
                db.execute("UPDATE scan_files SET status=? WHERE path=?", (status, stem + ".MP4"))
            db.execute("DELETE FROM scan_files WHERE path='archived.MP4'")
            db.execute("INSERT INTO media(id,path,name,kind,sha,size,fingerprint,status,original_path) VALUES ('archive','kept.MP4','kept.MP4','video','sha',1,'snapshot','archived','archived.MP4')")
        for name in ("processed.MP4", "archived.MP4"):
            (self.incoming / name).unlink()
        self.write("unscanned.MP4")
        for name in ("orphan.LRV", "processed.THM", "archived.THM", "dup.LRV", "ready.LRV", "review.LRV", "amb.AAE", "unscanned.LRV", "unreadable.THM"):
            self.write(name)
        original = cleanup.scan_tree
        def unreadable(root, extensions):
            for path, info in original(root, extensions):
                yield path, None if path == "unreadable.THM" else info
        with patch.object(cleanup, "scan_tree", side_effect=unreadable):
            plan = self.plan()
        items = {item["path"]: item for item in plan["items"]}
        self.assertEqual({item["category"] for item in items.values()}, set(cleanup.AUX_CATEGORY_ORDER))
        self.assertEqual(items["processed.THM"]["orphanHint"], "owner-processed")
        self.assertEqual(items["archived.THM"]["orphanHint"], "owner-archived")
        self.assertEqual(items["processed.THM"]["reason"], "원본(processed.MP4)이 이미 이동·정리된 뒤 남아 있는 보조 파일입니다.")
        self.assertEqual(items["archived.THM"]["reason"], "원본(archived.MP4)이 보관함에 등록된 기록이 있는 보조 파일입니다.")
        self.assertEqual(items["orphan.LRV"]["reason"], "원본 보관 여부를 확인할 수 없는 고아 보조 파일입니다.")
        self.assertTrue(all(item["folder"] == "" for item in items.values()))
        self.assertEqual(items["amb.AAE"]["candidatePaths"], ["amb.JPG", "amb.PNG"])
        self.assertFalse(items["unreadable.THM"]["selectable"])
        self.assertEqual(plan["summary"]["totalCount"], 9)
        self.assertEqual(plan["summary"]["defaultSelectedCount"], 4)
        self.assertEqual(plan["summary"]["totalBytes"], 72)
        self.assertEqual([item["category"] for item in plan["items"]], sorted([item["category"] for item in plan["items"]], key=cleanup.AUX_CATEGORY_ORDER.index))

    def test_gopro_live_photo_and_explicit_aae_ownership(self):
        for name in ("GH010636.MP4", "GL010636.LRV", "GL010636.THM", "IMG.HEIC", "IMG.MOV", "IMG.AAE", "IMG.MOV.AAE", "IMG.XMP", "amb.JPG", "amb.PNG", "amb.AAE"):
            self.write(name, name.encode())
        self.fx.run_job("scan", worker.scan_incoming)
        items = {item["path"]: item for item in self.plan()["items"]}
        self.assertEqual(items["GL010636.LRV"]["ownerPath"], "GH010636.MP4")
        self.assertEqual(items["IMG.AAE"]["ownerPath"], "IMG.HEIC")
        self.assertEqual(items["IMG.MOV.AAE"]["ownerPath"], "IMG.MOV")
        self.assertEqual(items["amb.AAE"]["category"], "ambiguous")
        self.assertNotIn("IMG.XMP", items)
        rows = self.fx.files()
        self.assertFalse(any(entry["path"] == "IMG.AAE" for entry in json.loads(rows["IMG.MOV"]["companions"])))
        for name in ("amb.JPG", "amb.PNG"):
            entry, = json.loads(rows[name]["companions"])
            self.assertNotIn("fingerprint", entry)
            self.assertEqual(entry["size"], len(b"amb.AAE"))
        # The duplicate cleanup plan uses the same ownership evidence.
        with catalog.database(write=True) as db:
            db.execute("UPDATE scan_files SET status='duplicate'")
            plan = cleanup.plan_duplicate_cleanup(db, [row["id"] for row in rows.values()])
        aux = [item for group in plan["groups"] for item in group["auxCompanions"]]
        self.assertEqual(sum(item["path"] == "IMG.AAE" for item in aux), 1)
        self.assertFalse(any(item["path"] == "amb.AAE" for item in aux))

    def test_http_plan_queue_and_security(self):
        self.write("orphan.LRV")
        response = self.client.get("/api/incoming/aux/plan")
        self.assertEqual((response.status_code, response.headers["cache-control"]), (200, "no-store"))
        item = {key: response.json()["items"][0][key] for key in ("path", "fingerprint")}
        for payload in ({}, {"items": []}, {"items": [{"path": "a.THM"}]}):
            self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json=payload).status_code, 422)
        for path in ("../evil.LRV", "/evil.LRV", ".hidden.LRV", ".photo-saver-uploads/a.LRV", "a/../b.THM", "a.xmp", "a.JPG", "a.MP4"):
            self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [{**item, "path": path}]}).status_code, 400)
        for snapshot in ("bad", "[1,2,3]", "[1,2,true,4,5]", "[1,2,3.0,4,5]", "[1,2,\"3\",4,5]"):
            self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [{**item, "fingerprint": snapshot}]}).status_code, 400)
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [item, item]}).status_code, 400)
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [{**item, "path": "absent.THM"}]}).status_code, 409)
        (self.incoming / "link.LRV").symlink_to(self.incoming / item["path"])
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [{**item, "path": "link.LRV"}]}).status_code, 409)
        response = self.client.post("/api/jobs/aux-cleanup", json={"items": [item]})
        self.assertEqual((response.status_code, response.headers["cache-control"], response.json()["lane"]), (202, "no-store", "local"))
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [item]}).status_code, 409)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='done'")
            catalog.queue_job(db, "reset-all", {})
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [item]}).status_code, 409)

    def test_http_live_state_change_and_mount_error(self):
        target = self.write("orphan.THM")
        item = self.client.get("/api/incoming/aux/plan").json()["items"][0]
        target.write_bytes(b"changed")
        response = self.client.post("/api/jobs/aux-cleanup", json={"items": [{key: item[key] for key in ("path", "fingerprint")} ]})
        self.assertEqual(response.status_code, 409)
        with patch.object(api, "INCOMING_PREVIEW", self.incoming / "missing"):
            self.assertEqual(self.client.get("/api/incoming/aux/plan").status_code, 503)

    def test_plan_nested_folder_preserves_relative_directory(self):
        self.write("camera/day1/orphan.THM")
        item, = self.plan()["items"]
        self.assertEqual(item["folder"], "camera/day1")

    def test_worker_sync_and_ready_source_can_still_move(self):
        self.write("clip.MP4", b"video")
        self.write("clip.LRV")
        self.write("orphan.THM")
        self.write("keep.XMP", b"<x/>")
        self.fx.run_job("scan", worker.scan_incoming)
        result = self.run_job(self.queue(["clip.LRV", "orphan.THM"]))
        self.assertEqual((result["deleted"], result["freedBytes"]), (2, 18))
        self.assertEqual(json.loads(self.fx.files()["clip.MP4"]["companions"])[0]["disposition"], "deleted")
        with catalog.database() as db:
            scan = catalog.load_latest_scan(db)
        self.assertFalse(any(item["path"] == "orphan.THM" for item in json.loads(scan["result"])["unmatchedCompanions"]))
        self.assertTrue((self.incoming / "keep.XMP").exists())
        moved = self.fx.move("clip.MP4")
        self.assertEqual(moved["moved"], 1)
        self.assertEqual(moved.get("companionReview", 0), 0)

    def test_worker_changed_symlink_absent_and_restart_receipts(self):
        for name in ("changed.AAE", "link.THM", "absent.LRV", "good.THM"):
            self.write(name)
        job = self.queue(["changed.AAE", "link.THM", "absent.LRV", "good.THM"])
        self.write("changed.AAE", b"changed edits")
        (self.incoming / "link.THM").unlink()
        (self.incoming / "link.THM").symlink_to(self.incoming / "changed.AAE")
        (self.incoming / "absent.LRV").unlink()
        result = self.run_job(job)
        self.assertEqual((result["deleted"], result["absent"], result["review"], result["freedBytes"]), (1, 1, 2, 9))
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='queued' WHERE id=?", (job["id"],))
            resumed = dict(db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone())
        original = cleanup.delete_verified_file
        with patch.object(cleanup, "delete_verified_file", wraps=original) as delete:
            again = self.run_job(resumed)
        self.assertEqual(delete.call_count, 2)
        self.assertEqual((again["deleted"], again["absent"], again["freedBytes"]), (1, 1, 9))

    def test_worker_crash_after_progress_and_latest_scan_sync(self):
        self.write("one.THM")
        self.write("two.THM")
        self.fx.run_job("scan", worker.scan_incoming)
        job = self.queue(["one.THM", "two.THM"])
        original = cleanup.delete_verified_file
        def interrupted(root, path, snapshot):
            if path == "two.THM":
                raise RuntimeError("simulated process crash")
            original(root, path, snapshot)
        with patch.object(cleanup, "delete_verified_file", side_effect=interrupted), self.assertRaises(RuntimeError):
            self.run_job(job)
        with catalog.database() as db:
            resumed = dict(db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone())
        self.assertEqual(json.loads(resumed["result"])["completedFiles"], 1)
        result = self.run_job(resumed)
        self.assertEqual((result["deleted"], result["freedBytes"]), (2, 18))
        with catalog.database() as db:
            self.assertEqual(json.loads(catalog.load_latest_scan(db)["result"])["unmatchedCompanions"], [])

    def test_worker_revalidates_payload_allowlist(self):
        self.write("safe.THM")
        self.write("keep.xmp")
        job = self.queue(["safe.THM"])
        payload = json.loads(job["payload"])
        payload["files"][0].update(path="keep.xmp", fingerprint=media.fingerprint((self.incoming / "keep.xmp").stat()))
        job["payload"] = json.dumps(payload)
        result = self.run_job(job)
        self.assertEqual(result["review"], 1)
        self.assertTrue((self.incoming / "keep.xmp").exists())

    def test_worker_sync_keeps_review_and_xmp_and_marks_absent(self):
        for name in ("changed.THM", "absent.THM", "keep.XMP"):
            self.write(name)
        self.fx.run_job("scan", worker.scan_incoming)
        job = self.queue(["changed.THM", "absent.THM"])
        self.write("changed.THM", b"changed")
        (self.incoming / "absent.THM").unlink()
        result = self.run_job(job)
        self.assertEqual((result["absent"], result["review"]), (1, 1))
        with catalog.database() as db:
            unmatched = json.loads(catalog.load_latest_scan(db)["result"])["unmatchedCompanions"]
        self.assertEqual([entry["path"] for entry in unmatched], ["changed.THM"])
        self.assertTrue((self.incoming / "keep.XMP").exists())

    def test_http_permission_error_and_parent_symlink_are_rejected(self):
        target = self.write("folder/file.AAE")
        item = {"path": "folder/file.AAE", "fingerprint": media.fingerprint(target.stat())}
        with patch.object(cleanup, "inspect", side_effect=PermissionError("unreadable")):
            self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [item]}).status_code, 409)
        (self.incoming / "linked").symlink_to(self.incoming / "folder", target_is_directory=True)
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [{**item, "path": "linked/file.AAE"}]}).status_code, 409)
        self.assertEqual(self.client.post("/api/jobs/aux-cleanup", json={"items": [item] * 10001}).status_code, 422)
