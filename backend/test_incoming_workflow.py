import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import api
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

    def move(self, *paths):
        files = self.files()

        def analysis(root, path, *args):
            kind = "photo" if Path(path).suffix.lower() in catalog.PHOTOS else "video"
            return (kind, {}, None, None, None, False, None)

        with patch.object(worker, "analyze", side_effect=analysis):
            return self.run_job("move", worker.import_selection, {"ids": [files[path]["id"] for path in paths]})

    def test_aae_single_photo_and_video_are_deleted_after_move_without_managed_copy(self):
        for name in ("IMG_0001.HEIC", "IMG_0001.AAE", "clip.mov", "clip.aae"):
            (self.incoming / name).write_bytes(name.encode())
        self.run_job("scan", worker.scan_incoming)
        files = self.files()
        for name in ("IMG_0001.HEIC", "clip.mov"):
            entry, = json.loads(files[name]["companions"])
            self.assertEqual((entry["kind"], entry["disposition"]), ("aae", "delete-after-move"))
            self.assertTrue(entry["fingerprint"])
            self.assertEqual(api.view_scan_file(files[name])["cameraAuxCount"], 1)
        result = self.move("IMG_0001.HEIC", "clip.mov")
        self.assertEqual((result["moved"], result["auxDeleted"]), (2, 2))
        self.assertTrue(all(item["companions"][0]["disposition"] == "deleted" for item in result["items"]))
        self.assertEqual(list(self.incoming.iterdir()), [])
        self.assertEqual(sorted(path.name for path in self.managed.rglob("*") if path.is_file()), ["IMG_0001.HEIC", "clip.mov"])

    def test_live_photo_aae_belongs_only_to_photo_and_is_deleted_once(self):
        for stem, extension in (("IMG_1001", "HEIC"), ("IMG_1002", "JPG")):
            for suffix in (extension, "MOV", "AAE"):
                name = f"{stem}.{suffix}"
                (self.incoming / name).write_bytes(name.encode())
        self.run_job("scan", worker.scan_incoming)
        files = self.files()
        for stem, extension in (("IMG_1001", "HEIC"), ("IMG_1002", "JPG")):
            photo, video = files[f"{stem}.{extension}"], files[f"{stem}.MOV"]
            self.assertEqual(api.view_scan_file(photo)["cameraAuxCount"], 1)
            self.assertEqual(api.view_scan_file(video)["cameraAuxCount"], 0)
            self.assertEqual(json.loads(video["companions"]), [])
            entry, = json.loads(photo["companions"])
            self.assertEqual(entry["path"], f"{stem}.AAE")
            self.assertEqual(entry["disposition"], "delete-after-move")
            # Moving the video first must neither delete nor attach the photo's AAE.
            result = self.move(video["path"], photo["path"])
            self.assertEqual((result["moved"], result["auxDeleted"]), (2, 1))
            self.assertNotIn("companionReview", result)
            self.assertNotIn("companions", result["items"][0])
            self.assertEqual(result["items"][1]["companions"][0]["disposition"], "deleted")
            self.assertFalse((self.incoming / f"{stem}.AAE").exists())

    def test_live_photo_aae_with_unreadable_stat_is_kept_only_on_photo(self):
        for name in ("IMG_1001.HEIC", "IMG_1001.MOV", "IMG_1001.AAE"):
            (self.incoming / name).write_bytes(name.encode())
        scan_tree = worker.scan_tree

        def unreadable_aae(root, *args, **kwargs):
            for path, info in scan_tree(root, *args, **kwargs):
                yield path, None if root == self.incoming and path == "IMG_1001.AAE" else info

        with patch.object(worker, "scan_tree", side_effect=unreadable_aae):
            result = self.run_job("scan", worker.scan_incoming)

        files = self.files()
        entry, = json.loads(files["IMG_1001.HEIC"]["companions"])
        self.assertEqual(entry["path"], "IMG_1001.AAE")
        self.assertEqual(entry["disposition"], "keep")
        self.assertEqual(entry["reason"], "파일 상태를 읽을 수 없습니다.")
        self.assertNotIn("fingerprint", entry)
        self.assertEqual(json.loads(files["IMG_1001.MOV"]["companions"]), [])
        self.assertEqual(result["unmatchedCompanions"], [])
        self.assertTrue((self.incoming / "IMG_1001.AAE").is_file())

    def test_live_photo_duplicate_owner_preserves_aae_until_photo_is_promoted(self):
        for name, contents in {
            "AAA.HEIC": b"same photo", "IMG_1003.HEIC": b"same photo",
            "IMG_1003.MOV": b"live video", "IMG_1003.AAE": b"apple edits",
        }.items():
            (self.incoming / name).write_bytes(contents)
        self.run_job("scan", worker.scan_incoming)
        photo = self.files()["IMG_1003.HEIC"]
        self.assertEqual(photo["status"], "duplicate")
        entry, = json.loads(photo["companions"])
        self.assertEqual(entry["disposition"], "keep")
        self.assertEqual(entry["reason"], "원본이 이동 대상이 아니므로 보조 파일을 보존합니다.")
        self.assertTrue(entry["fingerprint"])
        self.assertEqual(json.loads(self.files()["IMG_1003.MOV"]["companions"]), [])
        result = self.move("IMG_1003.MOV")
        self.assertEqual(result["moved"], 1)
        self.assertNotIn("auxDeleted", result)
        self.assertEqual((self.incoming / "IMG_1003.AAE").read_bytes(), b"apple edits")
        deletion = self.run_job("delete", worker.delete_selection, {"ids": [self.files()["AAA.HEIC"]["id"]]})
        self.assertEqual(deletion["deleted"], 1)
        promoted = self.files()["IMG_1003.HEIC"]
        self.assertEqual(promoted["status"], "ready")
        self.assertEqual(json.loads(promoted["companions"])[0]["disposition"], "delete-after-move")
        result = self.move("IMG_1003.HEIC")
        self.assertEqual(result["auxDeleted"], 1)
        self.assertFalse((self.incoming / "IMG_1003.AAE").exists())

    def test_ambiguous_aae_and_gopro_live_photo_proxies_stay_kept_after_promotion(self):
        cases = {
            "photos": ("HEIC", "JPG"), "videos": ("MOV", "MP4"),
            "not-live": ("HEIC", "MP4"), "three": ("HEIC", "MOV", "MP4"),
            "proxy": ("HEIC", "MOV"),
        }
        for stem, extensions in cases.items():
            for extension in extensions:
                (self.incoming / f"{stem}.{extension}").write_bytes(stem.encode())
            for extension in (("THM", "LRV") if stem == "proxy" else ("AAE",)):
                (self.incoming / f"{stem}.{extension}").write_bytes(b"aux")
        self.run_job("scan", worker.scan_incoming)
        files = self.files()
        for stem, extensions in cases.items():
            for extension in extensions:
                row = files[f"{stem}.{extension}"]
                for entry in json.loads(row["companions"]):
                    # LRV has a single video candidate even in a photo+MOV pair.
                    if entry["kind"] == "lrv":
                        continue
                    self.assertEqual(entry["disposition"], "keep")
                    self.assertEqual(entry["reason"], "원본 후보가 여러 개입니다.")
                    self.assertNotIn("fingerprint", entry)
            ready, = [row for row in files.values() if Path(row["path"]).stem == stem and row["status"] == "ready"]
            # Remove the earlier copy and refresh the group, including video-only groups.
            (self.incoming / ready["path"]).unlink()
            with catalog.database(write=True) as db:
                db.execute("UPDATE scan_files SET status='deleted' WHERE id=?", (ready["id"],))
            worker.refresh_deleted_group(self.managed, ready["sha"])
            promoted, = [row for row in self.files().values() if Path(row["path"]).stem == stem and row["status"] == "ready"]
            for entry in json.loads(promoted["companions"]):
                if entry["kind"] != "lrv":
                    self.assertEqual(entry["disposition"], "keep")
                    self.assertNotIn("fingerprint", entry)
            result = self.move(promoted["path"])
            self.assertEqual(result["moved"], 1)
            for entry in result["items"][0].get("companions", []):
                if entry["kind"] != "lrv":
                    self.assertEqual(entry["disposition"], "keep")
                    self.assertTrue((self.incoming / entry["path"]).is_file())

    def test_aae_exact_extension_matches_only_named_source_and_never_falls_back(self):
        for name in ("IMG_2001.HEIC", "IMG_2001.JPG", "IMG_2001.HEIC.AAE",
                     "MISSING.JPG", "MISSING.HEIC.AAE", "clip.MOV", "clip.MOV.aae"):
            (self.incoming / name).write_bytes(name.encode())
        result = self.run_job("scan", worker.scan_incoming)
        self.assertEqual([entry["path"] for entry in result["unmatchedCompanions"]], ["MISSING.HEIC.AAE"])
        self.assertEqual(json.loads(self.files()["IMG_2001.JPG"]["companions"]), [])
        for name in ("IMG_2001.HEIC", "clip.MOV"):
            entry, = json.loads(self.files()[name]["companions"])
            self.assertEqual(entry["path"].casefold(), (name + ".aae").casefold())
        result = self.move("IMG_2001.HEIC", "clip.MOV")
        self.assertEqual(result["auxDeleted"], 2)
        self.assertTrue((self.incoming / "MISSING.HEIC.AAE").is_file())
        self.assertFalse((self.incoming / "IMG_2001.HEIC.AAE").exists())
        self.assertFalse((self.incoming / "clip.MOV.aae").exists())

    def test_orphan_aae_and_gl_aae_do_not_match_gopro_original(self):
        for name in ("GH010636.MP4", "GL010636.AAE", "orphan.AAE"):
            (self.incoming / name).write_bytes(name.encode())
        result = self.run_job("scan", worker.scan_incoming)
        self.assertEqual(json.loads(self.files()["GH010636.MP4"]["companions"]), [])
        self.assertEqual([entry["path"] for entry in result["unmatchedCompanions"]], ["GL010636.AAE", "orphan.AAE"])
        for entry in result["unmatchedCompanions"]:
            self.assertEqual(entry["disposition"], "keep")
            self.assertEqual(entry["reason"], "연결할 원본을 찾지 못했습니다.")
            self.assertNotIn("fingerprint", entry)
        self.assertEqual(self.move("GH010636.MP4")["moved"], 1)
        self.assertTrue((self.incoming / "GL010636.AAE").is_file())
        self.assertTrue((self.incoming / "orphan.AAE").is_file())

    def test_changed_symlinked_and_absent_aae_are_not_counted_as_deleted(self):
        for stem in ("changed", "symlinked", "absent"):
            (self.incoming / f"{stem}.HEIC").write_bytes(stem.encode())
            (self.incoming / f"{stem}.AAE").write_bytes(b"apple edits")
        self.run_job("scan", worker.scan_incoming)
        changed = self.incoming / "changed.AAE"
        changed.write_bytes(b"new edits")
        linked = self.incoming / "symlinked.AAE"
        linked.unlink()
        target = self.managed.parent / "protected.AAE"
        target.write_bytes(b"outside edits")
        linked.symlink_to(target)
        (self.incoming / "absent.AAE").unlink()
        for stem in ("changed", "symlinked", "absent"):
            result = self.move(f"{stem}.HEIC")
            self.assertEqual(result["moved"], 1)
            self.assertNotIn("auxDeleted", result)
            entry, = result["items"][0]["companions"]
            self.assertEqual(entry["disposition"], "absent" if stem == "absent" else "review")
            if stem != "absent":
                self.assertEqual(result["companionReview"], 1)
        self.assertEqual(changed.read_bytes(), b"new edits")
        self.assertTrue(linked.is_symlink())
        self.assertEqual(target.read_bytes(), b"outside edits")

    def test_photo_delete_preserves_aae(self):
        (self.incoming / "discard.HEIC").write_bytes(b"photo")
        sidecar = self.incoming / "discard.AAE"
        sidecar.write_bytes(b"apple edits")
        self.run_job("scan", worker.scan_incoming)
        result = self.run_job("delete", worker.delete_selection, {"ids": [self.files()["discard.HEIC"]["id"]]})
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["items"][0]["companions"][0]["disposition"], "keep")
        self.assertEqual(sidecar.read_bytes(), b"apple edits")

    def test_deleted_incoming_preserves_remote_and_archive_thumbnail_references(self):
        for source in ('remote', 'archive'):
            sha = ('a' if source == 'remote' else 'b') * 64
            media.thumbnail_path(sha).write_bytes(b'cached')
            with catalog.database(write=True) as db:
                job_id = catalog.queue_job(db, 'upload', {})
                db.execute("UPDATE jobs SET status='done' WHERE id=?", (job_id,))
                if source == 'remote':
                    catalog.upsert_remote_file(db, 'storage', 'photo.jpg', '/NAS', sha, 1)
                else:
                    db.execute("""INSERT INTO archive_entries(job_id,item_index,media_id,asset_kind,local_path,sha,storage_id,archive_root,target,outcome,recorded_at)
                        VALUES (?,0,'old','media','old.jpg',?,'storage','/NAS','old.jpg','uploaded','now')""", (job_id, sha))
            worker.refresh_deleted_group(self.managed, sha)
            self.assertTrue(media.thumbnail_path(sha).is_file())

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
