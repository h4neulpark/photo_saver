import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import catalog
import media
import worker


class GoProTests(unittest.TestCase):
    def probe(self, info, extracted=None, failure=None):
        responses = [SimpleNamespace(stdout=json.dumps(info))]
        if extracted is not None:
            responses.append(SimpleNamespace(stdout=json.dumps([extracted])))
        elif failure is not None:
            responses.append(failure)
        stream = MagicMock()
        stream.fileno.return_value = 99
        with patch.object(media.subprocess, "run", side_effect=responses) as run:
            result = media.video_metadata(stream, None)
        return result, run

    def test_encoder_and_proprietary_model_identify_hero8(self):
        result, run = self.probe({
            "streams": [{"codec_type": "video", "tags": {"encoder": "GoPro AVC encoder"}}],
            "format": {"tags": {"creation_time": "2026-09-04T20:24:28Z"}},
        }, {"Model": "HERO8 Black", "FirmwareVersion": "HD8.01.02.51.00"})
        details, captured, verified, _ = result
        self.assertEqual((details["make"], details["model"]), ("GoPro", "HERO8 Black"))
        self.assertEqual(details["firmware"], "HD8.01.02.51.00")
        self.assertTrue(verified)
        self.assertTrue(captured.startswith("2026-09-04T20:24:28"))
        self.assertEqual(run.call_args_list[1].args[0][0], "exiftool")

    def test_telemetry_track_identifies_gopro_without_encoder(self):
        result, _ = self.probe({"streams": [
            {"codec_type": "video"}, {"codec_type": "data", "codec_tag_string": "gpmd"},
        ]}, {})
        self.assertEqual(result[0]["make"], "GoPro")
        self.assertEqual(result[0]["model"], "")
        self.assertIn("GoPro metadata track (gpmd)", result[0]["device_evidence"])

    def test_handler_name_identifies_gopro_when_model_reader_fails(self):
        result, _ = self.probe({"streams": [
            {"codec_type": "video", "tags": {"handler_name": "\x0bGoPro AVC  "}},
        ]}, failure=subprocess.TimeoutExpired("exiftool", 15))
        self.assertEqual(result[0]["make"], "GoPro")
        self.assertNotIn("error", result[0])

    def test_filename_and_firmware_alone_do_not_guess_camera(self):
        result, run = self.probe({"format": {"filename": "GH020834.MP4", "tags": {"firmware": "HD8.01.02.51.00"}}})
        self.assertEqual((result[0]["make"], result[0]["model"]), ("", ""))
        self.assertEqual(run.call_count, 1)

    def test_preserves_explicit_quicktime_camera(self):
        result, _ = self.probe({"format": {"tags": {
            "com.apple.quicktime.make": "Apple", "com.apple.quicktime.model": "iPhone 16",
        }}})
        self.assertEqual((result[0]["make"], result[0]["model"]), ("Apple", "iPhone 16"))

    def test_cached_video_refreshes_once_and_preserves_user_classification(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(catalog, "DATA", Path(directory) / "data"):
            catalog.initialize()
            root = Path(directory) / "managed"
            root.mkdir()
            file = root / "GH020834.MP4"
            file.write_bytes(b"test video")
            worker.store_analysis("existing", file.name, "sha", file.stat(), ("video", {}, None, None, "", False, None))
            with catalog.database(write=True) as db:
                db.execute("INSERT INTO events (id,name,folder,folder_key) VALUES ('event','Trip','Trip','trip')")
                db.execute("UPDATE media SET user_device='My camera',user_time='2026-09-04T20:24:28+00:00',event_id='event',confirmed=1")
            analysis = ("video", {"make": "GoPro", "model": "HERO8 Black", "video_metadata_version": media.VIDEO_METADATA_VERSION}, None, None, "", False, "GoPro HERO8 Black")
            with patch.object(worker, "analyze", return_value=analysis) as analyze, patch.object(worker, "hash_file") as hash_file:
                worker.index_managed(root)
                analyze.assert_called_once()
                hash_file.assert_not_called()
                worker.index_managed(root)
                analyze.assert_called_once()
            with catalog.database() as db:
                row = db.execute("SELECT * FROM media").fetchone()
                self.assertEqual(row["id"], "existing")
                self.assertEqual(row["device"], "GoPro HERO8 Black")
                self.assertEqual(row["user_device"], "My camera")
                self.assertEqual(row["user_time"], "2026-09-04T20:24:28+00:00")
                self.assertEqual((row["event_id"], row["confirmed"]), ("event", 1))


if __name__ == "__main__":
    unittest.main()
