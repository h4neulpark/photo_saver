import asyncio
import errno
import hashlib
import io
import json
import os
import socket
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import api
import catalog
import media
from worker import store_analysis


class StreamCancelled(Exception):
    pass


async def call_asgi(app, method, path, headers=None, *, collect_body=True, on_chunk=None):
    raw_headers = []
    for key, value in (headers or []):
        raw_headers.append((key.lower().encode("latin-1"), value.encode("latin-1")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": raw_headers,
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    starts = []
    body_chunks = []
    total_bytes = 0
    max_chunk = 0

    async def send(message):
        nonlocal total_bytes, max_chunk
        if message["type"] == "http.response.start":
            starts.append(message)
        elif message["type"] == "http.response.body":
            chunk = message.get("body", b"")
            total_bytes += len(chunk)
            if len(chunk) > max_chunk:
                max_chunk = len(chunk)
            if collect_body:
                body_chunks.append(chunk)
            if on_chunk is not None:
                on_chunk(chunk, message.get("more_body", False))

    await app(scope, receive, send)
    start = starts[-1]
    response_headers = {}
    for key, value in start.get("headers", []):
        response_headers[key.decode("latin-1").lower()] = value.decode("latin-1")
    return {
        "status": start["status"],
        "headers": response_headers,
        "body": b"".join(body_chunks) if collect_body else b"",
        "total_bytes": total_bytes,
        "max_chunk": max_chunk,
        "start_count": len(starts),
    }


def run_request(method, path, headers=None, *, collect_body=True, on_chunk=None):
    return asyncio.run(call_asgi(api.app, method, path, headers=headers, collect_body=collect_body, on_chunk=on_chunk))


class MediaPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.managed = self.root / "managed"
        self.incoming = self.root / "incoming"
        self.outside = self.root / "outside"
        self.managed.mkdir()
        self.incoming.mkdir()
        self.outside.mkdir()
        self.sentinel = self.outside / "secret.jpg"
        self.sentinel.write_bytes(b"TOP-SECRET-OUTSIDE-BYTES")

        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(catalog, "DATA", self.root / "data"))
        self.stack.enter_context(patch.object(catalog, "THUMBNAILS", self.root / "thumbnails"))
        self.stack.enter_context(patch.object(api, "MANAGED_PREVIEW", self.managed))
        self.stack.enter_context(patch.object(api, "INCOMING_PREVIEW", self.incoming))
        self.stack.enter_context(patch.object(api, "active_storage_scope", return_value=(None, None)))
        catalog.initialize()

    def add_managed(
        self,
        file_id,
        rel_path,
        contents=b"0123456789abcdefghij",
        *,
        kind=None,
        status="available",
        event_id=None,
        confirmed=0,
        device="Sony A7",
        thumbnail=None,
        fingerprint_override=None,
        create_file=True,
    ):
        target = self.managed / rel_path
        if create_file:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
            info = target.stat()
            snap = media.fingerprint(info)
            size = info.st_size
        else:
            snap = json.dumps([1, 2, len(contents), 1_700_000_000_000_000_000, 1_700_000_000_000_000_000])
            size = len(contents)
        if fingerprint_override is not None:
            snap = fingerprint_override
        suffix = Path(rel_path).suffix.lower()
        resolved_kind = kind or ("photo" if suffix in catalog.PHOTOS else "video")
        sha = hashlib.sha256(contents).hexdigest()
        with catalog.database(write=True) as db:
            db.execute(
                """INSERT INTO media
                   (id, path, name, kind, sha, size, fingerprint, status, metadata, thumbnail,
                    capture_time, time_source, time_verified, device, event_id, confirmed)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    file_id, rel_path, Path(rel_path).name, resolved_kind, sha, size, snap,
                    status, "{}", thumbnail, "2026-06-01T10:00:00+00:00", "EXIF", 1, device, event_id, confirmed,
                ),
            )
        return target, snap

    def add_scan_file(self, scan_id, file_id, rel_path, contents=b"incoming-bytes", *, status="ready", create_file=True):
        target = self.incoming / rel_path
        if create_file:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
            info = target.stat()
            snap = media.fingerprint(info)
            size = info.st_size
        else:
            snap = json.dumps([1, 2, len(contents), 1_700_000_000_000_000_000, 1_700_000_000_000_000_000])
            size = len(contents)
        with catalog.database(write=True) as db:
            db.execute(
                """INSERT INTO scan_files
                   (scan_id, id, path, fingerprint, sha, size, modified_at, thumbnail, companions, status, reason)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    scan_id, file_id, rel_path, snap, hashlib.sha256(contents).hexdigest(), size,
                    "2026-06-01T10:00:00+00:00", None, "[]", status, "",
                ),
            )
        return target, snap

    def create_scan_job(self, status="done"):
        with catalog.database(write=True) as db:
            cur = db.execute(
                "INSERT INTO jobs (kind, status, payload, result, created_at, finished_at) VALUES ('scan', ?, '{}', '{\"checked\":1}', ?, ?)",
                (status, catalog.now(), catalog.now() if status == "done" else None),
            )
            return cur.lastrowid

    def assert_media_headers(self, headers):
        self.assertEqual(headers.get("cache-control"), "private, no-store")
        self.assertEqual(headers.get("x-content-type-options"), "nosniff")

    def test_state_managed_preview_urls_and_no_scan_required(self):
        with catalog.database(write=True) as db:
            db.execute(
                "INSERT INTO events (id, name, folder, folder_key, start, end, zone) VALUES ('ev1', 'Trip', '260601_Trip', '260601_trip', '2026-06-01', '2026-06-03', 'Asia/Seoul')"
            )
        self.add_managed("m-unassigned", "m-unassigned/a.jpg", b"a" * 1_500_000, event_id=None, confirmed=0, device=None)
        self.add_managed("m-draft", "m-draft/b.MOV", b"b" * 2000, event_id="ev1", confirmed=0)
        self.add_managed("m-confirmed", "custom/nested/c.MP4", b"c" * 3000, event_id="ev1", confirmed=1, thumbnail="thumb-c.jpg")
        self.add_managed("m-archived", "m-archived/d.mp4", b"d" * 4000, status="archived", create_file=False)
        self.add_managed("m-nofp", "m-nofp/e.jpg", b"e" * 100, fingerprint_override="")

        res = run_request("GET", "/api/state")
        self.assertEqual(res["status"], 200)
        payload = json.loads(res["body"])
        self.assertIsNone(payload["scan"])
        by_id = {item["id"]: item for item in payload["managed"]}

        self.assertEqual(by_id["m-unassigned"]["preview"], "/api/managed/m-unassigned/preview")
        self.assertEqual(by_id["m-unassigned"]["original"], "/api/managed/m-unassigned/original")
        self.assertAlmostEqual(by_id["m-unassigned"]["size"], 1.5, places=6)
        self.assertIsNone(by_id["m-unassigned"]["thumbnail"])

        self.assertEqual(by_id["m-draft"]["preview"], "/api/managed/m-draft/preview")
        self.assertEqual(by_id["m-draft"]["original"], "/api/managed/m-draft/original")

        self.assertEqual(by_id["m-confirmed"]["preview"], "/api/managed/m-confirmed/preview")
        self.assertEqual(by_id["m-confirmed"]["original"], "/api/managed/m-confirmed/original")
        self.assertEqual(by_id["m-confirmed"]["thumbnail"], "/thumbnails/thumb-c.jpg")

        self.assertIsNone(by_id["m-archived"]["preview"])
        self.assertIsNone(by_id["m-archived"]["original"])
        self.assertIsNone(by_id["m-nofp"]["preview"])
        self.assertIsNone(by_id["m-nofp"]["original"])

        # Managed original works without any scan job in catalog.
        original_res = run_request("GET", "/api/managed/m-draft/original")
        self.assertEqual(original_res["status"], 200)
        self.assertEqual(original_res["body"], b"b" * 2000)

    def test_original_mime_headers_uppercase_unicode_and_methods(self):
        cases = [
            ("id-jpg", "id-jpg/photo.JPG", b"\xff\xd8\xffjpeg", "image/jpeg"),
            ("id-png", "id-png/pic.png", b"\x89PNGdata", "image/png"),
            ("id-webp", "id-webp/pic.WebP", b"RIFFwebp", "image/webp"),
            ("id-mp4", "folder/sub/clip.MP4", b"0000ftypmp42", "video/mp4"),
            ("id-mov", 'folder/제주 "바다" 영상.MOV', b"0000ftypqt  ", "video/quicktime"),
        ]
        for file_id, rel_path, data, expected_mime in cases:
            self.add_managed(file_id, rel_path, data)
            res = run_request("GET", f"/api/managed/{file_id}/original")
            self.assertEqual(res["status"], 200)
            self.assertEqual(res["body"], data)
            self.assertEqual(res["headers"]["content-type"], expected_mime)
            self.assertEqual(res["headers"]["content-length"], str(len(data)))
            self.assertEqual(res["headers"]["accept-ranges"], "bytes")
            self.assertTrue(res["headers"]["content-disposition"].startswith("inline;"))
            self.assertIn("etag", res["headers"])
            self.assertIn("last-modified", res["headers"])
            self.assert_media_headers(res["headers"])

            head = run_request("HEAD", f"/api/managed/{file_id}/original")
            self.assertEqual(head["status"], 200)
            self.assertEqual(head["body"], b"")
            self.assertEqual(head["total_bytes"], 0)
            self.assertEqual(head["headers"]["content-length"], str(len(data)))
            self.assertEqual(head["headers"]["etag"], res["headers"]["etag"])
            self.assert_media_headers(head["headers"])

            # Non-HEIF preview delivers original bytes as well.
            prev = run_request("GET", f"/api/managed/{file_id}/preview")
            self.assertEqual(prev["status"], 200)
            self.assertEqual(prev["body"], data)
            self.assertEqual(prev["headers"]["content-type"], expected_mime)
            self.assert_media_headers(prev["headers"])

        # UTF-8 filename* encoding for Korean/space/quote name
        mov = run_request("GET", "/api/managed/id-mov/original")
        self.assertIn("filename*=utf-8''", mov["headers"]["content-disposition"])
        self.assertIn("%22", mov["headers"]["content-disposition"])

        # Disallowed HTTP methods return 405
        self.assertEqual(run_request("HEAD", "/api/managed/id-mp4/preview")["status"], 405)
        self.assertEqual(run_request("POST", "/api/managed/id-mp4/original")["status"], 405)
        self.assertEqual(run_request("DELETE", "/api/managed/id-mp4/original")["status"], 405)
        self.assertEqual(run_request("PUT", "/api/managed/id-mp4/preview")["status"], 405)

    def test_single_range_if_range_400_416_and_head_errors(self):
        content = bytes(range(100))
        self.add_managed("vid", "vid/sample.mp4", content)
        self.add_managed("empty", "empty/zero.mp4", b"")

        full = run_request("GET", "/api/managed/vid/original")
        etag = full["headers"]["etag"]
        last_modified = full["headers"]["last-modified"]

        # bytes=0-9
        r1 = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=0-9")])
        self.assertEqual(r1["status"], 206)
        self.assertEqual(r1["body"], content[0:10])
        self.assertEqual(r1["headers"]["content-range"], "bytes 0-9/100")
        self.assertEqual(r1["headers"]["content-length"], "10")
        self.assertEqual(r1["headers"]["content-type"], "video/mp4")
        self.assert_media_headers(r1["headers"])

        # HEAD with Range -> 206, 0-byte body
        h1 = run_request("HEAD", "/api/managed/vid/original", [("Range", "bytes=0-9")])
        self.assertEqual(h1["status"], 206)
        self.assertEqual(h1["total_bytes"], 0)
        self.assertEqual(h1["headers"]["content-range"], "bytes 0-9/100")
        self.assertEqual(h1["headers"]["content-length"], "10")
        self.assert_media_headers(h1["headers"])

        # bytes=90-
        r2 = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=90-")])
        self.assertEqual(r2["status"], 206)
        self.assertEqual(r2["body"], content[90:])
        self.assertEqual(r2["headers"]["content-range"], "bytes 90-99/100")

        # bytes=-10
        r3 = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=-10")])
        self.assertEqual(r3["status"], 206)
        self.assertEqual(r3["body"], content[-10:])
        self.assertEqual(r3["headers"]["content-range"], "bytes 90-99/100")

        # bytes=80-9999 clamped to EOF
        r4 = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=80-9999")])
        self.assertEqual(r4["status"], 206)
        self.assertEqual(r4["body"], content[80:])
        self.assertEqual(r4["headers"]["content-range"], "bytes 80-99/100")

        # Non-HEIF preview also supports Range
        p1 = run_request("GET", "/api/managed/vid/preview", [("Range", "bytes=10-19")])
        self.assertEqual(p1["status"], 206)
        self.assertEqual(p1["body"], content[10:20])
        self.assert_media_headers(p1["headers"])

        # If-Range matches ETag and Last-Modified -> 206
        ir_etag = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=0-9"), ("If-Range", etag)])
        self.assertEqual(ir_etag["status"], 206)
        self.assertEqual(ir_etag["body"], content[0:10])

        ir_lm = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=0-9"), ("If-Range", last_modified)])
        self.assertEqual(ir_lm["status"], 206)
        self.assertEqual(ir_lm["body"], content[0:10])

        # If-Range mismatch -> 200 full file
        ir_bad = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=0-9"), ("If-Range", '"mismatch"')])
        self.assertEqual(ir_bad["status"], 200)
        self.assertEqual(ir_bad["body"], content)

        # Oversized suffix on non-empty 100-byte file -> clamped to full 206 bytes 0-99/100 (GET, HEAD, /preview)
        r_over = run_request("GET", "/api/managed/vid/original", [("Range", "bytes=-101")])
        self.assertEqual(r_over["status"], 206)
        self.assertEqual(r_over["body"], content)
        self.assertEqual(r_over["headers"]["content-range"], "bytes 0-99/100")
        self.assertEqual(r_over["headers"]["content-length"], "100")
        self.assert_media_headers(r_over["headers"])

        h_over = run_request("HEAD", "/api/managed/vid/original", [("Range", "bytes=-101")])
        self.assertEqual(h_over["status"], 206)
        self.assertEqual(h_over["total_bytes"], 0)
        self.assertEqual(h_over["headers"]["content-range"], "bytes 0-99/100")
        self.assertEqual(h_over["headers"]["content-length"], "100")
        self.assert_media_headers(h_over["headers"])

        p_over = run_request("GET", "/api/managed/vid/preview", [("Range", "bytes=-101")])
        self.assertEqual(p_over["status"], 206)
        self.assertEqual(p_over["body"], content)
        self.assertEqual(p_over["headers"]["content-range"], "bytes 0-99/100")
        self.assert_media_headers(p_over["headers"])

        # If-Range mismatch with oversized suffix or malformed range -> 200 full file (GET & HEAD)
        for range_val in ("bytes=-101", "bytes=10-9"):
            ir_mis = run_request("GET", "/api/managed/vid/original", [("Range", range_val), ("If-Range", '"mismatch"')])
            self.assertEqual(ir_mis["status"], 200)
            self.assertEqual(ir_mis["body"], content)
            self.assert_media_headers(ir_mis["headers"])
            ir_mis_head = run_request("HEAD", "/api/managed/vid/original", [("Range", range_val), ("If-Range", '"mismatch"')])
            self.assertEqual(ir_mis_head["status"], 200)
            self.assertEqual(ir_mis_head["total_bytes"], 0)
            self.assert_media_headers(ir_mis_head["headers"])

        # Malformed, inverted (including end == start - 1), multi-range, and 4500-digit numbers -> 400 (no 500/ValueError)
        huge_digits = "1" * 4500
        for bad_headers in [
            [("Range", "bytes=0-1,4-5")],
            [("Range", "bytes=0-1"), ("Range", "bytes=4-5")],
            [("Range", "bytes=abc")],
            [("Range", "bytes=0-5abc")],
            [("Range", "items=0-5")],
            [("Range", "bytes=20-10")],
            [("Range", "bytes=10-9")],
            [("Range", "bytes=99-98")],
            [("Range", f"bytes={huge_digits}-")],
            [("Range", f"bytes=0-{huge_digits}")],
            [("Range", f"bytes=-{huge_digits}")],
            [("Range", f"bytes={huge_digits}-{'2' * 4500}")],
        ]:
            bad = run_request("GET", "/api/managed/vid/original", bad_headers)
            self.assertEqual(bad["status"], 400, f"GET original failed for {bad_headers[0][1][:40]}")
            self.assert_media_headers(bad["headers"])
            bad_head = run_request("HEAD", "/api/managed/vid/original", bad_headers)
            self.assertEqual(bad_head["status"], 400, f"HEAD original failed for {bad_headers[0][1][:40]}")
            self.assertEqual(bad_head["total_bytes"], 0)
            self.assert_media_headers(bad_head["headers"])
            bad_prev = run_request("GET", "/api/managed/vid/preview", bad_headers)
            self.assertEqual(bad_prev["status"], 400, f"GET preview failed for {bad_headers[0][1][:40]}")
            self.assert_media_headers(bad_prev["headers"])

        # Out-of-range, zero suffix, and empty file -> 416 with Content-Range: bytes */N and MEDIA_HEADERS
        for range_val in ("bytes=9999-", "bytes=-0"):
            oor = run_request("GET", "/api/managed/vid/original", [("Range", range_val)])
            self.assertEqual(oor["status"], 416, range_val)
            self.assertEqual(oor["headers"]["content-range"], "bytes */100")
            self.assert_media_headers(oor["headers"])

            oor_head = run_request("HEAD", "/api/managed/vid/original", [("Range", range_val)])
            self.assertEqual(oor_head["status"], 416, range_val)
            self.assertEqual(oor_head["headers"]["content-range"], "bytes */100")
            self.assertEqual(oor_head["total_bytes"], 0)
            self.assert_media_headers(oor_head["headers"])

            oor_prev = run_request("GET", "/api/managed/vid/preview", [("Range", range_val)])
            self.assertEqual(oor_prev["status"], 416, range_val)
            self.assertEqual(oor_prev["headers"]["content-range"], "bytes */100")
            self.assert_media_headers(oor_prev["headers"])

        for range_val in ("bytes=0-0", "bytes=-101", "bytes=-0"):
            empty_oor = run_request("GET", "/api/managed/empty/original", [("Range", range_val)])
            self.assertEqual(empty_oor["status"], 416, range_val)
            self.assertEqual(empty_oor["headers"]["content-range"], "bytes */0")
            self.assert_media_headers(empty_oor["headers"])
            empty_head = run_request("HEAD", "/api/managed/empty/original", [("Range", range_val)])
            self.assertEqual(empty_head["status"], 416, range_val)
            self.assertEqual(empty_head["headers"]["content-range"], "bytes */0")
            self.assertEqual(empty_head["total_bytes"], 0)
            self.assert_media_headers(empty_head["headers"])
            empty_prev = run_request("GET", "/api/managed/empty/preview", [("Range", range_val)])
            self.assertEqual(empty_prev["status"], 416, range_val)
            self.assertEqual(empty_prev["headers"]["content-range"], "bytes */0")
            self.assert_media_headers(empty_prev["headers"])

    def test_status_codes_errors_and_permissions(self):
        # Nonexistent ID -> 404
        for method in ("GET", "HEAD"):
            res = run_request(method, "/api/managed/does-not-exist/original")
            self.assertEqual(res["status"], 404)
            self.assert_media_headers(res["headers"])
            if method == "HEAD":
                self.assertEqual(res["total_bytes"], 0)

        # Non-available statuses -> 404
        for st in ("archived", "missing", "moving", "offloading"):
            self.add_managed(f"st-{st}", f"st-{st}/a.jpg", status=st, create_file=False)
            res = run_request("GET", f"/api/managed/st-{st}/original")
            self.assertEqual(res["status"], 404)
            self.assert_media_headers(res["headers"])
            prev = run_request("GET", f"/api/managed/st-{st}/preview")
            self.assertEqual(prev["status"], 404)
            self.assert_media_headers(prev["headers"])

        # Empty fingerprint -> 404
        self.add_managed("nofp", "nofp/a.jpg", fingerprint_override="")
        res = run_request("GET", "/api/managed/nofp/original")
        self.assertEqual(res["status"], 404)
        self.assert_media_headers(res["headers"])

        # Missing physical file -> 404 without leaking host path
        self.add_managed("gone", "gone/missing.jpg", create_file=False)
        res = run_request("GET", "/api/managed/gone/original")
        self.assertEqual(res["status"], 404)
        self.assertNotIn(str(self.managed), res["body"].decode("utf-8"))
        self.assert_media_headers(res["headers"])

        # Unsupported extensions and kind mismatches -> 415
        self.add_managed("bad-xmp", "bad-xmp/a.xmp", kind="photo")
        self.add_managed("bad-thm", "bad-thm/a.thm", kind="photo")
        self.add_managed("bad-lrv", "bad-lrv/a.lrv", kind="video")
        self.add_managed("bad-kind-1", "bad-kind-1/a.mp4", kind="photo")
        self.add_managed("bad-kind-2", "bad-kind-2/a.jpg", kind="video")
        for file_id in ("bad-xmp", "bad-thm", "bad-lrv", "bad-kind-1", "bad-kind-2"):
            res = run_request("GET", f"/api/managed/{file_id}/original")
            self.assertEqual(res["status"], 415, file_id)
            self.assert_media_headers(res["headers"])
            head = run_request("HEAD", f"/api/managed/{file_id}/original")
            self.assertEqual(head["status"], 415, file_id)
            self.assertEqual(head["total_bytes"], 0)

        # Permission error -> 403 without exposing internal path or raw message
        self.add_managed("perm", "perm/photo.jpg")
        secret_msg = f"Permission denied: {self.managed}/perm/photo.jpg"
        with patch.object(api, "regular_file", side_effect=PermissionError(errno.EACCES, secret_msg)):
            res = run_request("GET", "/api/managed/perm/original")
            self.assertEqual(res["status"], 403)
            self.assertNotIn(str(self.managed), res["body"].decode("utf-8"))
            self.assertNotIn("Permission denied", res["body"].decode("utf-8"))
            self.assert_media_headers(res["headers"])
            head = run_request("HEAD", "/api/managed/perm/original")
            self.assertEqual(head["status"], 403)
            self.assertEqual(head["total_bytes"], 0)

    def test_security_traversal_symlinks_and_non_regular_files(self):
        # Traversal / absolute / empty component / NUL -> 404, never exposes sentinel
        for idx, bad_path in enumerate([
            "../outside/secret.jpg",
            f"/{self.sentinel.as_posix().lstrip('/')}",
            "a//b.jpg",
            "a/./b.jpg",
            "a/\x00b.jpg",
        ]):
            self.add_managed(f"trav-{idx}", bad_path, kind="photo", create_file=False)
            res = run_request("GET", f"/api/managed/trav-{idx}/original")
            self.assertEqual(res["status"], 404, bad_path)
            self.assertNotIn(b"TOP-SECRET", res["body"])
            self.assert_media_headers(res["headers"])

        # Final file symlink (pointing outside and inside) -> 404
        (self.managed / "sym").mkdir()
        outside_link = self.managed / "sym" / "out.jpg"
        outside_link.symlink_to(self.sentinel)
        self.add_managed("sym-out", "sym/out.jpg", kind="photo", create_file=False)
        res = run_request("GET", "/api/managed/sym-out/original")
        self.assertEqual(res["status"], 404)
        self.assertNotIn(b"TOP-SECRET", res["body"])

        real_inside = self.managed / "sym" / "real.jpg"
        real_inside.write_bytes(b"real-inside")
        inside_link = self.managed / "sym" / "in.jpg"
        inside_link.symlink_to(real_inside)
        self.add_managed("sym-in", "sym/in.jpg", kind="photo", create_file=False)
        res = run_request("GET", "/api/managed/sym-in/original")
        self.assertEqual(res["status"], 404)
        self.assertNotIn(b"real-inside", res["body"])

        # Intermediate directory symlink -> 404
        dir_link = self.managed / "dirlink"
        dir_link.symlink_to(self.outside)
        self.add_managed("sym-dir", "dirlink/secret.jpg", kind="photo", create_file=False)
        res = run_request("GET", "/api/managed/sym-dir/original")
        self.assertEqual(res["status"], 404)
        self.assertNotIn(b"TOP-SECRET", res["body"])

        # Root symlink -> 404
        root_link = self.root / "managed-link"
        root_link.symlink_to(self.managed)
        self.add_managed("ok-for-root", "ok-for-root/a.jpg", b"ok-bytes")
        with patch.object(api, "MANAGED_PREVIEW", root_link):
            res = run_request("GET", "/api/managed/ok-for-root/original")
            self.assertEqual(res["status"], 404)

        # Directory as target -> 409
        (self.managed / "adir.jpg").mkdir()
        self.add_managed("nonreg-dir", "adir.jpg", kind="photo", create_file=False)
        res = run_request("GET", "/api/managed/nonreg-dir/original")
        self.assertEqual(res["status"], 409)
        self.assert_media_headers(res["headers"])

        # FIFO (must not block because of O_NONBLOCK) -> 409
        fifo_path = self.managed / "pipe.jpg"
        os.mkfifo(fifo_path)
        self.add_managed("nonreg-fifo", "pipe.jpg", kind="photo", create_file=False)
        res = run_request("GET", "/api/managed/nonreg-fifo/original")
        self.assertEqual(res["status"], 409)
        self.assert_media_headers(res["headers"])

        # Unix domain socket -> 409
        sock_path = self.managed / "sock.jpg"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.bind(str(sock_path))
            self.add_managed("nonreg-sock", "sock.jpg", kind="photo", create_file=False)
            res = run_request("GET", "/api/managed/nonreg-sock/original")
            self.assertEqual(res["status"], 409)
            self.assert_media_headers(res["headers"])
        finally:
            sock.close()

    def test_toctou_descriptor_pinning_fingerprint_mismatch_and_etag(self):
        target, snap1 = self.add_managed("swap", "swap/clip.mp4", b"ORIGINAL-VERIFIED-BYTES")

        # Fingerprint mismatch before request -> 409
        target.write_bytes(b"MODIFIED-BEFORE-REQUEST")
        res = run_request("GET", "/api/managed/swap/original")
        self.assertEqual(res["status"], 409)
        self.assert_media_headers(res["headers"])

        # Restore with updated fingerprint, then swap path AFTER regular_file opens descriptor
        target.write_bytes(b"ORIGINAL-VERIFIED-BYTES")
        snap_ok = media.fingerprint(target.stat())
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET fingerprint=? WHERE id='swap'", (snap_ok,))

        real_regular_file = api.regular_file

        class SwappingContext:
            def __init__(self, *args, **kwargs):
                self._cm = real_regular_file(*args, **kwargs)

            def __enter__(self):
                stream, info = self._cm.__enter__()
                # Atomically replace target path with a completely different file after verification.
                replacement = target.parent / "other.tmp"
                replacement.write_bytes(b"ATTACKER-REPLACED-BYTES")
                os.replace(replacement, target)
                return stream, info

            def __exit__(self, *exc):
                return self._cm.__exit__(*exc)

        with patch.object(api, "regular_file", side_effect=SwappingContext):
            res = run_request("GET", "/api/managed/swap/original")
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"], b"ORIGINAL-VERIFIED-BYTES")

        # ETag differentiates inode/ctime even when mtime and size are identical
        fp_a = json.dumps([100, 200, 50, 1_700_000_000_000_000_000, 1_700_000_000_000_000_001])
        fp_b = json.dumps([100, 201, 50, 1_700_000_000_000_000_000, 1_700_000_000_000_000_001])
        self.assertNotEqual(api.fingerprint_etag(fp_a), api.fingerprint_etag(fp_b))

    def test_heif_preview_conversion_range_ignore_and_errors(self):
        target, _ = self.add_managed("heic1", "heic1/photo.HEIC", b"fake-heic-raw-bytes", kind="photo")

        # /original returns raw HEIC bytes with image/heic
        orig = run_request("GET", "/api/managed/heic1/original")
        self.assertEqual(orig["status"], 200)
        self.assertEqual(orig["body"], b"fake-heic-raw-bytes")
        self.assertEqual(orig["headers"]["content-type"], "image/heic")
        self.assert_media_headers(orig["headers"])

        # /preview converts via save_image_preview, scales within 2200x2200, applies EXIF orientation, ignores Range header
        real_open = Image.open

        def fake_open(_stream):
            img = Image.new("RGB", (3000, 1200), color=(10, 120, 200))
            exif = img.getexif()
            exif[274] = 6  # Rotate 90 CW -> portrait 1200x3000 scaled within 2200x2200 -> height > width
            buf = io.BytesIO()
            img.save(buf, format="JPEG", exif=exif.tobytes())
            buf.seek(0)
            return real_open(buf)

        with patch.object(api.Image, "open", side_effect=fake_open):
            prev = run_request("GET", "/api/managed/heic1/preview", [("Range", "bytes=0-10")])
        self.assertEqual(prev["status"], 200)
        self.assertEqual(prev["headers"]["content-type"], "image/jpeg")
        self.assertEqual(prev["headers"]["content-length"], str(len(prev["body"])))
        self.assert_media_headers(prev["headers"])
        self.assertNotIn("accept-ranges", prev["headers"])
        self.assertNotIn("content-range", prev["headers"])
        self.assertNotIn("etag", prev["headers"])
        self.assertNotIn("last-modified", prev["headers"])
        with Image.open(io.BytesIO(prev["body"])) as converted:
            self.assertEqual(converted.format, "JPEG")
            self.assertLessEqual(converted.width, 2200)
            self.assertLessEqual(converted.height, 2200)
            self.assertGreater(converted.height, converted.width)

        # Decode errors & DecompressionBombError -> 409 with MEDIA_HEADERS
        for exc in (OSError("bad heif"), ValueError("corrupt"), Image.DecompressionBombError("too big")):
            with patch.object(api.Image, "open", side_effect=exc):
                err = run_request("GET", "/api/managed/heic1/preview")
            self.assertEqual(err["status"], 409)
            self.assert_media_headers(err["headers"])

        # File mutated during HEIF conversion -> recheck=True triggers 409
        def mutating_open(_stream):
            target.write_bytes(b"mutated-mid-conversion")
            return Image.new("RGB", (100, 100), color=(255, 0, 0))

        with patch.object(api.Image, "open", side_effect=mutating_open):
            mut = run_request("GET", "/api/managed/heic1/preview")
        self.assertEqual(mut["status"], 409)
        self.assert_media_headers(mut["headers"])

    def test_event_edit_lifecycle_offload_and_reset(self):
        target, _ = self.add_managed("life1", "life1/clip.mp4", b"stable-video-bytes", device="Sony")
        with catalog.database(write=True) as db:
            db.execute(
                "INSERT INTO events (id, name, folder, folder_key, start, end, zone) VALUES ('e1', 'Beach', '260601_Beach', '260601_beach', '2026-06-01', '2026-06-02', 'Asia/Seoul')"
            )
        # Assign, edit device, edit event name, confirm placement -> URL and bytes remain intact
        api.assign_files(api.Assignment(ids=["life1"], event_id="e1"))
        api.edit_media(api.MediaEdit(ids=["life1"], device="Camera A"))
        api.edit_event("e1", api.EventFields(name="Renamed Beach", start="2026-06-01", end="2026-06-02"))
        api.confirm_placements(api.Selection(ids=["life1"]))

        res = run_request("GET", "/api/managed/life1/original")
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"], b"stable-video-bytes")

        # External file replacement without rescan fails with 409 (and HEAD body is empty)
        target.write_bytes(b"externally-replaced-bytes")
        stale = run_request("GET", "/api/managed/life1/original")
        self.assertEqual(stale["status"], 409)
        self.assert_media_headers(stale["headers"])
        stale_head = run_request("HEAD", "/api/managed/life1/original")
        self.assertEqual(stale_head["status"], 409)
        self.assertEqual(stale_head["total_bytes"], 0)
        self.assert_media_headers(stale_head["headers"])

        # Rescan / rename registers new ID and marks old missing -> old ID 404, new ID 200
        renamed = target.parent / "renamed.mp4"
        os.replace(target, renamed)
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='missing' WHERE id='life1'")
        self.add_managed("life2", "life1/renamed.mp4", b"externally-replaced-bytes", create_file=False)
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET fingerprint=?, size=? WHERE id='life2'", (media.fingerprint(renamed.stat()), renamed.stat().st_size))
        self.assertEqual(run_request("GET", "/api/managed/life1/original")["status"], 404)
        self.assertEqual(run_request("HEAD", "/api/managed/life1/original")["total_bytes"], 0)
        ok2 = run_request("GET", "/api/managed/life2/original")
        self.assertEqual(ok2["status"], 200)
        self.assertEqual(ok2["body"], b"externally-replaced-bytes")

        # Offload marks row archived and deletes local file -> 404 and /state nulls URLs
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET status='archived' WHERE id='life2'")
        renamed.unlink()
        self.assertEqual(run_request("GET", "/api/managed/life2/original")["status"], 404)
        st = json.loads(run_request("GET", "/api/state")["body"])
        item = next(m for m in st["managed"] if m["id"] == "life2")
        self.assertIsNone(item["preview"])
        self.assertIsNone(item["original"])

        # Reset clears catalog -> 404
        with catalog.database(write=True) as db:
            catalog.clear_catalog(db)
        self.assertEqual(run_request("GET", "/api/managed/life2/original")["status"], 404)

    def test_sparse_large_file_bounded_chunks_fd_cleanup_and_no_db_lock(self):
        sparse_dir = self.managed / "sparse"
        sparse_dir.mkdir()
        sparse_file = sparse_dir / "huge.mp4"
        total_size = 64 * 1024 * 1024  # 64 MiB sparse file
        with open(sparse_file, "wb") as handle:
            handle.write(b"START-MARKER")
            handle.seek(32 * 1024 * 1024)
            handle.write(b"MID---MARKER")
            handle.seek(total_size - 12)
            handle.write(b"TAIL--MARKER")
        info = sparse_file.stat()
        snap = media.fingerprint(info)
        with catalog.database(write=True) as db:
            db.execute(
                """INSERT INTO media (id, path, name, kind, sha, size, fingerprint, status, metadata)
                   VALUES ('huge', 'sparse/huge.mp4', 'huge.mp4', 'video', 'sha-huge', ?, ?, 'available', '{}')""",
                (total_size, snap),
            )

        # Read start, middle, and tail ranges with bounded chunks
        for rng, expected in [
            ("bytes=0-11", b"START-MARKER"),
            (f"bytes={32 * 1024 * 1024}-{32 * 1024 * 1024 + 11}", b"MID---MARKER"),
            ("bytes=-12", b"TAIL--MARKER"),
        ]:
            res = run_request("GET", "/api/managed/huge/original", [("Range", rng)])
            self.assertEqual(res["status"], 206)
            self.assertEqual(res["body"], expected)
            self.assertLessEqual(res["max_chunk"], 64 * 1024)

        # Range larger than one chunk streams in <= 64 KiB chunks without holding DB write lock
        db_write_succeeded_mid_stream = False

        def on_chunk(_chunk, more_body):
            nonlocal db_write_succeeded_mid_stream
            if more_body and not db_write_succeeded_mid_stream:
                with catalog.database(write=True) as db:
                    db.execute("INSERT INTO device_names (source, name) VALUES ('midstream', 'Midstream Cam')")
                db_write_succeeded_mid_stream = True

        res = run_request(
            "GET", "/api/managed/huge/original", [("Range", "bytes=0-196607")],
            collect_body=False, on_chunk=on_chunk,
        )
        self.assertEqual(res["status"], 206)
        self.assertEqual(res["total_bytes"], 196608)
        self.assertLessEqual(res["max_chunk"], 64 * 1024)
        self.assertTrue(db_write_succeeded_mid_stream)

        # Client cancellation / disconnect mid-stream closes verified FD and does not send a second start
        opened_streams = []
        real_regular_file = api.regular_file

        class TrackingCM:
            def __init__(self, *args, **kwargs):
                self._cm = real_regular_file(*args, **kwargs)

            def __enter__(self):
                stream, st = self._cm.__enter__()
                opened_streams.append(stream)
                return stream, st

            def __exit__(self, *exc):
                return self._cm.__exit__(*exc)

        def abort_on_first_chunk(_chunk, _more_body):
            raise StreamCancelled("client disconnected")

        with patch.object(api, "regular_file", side_effect=TrackingCM):
            with self.assertRaises(StreamCancelled):
                run_request(
                    "GET", "/api/managed/huge/original", [("Range", "bytes=0-196607")],
                    collect_body=False, on_chunk=abort_on_first_chunk,
                )
        self.assertEqual(len(opened_streams), 1)
        self.assertTrue(opened_streams[0].closed)

    def test_incoming_regression_and_delete_isolation(self):
        old_scan = self.create_scan_job()
        self.add_scan_file(old_scan, "inc-old", "old.jpg", b"old-bytes", status="ready")

        latest_scan = self.create_scan_job()
        self.add_scan_file(latest_scan, "inc-ready", "ready.jpg", b"0123456789abcdef", status="ready")
        self.add_scan_file(latest_scan, "inc-dup", "dup.jpg", b"dup-bytes", status="duplicate")
        self.add_scan_file(latest_scan, "inc-rev", "rev.jpg", b"rev-bytes", status="review")
        self.add_scan_file(latest_scan, "inc-heic", "pic.heic", b"heic-raw", status="ready")
        self.add_managed("m-photo", "m-photo/keep.jpg", b"managed-photo", kind="photo")

        # Only latest scan ready/duplicate allowed
        self.assertEqual(run_request("GET", "/api/incoming/inc-old/original")["status"], 404)
        self.assertEqual(run_request("GET", "/api/incoming/inc-rev/original")["status"], 404)

        ok = run_request("GET", "/api/incoming/inc-ready/original")
        self.assertEqual(ok["status"], 200)
        self.assertEqual(ok["body"], b"0123456789abcdef")
        self.assert_media_headers(ok["headers"])

        dup = run_request("GET", "/api/incoming/inc-dup/original")
        self.assertEqual(dup["status"], 200)
        self.assertEqual(dup["body"], b"dup-bytes")

        # Incoming HEIF preview converts via shared helper
        with patch.object(api.Image, "open", side_effect=lambda _s: Image.new("RGB", (64, 64), color=(1, 2, 3))):
            heif = run_request("GET", "/api/incoming/inc-heic/preview")
        self.assertEqual(heif["status"], 200)
        self.assertEqual(heif["headers"]["content-type"], "image/jpeg")
        self.assert_media_headers(heif["headers"])

        # Incoming keeps default FileResponse range policy (not managed's single-range 400)
        multi = run_request("GET", "/api/incoming/inc-ready/original", [("Range", "bytes=0-1,4-5")])
        self.assertEqual(multi["status"], 206)

        # Delete endpoint rejects managed IDs and accepts only incoming scanned photos
        with self.assertRaises(api.HTTPException) as ctx:
            api.delete_photos(api.Selection(ids=["m-photo"]))
        self.assertEqual(ctx.exception.status_code, 409)

        queued = api.delete_photos(api.Selection(ids=["inc-ready"]))
        self.assertIn("id", queued)


if __name__ == "__main__":
    unittest.main()
