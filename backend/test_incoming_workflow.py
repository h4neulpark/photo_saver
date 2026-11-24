import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import catalog
import media
import worker


class IncomingWorkflowTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.incoming = root / "incoming"
        self.managed = root / "managed"
        thumbnails = root / "thumbnails"
        for path in (self.incoming, self.managed, thumbnails):
            path.mkdir()
        self.enterContext(patch.object(catalog, "DATA", root / "data"))
        self.enterContext(patch.object(media, "THUMBNAILS", thumbnails))
        self.enterContext(patch.object(worker, "preview_thumbnail", return_value=None))
        self.enterContext(patch.object(worker.time, "sleep"))
        catalog.initialize()

    def run_job(self, kind, handler, payload=None):
        with catalog.database(write=True) as db:
            job_id = catalog.queue_job(db, kind, payload or {})
            job = dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
        handler(job, self.incoming, self.managed)
        with catalog.database() as db:
            completed = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        self.assertEqual(completed["status"], "done")
        return json.loads(completed["result"])

    def files(self):
        with catalog.database() as db:
            return {row["path"]: dict(row) for row in db.execute("SELECT * FROM scan_files")}

    def test_scan_stages_report_duplicate_and_unmatched_companions(self):
        for name, contents in {
            "a.MP4": b"same video",
            "b.MP4": b"same video",
            "b.XMP": b"<xmp/>",
            "b.THM": b"camera preview",
            "orphan.LRV": b"orphan",
        }.items():
            (self.incoming / name).write_bytes(contents)

        with patch.object(worker, "job_progress", wraps=worker.job_progress) as progress:
            result = self.run_job("scan", worker.scan_incoming)
        self.assertEqual(result["checked"], 2)
        self.assertEqual(result["ready"], 1)
        self.assertEqual(result["duplicate"], 1)
        self.assertEqual([item["path"] for item in result["unmatchedCompanions"]], ["orphan.LRV"])
        self.assertEqual(list(dict.fromkeys(call.args[1] for call in progress.call_args_list)), [
            "보관함 파일 확인 중", "Incoming 파일 찾는 중", "Incoming 파일 해시 검사 중",
            "썸네일 생성과 중복 확인 중", "동반 파일 확인 중",
        ])
        duplicate = self.files()["b.MP4"]
        self.assertEqual(duplicate["status"], "duplicate")
        attached = {item["kind"]: item for item in json.loads(duplicate["companions"])}
        self.assertEqual(attached["thm"]["disposition"], "keep")
        self.assertEqual(attached["xmp"]["disposition"], "keep")
        self.assertTrue(attached["xmp"]["pendingId"])

    def test_changed_file_between_scan_phases_clears_stale_sha_and_fingerprint(self):
        path = self.incoming / "changed.jpg"
        path.write_bytes(b"image")
        progress = worker.job_progress

        def remove_before_thumbnail(job_id, phase, *args):
            if phase == "썸네일 생성과 중복 확인 중":
                path.unlink(missing_ok=True)
            progress(job_id, phase, *args)

        with patch.object(worker, "job_progress", side_effect=remove_before_thumbnail):
            result = self.run_job("scan", worker.scan_incoming)
        self.assertEqual(result["review"], 1)
        self.assertIn("이동되었거나 삭제", self.files()["changed.jpg"]["reason"])
        row = self.files()["changed.jpg"]
        for key in ("sha", "fingerprint", "thumbnail"):
            self.assertIsNone(row[key])

    def test_promoted_duplicate_moves_xmp_and_deletes_camera_aux_and_clears_stale_scan_xmp(self):
        for name, content in {
            "a.MP4": b"same video", "b.MP4": b"same video",
            "b.XMP": b"<xmp/>", "b.THM": b"camera preview",
            "CLIP.JPG": b"same video", "CLIP.MP4": b"same video", "CLIP.THM": b"ambiguous preview",
        }.items():
            (self.incoming / name).write_bytes(content)
        self.run_job("scan", worker.scan_incoming)
        files = self.files()
        duplicate = files["b.MP4"]
        self.assertEqual(duplicate["status"], "duplicate")
        before = {entry["kind"]: entry for entry in json.loads(duplicate["companions"])}
        self.assertEqual(before["thm"]["disposition"], "keep")
        self.assertTrue(before["thm"]["fingerprint"])
        pending_id = before["xmp"]["pendingId"]
        with catalog.database() as db:
            self.assertIsNotNone(db.execute("SELECT 1 FROM scan_xmp WHERE id=?", (pending_id,)).fetchone())
        ambiguous = json.loads(files["CLIP.JPG"]["companions"])[0]
        self.assertEqual(ambiguous["disposition"], "keep")
        self.assertNotIn("fingerprint", ambiguous)

        # Promote the ambiguous owner's remaining sibling first: its auxiliary stays kept.
        for name in ("a.MP4", "CLIP.JPG"):
            (self.incoming / name).unlink()
        with catalog.database(write=True) as db:
            db.execute("UPDATE scan_files SET status='deleted' WHERE path IN ('a.MP4','CLIP.JPG')")
        worker.refresh_deleted_group(self.managed, duplicate["sha"])
        ambiguous_owner = self.files()["CLIP.MP4"]
        self.assertEqual(ambiguous_owner["status"], "ready")
        self.assertEqual(json.loads(ambiguous_owner["companions"])[0]["disposition"], "keep")
        self.assertEqual(self.files()["b.MP4"]["companions"], duplicate["companions"])
        # Removing the last other sibling leaves b.MP4 as the only surviving copy.
        (self.incoming / "CLIP.MP4").unlink()
        with catalog.database(write=True) as db:
            db.execute("UPDATE scan_files SET status='deleted' WHERE path='CLIP.MP4'")
        worker.refresh_deleted_group(self.managed, duplicate["sha"])
        promoted = self.files()["b.MP4"]
        self.assertEqual(promoted["status"], "ready")
        entries = {entry["kind"]: entry for entry in json.loads(promoted["companions"])}
        self.assertEqual(entries["xmp"]["disposition"], "move")
        self.assertNotIn("pendingId", entries["xmp"])
        self.assertEqual(entries["thm"]["disposition"], "delete-after-move")
        with catalog.database() as db:
            self.assertIsNone(db.execute("SELECT 1 FROM scan_xmp WHERE id=?", (pending_id,)).fetchone())
        # A second refresh preserves the now-ready plan.
        worker.refresh_deleted_group(self.managed, duplicate["sha"])
        self.assertEqual(self.files()["b.MP4"]["companions"], promoted["companions"])
        analysis = ("video", {}, None, None, None, False, None)
        with patch.object(worker, "analyze", return_value=analysis):
            result = self.run_job("move", worker.import_selection, {"ids": [duplicate["id"]]})
        self.assertEqual(result["moved"], 1)
        self.assertEqual({entry["kind"]: entry["disposition"] for entry in result["items"][0]["companions"]},
                         {"xmp": "linked", "thm": "deleted"})
        self.assertFalse((self.incoming / "b.XMP").exists())
        self.assertFalse((self.incoming / "b.THM").exists())
        self.assertTrue((self.managed / duplicate["id"] / "b.XMP").is_file())
        self.assertEqual((self.incoming / "CLIP.THM").read_bytes(), b"ambiguous preview")
        self.assertEqual(json.loads(self.files()["CLIP.JPG"]["companions"])[0]["disposition"], "keep")

    def test_move_and_photo_delete_persist_file_and_companion_outcomes(self):
        for name, contents in {
            "move.jpg": b"move image", "move.xmp": b"<xmp/>", "move.thm": b"thumbnail",
            "discard.jpg": b"discard image", "discard.xmp": b"<xmp/>",
        }.items():
            (self.incoming / name).write_bytes(contents)
        self.run_job("scan", worker.scan_incoming)
        files = self.files()
        analysis = ("photo", {}, None, None, None, False, None)
        with patch.object(worker, "analyze", return_value=analysis):
            move = self.run_job("move", worker.import_selection, {"ids": [files["move.jpg"]["id"]]})
        self.assertEqual(move["items"][0]["status"], "moved")
        self.assertEqual({item["kind"]: item["disposition"] for item in move["items"][0]["companions"]},
                         {"thm": "deleted", "xmp": "linked"})
        self.assertFalse((self.incoming / "move.xmp").exists())
        self.assertFalse((self.incoming / "move.thm").exists())
        delete = self.run_job("delete", worker.delete_selection, {"ids": [files["discard.jpg"]["id"]]})
        self.assertEqual(delete["items"][0]["status"], "deleted")
        self.assertEqual(delete["items"][0]["companions"][0]["disposition"], "keep")
        self.assertTrue((self.incoming / "discard.xmp").is_file())

    def test_xmp_link_updates_duplicate_row_and_marks_already_stored_on_rescan(self):
        original = self.managed / "retained.jpg"
        original.write_bytes(b"image")
        sha, info = media.hash_file(self.managed, original.name)
        worker.store_analysis("known", original.name, sha, info, ("photo", {}, None, None, None, False, None))
        (self.incoming / "duplicate.jpg").write_bytes(b"image")
        xmp = self.incoming / "duplicate.xmp"
        xmp.write_bytes(b"<xmp/>")
        self.run_job("scan", worker.scan_incoming)
        before = json.loads(self.files()["duplicate.jpg"]["companions"])[0]
        self.assertEqual(before["disposition"], "link")
        link = self.run_job("xmp-link", worker.link_xmp_selection, {
            "links": [{"id": before["pendingId"], "media_id": "known"}],
        })
        self.assertEqual(link["items"][0]["path"], xmp.name)
        self.assertEqual(link["items"][0]["status"], "linked")
        self.assertEqual(json.loads(self.files()["duplicate.jpg"]["companions"])[0]["disposition"], "linked")
        self.assertFalse(xmp.exists())
        xmp.write_bytes(b"<xmp/>")
        self.run_job("scan", worker.scan_incoming)
        self.assertEqual(json.loads(self.files()["duplicate.jpg"]["companions"])[0]["disposition"], "already-stored")
        self.assertTrue(xmp.is_file())

    def test_move_reports_an_already_absent_camera_auxiliary_separately(self):
        (self.incoming / "clip.jpg").write_bytes(b"image")
        auxiliary = self.incoming / "clip.thm"
        auxiliary.write_bytes(b"thumbnail")
        self.run_job("scan", worker.scan_incoming)
        auxiliary.unlink()
        analysis = ("photo", {}, None, None, None, False, None)
        with patch.object(worker, "analyze", return_value=analysis):
            result = self.run_job("move", worker.import_selection, {"ids": [self.files()["clip.jpg"]["id"]]})
        self.assertEqual(result["moved"], 1)
        self.assertEqual(result["items"][0]["companions"][0]["disposition"], "absent")
        self.assertNotIn("auxDeleted", result)
