import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import catalog
import devices
import media
import worker


class DJITests(unittest.TestCase):
    def sample_info(self):
        # Relevant ffprobe fields from DJI_20260313124121_0140_D.MP4.
        return {
            "streams": [
                {"index": 0, "codec_type": "video", "codec_name": "hevc", "width": 1920, "height": 1080,
                 "tags": {"creation_time": "2026-03-13T10:41:22.000000Z", "handler_name": "VideoHandler"}},
                {"index": 1, "codec_type": "audio", "codec_name": "aac", "tags": {"handler_name": "SoundHandler"}},
                {"index": 2, "codec_type": "data", "codec_tag_string": "djmd", "tags": {"handler_name": "DJI meta"}},
                {"index": 3, "codec_type": "data", "codec_tag_string": "dbgi", "tags": {"handler_name": "DJI dbgi"}},
                {"index": 4, "codec_type": "data", "codec_tag_string": "tmcd"},
                {"index": 5, "codec_type": "video", "codec_name": "mjpeg", "width": 1280, "height": 720,
                 "disposition": {"attached_pic": 1}},
            ],
            "format": {"duration": "93.560133", "tags": {
                "creation_time": "2026-03-13T10:41:22.000000Z", "encoder": "DJI OsmoPocket3",
            }},
        }

    def probe(self, info):
        stream = MagicMock()
        stream.fileno.return_value = 99
        with patch.object(media.subprocess, "run", return_value=SimpleNamespace(stdout=json.dumps(info))) as run:
            result = media.video_metadata(stream, None)
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0][0], "ffprobe")
        return result

    def analyze_sample(self, root, path, sha="sample"):
        # A cached preview keeps these metadata tests independent of FFmpeg.
        media.thumbnail_path(sha).write_bytes(b"cached thumbnail")
        with patch.object(media.subprocess, "run", return_value=SimpleNamespace(stdout=json.dumps(self.sample_info()))) as run:
            result = media.analyze(root, path, sha, media.fingerprint((root / path).stat()))
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0][0], "ffprobe")
        return result

    def test_osmo_pocket3_sample_structure_identifies_model_without_exiftool(self):
        details, captured, verified, source = self.probe(self.sample_info())
        self.assertEqual((details["make"], details["model"]), ("DJI", "OsmoPocket3"))
        self.assertEqual(details["video_metadata_version"], 3)
        self.assertEqual((details["width"], details["height"], details["codec"], details["duration"]),
                         (1920, 1080, "hevc", "93.560133"))
        self.assertEqual(captured, "2026-03-13T10:41:22+00:00")
        self.assertTrue(verified)
        self.assertEqual(source, "영상 메타데이터")
        self.assertEqual(details["device_evidence"], [
            "encoder: DJI OsmoPocket3", "handler_name: DJI meta", "handler_name: DJI dbgi",
            "DJI metadata track (djmd)", "DJI metadata track (dbgi)",
        ])
        with tempfile.TemporaryDirectory() as directory, patch.object(media, "THUMBNAILS", Path(directory)):
            root = Path(directory)
            (root / "clip.MP4").write_bytes(b"test video")
            self.assertEqual(self.analyze_sample(root, "clip.MP4")[-1], "DJI OsmoPocket3")

    def test_various_dji_encoder_models_preserve_raw_model_name(self):
        for encoder, model in [
            ("DJI OsmoPocket3", "OsmoPocket3"), ("DJI Osmo Pocket 3", "Osmo Pocket 3"),
            ("dJi OsmoAction5Pro", "OsmoAction5Pro"), ("DJI_Mavic 3 Pro", "Mavic 3 Pro"),
            ("DJI/Mini 4 Pro", "Mini 4 Pro"), ("DJI-Ronin 4D", "Ronin 4D"),
            ("DJI.FutureCamera_7-Pro", "FutureCamera_7-Pro"),
        ]:
            with self.subTest(encoder=encoder):
                details = self.probe({"format": {"tags": {"EnCoDeR": encoder}}})[0]
                self.assertEqual((details["make"], details["model"]), ("DJI", model))

    def test_generic_dji_encoders_and_bare_dji_fall_back_to_make_only(self):
        for encoder in [
            "DJI", "dji ", "DJI AVC encoder", "DJI HEVC Encoder v1.2.3", "DJI H.264 encoder",
            "DJI H.265 encoder", "DJI h264 h265 mpeg4 mp4 mp4v", "DJI mjpeg aac pcm prores",
            "DJI VideoHandler SoundHandler", "DJI meta metadata dbgi data", "DJI timecode subtitle stream",
            "DJI camera media muxer recorder transcoder software firmware", "DJI 1.2.3", "DJI._-/",
        ]:
            with self.subTest(encoder=encoder):
                info = {"format": {"tags": {"encoder": encoder}}}
                details = self.probe(info)[0]
                self.assertEqual((details["make"], details["model"]), ("DJI", ""))
                self.assertNotIn("model", media.dji_metadata(info))

    def test_tracks_and_handlers_identify_dji_without_encoder(self):
        for info, evidence in [
            ({"streams": [{"codec_type": "data", "codec_tag_string": "djmd"}]}, "DJI metadata track (djmd)"),
            ({"format": None, "streams": [{"tags": None}, {"codec_tag_string": " DBGI\x00"}]}, "DJI metadata track (dbgi)"),
            ({"format": {"tags": None}, "streams": [{"tags": {"handler_name": "DJI meta"}}]}, "handler_name: DJI meta"),
            ({"format": {"tags": {"HANDLER_NAME": "dji dbgi"}}, "streams": None}, "HANDLER_NAME: dji dbgi"),
            ({"format": {"tags": {"make": "SZ DJI Technology Co., Ltd."}}}, "make: SZ DJI Technology Co., Ltd."),
            ({"streams": [{"tags": {"com.apple.quicktime.make": "DJI"}}]}, "com.apple.quicktime.make: DJI"),
        ]:
            with self.subTest(info=info):
                details = self.probe(info)[0]
                self.assertEqual((details["make"], details["model"]), ("DJI", ""))
                self.assertIn(evidence, details["device_evidence"])
        self.assertEqual(media.dji_metadata({"format": None, "streams": None}), {})
        self.assertEqual(self.probe({"format": None, "streams": None})[0]["make"], "")

    def test_control_characters_and_whitespace_are_normalized(self):
        info = {
            "format": {"tags": {"encoder": "\x00\x0bDJI\t OsmoPocket3\x7f\r\n"}},
            "streams": [
                {"tags": {"encoder": " DJI  OsmoPocket3 ", "handler_name": "\x0bDJI\t meta\x00"}},
                {"tags": {"handler_name": "DJI meta"}},
                {"codec_tag_string": "\x00 DJMD\t"}, {"codec_tag_string": "djmd"},
            ],
        }
        details = self.probe(info)[0]
        self.assertEqual((details["make"], details["model"]), ("DJI", "OsmoPocket3"))
        self.assertEqual(details["device_evidence"], [
            "encoder: DJI OsmoPocket3", "handler_name: DJI meta", "DJI metadata track (djmd)",
        ])

    def test_stream_encoder_model_fallback_when_container_encoder_is_generic(self):
        info = {"format": {"tags": {"encoder": "DJI AVC encoder"}}, "streams": [
            {"codec_type": "video", "tags": {"encoder": "DJI HEVC encoder"}},
            {"codec_type": "data", "tags": {"encoder": "DJI OsmoPocket3"}},
            {"tags": {"encoder": "DJI OtherModel"}},
        ]}
        details = self.probe(info)[0]
        self.assertEqual((details["make"], details["model"]), ("DJI", "OsmoPocket3"))
        self.assertIn("encoder: DJI AVC encoder", details["device_evidence"])
        self.assertIn("encoder: DJI OsmoPocket3", details["device_evidence"])

    def test_dji_make_enriches_empty_model_and_preserves_explicit_model(self):
        for make_key in ("make", "com.apple.quicktime.make"):
            for make in ("DJI", " dJi\x00 ", "SZ DJI Technology Co., Ltd."):
                for model, expected in ((None, "OsmoPocket3"), (" \t\x00", "OsmoPocket3"), (" Explicit Model ", "Explicit Model")):
                    with self.subTest(make_key=make_key, make=make, model=model):
                        info = {"format": {"tags": {
                            make_key: make, "com.apple.quicktime.model": model, "encoder": "DJI OsmoPocket3",
                        }}}
                        details = self.probe(info)[0]
                        self.assertEqual((details["make"], details["model"]), ("DJI", expected))

    def test_filename_and_non_dji_encoders_do_not_guess_camera(self):
        for encoder in (None, "", "Lavf61.7.100", "Apple HEVC", "DJIish OsmoPocket3", "MyDJI Encoder",
                        "Not DJI OsmoPocket3", "DJI: OsmoPocket3", "DJI123", "DjiCamera"):
            with self.subTest(encoder=encoder):
                details = self.probe({"format": {
                    "filename": "DJI_20260313124121_0140_D.MP4",
                    "tags": {"encoder": encoder, "comment": "DJI OsmoPocket3", "firmware": "DJI v1.2.3"},
                }})[0]
                self.assertEqual((details["make"], details["model"]), ("", ""))
                self.assertNotIn("device_evidence", details)
        for key, value in (("make", "NotDJI"), ("com.apple.quicktime.make", "DJIish"),
                           ("handler_name", "Other DJI meta"), ("handler_name", "DJIhandler")):
            with self.subTest(key=key, value=value):
                self.assertEqual(media.dji_metadata({"format": {"tags": {key: value}}}), {})

    def test_non_dji_encoder_with_dji_track_keeps_empty_model(self):
        for encoder in ("Lavf61.7.100", "Apple HEVC", "Not DJI OsmoPocket3", "DJIish OsmoPocket3"):
            with self.subTest(encoder=encoder):
                details = self.probe({"format": {"tags": {"encoder": encoder}}, "streams": [
                    {"codec_type": "data", "codec_tag_string": "djmd"},
                ]})[0]
                self.assertEqual((details["make"], details["model"]), ("DJI", ""))
                self.assertEqual(details["device_evidence"], ["DJI metadata track (djmd)"])

    def test_explicit_non_dji_camera_is_never_overwritten(self):
        for make, model in (("Apple", "iPhone 16"), ("Sony", "ILCE-7M4"), ("NotDJI", "Other Camera")):
            with self.subTest(make=make), patch.object(media, "gopro_metadata") as gopro, patch.object(media, "dji_metadata") as dji:
                info = self.sample_info()
                info["format"]["tags"].update({"com.apple.quicktime.make": make, "com.apple.quicktime.model": model})
                info["streams"].append({"codec_tag_string": "gpmd", "tags": {"encoder": "GoPro AVC encoder"}})
                details = self.probe(info)[0]
                self.assertEqual((details["make"], details["model"]), (make, model))
                self.assertNotIn("device_evidence", details)
                gopro.assert_not_called()
                dji.assert_not_called()
        # A confirmed GoPro takes precedence when conflicting DJI tracks exist.
        info = self.sample_info()
        info["streams"].append({"codec_tag_string": "gpmd"})
        stream = MagicMock()
        stream.fileno.return_value = 99
        responses = [SimpleNamespace(stdout=json.dumps(info)), SimpleNamespace(stdout='[{"Model": "HERO8 Black"}]')]
        with patch.object(media.subprocess, "run", side_effect=responses) as run, patch.object(media, "dji_metadata") as dji:
            details = media.video_metadata(stream, None)[0]
        self.assertEqual((details["make"], details["model"]), ("GoPro", "HERO8 Black"))
        self.assertEqual([call.args[0][0] for call in run.call_args_list], ["ffprobe", "exiftool"])
        dji.assert_not_called()

    def test_v2_managed_dji_video_reanalyzes_once_and_preserves_user_fields_and_archived(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(catalog, "DATA", Path(directory) / "data"), \
                patch.object(media, "THUMBNAILS", Path(directory)):
            catalog.initialize()
            root = Path(directory) / "managed"
            root.mkdir()
            file = root / "clip.MP4"
            file.write_bytes(b"test video")
            old_analysis = ("video", {"video_metadata_version": 2}, None, None, "", False, None)
            worker.store_analysis("existing", file.name, "sha", file.stat(), old_analysis)
            worker.store_analysis("archived", "absent.MP4", "archived-sha", file.stat(), old_analysis)
            user_fields = {
                "user_device": "My Pocket", "user_time": "2026-03-13T10:41:22+00:00", "user_time_source": "manual",
                "event_id": "event", "confirmed": 1, "original_path": "Trip/clip.MP4",
                "xmp_path": "clip.xmp", "xmp_sha": "xmp-sha", "xmp_metadata": '{"title":"Trip"}',
            }
            with catalog.database(write=True) as db:
                db.execute("INSERT INTO events (id,name,folder,folder_key) VALUES ('event','Trip','Trip','trip')")
                db.execute("UPDATE media SET " + ",".join(f"{key}=?" for key in user_fields), tuple(user_fields.values()))
                db.execute("UPDATE media SET status='archived' WHERE id='archived'")
                archived_before = dict(db.execute("SELECT * FROM media WHERE id='archived'").fetchone())
            media.thumbnail_path("sha").write_bytes(b"cached thumbnail")
            with patch.object(worker, "analyze", wraps=media.analyze) as analyze, patch.object(worker, "hash_file") as hash_file, \
                    patch.object(media.subprocess, "run", return_value=SimpleNamespace(stdout=json.dumps(self.sample_info()))) as run:
                worker.index_managed(root)
                analyze.assert_called_once_with(root, file.name, "sha", media.fingerprint(file.stat()))
                hash_file.assert_not_called()
                worker.index_managed(root)
                analyze.assert_called_once()
                hash_file.assert_not_called()
                run.assert_called_once()
            # The existing upsert guard also protects an archived row from late analysis results.
            worker.store_analysis("replacement", "absent.MP4", "changed", file.stat(),
                                  ("video", {"video_metadata_version": 3}, None, None, "", False, "DJI OsmoPocket3"))
            with catalog.database() as db:
                row = db.execute("SELECT * FROM media WHERE id='existing'").fetchone()
                self.assertEqual((row["id"], row["sha"], row["status"], row["device"]),
                                 ("existing", "sha", "available", "DJI OsmoPocket3"))
                details = json.loads(row["metadata"])
                self.assertEqual((details["make"], details["model"], details["video_metadata_version"]), ("DJI", "OsmoPocket3", 3))
                for key, expected in user_fields.items():
                    self.assertEqual(row[key], expected, key)
                self.assertEqual(dict(db.execute("SELECT * FROM media WHERE id='archived'").fetchone()), archived_before)

    def test_detected_dji_device_works_with_device_names_rule(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(catalog, "DATA", Path(directory) / "data"), \
                patch.object(media, "THUMBNAILS", Path(directory)):
            catalog.initialize()
            root = Path(directory)
            file = root / "clip.MP4"
            file.write_bytes(b"test video")
            analysis = self.analyze_sample(root, file.name)
            source = analysis[-1]
            self.assertEqual(source, "DJI OsmoPocket3")
            worker.store_analysis("existing", file.name, "sha", file.stat(), analysis)
            devices.rename_device(devices.DeviceName(source=source, name="포켓 3"))
            # New analyses retain the source key and pick up the same persisted rule.
            worker.store_analysis("new", "next.MP4", "new-sha", file.stat(), analysis)
            with catalog.database(write=True) as db:
                names = devices.device_names(db)
                self.assertEqual(names, {source: "포켓 3"})
                for row in db.execute("SELECT * FROM media"):
                    self.assertEqual(row["device"], source)
                    self.assertEqual(devices.effective_device(row, names), "포켓 3")
                self.assertEqual({row[0] for row in db.execute(f"SELECT {devices.device_sql()} FROM media m")}, {"포켓 3"})
                db.execute("UPDATE media SET user_device='내 카메라' WHERE id='existing'")
                row = db.execute("SELECT * FROM media WHERE id='existing'").fetchone()
                self.assertEqual(devices.effective_device(row, names), "내 카메라")
                self.assertEqual(db.execute(f"SELECT {devices.device_sql()} FROM media m WHERE id='existing'").fetchone()[0], "내 카메라")
            self.assertEqual(devices.get_devices()["devices"], [{"source": source, "name": "포켓 3", "count": 1}])


if __name__ == "__main__":
    unittest.main()
