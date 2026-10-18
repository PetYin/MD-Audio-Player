"""Release-boundary regressions use synthetic data, never game fixtures."""
import importlib.util
import copy
import io
import json
import lzma
import os
from pathlib import Path
import stat
import struct
import tarfile
import tempfile
import unittest
import zipfile


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / "scripts" / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


audit = module("release_audit_tests", "release-audit.py")
zipper = module("release_zip_tests", "zip-release.py")
TEST_ROOT = Path(__file__).resolve().parents[1] / ".cache" / "release-audit-tests"
TEST_ROOT.mkdir(parents=True, exist_ok=True)


def temporary_directory():
    # The parent is fixed inside this workspace; TemporaryDirectory only removes
    # the uniquely created child, never a source, release or outside directory.
    return tempfile.TemporaryDirectory(prefix="case-", dir=TEST_ROOT)


def zipped(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return out.getvalue()


def approved_archive(data, kind="third-party-source", **extra):
    return {"approvedArchives": {audit.digest(data): {"kind": kind, **extra}}}


class ReleaseAuditTests(unittest.TestCase):
    @staticmethod
    def facet_fixture():
        draw = "SE_CARD_DRAW_TEST:" + "a" * 64
        reverse = "SE_DISP_ATTACK:" + "b" * 64
        classifications = {
            draw: {"title": "抽卡", "category": ["卡片操作", "抽卡"], "tags": ["抽卡"], "description": "Synthetic draw resource"},
            reverse: {"title": "反转召唤", "category": ["卡片操作", "表示形式"], "tags": ["反转召唤"], "description": "Synthetic flip resource"},
        }
        profile = {"types": ["卡片相关"], "purposes": {"卡片相关": ["抽卡"]}, "summon": [], "attribute": [], "cardType": [], "level": [], "animation": [], "confirmation": ["已确认"], "displayForm": "碎片片段"}
        reverse_profile = {**profile, "types": ["卡片相关", "召唤方式"], "purposes": {"卡片相关": ["表示形式"], "召唤方式": ["表示形式"]}, "summon": ["反转召唤／翻转"]}
        table = {"schemaVersion": 1, "profiles": [profile, reverse_profile], "resources": {draw: 0, reverse: 1}, "actions": {}, "resourceDefaults": copy.deepcopy(classifications)}
        return table, classifications, {"recipes": []}

    def test_facet_defaults_schema_accepts_reviewed_exact_resource_corrections(self):
        table, classifications, recipes = self.facet_fixture()
        audit.audit_facet_metadata(table, classifications, recipes)
        table["profiles"][0]["summon"] = ["反转召唤"]
        with self.assertRaisesRegex(audit.AuditError, "CARD_DRAW summon exclusion"):
            audit.audit_facet_metadata(table, classifications, recipes)

    def test_facet_defaults_reject_unreviewed_fields_identities_and_classification_drift(self):
        base, classifications, recipes = self.facet_fixture()
        draw = next(iter(classifications))
        for label, change in [
            ("root fields", lambda table: table.pop("resourceDefaults")),
            ("reviewed default identities", lambda table: table["resourceDefaults"].update({"UNREVIEWED:" + "c" * 64: classifications[draw]})),
            ("default fields", lambda table: table["resourceDefaults"][draw].update({"mediaId": "c" * 64})),
            ("defaults differ", lambda table: table["resourceDefaults"][draw].update({"title": "Unreviewed title"})),
            ("resource profile index", lambda table: table["resources"].update({draw: 99})),
        ]:
            with self.subTest(label=label):
                table = copy.deepcopy(base)
                change(table)
                with self.assertRaisesRegex(audit.AuditError, label):
                    audit.audit_facet_metadata(table, classifications, recipes)

    def test_rule_provenance_binds_current_metadata_hashes_and_schema_without_replacing_history(self):
        table, classifications, recipes = self.facet_fixture()
        with temporary_directory() as temp:
            root = Path(temp)
            payloads = {"engine/rules/classification.json": classifications, "engine/rules/recipes.json": recipes, "shared/facet-metadata.json": table}
            artifacts = []
            for name, payload in payloads.items():
                audit.write_json(root / name, payload)
                artifacts.append(audit.record(name, (root / name).read_bytes()))
            facets = artifacts[-1]
            facets.update(resourceCount=2, actionCount=0, profileCount=2, resourceDefaultCount=2, rootFields=list(table), resourceDefaultFields=["title", "category", "tags", "description"])
            manifest = {"artifacts": artifacts, "navigationCorrection": {"previousFacetMetadataSha256": "0" * 64}}
            audit.write_json(root / "compliance/rules-manifest.json", manifest)
            policy = {"pinnedSourceFiles": {artifact["path"]: artifact["sha256"] for artifact in artifacts}}
            audit.audit_rule_metadata(root, policy)
            self.assertEqual(audit.load_json(root / "compliance/rules-manifest.json")["navigationCorrection"]["previousFacetMetadataSha256"], "0" * 64)
            facets["resourceDefaultCount"] = 1
            audit.write_json(root / "compliance/rules-manifest.json", manifest)
            with self.assertRaisesRegex(audit.AuditError, "provenance count differs"):
                audit.audit_rule_metadata(root, policy)
            facets["resourceDefaultCount"] = 2
            facets["sha256"] = "0" * 64
            audit.write_json(root / "compliance/rules-manifest.json", manifest)
            with self.assertRaisesRegex(audit.AuditError, "differs from reviewed source"):
                audit.audit_rule_metadata(root, policy)

    def test_generated_json_uses_stable_utf8_lf_bytes(self):
        with temporary_directory() as temp:
            target = Path(temp) / "app/package.json"
            audit.write_json(target, {"version": "1.0.2", "name": "synthetic"})
            expected = b'{\n  "name": "synthetic",\n  "version": "1.0.2"\n}\n'
            self.assertEqual(target.read_bytes(), expected)
            audit.verify_tree(target.parent, {"package.json": audit.digest(expected)}, {})
            target.write_bytes(expected.replace(b"\n", b"\r\n"))
            with self.assertRaisesRegex(audit.AuditError, "Hash mismatch"):
                audit.verify_tree(target.parent, {"package.json": audit.digest(expected)}, {})

    def test_vendor_exact_set_and_hash_are_independent_of_generated_manifest(self):
        with temporary_directory() as temp:
            root = Path(temp)
            (root / "vendor/engine").mkdir(parents=True)
            payload = b"MZ synthetic pinned runtime"
            (root / "vendor/engine/tool.exe").write_bytes(payload)
            tools = {"python": "test"}
            (root / "dependencies.lock.json").write_text(json.dumps({"buildTools": tools}))
            info = {"schemaVersion": 1, "platform": "win-x64", "buildTools": tools, "runtimeFiles": [{"path": "engine/tool.exe", "sha256": audit.digest(payload)}]}
            (root / "vendor/build-info.json").write_text(json.dumps(info))
            policy = {"vendorFiles": {"engine/tool.exe": audit.digest(payload)}}
            self.assertEqual(len(audit.audit_vendor(root, policy)), 2)
            extra = root / "vendor/engine/fmod.dll"
            extra.write_bytes(b"innocent placeholder")
            with self.assertRaisesRegex(audit.AuditError, "extra="):
                audit.audit_vendor(root, policy)
            extra.unlink()
            (root / "vendor/engine/tool.exe").unlink()
            with self.assertRaisesRegex(audit.AuditError, "missing="):
                audit.audit_vendor(root, policy)
            changed = b"MZ different build"
            (root / "vendor/engine/tool.exe").write_bytes(changed)
            info["runtimeFiles"][0]["sha256"] = audit.digest(changed)
            (root / "vendor/build-info.json").write_text(json.dumps(info))
            with self.assertRaisesRegex(audit.AuditError, "Hash mismatch"):
                audit.audit_vendor(root, policy)

    def test_disguised_audio_unity_and_database_headers_are_rejected(self):
        headers = [b"RIFF\0\0\0\0WAVE", b"RF64\0\0\0\0WAVE", b"OggS", b"fLaC", b"ID3\x04\0\0\0\0\0\0", b"FSB5", b"UnityFS\0", b"UnityRaw\0", b"UnityWeb\0", b"SQLite format 3\0", b"FORM\0\0\0\0AIFF"]
        for header in headers:
            with self.subTest(header=header), self.assertRaisesRegex(audit.AuditError, "signature"):
                audit.inspect_bytes("innocent.json", header + b"synthetic", {}, approved_binary=True)

    def test_private_path_checks_are_case_insensitive(self):
        for name in ["LOCALDATA/a", "x/localdata/a", "../outside", "/absolute", "C:/absolute", "a\\b", "a/./b", "a//b"]:
            with self.subTest(name=name), self.assertRaises(audit.AuditError):
                audit.safe_name(name)

    def test_unapproved_binary_and_archive_cannot_hide_as_text(self):
        for data in [b"MZ\0binary", b"\x89PNG\r\n\x1a\n", zipped([("readme.txt", b"hi")])]:
            with self.subTest(data=data[:8]), self.assertRaises(audit.AuditError):
                audit.inspect_bytes("notes.txt", data, {})

    def test_allowed_text_names_cannot_carry_private_data_or_encoded_audio(self):
        samples = ["C:" + "/Users/ReleaseTestOnly/private.txt", "Local" + "Data/0123456789abcdef/file", "-----BEGIN " + "PRIVATE KEY-----", "da" + "ta:audio/wav;base64,UklGRg=="]
        for sample in samples:
            with self.subTest(sample=sample[:12]), self.assertRaisesRegex(audit.AuditError, "Private/embedded"):
                audit.inspect_bytes("allowed.json", json.dumps({"description": sample}).encode(), {}, approved_binary=True)

    def test_private_research_references_are_rejected(self):
        samples = ["workspace/catalog" + "-data.js", "scripts/library" + "_ui/library.js", "scripts\\library" + "_ui\\library.js", "flip/native" + "-evidence.json", "Effect" + "TaskCardFlipTurn.FinishStep", "依据游戏客户端" + "静态" + "调用", "客户端" + "静态检查"]
        for sample in samples:
            with self.subTest(sample=sample[:12]), self.assertRaisesRegex(audit.AuditError, "unpublished workspace reference"):
                audit.inspect_bytes("allowed.json", json.dumps({"description": sample}, ensure_ascii=False).encode(), {}, approved_binary=True)

    def test_disguised_raw_tar_does_not_bypass_archive_approval(self):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w") as archive:
            payload = b"OggSsynthetic"
            item = tarfile.TarInfo("hidden.bin")
            item.size = len(payload)
            archive.addfile(item, io.BytesIO(payload))
        outer = zipped([("nested.dat", out.getvalue())])
        with self.assertRaisesRegex(audit.AuditError, "Unapproved nested archive"):
            audit.inspect_bytes("source.zip", outer, approved_archive(outer))

    def test_nested_archive_requires_its_own_approval(self):
        inner = zipped([("readme.txt", b"hello")])
        outer = zipped([("nested.dat", inner)])
        with self.assertRaisesRegex(audit.AuditError, "Unapproved nested archive"):
            audit.inspect_bytes("approved.zip", outer, approved_archive(outer))

    def test_pinned_container_does_not_bypass_bad_paths_or_disguised_media(self):
        cases = [[("../outside", b"text")], [("LOCALDATA/a", b"text")], [("test.txt", b"OggSsynthetic")], [("a", b"1"), ("A", b"2")]]
        for entries in cases:
            data = zipped(entries)
            with self.subTest(entries=entries), self.assertRaises(audit.AuditError):
                audit.inspect_bytes("approved.zip", data, approved_archive(data))

    def test_upstream_media_named_text_reference_is_not_false_positive(self):
        data = zipped([("tests/ref/peak.wav", b"aabbcc *tests/data/peak.wav\n832 tests/data/peak.wav\n")])
        audit.inspect_bytes("source.zip", data, approved_archive(data))
        with self.assertRaisesRegex(audit.AuditError, "extension"):
            audit.inspect_bytes("peak.wav", b"same text", {})
        audit.inspect_bytes("id3-reference", b"ID3v2.4 title=test\n", {})

    def test_upstream_media_exception_is_bound_to_path_and_hash(self):
        wave = b"RIFF\0\0\0\0WAVE synthetic fixture"
        data = zipped([("tests/tone.wav", wave)])
        policy = approved_archive(data, signatureExceptions={"tests/tone.wav": audit.digest(wave)})
        audit.inspect_bytes("upstream.zip", data, policy)
        policy["approvedArchives"][audit.digest(data)]["signatureExceptions"]["tests/tone.wav"] = "0" * 64
        with self.assertRaisesRegex(audit.AuditError, "media changed"):
            audit.inspect_bytes("upstream.zip", data, policy)

    def test_tar_link_and_expansion_limits_are_checked(self):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w") as archive:
            member = tarfile.TarInfo("link")
            member.type = tarfile.SYMTYPE
            member.linkname = "../../outside"
            archive.addfile(member)
        data = lzma.compress(out.getvalue())
        with self.assertRaisesRegex(audit.AuditError, "Linked/special"):
            audit.inspect_bytes("source.tar.xz", data, approved_archive(data))
        data = zipped([("file.txt", b"x" * 100)])
        with self.assertRaisesRegex(audit.AuditError, "expansion limit"):
            audit.inspect_bytes("source.zip", data, approved_archive(data, maxExpandedBytes=20))

    def test_zip_symlink_is_rejected(self):
        entry = zipfile.ZipInfo("link")
        entry.create_system = 3
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        data = zipped([(entry, b"target")])
        with self.assertRaisesRegex(audit.AuditError, "[Ll]inked"):
            audit.inspect_bytes("source.zip", data, approved_archive(data))
        entry.filename = "linked/"
        data = zipped([(entry, b"../../outside")])
        with self.assertRaisesRegex(audit.AuditError, "[Ll]inked"):
            audit.inspect_bytes("source.zip", data, approved_archive(data))

    def test_filesystem_symlink_or_windows_junction_is_not_followed(self):
        with temporary_directory() as temp:
            base = Path(temp)
            root = base / "input"
            outside = base / "outside"
            root.mkdir()
            outside.mkdir()
            (outside / "secret.txt").write_text("synthetic marker")
            if os.name == "nt":
                import _winapi
                _winapi.CreateJunction(str(outside), str(root / "linked"))
            else:
                (root / "linked").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(audit.AuditError, "Linked directory"):
                audit.inventory(root)

    def test_stage_rejects_extra_missing_changed_and_pycache_files(self):
        with temporary_directory() as temp:
            root = Path(temp)
            (root / "ok.txt").write_bytes(b"approved")
            expected = {"ok.txt": audit.digest(b"approved")}
            audit.verify_tree(root, expected, {})
            (root / "__pycache__").mkdir()
            (root / "__pycache__/hidden.pyc").write_bytes(b"hidden")
            with self.assertRaisesRegex(audit.AuditError, "extra="):
                audit.verify_tree(root, expected, {})

    def test_source_unknown_files_are_not_silently_excluded(self):
        with temporary_directory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/main.ts").write_text("export const ok = true;\n")
            policy = {"sourceFiles": ["src/main.ts"]}
            self.assertEqual(len(audit.audit_source(root, policy)), 1)
            (root / "src/leak.ogg").write_bytes(b"OggSsynthetic")
            with self.assertRaisesRegex(audit.AuditError, "Source inventory mismatch"):
                audit.audit_source(root, policy)

    def test_stable_zip_binds_exact_manifest_and_refuses_tampering(self):
        with temporary_directory() as temp:
            base = Path(temp)
            root = base / "input"
            root.mkdir()
            (root / "readme.txt").write_bytes(b"approved\n")
            rows = [audit.record("readme.txt", b"approved\n")]
            zipper.make_zip(root, base / "a.zip", rows, {})
            zipper.make_zip(root, base / "b.zip", rows, {})
            self.assertEqual((base / "a.zip").read_bytes(), (base / "b.zip").read_bytes())
            audit.verify_archive(base / "a.zip", rows, {})
            (base / "appended.zip").write_bytes((base / "a.zip").read_bytes() + b"OggSsynthetic appended payload")
            with self.assertRaisesRegex(audit.AuditError, "trailing data"):
                audit.verify_archive(base / "appended.zip", rows, {})
            (base / "prefixed.zip").write_bytes(b"OggSsynthetic prefix" + (base / "a.zip").read_bytes())
            with self.assertRaises(audit.AuditError):
                audit.verify_archive(base / "prefixed.zip", rows, {})
            raw = bytearray((base / "a.zip").read_bytes())
            with zipfile.ZipFile(io.BytesIO(raw)) as original:
                member = original.infolist()[0]
                central = original.start_dir
            tail = b"OggSsynthetic within compressed member"
            struct.pack_into("<L", raw, 18, member.compress_size + len(tail))
            struct.pack_into("<L", raw, central + 20, member.compress_size + len(tail))
            struct.pack_into("<L", raw, len(raw) - 6, central + len(tail))
            raw[central:central] = tail
            (base / "compressed-tail.zip").write_bytes(raw)
            with self.assertRaisesRegex(audit.AuditError, "compressed stream"):
                audit.verify_archive(base / "compressed-tail.zip", rows, {})
            with self.assertRaisesRegex(ValueError, "overwrite"):
                zipper.make_zip(root, base / "a.zip", rows, {})
            (base / "bad.zip").write_bytes(zipped([("readme.txt", b"different")]))
            with self.assertRaises(audit.AuditError):
                audit.verify_archive(base / "bad.zip", rows, {})
            (root / "extra.txt").write_bytes(b"extra")
            with self.assertRaisesRegex(ValueError, "extra="):
                zipper.make_zip(root, base / "c.zip", rows, {})


if __name__ == "__main__":
    unittest.main()
