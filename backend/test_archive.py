import errno
import json
import stat
import unittest
from pathlib import PurePosixPath
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

import archive


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


if __name__ == "__main__":
    unittest.main()
