import asyncio
import errno
import json
import stat
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

import archive
import catalog
import settings
import test_transfers


class ArchiveTests(unittest.TestCase):
    def test_rejects_paths_outside_root_before_connecting(self):
        for value in ("../secret", "event/../../secret", "/etc", "bad\0name"):
            with self.subTest(value=value), self.assertRaises(HTTPException) as error:
                archive.browse_archive(value)
            self.assertEqual(error.exception.status_code, 400)

    def test_rejects_symlink_target_outside_root(self):
        sftp = MagicMock()
        sftp.normalize.side_effect = ["/archive", "/archive-other"]
        with self.assertRaises(HTTPException) as error:
            archive.directory_listing(sftp, "/archive", PurePosixPath("link"))
        self.assertEqual(error.exception.status_code, 403)
        sftp.listdir_iter.assert_not_called()

    def test_lists_special_names_folders_first_and_keeps_links_inert(self):
        sftp = MagicMock()
        sftp.normalize.side_effect = ["/real/archive", "/real/archive/한글 폴더"]
        def entry(name, mode, size):
            return SimpleNamespace(filename=name, st_mode=mode, st_size=size, st_mtime=123)
        sftp.listdir_iter.return_value = [
            entry('한글 "사진"\n.jpg', stat.S_IFREG, 1234),
            entry('link', stat.S_IFLNK, 10), entry('Folder', stat.S_IFDIR, 4096),
        ]
        result = archive.directory_listing(sftp, "/archive", PurePosixPath("한글 폴더"))
        self.assertEqual(result["path"], "한글 폴더")
        self.assertEqual([item["kind"] for item in result["entries"]], ["folder", "link", "file"])
        self.assertEqual(result["entries"][-1]["name"], '한글 "사진"\n.jpg')
        self.assertEqual(result["entries"][-1]["size"], 1234)
        sftp.listdir_iter.assert_called_once_with("/real/archive/한글 폴더", read_aheads=1)

    def test_empty_root_listing(self):
        sftp = MagicMock()
        sftp.normalize.return_value = "/archive"
        sftp.listdir_iter.return_value = []
        result = archive.directory_listing(sftp, "/archive", PurePosixPath("."))
        self.assertEqual(result, {"root": "/archive", "path": "", "entries": []})

    def test_bounded_listing(self):
        sftp = MagicMock()
        sftp.normalize.return_value = "/archive"
        item = SimpleNamespace(filename="file", st_mode=stat.S_IFREG, st_size=1, st_mtime=1)
        sftp.listdir_iter.return_value = [item, item]
        with patch.object(archive, "MAX_ENTRIES", 1), self.assertRaises(HTTPException) as error:
            archive.directory_listing(sftp, "/archive", PurePosixPath("."))
        self.assertEqual(error.exception.status_code, 413)

    def test_permissions_authentication_and_timeout_are_actionable(self):
        for failure, expected in [
            (PermissionError(errno.EACCES, "denied"), 403),
            (FileNotFoundError(errno.ENOENT, "missing"), 404),
            (archive.paramiko.AuthenticationException(), 401),
            (TimeoutError(), 504),
        ]:
            with self.subTest(failure=failure), patch.object(archive, "archive_config", return_value={"address": "127.0.0.1", "account": "test", "root": "/archive"}), patch.object(archive.settings, "ssh_target", return_value=("127.0.0.1", "test")), \
                    patch.object(archive.settings, "read_setting", return_value="/archive"), \
                    patch.object(archive.settings, "known_host_file") as known, \
                    patch.object(archive.paramiko, "HostKeys", side_effect=failure):
                known.return_value.is_file.return_value = True
                with self.assertRaises(HTTPException) as error:
                    archive.browse_archive()
                self.assertEqual(error.exception.status_code, expected)

    def test_uses_saved_host_key_and_private_key_without_agent_or_password(self):
        with patch.object(archive, "archive_config", return_value={"address": "127.0.0.1", "account": "test", "root": "/archive"}), patch.object(archive.settings, "ssh_target", return_value=("127.0.0.1", "test")), \
                patch.object(archive.settings, "read_setting", return_value="/archive"), \
                patch.object(archive.settings, "known_host_file") as known, \
                patch.object(archive.paramiko, "HostKeys") as hosts, \
                patch.object(archive.paramiko, "SSHClient") as ssh:
            known.return_value.is_file.return_value = True
            key = MagicMock()
            hosts.return_value.lookup.return_value = {"ssh-ed25519": key}
            client = ssh.return_value.__enter__.return_value
            sftp = client.open_sftp.return_value.__enter__.return_value
            sftp.normalize.return_value = "/archive"
            sftp.listdir_iter.return_value = []
            response = archive.browse_archive()
            self.assertEqual(json.loads(response.body)["entries"], [])
            self.assertEqual(response.headers["cache-control"], "no-store")
            client.get_host_keys.return_value.add.assert_called_once_with("127.0.0.1", "ssh-ed25519", key)
            options = client.connect.call_args.kwargs
            self.assertEqual(options["key_filename"], str(archive.settings.KEY_FILE))
            self.assertFalse(options["allow_agent"])
            self.assertFalse(options["look_for_keys"])
            self.assertNotIn("password", options)

    def collect_stream(self, response):
        async def consume():
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            return b"".join(chunks)
        return asyncio.run(consume())

    def test_download_by_path_and_media_id_streams_bytes_and_utf8_headers(self):
        fixture = test_transfers.TransferTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        korean_dir = fixture.remote / "260903_제주"
        korean_dir.mkdir()
        (korean_dir / "제주 영상.MP4").write_bytes(b"korean-video-bytes")
        @contextmanager
        def connection(_expected=None):
            yield fixture.sftp, fixture.config
        with patch.object(archive, "archive_config", return_value=fixture.config), \
                patch.object(archive, "archive_connection", side_effect=connection):
            response = archive.download_archive_file(path="260903_제주/제주 영상.MP4")
            self.assertEqual(self.collect_stream(response), b"korean-video-bytes")
            self.assertEqual(response.headers["content-length"], str(len(b"korean-video-bytes")))
            self.assertEqual(response.headers["cache-control"], "private, no-store")
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")
            self.assertIn("filename*=UTF-8''%EC%A0%9C%EC%A3%BC%20%EC%98%81%EC%83%81.MP4", response.headers["content-disposition"])

            # Upload media+XMP and download via media_id
            fixture.run_job(fixture.queue([{"id": "one"}, {"id": "one", "kind": "xmp"}]))
            media_response = archive.download_archive_file(media_id="one", kind="media")
            self.assertEqual(self.collect_stream(media_response), b"first video")
            xmp_response = archive.download_archive_file(media_id="one", kind="xmp")
            self.assertEqual(self.collect_stream(xmp_response), b"<xmp/>")

            # Different archive root must reject with 409
            fixture.config["root"] = str(fixture.remote.parent / "other-root")
            with self.assertRaises(HTTPException) as mismatch:
                archive.download_archive_file(media_id="one")
            self.assertEqual(mismatch.exception.status_code, 409)

    def test_download_rejects_invalid_paths_symlinks_directories_and_missing(self):
        fixture = test_transfers.TransferTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        outside = fixture.remote.parent / "secret.txt"
        outside.write_bytes(b"secret")
        (fixture.remote / "folder").mkdir()
        (fixture.remote / "file-link").symlink_to(outside)
        (fixture.remote / "dir-link").symlink_to(fixture.remote.parent, target_is_directory=True)
        @contextmanager
        def connection(_expected=None):
            yield fixture.sftp, fixture.config
        with patch.object(archive, "archive_config", return_value=fixture.config), \
                patch.object(archive, "archive_connection", side_effect=connection):
            for kwargs, expected in [
                ({}, 400),
                ({"path": "a", "media_id": "one"}, 400),
                ({"path": "../secret.txt"}, 400),
                ({"path": "folder"}, 400),
                ({"path": "missing.mp4"}, 404),
                ({"path": "file-link"}, 403),
                ({"path": "dir-link/secret.txt"}, 403),
            ]:
                with self.subTest(kwargs=kwargs), self.assertRaises(HTTPException) as error:
                    archive.download_archive_file(**kwargs)
                self.assertEqual(error.exception.status_code, expected)

    def test_reset_host_key_and_active_job_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings_dir = root / "settings"
            settings_dir.mkdir()
            address = "192.0.2.10"
            (settings_dir / "address").write_text(address, encoding="utf-8")
            with patch.object(catalog, "DATA", root / "data"), \
                    patch.object(settings, "SETTINGS_DIR", settings_dir), \
                    patch.object(settings, "ADDRESS_FILE", settings_dir / "address"), \
                    patch.object(settings, "STORAGE_ROOT_FILE", settings_dir / "remote-root"), \
                    patch.object(settings, "KEY_FILE", settings_dir / "ssh/id_ed25519"), \
                    patch.object(settings, "PUBLIC_KEY", settings_dir / "ssh/id_ed25519.pub"), \
                    patch.object(settings, "KEY_COPIED", settings_dir / "ssh/public_key_copied"), \
                    patch.object(settings, "PENDING_HOST_KEY", settings_dir / "pending-host-key.json"):
                catalog.initialize()
                known = settings.known_host_file(address)
                known.write_text(f"{settings.host_alias(address)} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n", encoding="utf-8")
                self.assertTrue(settings.settings_state()["hostKeyTrusted"])
                with catalog.database(write=True) as db:
                    job_id = catalog.queue_job(db, "upload", {})
                with self.assertRaises(HTTPException) as active_error:
                    settings.reset_host_key()
                self.assertEqual(active_error.exception.status_code, 409)
                with catalog.database(write=True) as db:
                    db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
                response = settings.reset_host_key()
                self.assertFalse(json.loads(response.body)["hostKeyTrusted"])
                self.assertFalse(known.exists())


if __name__ == "__main__":
    unittest.main()
