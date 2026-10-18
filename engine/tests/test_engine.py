from __future__ import annotations

from array import array
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import struct
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch
import wave

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))
from main import Importer, inspect, scan
from media import Cancelled, Media, Runner, ensure_space, wav_metadata
from safety import Boundary, account_parts, digest, stable_hash
from classify import classify, metadata


def wav(path: Path, frames=4000, channels=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = array("h", (round(22000 * math.sin(i * 0.13)) for i in range(frames * channels)))
    with wave.open(str(path), "wb") as target:
        target.setparams((channels, 2, 8000, 0, "NONE", "not compressed"))
        target.writeframes(data.tobytes())


class EngineTests(unittest.TestCase):
    def setUp(self):
        # Python 3.13's Windows TemporaryDirectory uses an owner-only DACL;
        # ordinary mkdir inherits the workspace ACL used by packaged helpers.
        self.test_parent = ENGINE.parent / ".cache" / "engine-tests"
        self.test_parent.mkdir(parents=True, exist_ok=True)
        self.root = self.test_parent / ("case-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.game = self.root / "Game"
        self.data = self.root / "Player"
        self.tools = self.root / "Tools"
        self.game.mkdir()
        (self.game / "masterduel.exe").touch()
        (self.game / "masterduel_Data").mkdir()
        suffix = ".exe" if os.name == "nt" else ""
        for directory, name in [("ffmpeg", "ffmpeg"), ("vgmstream", "vgmstream-cli"), ("importer", "AudioInventory")]:
            tool = self.tools / directory / (name + suffix)
            tool.parent.mkdir(parents=True, exist_ok=True)
            tool.write_bytes(b"unit-test-placeholder-not-executed")

    def tearDown(self):
        self.assertEqual(self.root.resolve().parent, self.test_parent.resolve())
        self.assertTrue(self.root.name.startswith("case-"))
        shutil.rmtree(self.root)

    def run_import(self):
        events = []
        with patch.object(Importer, "build_actions", lambda _: None):
            result = Importer(self.game, self.data, self.tools, output=events.append).run()
        records = {e["record"]["id"]: e["record"] for e in events if e["type"] == "record"}
        return result, events, records

    def test_uuid_independent_identity_dedup_and_incremental_recovery(self):
        one = self.game / "LocalData" / "arbitrary-account" / "0000" / "ab" / "sample.wav"
        two = self.game / "LocalData" / "different-user" / "0000" / "ab" / "sample.wav"
        wav(one)
        two.parent.mkdir(parents=True)
        shutil.copyfile(one, two)
        before = {p.relative_to(self.game).as_posix(): digest(p) for p in self.game.rglob("*") if p.is_file()}
        result, events, records = self.run_import()
        self.assertEqual(result, 0)
        self.assertEqual(events[-1]["failures"], 0)
        self.assertEqual(len(records), 1)
        record = next(iter(records.values()))
        self.assertEqual(len(record["sources"]), 2)
        self.assertEqual(len(list((self.data / "assets/audio").glob("*.wav"))), 1)
        self.assertEqual(record["sampleRate"], 8000)
        self.assertEqual(record["channels"], 1)
        self.assertAlmostEqual(record["duration"], 0.5)
        self.assertGreater(max(record["peaks"]), 0.6)
        after = {p.relative_to(self.game).as_posix(): digest(p) for p in self.game.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        # Rename account and move portable data: all database-facing identity
        # and relative media paths remain the same, and cache is usable.
        (self.game / "LocalData" / "arbitrary-account").rename(self.game / "LocalData" / "renamed-user")
        destination = self.root / "MovedPlayer"
        self.data.rename(destination)
        self.data = destination
        _, events2, records2 = self.run_import()
        self.assertEqual(set(records), set(records2))
        self.assertEqual(events2[-1]["imported"], 0)
        self.assertEqual(events2[-1]["duplicates"], 2)
        self.assertEqual(next(iter(records2.values()))["mediaId"], record["mediaId"])
        # Same-size corruption is detected by the committed content digest,
        # then restored from read-only source without losing logical identity.
        media = self.data / record["relativePath"]
        broken = bytearray(media.read_bytes())
        broken[-1] ^= 0x7F
        media.write_bytes(broken)
        _, _, repaired = self.run_import()
        self.assertEqual(digest(media), record["mediaId"])
        self.assertEqual(set(repaired), set(records))

    def test_updated_payload_creates_safe_new_variant(self):
        source = self.game / "LocalData" / "u" / "0000" / "sound.wav"
        wav(source)
        _, _, before = self.run_import()
        wav(source, frames=4010)
        _, _, after = self.run_import()
        self.assertNotEqual(set(before), set(after))
        self.assertEqual(len(list((self.data / "assets/audio").glob("*.wav"))), 2)

    def test_malformed_audio_never_commits_or_counts_success(self):
        source = self.game / "masterduel_Data" / "StreamingAssets" / "bad.wav"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"RIFF" + bytes(60))
        result, events, records = self.run_import()
        self.assertEqual(result, 0)
        self.assertEqual(records, {})
        self.assertEqual(events[-1]["imported"], 0)
        self.assertEqual(events[-1]["failures"], 1)
        self.assertEqual(list((self.data / "assets/audio").glob("*.wav")), [])

    def test_directory_boundaries_and_prefix_collision(self):
        with self.assertRaises(ValueError):
            Boundary(self.game, self.game / "player")
        with self.assertRaises(ValueError):
            Boundary(self.game, self.root)
        boundary = Boundary(self.game, self.root / "Game-player")
        boundary.mkdir("assets")
        with self.assertRaises(ValueError):
            boundary.output("../Game/would-write")
        with self.assertRaises(ValueError):
            boundary.output(self.game / "absolute-write")

    def test_junction_cannot_redirect_writes_into_game(self):
        boundary = Boundary(self.game, self.data)
        boundary.mkdir("assets")
        link = self.data / "assets" / "audio"
        if os.name == "nt":
            import _winapi
            try:
                _winapi.CreateJunction(str(self.game), str(link))
            except OSError as exc:
                self.skipTest("Junction unavailable: " + str(exc))
        else:
            link.symlink_to(self.game, target_is_directory=True)
        with self.assertRaises(ValueError):
            boundary.output("assets/audio/would-write.wav")
        self.assertFalse((self.game / "would-write.wav").exists())

    def test_source_links_are_not_scanned(self):
        public = self.game / "masterduel_Data" / "StreamingAssets"
        public.mkdir()
        outside = self.root / "Outside"
        outside.mkdir()
        wav(outside / "outside.wav")
        link = public / "link"
        if os.name == "nt":
            import _winapi
            try:
                _winapi.CreateJunction(str(outside), str(link))
            except OSError as exc:
                self.skipTest("Junction unavailable: " + str(exc))
        else:
            link.symlink_to(outside, target_is_directory=True)
        result, events, records = self.run_import()
        self.assertEqual(result, 0)
        self.assertFalse(records)
        self.assertEqual(events[-1]["failures"], 0)

    def test_process_cancel_is_prompt_and_kills_child(self):
        cancel = self.root / "cancel"
        runner = Runner(cancel)
        timer = threading.Timer(0.3, lambda: cancel.touch())
        started = time.monotonic()
        timer.start()
        try:
            with self.assertRaises(Cancelled):
                runner.run([sys.executable, "-c", "import time; time.sleep(15)"])
        finally:
            timer.join()
        self.assertLess(time.monotonic() - started, 3)

    def test_space_failure_keeps_existing_assets(self):
        source = self.game / "masterduel_Data" / "sound.wav"
        wav(source)
        _, _, before = self.run_import()
        wav(self.game / "masterduel_Data" / "second.wav", frames=4012)
        with patch("media.shutil.disk_usage", return_value=shutil._ntuple_diskusage(100, 100, 0)):
            _, events, _ = self.run_import()
        self.assertEqual(events[-1]["failures"], 1)
        old = next(iter(before.values()))
        self.assertEqual(digest(self.data / old["relativePath"]), old["mediaId"])

    def test_truncated_wav_rejected(self):
        source = self.root / "truncated.wav"
        wav(source)
        source.write_bytes(source.read_bytes()[:-50])
        with self.assertRaises(ValueError):
            wav_metadata(source, Runner())

    def test_rule_pack_contains_clean_preserved_recipes(self):
        text = (ENGINE / "rules/recipes.json").read_text(encoding="utf-8")
        rules = json.loads(text)
        recipes = rules["recipes"]
        self.assertEqual(len(recipes), 84)
        self.assertEqual(sum(r["alias"] for r in recipes), 0)
        self.assertEqual(sum(r["form"] == "完整动作" for r in recipes), 71)
        self.assertNotRegex(text, r"LocalData/[0-9a-fA-F]{8}/")
        self.assertNotIn("C:\\\\", text)
        self.assertNotIn("decoded_wav", text)
        self.assertTrue(all(c["start"] >= 0 and len(c["rawHash"]) == 64 for r in recipes for c in r["components"]))
        self.assertFalse(any(r["id"].startswith("event_card_cutin_") for r in recipes))

    def test_classification_has_no_card_identifiers(self):
        entries = json.loads((ENGINE / "rules/classification.json").read_text(encoding="utf-8"))
        tags = [tag for entry in entries.values() for tag in entry["tags"]]
        self.assertFalse(any(tag.isdigit() or tag.startswith("卡片编号") for tag in tags))

    def test_card_draw_resources_are_card_operations_without_summon_tags(self):
        entries = [(key, row) for key, row in metadata().items() if "CARD_DRAW" in key.split(":")[0]]
        self.assertEqual(len(entries), 4)
        for key, _ in entries:
            name, payload = key.split(":")
            row = classify(name, payload)
            self.assertEqual(row["title"], "抽卡 · " + name)
            self.assertEqual(row["category"], ["决斗音效", "卡片操作", "抽卡"])
            self.assertEqual(row["tags"], ["卡片操作", "抽卡", "决斗音效"])

    def test_flip_completion_branches_are_position_changes_not_battle_attacks(self):
        entries = [(key, row) for key, row in metadata().items() if key.split(":")[0] in {"SE_DISP_ATTACK", "SE_DISP_DEFENS"}]
        self.assertEqual(len(entries), 2)
        for key, _ in entries:
            name, payload = key.split(":")
            row = classify(name, payload)
            self.assertEqual(row["category"], ["决斗音效", "卡片操作", "表示形式"])
            self.assertIn("反转召唤／翻转", row["tags"])
            self.assertNotIn("攻击", row["tags"])
            self.assertIn("表侧", row["description"])

    def test_recipe_version_mismatch_is_unavailable(self):
        importer = Importer(self.game, self.data, self.tools, output=lambda _: None)
        self.assertFalse(importer.version_matches({"locks": [{"path": "GameAssembly.dll", "sha256": "0" * 64}]}))

    def test_real_ffmpeg_mix_preserves_timing_and_verifies_final_peak(self):
        tools = ENGINE.parent / "vendor"
        ffmpeg = tools / "ffmpeg" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        if not ffmpeg.is_file():
            self.skipTest("Bundled FFmpeg not built")
        boundary = Boundary(self.game, self.data)
        stage = "cache/staging/native-test"
        folder = boundary.mkdir(stage)
        original = folder / "original.wav"
        wav(original, frames=4000, channels=2)
        media = Media(boundary, tools, Runner())
        source = media.commit(original)
        recipe = {"minimumSamples": 48000, "components": [
            {"start": 0, "gain": 2, "pitch": 0},
            {"start": 12000, "gain": 2, "pitch": 100},
        ]}
        output = media.mix(recipe, [source, source], stage)
        self.assertEqual(output["sampleRate"], 48000)
        self.assertEqual(output["channels"], 2)
        self.assertAlmostEqual(output["duration"], 1.0)
        self.assertLessEqual(media.peak(self.data / output["relativePath"]), -1.0)
        self.assertGreater(media.peak(self.data / output["relativePath"]), -1.3)
        self.assertTrue(media.valid(output))

    def test_resource_blob_with_audio_header_remains_a_dependency(self):
        (self.game / "masterduel_Data" / "resources.resource").write_bytes(b"FSB5" + bytes(256))
        bundles, standalone, audit = scan(Boundary(self.game, self.data), Runner(), lambda *args: None, lambda message: self.fail(message))
        self.assertFalse(bundles)
        self.assertFalse(standalone)
        self.assertEqual(audit["counts"]["dependencies"], 1)

    def test_real_fsb_decoder_in_unicode_portable_directory(self):
        tools = ENGINE.parent / "vendor"
        binary = tools / "vgmstream" / ("vgmstream-cli.exe" if os.name == "nt" else "vgmstream-cli")
        if not binary.is_file():
            self.skipTest("Bundled vgmstream not built")
        boundary = Boundary(self.game, self.data / "中文音效播放器")
        stage = "cache/staging/ascii-names"
        raw = boundary.mkdir(stage) / "generated.fsb"
        # Synthetic PCM16 FSB5, built from public format fields; no game asset
        # is part of this test or the repository. vgmstream fsb5.c documents
        # these headers (version 1, 8 kHz mono, one 4,000-sample subsound).
        pcm = array("h", (round(16000 * math.sin(i * 0.09)) for i in range(4000))).tobytes()
        header = bytearray(60)
        struct.pack_into("<4sIIIIII", header, 0, b"FSB5", 1, 1, 8, 0, len(pcm), 2)
        raw.write_bytes(header + struct.pack("<Q", (4000 << 34) | (1 << 1)) + pcm)
        before = digest(raw)
        record = Media(boundary, tools, Runner()).decode(raw, stage)
        self.assertEqual(record["sampleRate"], 8000)
        self.assertEqual(record["channels"], 1)
        self.assertAlmostEqual(record["duration"], 0.5)
        self.assertEqual(digest(raw), before)
        with wave.open(str(boundary.output(record["relativePath"])), "rb") as decoded:
            self.assertEqual(decoded.readframes(4000), pcm)

    def test_failed_audio_bundle_is_never_cached_as_empty_success(self):
        bundle = self.game / "masterduel_Data" / "test.bundle"
        bundle.write_bytes(b"UnityFS\0" + bytes(16))
        engine = Importer(self.game, self.data, self.tools, output=lambda _: None)
        engine.decoder_key = "test"
        engine.bundle_current = engine.bundle_total = 1
        relative = "masterduel_Data/test.bundle"
        item = {"path": relative, "signature": [bundle.stat().st_size, bundle.stat().st_mtime_ns], "cache": "cache/bundles/test.json"}
        failure = {"assets": [{"name": "SE_TEST", "status": "failed", "error": "simulated truncated payload", "source": {"bundle": relative}}],
                   "inputs": [{"path": relative, "loaded": True}]}
        with patch.object(engine.runner, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(failure).encode(), b"")):
            engine.bundle_batch([item])
        self.assertEqual(engine.failures, 0)
        self.assertEqual(len(engine.attempt_errors), 1)
        self.assertFalse((self.data / item["cache"]).exists())

    def test_logged_object_parse_error_is_not_an_empty_success(self):
        bundle = self.game / "masterduel_Data" / "test.bundle"
        bundle.write_bytes(b"UnityFS\0" + bytes(16))
        engine = Importer(self.game, self.data, self.tools, output=lambda _: None)
        engine.bundle_current = engine.bundle_total = 1
        relative = "masterduel_Data/test.bundle"
        item = {"path": relative, "signature": [bundle.stat().st_size, bundle.stat().st_mtime_ns], "cache": "cache/bundles/test.json"}
        failure = {"assets": [], "inputs": [{"path": relative, "loaded": True}], "log": ["Error: AudioClip metadata truncated"]}
        with patch.object(engine.runner, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(failure).encode(), b"")):
            with self.assertRaises(RuntimeError):
                engine.bundle_batch([item])
        self.assertFalse((self.data / item["cache"]).exists())
        for stage in list(engine.stages):
            engine.cleanup(stage)


if __name__ == "__main__":
    unittest.main()
