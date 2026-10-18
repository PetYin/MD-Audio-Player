"""Scope and extraction scheduling regressions, with real cache/media writes.

Only the native Unity subprocess is substituted; the scanner, importer scheduler,
cache validation, WAV commit, cancellation and source merging run unchanged.
"""
from __future__ import annotations

import json
import copy
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import test_engine
from main import ENGINE_VERSION, Importer, inspect, scan, validate_accounts, valid_record_structure
from media import Cancelled
from safety import account_parts, digest, read_json, stable_hash


class ScanImportTests(unittest.TestCase):
    def setUp(self):
        test_engine.EngineTests.setUp(self)
        self.calls = []

    def tearDown(self):
        test_engine.EngineTests.tearDown(self)

    def bundle(self, account="a", name="ab/sound.bundle", content=b"A"):
        path = self.game / "LocalData" / account / "0000" / name if account else self.game / "masterduel_Data" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"UnityFS\0" + bytes(16) + content)
        return path

    def importer(self, **kwargs):
        events = []
        engine = Importer(self.game, self.data, self.tools, output=events.append, **kwargs)
        engine.decoder_key = "fixture-decoder"
        engine.boundary.mkdir("cache/staging")
        engine.boundary.mkdir("assets/audio")
        return engine, events

    def scanned(self, engine, **kwargs):
        bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, **kwargs)
        return bundles, audit["dependencies"]

    def native(self, command, **kwargs):
        inputs = [Path(path) for path in read_json(Path(command[1]))]
        self.calls.append([path.relative_to(self.game).as_posix() for path in inputs])
        output = Path(command[3])
        assets = []
        for index, path in enumerate(inputs):
            raw = output / f"sample-{index}.wav"
            test_engine.wav(raw, frames=4000 + path.read_bytes()[-1])
            relative = path.relative_to(self.game).as_posix()
            assets.append({"name": "SE_TEST", "path_id": "1", "payload_hash": digest(raw), "raw_path": raw.name,
                           "source": {"bundle": relative, "serialized_file": "CAB-test", "container": ""}, "status": "success"})
        document = {"assets": assets, "inputs": [{"path": p.relative_to(self.game).as_posix(), "loaded": True} for p in inputs]}
        return subprocess.CompletedProcess(command, 0, json.dumps(document).encode(), b"")

    def test_latest_uses_0000_mtime_tie_break_and_never_walks_old_account(self):
        self.bundle("old")
        self.bundle("z-new")
        self.bundle("a-new")
        self.bundle("")
        for name, timestamp in [("old", 10_000_000_000), ("z-new", 20_000_000_000), ("a-new", 20_000_000_000)]:
            os.utime(self.game / "LocalData" / name / "0000", ns=(timestamp, timestamp))
        installation = inspect(self.game)
        self.assertEqual(installation["latestAccount"], "a-new")
        self.assertEqual(installation["accountDirectories"][0]["modifiedNs"], "20000000000")
        engine, _ = self.importer()
        actual_walk = os.walk
        roots = []
        def guarded_walk(root, **kwargs):
            roots.append(Path(root))
            self.assertNotIn(Path(root).parent.name, ("old", "z-new"))
            return actual_walk(root, **kwargs)
        with patch("main.os.walk", side_effect=guarded_walk):
            bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, "latest")
        self.assertEqual(audit["accounts"], ["a-new"])
        self.assertEqual(len(bundles), 2)
        self.assertEqual(len(roots), 2)

    def test_all_empty_latest_and_explicit_empty_accounts(self):
        self.bundle("old")
        self.bundle("")
        empty = self.game / "LocalData" / "empty" / "0000"
        empty.mkdir(parents=True)
        os.utime(empty, ns=(9_000_000_000_000_000_000, 9_000_000_000_000_000_000))
        engine, _ = self.importer()
        bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, "latest")
        self.assertEqual(audit["accounts"], ["empty"])
        self.assertEqual(len(bundles), 1)
        bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, "all")
        self.assertEqual(audit["accounts"], ["empty", "old"])
        self.assertEqual(len(bundles), 2)
        bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, "all", [])
        self.assertEqual(audit["accounts"], [])
        self.assertEqual(len(bundles), 1)

    def test_no_accounts_latest_scans_public(self):
        self.bundle("")
        engine, _ = self.importer()
        bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, "latest")
        self.assertEqual(audit["accounts"], [])
        self.assertEqual(len(bundles), 1)

    def test_unreadable_directory_time_is_explicit_and_blocks_implicit_selection(self):
        self.bundle("unreadable")
        actual = Path.lstat
        def denied(path, *args, **kwargs):
            if path == self.game / "LocalData" / "unreadable" / "0000":
                raise PermissionError("denied test timestamp")
            return actual(path, *args, **kwargs)
        with patch.object(Path, "lstat", denied):
            installation = inspect(self.game)
            self.assertIn("denied test timestamp", installation["selectionError"])
            self.assertIsNone(installation["latestAccount"])
            engine, _ = self.importer()
            with self.assertRaisesRegex(ValueError, "denied test timestamp"):
                self.scanned(engine, scan_mode="latest")

    def test_frozen_selection_never_switches_and_disappearance_or_link_fails(self):
        self.bundle("a")
        self.bundle("b")
        engine, _ = self.importer()
        bundles, _, audit = scan(engine.boundary, engine.runner, engine.progress, engine.error, "latest", ["a"])
        self.assertEqual(audit["accounts"], ["a"])
        self.assertEqual(len(bundles), 1)
        (self.game / "LocalData" / "a").rename(self.game / "LocalData" / "renamed")
        with self.assertRaises(OSError):
            self.scanned(engine, scan_mode="latest", accounts=["a"])
        from main import reparse
        with patch("main.reparse", side_effect=lambda path: path == self.game / "LocalData" / "b" / "0000" or reparse(path)):
            with self.assertRaises(ValueError):
                self.scanned(engine, scan_mode="latest", accounts=["b"])

    def test_directory_removed_during_walk_is_reported(self):
        self.bundle("a")
        engine, _ = self.importer()
        from main import walk_readonly
        def removed(root, *args):
            yield from walk_readonly(root, *args)
            if root.parent.name == "a":
                root.rename(root.with_name("moved"))
        with patch("main.walk_readonly", side_effect=removed):
            with self.assertRaises(OSError):
                self.scanned(engine, accounts=["a"])

    def test_account_input_rejects_traversal_duplicates_and_latest_multiple(self):
        for value in (None, {}, "a", [".."], ["a/b"], ["a\\b"], ["C:"], ["a", "a"], [1]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_accounts(value, "all")
        with self.assertRaises(ValueError):
            validate_accounts(["a", "b"], "latest")
        self.assertEqual(validate_accounts([], "latest"), [])

    def test_duplicates_extract_once_merge_sources_and_reuse_legacy_cache_key(self):
        first = self.bundle("a")
        self.bundle("b")
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(engine.metrics["uniqueBundleTasks"], 1)
        self.assertEqual(engine.metrics["deduplicatedBundles"], 1)
        record = next(iter(engine.seen.values()))
        self.assertEqual({source["account"] for source in record["sources"]}, {"a", "b"})
        canonical = account_parts(first.relative_to(self.game).as_posix())[1]
        legacy = stable_hash([ENGINE_VERSION, canonical, digest(first), [], engine.decoder_key])
        self.assertTrue((self.data / "cache/bundles" / f"{legacy}.json").is_file())
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=AssertionError("warm import launched native extractor")):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.metrics["cacheReusedBundles"], 2)
        self.assertEqual(engine.metrics["pendingBundleTasks"], 0)
        self.assertEqual(set(engine.seen), {record["id"]})

    def test_different_content_and_account_unique_bundles_are_not_lost(self):
        self.bundle("a", content=b"A")
        self.bundle("b", content=b"B")
        self.bundle("b", name="unique.bundle", content=b"C")
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.metrics["uniqueBundleTasks"], 3)
        self.assertEqual(len(engine.seen), 3)
        self.assertEqual(sum(len(call) for call in self.calls), 3)

    def test_empty_completed_bundle_cache_is_a_success(self):
        self.bundle("a")
        self.bundle("b")
        engine, _ = self.importer()
        def empty(command, **kwargs):
            result = self.native(command, **kwargs)
            document = json.loads(result.stdout)
            document["assets"] = []
            result.stdout = json.dumps(document).encode()
            return result
        with patch.object(engine.runner, "run", side_effect=empty):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.failures, 0)
        self.assertEqual(engine.metrics["extractorCalls"], 1)
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=AssertionError("empty cache is valid")):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.metrics["cacheReusedBundles"], 2)

    def test_representative_failure_recovers_from_equivalent_copy(self):
        self.bundle("a")
        self.bundle("b")
        engine, _ = self.importer()
        def fail_first_account(command, **kwargs):
            result = self.native(command, **kwargs)
            document = json.loads(result.stdout)
            if "LocalData/a/" in document["inputs"][0]["path"]:
                document["inputs"][0]["loaded"] = False
                document["assets"] = []
            result.stdout = json.dumps(document).encode()
            return result
        with patch.object(engine.runner, "run", side_effect=fail_first_account):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.failures, 0)
        self.assertEqual(engine.metrics["extractorCalls"], 3)
        self.assertEqual(engine.metrics["retries"], 2)
        self.assertEqual(len(engine.attempt_errors), 2)
        self.assertEqual(len(next(iter(engine.seen.values()))["sources"]), 2)

    def test_partial_batch_exception_retries_only_uncommitted_member(self):
        self.bundle("a", name="one.bundle")
        self.bundle("a", name="two.bundle")
        engine, _ = self.importer()
        original = engine.bundle_batch
        def partial(batch):
            if len(batch) > 1:
                original(batch[:1])
                raise RuntimeError("simulated failure after first commit")
            return original(batch)
        with patch.object(engine.runner, "run", side_effect=self.native), patch.object(engine, "bundle_batch", side_effect=partial):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual([path for call in self.calls for path in call], ["LocalData/a/0000/one.bundle", "LocalData/a/0000/two.bundle"])
        self.assertEqual(engine.metrics["retries"], 1)
        self.assertEqual(engine.failures, 0)

    def test_unrecovered_group_counts_one_failure_and_preserves_attempts(self):
        self.bundle("a")
        self.bundle("b")
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=RuntimeError("broken input")):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.failures, 1)
        self.assertEqual(len(engine.attempt_errors), 3)
        self.assertEqual(engine.metrics["extractorCalls"], 3)
        self.assertEqual(list((self.data / "cache/bundles").glob("*.json")), [])

    def test_changed_or_missing_alias_is_not_bound(self):
        for remove in (False, True):
            with self.subTest(remove=remove):
                self.calls.clear()
                self.bundle("a", content=b"A" if remove else b"B")
                alias = self.bundle("b", content=b"A" if remove else b"B")
                engine, _ = self.importer()
                def changed(command, **kwargs):
                    result = self.native(command, **kwargs)
                    if remove:
                        alias.unlink()
                    else:
                        alias.write_bytes(b"changed after scan")
                    return result
                with patch.object(engine.runner, "run", side_effect=changed):
                    engine.import_bundles(*self.scanned(engine))
                self.assertEqual(engine.failures, 1)
                self.assertEqual([source["account"] for source in next(iter(engine.seen.values()))["sources"]], ["a"])

    def test_cancel_stops_alias_replay_and_next_run_reuses_committed_cache(self):
        self.bundle("a")
        self.bundle("b")
        cancel = self.root / "cancel"
        engine, events = self.importer(cancel_file=cancel)
        original = engine.bundle_batch
        def cancel_after_commit(batch):
            original(batch)
            cancel.touch()
        with patch.object(engine.runner, "run", side_effect=self.native), patch.object(engine, "bundle_batch", side_effect=cancel_after_commit):
            with self.assertRaises(Cancelled):
                engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.metrics["extractorCalls"], 1)
        self.assertEqual(len(next(iter(engine.seen.values()))["sources"]), 1)
        cancel.unlink()
        resumed, _ = self.importer(cancel_file=cancel)
        with patch.object(resumed.runner, "run", side_effect=AssertionError("resume should reuse committed cache")):
            resumed.import_bundles(*self.scanned(resumed))
        self.assertEqual(resumed.metrics["cacheReusedBundles"], 2)
        self.assertEqual(len(next(iter(resumed.seen.values()))["sources"]), 2)

    def test_local_dependency_isolates_every_account_and_ignores_legacy_cache(self):
        first = self.bundle("a")
        self.bundle("b")
        dependency = first.parent / "external.resource"
        dependency.write_bytes(b"FSB5 account-specific")
        engine, _ = self.importer()
        bundles, dependencies = self.scanned(engine)
        legacy_dependencies = [[account_parts(item["path"])[1], digest(self.game / item["path"])] for item in dependencies]
        legacy = stable_hash([ENGINE_VERSION, account_parts(bundles[0]["path"])[1], digest(first), legacy_dependencies, engine.decoder_key])
        engine.boundary.json(f"cache/bundles/{legacy}.json", {"version": ENGINE_VERSION, "records": []})
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(bundles, dependencies)
        self.assertEqual(engine.metrics["uniqueBundleTasks"], 2)
        self.assertEqual(engine.metrics["cacheReusedBundles"], 0)
        self.assertEqual(engine.metrics["extractorCalls"], 2)
        self.assertNotEqual(bundles[0]["cache"], bundles[1]["cache"])
        self.assertTrue(all(f"{legacy}.json" not in item["cache"] for item in bundles))

    def test_incomplete_cached_metadata_is_reextracted(self):
        self.bundle("a")
        engine, _ = self.importer()
        bundles, dependencies = self.scanned(engine)
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(bundles, dependencies)
        cache = read_json(self.data / bundles[0]["cache"])
        del cache["records"][0]["title"]
        engine.boundary.json(bundles[0]["cache"], cache)
        resumed, _ = self.importer()
        with patch.object(resumed.runner, "run", side_effect=self.native):
            resumed.import_bundles(*self.scanned(resumed))
        self.assertEqual(resumed.metrics["extractorCalls"], 1)
        self.assertIn("title", next(iter(resumed.seen.values())))

    def test_batch_file_limit_and_directory_isolation_save_index_once(self):
        for index in range(129):
            self.bundle("a", name=f"same/{index:03}.bundle")
        self.bundle("a", name="other/one.bundle")
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=self.native), patch.object(engine, "save_index", wraps=engine.save_index) as save:
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(sorted(len(call) for call in self.calls), [1, 1, 128])
        self.assertTrue(all(len({str(Path(path).parent) for path in call}) == 1 for call in self.calls))
        self.assertEqual(save.call_count, 1)
        self.assertEqual(len(read_json(self.data / "cache/source-index.json")), 130)

    def test_cancel_after_failed_batch_prevents_retry(self):
        self.bundle("a")
        self.bundle("b")
        cancel = self.root / "cancel"
        engine, _ = self.importer(cancel_file=cancel)
        def failed(command, **kwargs):
            cancel.touch()
            raise RuntimeError("failure coincident with cancellation")
        with patch.object(engine.runner, "run", side_effect=failed):
            with self.assertRaises(Cancelled):
                engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.metrics["extractorCalls"], 1)
        self.assertEqual(engine.metrics["retries"], 0)
        self.assertEqual(engine.failures, 0)

    def test_dependency_changed_during_extract_never_commits_bundle_cache(self):
        first = self.bundle("a")
        dependency = first.parent / "external.resource"
        dependency.write_bytes(b"FSB5 account-specific")
        engine, _ = self.importer()
        def changed(command, **kwargs):
            result = self.native(command, **kwargs)
            dependency.write_bytes(dependency.read_bytes() + b"changed")
            return result
        with patch.object(engine.runner, "run", side_effect=changed):
            engine.import_bundles(*self.scanned(engine))
        self.assertEqual(engine.failures, 1)
        self.assertEqual(list((self.data / "cache/bundles").glob("*.json")), [])

    def test_scope_remains_visible_in_each_active_progress_phase(self):
        for mode, accounts, expected in [("latest", ["recent"], "最新目录 recent + 公共资源"),
                                         ("all", ["a", "b"], "全部 2 个目录 + 公共资源"),
                                         ("latest", [], "仅公共资源")]:
            engine, events = self.importer(scan_mode=mode, accounts=accounts)
            for stage in ("scanning", "extracting", "decoding", "actions"):
                engine.progress(stage, "step")
                self.assertEqual(events[-1]["message"], expected + " · step")

    def test_cache_wrong_types_or_invalid_source_hash_are_reextracted(self):
        self.bundle("a")
        engine, _ = self.importer()
        bundles, dependencies = self.scanned(engine)
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(bundles, dependencies)
        original = read_json(self.data / bundles[0]["cache"])
        cases = [("title", ["invalid"]), ("category", "invalid"), ("category", [123]),
                 ("payloadHash", "not-a-sha256"), ("payloadHash", 123), ("sourceKey", []),
                 ("sampleRate", True), ("sampleRate", 1.5), ("channels", "2"),
                 ("peaks", [1.1]), ("tags", [None]), ("description", {}), ("kind", "invalid")]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                corrupted = copy.deepcopy(original)
                if field == "payloadHash":
                    corrupted["records"][0]["sources"][0][field] = value
                elif field == "sourceKey":
                    corrupted["records"][0]["sources"][0]["key"] = value
                else:
                    corrupted["records"][0][field] = value
                engine.boundary.json(bundles[0]["cache"], corrupted)
                resumed, events = self.importer()
                with patch.object(resumed.runner, "run", side_effect=self.native):
                    resumed.import_bundles(*self.scanned(resumed))
                self.assertEqual(resumed.metrics["extractorCalls"], 1)
                self.assertEqual(resumed.metrics["cacheReusedBundles"], 0)
                self.assertTrue(all(valid_record_structure(event["record"]) for event in events if event["type"] == "record"))
                self.assertEqual(set(resumed.seen), set(engine.seen))

    def test_cache_numeric_and_utf16_bounds_are_checked_without_crashing(self):
        self.bundle("a")
        engine, _ = self.importer()
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(*self.scanned(engine))
        record = next(iter(engine.seen.values()))
        for field, value in [("duration", float("nan")), ("duration", float("inf")), ("duration", 10 ** 400),
                             ("bytes", -1), ("bytes", 2 ** 53), ("peaks", [True]), ("peaks", [0] * 4097),
                             ("title", "😀" * 501), ("form", "x" * 201), ("title", "\ud800"),
                             ("id", "bad id"), ("category", ["  "]), ("tags", ["a"] * 101)]:
            with self.subTest(field=field):
                self.assertFalse(valid_record_structure({**record, field: value}))

    def test_invalid_media_metadata_is_redecoded_when_bundle_cache_misses(self):
        self.bundle("a")
        engine, _ = self.importer()
        bundles, dependencies = self.scanned(engine)
        with patch.object(engine.runner, "run", side_effect=self.native):
            engine.import_bundles(bundles, dependencies)
        record = next(iter(engine.seen.values()))
        (self.data / bundles[0]["cache"]).unlink()
        media_cache = next((self.data / "cache/media").glob("*.json"))
        corrupted = read_json(media_cache)
        corrupted["peaks"] = "invalid"
        engine.boundary.json(media_cache.relative_to(self.data), corrupted)
        resumed, _ = self.importer()
        with patch.object(resumed.runner, "run", side_effect=self.native), patch.object(resumed.media, "decode", wraps=resumed.media.decode) as decode:
            resumed.import_bundles(*self.scanned(resumed))
        self.assertEqual(decode.call_count, 1)
        self.assertTrue(valid_record_structure(resumed.seen[record["id"]]))

    def test_invalid_standalone_metadata_is_not_replayed(self):
        test_engine.wav(self.game / "masterduel_Data" / "tone.wav")
        engine, _ = self.importer()
        _, files, _ = scan(engine.boundary, engine.runner, engine.progress, engine.error)
        engine.import_standalone(files)
        cached_path = next((self.data / "cache/standalone").glob("*.json"))
        cached = read_json(cached_path)
        cached["records"][0]["title"] = ["invalid"]
        engine.boundary.json(cached_path.relative_to(self.data), cached)
        resumed, _ = self.importer()
        with patch.object(resumed, "record", wraps=resumed.record) as create:
            resumed.import_standalone(files)
        self.assertEqual(create.call_count, 1)
        self.assertTrue(all(valid_record_structure(record) for record in resumed.seen.values()))


if __name__ == "__main__":
    unittest.main()
