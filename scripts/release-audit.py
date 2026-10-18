"""Fail-closed release inventory. Approval is checked in, never inferred from vendor/."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import tarfile
import zipfile
import zlib


class AuditError(ValueError):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")


def safe_name(name: str):
    p = PurePosixPath(name)
    if not name or "\\" in name or p.is_absolute() or any(x in ("", ".", "..") for x in name.split("/")) or ":" in name:
        raise AuditError(f"Unsafe release path: {name}")
    if any(x.casefold() in ("localdata", ".git", ".aws", ".ssh") for x in p.parts):
        raise AuditError(f"Private/game directory in release: {name}")


def linked(path: Path) -> bool:
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def inventory(root: Path, ignored=(), *, ignore_pycache=False) -> dict[str, Path]:
    """lstat every traversed path; never follow symlinks or Windows junctions."""
    root = Path(root)
    if linked(root):
        raise AuditError(f"Linked input root: {root}")
    result = {}
    folded = set()
    for current, directories, files in os.walk(root, followlinks=False):
        for name in list(directories):
            p = Path(current) / name
            rel = p.relative_to(root).as_posix()
            if linked(p):
                raise AuditError(f"Linked directory: {rel}")
            if rel in ignored or (ignore_pycache and name == "__pycache__"):
                directories.remove(name)
        for name in files:
            p = Path(current) / name
            rel = p.relative_to(root).as_posix()
            if linked(p) or not stat.S_ISREG(p.lstat().st_mode):
                raise AuditError(f"Non-regular release file: {rel}")
            safe_name(rel)
            if rel.casefold() in folded:
                raise AuditError(f"Case-colliding release path: {rel}")
            folded.add(rel.casefold())
            result[rel] = p
    return result


def media_signature(data: bytes):
    if data[:4] in (b"RIFF", b"RF64", b"RIFX") and data[8:12] == b"WAVE":
        return "WAVE"
    for prefix, label in ((b"OggS", "Ogg"), (b"fLaC", "FLAC"), (b"FSB4", "FSB4"), (b"FSB5", "FSB5"), (b"UnityFS\0", "UnityFS"), (b"UnityWeb\0", "UnityWeb"), (b"UnityRaw\0", "UnityRaw"), (b"SQLite format 3\0", "SQLite")):
        if data.startswith(prefix):
            return label
    if len(data) >= 10 and data[:3] == b"ID3" and data[3] in (2, 3, 4) and all(v < 128 for v in data[6:10]):
        return "ID3 audio"
    if data[:4] == b"FORM" and data[8:12] in (b"AIFF", b"AIFC"):
        return "AIFF"
    return None


BANNED_SUFFIXES = {".wav", ".ogg", ".mp3", ".flac", ".aac", ".m4a", ".wma", ".opus", ".aiff", ".aif", ".fsb", ".bank", ".wem", ".bundle", ".unity3d", ".assets", ".resource", ".ress", ".sqlite", ".db"}
PRIVATE_TEXT_PATTERNS = {
    "personal Windows user path": re.compile(r"(?i)\b[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|All Users\b)[^\\/<>\s\"']+"),
    "actual local account path": re.compile(r"(?i)LocalData[\\/]+[0-9a-f]{8,}(?=[\\/\s\"']|$)"),
    "private key marker": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "embedded audio data URI": re.compile("data:" + r"audio/[^;,\s]+(?:;base64)?,", re.I),
    # Split literals keep this file and its tests from matching the pattern below.
    "unpublished workspace reference": re.compile("|".join(["catalog" + r"-data\.js", "library" + r"_ui[\\/]", "native" + r"-evidence", "Effect" + r"Task[A-Za-z]", "静态" + "调用", "客户端" + "静态"]), re.I),
}


def inspect_text(name, data):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError:
        return
    for label, pattern in PRIVATE_TEXT_PATTERNS.items():
        if pattern.search(text):
            raise AuditError(f"Private/embedded content ({label}) in {name}")


def inspect_bytes(name: str, data: bytes, policy: dict, *, approved_binary=False, source_archive=False, depth=0, signature_exception=False, text_exception=False):
    safe_name(name)
    if not text_exception:
        inspect_text(name, data)
    found = media_signature(data)
    if found and not signature_exception:
        raise AuditError(f"Forbidden {found} signature: {name}")
    suffix = PurePosixPath(name).suffix.lower()
    if suffix in BANNED_SUFFIXES and not signature_exception:
        # FFmpeg tests/ref/*.wav and *.ogg are UTF-8 expected-output text.
        try:
            text = data.decode("utf-8")
        except UnicodeError:
            text = "\0"
        if not source_archive or "\0" in text:
            raise AuditError(f"Forbidden media/data extension: {name}")
    is_zip = data.startswith((b"PK\x03\x04", b"PK\x05\x06"))
    is_xz = data.startswith(b"\xfd7zXZ\0")
    is_gzip = data.startswith(b"\x1f\x8b")
    is_tar = data[257:262] == b"ustar" or name.lower().endswith(".tar")
    other_archive = data.startswith((b"7z\xbc\xaf\x27\x1c", b"Rar!\x1a\x07", b"BZh", b"\x28\xb5\x2f\xfd"))
    archive_extension = name.lower().endswith((".zip", ".tar", ".xz", ".gz", ".tgz", ".7z", ".rar", ".bz2", ".zst"))
    if is_zip or is_xz or is_gzip or is_tar or other_archive or archive_extension:
        approval = policy.get("approvedArchives", {}).get(digest(data))
        if not approval:
            raise AuditError(f"Unapproved nested archive (review its origin and exact hash): {name}")
        if depth >= 4:
            raise AuditError(f"Nested archive depth exceeded: {name}")
        source = approval["kind"] == "third-party-source"
        limit = approval.get("maxExpandedBytes", 512 * 1024 * 1024)
        seen = set()
        total = 0
        count = 0

        def check_member(child, size, mode, read):
            nonlocal total, count
            safe_name(child)
            if child.casefold() in seen or stat.S_ISLNK(mode):
                raise AuditError(f"Duplicate/linked nested entry: {name}!{child}")
            seen.add(child.casefold())
            total += size
            count += 1
            if total > limit or count > 20000:
                raise AuditError(f"Nested archive expansion limit exceeded: {name}")
            payload = read()
            if len(payload) != size:
                raise AuditError(f"Nested size mismatch: {name}!{child}")
            opaque = approval.get("opaqueMembers", {}).get(child)
            if opaque:
                if digest(payload) != opaque:
                    raise AuditError(f"Reviewed opaque fixture changed: {name}!{child}")
                return  # Deliberately malformed upstream ASAR fixtures: retain, never execute.
            exception = approval.get("signatureExceptions", {}).get(child)
            if exception and digest(payload) != exception:
                raise AuditError(f"Reviewed upstream media changed: {name}!{child}")
            text_exception = approval.get("textExceptions", {}).get(child)
            if text_exception and digest(payload) != text_exception:
                raise AuditError(f"Reviewed upstream text fixture changed: {name}!{child}")
            inspect_bytes(child, payload, policy, approved_binary=True, source_archive=source, depth=depth + 1, signature_exception=bool(exception), text_exception=bool(text_exception))

        if is_zip:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for item in archive.infolist():
                    if item.flag_bits & 1:
                        raise AuditError(f"Encrypted nested entry: {name}!{item.filename}")
                    if stat.S_ISLNK(item.external_attr >> 16):
                        raise AuditError(f"Linked nested entry: {name}!{item.filename}")
                    if item.is_dir():
                        directory_name = item.filename.rstrip("/")
                        safe_name(directory_name)
                        if directory_name.casefold() in seen:
                            raise AuditError(f"Duplicate nested directory: {name}!{directory_name}")
                        seen.add(directory_name.casefold())
                        continue
                    check_member(item.filename, item.file_size, item.external_attr >> 16, lambda: archive.read(item))
        elif is_xz or is_gzip or is_tar:
            # A bounded streaming decode also verifies the compressed stream check.
            if is_tar:
                unpacked = data
            else:
                stream = lzma.LZMAFile(io.BytesIO(data)) if is_xz else gzip.GzipFile(fileobj=io.BytesIO(data))
                unpacked = stream.read(limit + 1)
            if len(unpacked) > limit:
                raise AuditError(f"Compressed archive expansion limit exceeded: {name}")
            with tarfile.open(fileobj=io.BytesIO(unpacked), mode="r:") as archive:
                for item in archive.getmembers():
                    safe_name(item.name.rstrip("/"))
                    if item.isdir():
                        continue
                    if not item.isfile():
                        raise AuditError(f"Linked/special tar member: {name}!{item.name}")
                    check_member(item.name, item.size, item.mode, lambda: archive.extractfile(item).read())
        else:
            raise AuditError(f"Unsupported archive format: {name}")
    elif not approved_binary:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeError as error:
            raise AuditError(f"Unapproved binary source content: {name}") from error
        if "\0" in text:
            raise AuditError(f"Binary content hidden in text file: {name}")


def record(name, data):
    return {"path": name, "sizeBytes": len(data), "sha256": digest(data)}


def expected_map(records):
    result = {}
    seen = set()
    for item in records:
        safe_name(item["path"])
        if item["path"].casefold() in seen:
            raise AuditError(f"Duplicate manifest path: {item['path']}")
        seen.add(item["path"].casefold())
        result[item["path"]] = item
    return result


def verify_tree(root: Path, expected: dict, policy: dict, *, generated=()):
    actual = inventory(root)
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    if missing or extra:
        raise AuditError(f"Release inventory mismatch at {root}: missing={missing}, extra={extra}")
    result = []
    for name, path in sorted(actual.items()):
        data = path.read_bytes()
        spec = expected[name]
        wanted = spec if isinstance(spec, str) else (spec or {}).get("sha256")
        if wanted and digest(data) != wanted:
            raise AuditError(f"Hash mismatch: {name}. A legitimate rebuild requires explicit provenance review and an updated checked-in approval; approval is never regenerated automatically.")
        inspect_bytes(name, data, policy, approved_binary=True)
        result.append(record(name, data))
    return result


def audit_vendor(root: Path, policy: dict):
    expected = dict(policy["vendorFiles"])
    expected["build-info.json"] = None
    rows = verify_tree(root / "vendor", expected, policy)
    info = load_json(root / "vendor/build-info.json")
    if set(info) != {"schemaVersion", "platform", "buildTools", "runtimeFiles"} or info["schemaVersion"] != 1 or info["platform"] != "win-x64":
        raise AuditError("Unexpected vendor/build-info.json schema")
    if info["buildTools"] != load_json(root / "dependencies.lock.json")["buildTools"]:
        raise AuditError("Build tool identity differs from the dependency lock")
    approved = {k: v for k, v in policy["vendorFiles"].items() if k.split("/")[0] in ("engine", "importer", "vgmstream", "ffmpeg")}
    declared = expected_map(info["runtimeFiles"])
    if {k: v["sha256"] for k, v in declared.items()} != approved:
        raise AuditError("build-info.json does not describe the approved runtime file set")
    if any(set(v) != {"path", "sha256"} for v in info["runtimeFiles"]):
        raise AuditError("Unexpected private/extra fields in build-info.json")
    return rows


SOURCE_DIRS = ("src", "desktop", "shared", "engine", "importer", "scripts", "tests", "resources", ".github", "compliance")


def audit_facet_metadata(table: dict, classifications: dict, recipes: dict):
    """Validate the additive v1 defaults table before shipping it to old libraries."""
    def require(condition, detail):
        if not condition:
            raise AuditError("Invalid facet metadata: " + detail)

    def strings(value):
        return isinstance(value, list) and all(isinstance(item, str) for item in value)

    require(isinstance(table, dict) and set(table) == {"schemaVersion", "profiles", "resources", "actions", "resourceDefaults"}, "root fields")
    require(table["schemaVersion"] == 1, "schema version")
    profiles = table["profiles"]
    require(isinstance(profiles, list) and bool(profiles), "profiles")
    array_fields = {"types", "summon", "attribute", "cardType", "level", "animation", "confirmation"}
    for profile in profiles:
        require(isinstance(profile, dict) and set(profile) == array_fields | {"purposes", "displayForm"}, "profile fields")
        require(all(strings(profile[field]) for field in array_fields) and isinstance(profile["displayForm"], str), "profile values")
        require(isinstance(profile["purposes"], dict) and all(isinstance(key, str) and strings(value) for key, value in profile["purposes"].items()), "purpose values")

    def valid_index(index):
        return type(index) is int and 0 <= index < len(profiles)

    resources, actions, defaults = table["resources"], table["actions"], table["resourceDefaults"]
    require(isinstance(resources, dict) and set(resources) == set(classifications), "resource identities")
    require(all(valid_index(index) for index in resources.values()), "resource profile index")
    expected_actions = {recipe["id"]: recipe for recipe in recipes["recipes"]}
    require(isinstance(actions, dict) and set(actions) == set(expected_actions), "action identities")
    for key, action in actions.items():
        recipe = expected_actions[key]
        require(isinstance(action, dict) and set(action) == {"name", "form", "profile"}, "action fields")
        require(action["name"] == recipe["name"] and action["form"] == recipe["form"] and valid_index(action["profile"]), "action identity guard")
    correction_keys = {key for key in classifications if "CARD_DRAW" in key.split(":")[0].upper() or key.split(":")[0] in {"SE_DISP_ATTACK", "SE_DISP_DEFENS"}}
    fields = {"title", "category", "tags", "description"}
    require(isinstance(defaults, dict) and set(defaults) == correction_keys, "reviewed default identities")
    for key, value in defaults.items():
        require(isinstance(value, dict) and set(value) == fields, "default fields")
        require(isinstance(value["title"], str) and isinstance(value["description"], str) and strings(value["category"]) and strings(value["tags"]), "default values")
        require(value == {field: classifications[key][field] for field in fields}, "defaults differ from classification")
        facets = profiles[resources[key]]
        if "CARD_DRAW" in key.split(":")[0].upper():
            require(not facets["summon"] and "召唤方式" not in facets["types"] and "召唤方式" not in facets["purposes"], "CARD_DRAW summon exclusion")
        else:
            require(facets["summon"] == ["反转召唤／翻转"] and {"召唤方式", "卡片相关"} <= set(facets["types"]), "flip-summon display resource")


def audit_rule_metadata(root: Path, policy: dict):
    manifest = load_json(root / "compliance/rules-manifest.json")
    artifacts = expected_map(manifest["artifacts"])
    if set(artifacts) != {"engine/rules/classification.json", "engine/rules/recipes.json", "shared/facet-metadata.json"}:
        raise AuditError("Rule provenance manifest artifact identities differ")
    for artifact in artifacts.values():
        name = artifact["path"]
        safe_name(name)
        data = (root / name).read_bytes()
        if artifact["sha256"] != digest(data) or artifact["sizeBytes"] != len(data) or policy["pinnedSourceFiles"].get(name) != artifact["sha256"]:
            raise AuditError(f"Rule provenance manifest differs from reviewed source: {name}")
    table = load_json(root / "shared/facet-metadata.json")
    audit_facet_metadata(table, load_json(root / "engine/rules/classification.json"), load_json(root / "engine/rules/recipes.json"))
    declaration = artifacts["shared/facet-metadata.json"]
    for count, field in (("resourceCount", "resources"), ("actionCount", "actions"), ("profileCount", "profiles"), ("resourceDefaultCount", "resourceDefaults")):
        if declaration.get(count) != len(table[field]):
            raise AuditError(f"Facet provenance count differs: {count}")
    if set(declaration.get("rootFields", [])) != set(table) or set(declaration.get("resourceDefaultFields", [])) != {"title", "category", "tags", "description"}:
        raise AuditError("Facet provenance schema differs")


def audit_source(root: Path, policy: dict):
    expected = set(policy["sourceFiles"])
    if len(expected) != len(policy["sourceFiles"]):
        raise AuditError("Duplicate source approval")
    actual = set()
    for folder in SOURCE_DIRS:
        directory = root / folder
        if directory.exists():
            skipped = ("bin", "obj") if folder == "importer" else (("build", "dist") if folder == "engine" else ())
            actual.update(folder + "/" + n for n in inventory(directory, skipped, ignore_pycache=True))
    for path in root.iterdir():
        if path.is_file():
            if linked(path):
                raise AuditError(f"Linked source file: {path.name}")
            actual.add(path.name)
    if actual != expected:
        raise AuditError(f"Source inventory mismatch: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}")
    rows = []
    for name in sorted(expected):
        safe_name(name)
        data = (root / name).read_bytes()
        pinned = policy.get("pinnedSourceFiles", {}).get(name)
        if pinned and digest(data) != pinned:
            raise AuditError(f"Reviewed source asset/rule changed: {name}")
        approved = bool(pinned) or digest(data) in policy.get("approvedArchives", {})
        inspect_bytes(name, data, policy, approved_binary=approved)
        rows.append(record(name, data))
    if "shared/facet-metadata.json" in expected:
        audit_rule_metadata(root, policy)
    return rows


def audit_dist(root: Path, policy: dict):
    paths = inventory(root / "dist")
    rows = []
    required = {"desktop/main.cjs", "desktop/preload.cjs", "renderer/index.html"}
    present = set()
    fonts = set()
    js_css = {"js": 0, "css": 0}
    for name, path in sorted(paths.items()):
        if name in ("desktop/main.cjs.map", "desktop/preload.cjs.map"):
            continue
        data = path.read_bytes()
        if name in policy["fontFiles"]:
            if digest(data) != policy["fontFiles"][name]:
                raise AuditError(f"Unapproved font bytes: {name}")
            fonts.add(name)
        elif name in required:
            inspect_bytes(name, data, policy)
            present.add(name)
        elif re.fullmatch(r"renderer/assets/index-[A-Za-z0-9_-]+\.(js|css)", name):
            inspect_bytes(name, data, policy)
            js_css[name.rsplit(".", 1)[1]] += 1
        else:
            raise AuditError(f"Unexpected generated app file: {name}")
        rows.append(record("dist/" + name, data))
    if present != required or fonts != set(policy["fontFiles"]) or js_css != {"js": 1, "css": 1}:
        raise AuditError("Incomplete or ambiguous generated app inventory")
    return rows


def copy_rows(source: Path, destination: Path, rows):
    destination.mkdir(parents=True, exist_ok=False)
    for row in rows:
        target = destination / row["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / row["path"], target)


def prepare(root: Path, stage: Path):
    policy = load_json(root / "scripts/release-policy.json")
    package = load_json(root / "package.json")
    if package["devDependencies"]["electron"] != policy["electronVersion"]:
        raise AuditError("Electron version requires a new runtime approval")
    source = audit_source(root, policy)
    vendor = audit_vendor(root, policy)
    electron = verify_tree(root / "node_modules/electron/dist", policy["electronFiles"], policy)
    dist = audit_dist(root, policy)
    copy_rows(root, stage / "source", source)
    app_rows = dist + [r for r in source if r["path"].startswith("resources/") or r["path"] == "dependencies.lock.json"]
    copy_rows(root, stage / "app", app_rows)
    app_package = {key: package[key] for key in ("name", "version", "description", "license", "main")}
    write_json(stage / "app/package.json", app_package)
    app_rows.append(record("package.json", (stage / "app/package.json").read_bytes()))
    electron_zip_dir = stage / "electron"
    electron_zip_dir.mkdir()
    with zipfile.ZipFile(electron_zip_dir / f"electron-v{policy['electronVersion']}-win32-x64.zip", "w", zipfile.ZIP_STORED) as archive:
        for row in electron:
            archive.write(root / "node_modules/electron/dist" / row["path"], row["path"])
    plan = {"schemaVersion": 1, "version": package["version"], "policySha256": digest((root / "scripts/release-policy.json").read_bytes()), "sourceDigest": digest(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()), "source": source, "app": sorted(app_rows, key=lambda r: r["path"]), "vendor": [r for r in vendor if not r["path"].startswith("assetstudio/")], "electron": electron, "documentationFiles": policy["documentationFiles"]}
    write_json(stage / "plan.json", plan)
    return plan


def finalize(root: Path, stage: Path, portable: Path):
    policy = load_json(root / "scripts/release-policy.json")
    plan = load_json(stage / "plan.json")
    if digest((root / "scripts/release-policy.json").read_bytes()) != plan["policySha256"]:
        raise AuditError("Approval policy changed during packaging")
    verify_tree(stage / "source", expected_map(plan["source"]), policy)
    expected = {}
    for row in plan["electron"]:
        name = row["path"]
        if name == "electron.exe":
            # Only @electron/packager changes version/icon resources of this pinned input.
            expected["MD音效播放器.exe"] = None
        elif name == "resources/default_app.asar":
            continue  # The pinned stock Electron app is removed by packager.
        elif name == "LICENSE":
            expected["resources/vendor/licenses/Electron-MIT.txt"] = row["sha256"]
        else:
            expected[name] = row["sha256"]
    for row in plan["app"]:
        expected["resources/app/" + row["path"]] = row["sha256"]
    for row in plan["vendor"]:
        expected["resources/vendor/" + row["path"]] = row["sha256"]
    source = expected_map(plan["source"])
    for name in plan["documentationFiles"]:
        expected[name] = source[name]["sha256"]
    rows = verify_tree(portable, expected, policy)
    result = {key: plan[key] for key in ("schemaVersion", "version", "policySha256", "sourceDigest")}
    result.update({"source": plan["source"], "portable": rows, "limitations": ["Signatures do not identify every possible encoding or raw media format.", "Approved PE, PyInstaller bytecode, Chromium PAK, ICU and V8 internals are not reverse engineered.", "Dependency provenance and file integrity do not grant rights to game assets."]})
    write_json(stage / "candidate-manifest.json", result)


def verify_archive(path: Path, rows, policy: dict):
    expected = expected_map(rows)
    seen = set()
    data_offsets = {}
    with zipfile.ZipFile(path) as archive:
        # Our writer uses seekable files, no ZIP64, comments or extra fields.
        # Reject bytes hidden outside enumerated members instead of blessing them
        # with a newly calculated overall digest.
        with path.open("rb") as physical:
            physical.seek(-22, os.SEEK_END)
            footer = physical.read(22)
            if len(footer) != 22 or footer[:4] != b"PK\x05\x06" or archive.comment:
                raise AuditError("ZIP has a comment, trailing data, or invalid end record")
            _, disk, cd_disk, disk_entries, entries, cd_size, cd_offset, comment_len = struct.unpack("<4s4H2LH", footer)
            if disk or cd_disk or comment_len or entries != len(expected) or disk_entries != entries or cd_offset != archive.start_dir or cd_offset + cd_size != path.stat().st_size - 22:
                raise AuditError("ZIP has unexpected physical container metadata")
            next_offset = 0
            for item in archive.infolist():
                if item.header_offset != next_offset or item.extra or item.comment or item.flag_bits & 8:
                    raise AuditError("ZIP contains unmanifested prefix/gap/extra-field data")
                physical.seek(item.header_offset)
                header = physical.read(30)
                if header[:4] != b"PK\x03\x04" or len(header) != 30:
                    raise AuditError("Invalid ZIP local header")
                name_size, extra_size = struct.unpack_from("<HH", header, 26)
                if extra_size:
                    raise AuditError("Unexpected ZIP local extra fields")
                local = struct.unpack("<4s5H3L2H", header)
                if local[2] != item.flag_bits or local[3] != item.compress_type or local[6:9] != (item.CRC, item.compress_size, item.file_size):
                    raise AuditError("ZIP local and central headers differ")
                encoding = "utf-8" if item.flag_bits & 0x800 else "cp437"
                if physical.read(name_size) != item.filename.encode(encoding):
                    raise AuditError("ZIP local filename differs from central directory")
                data_offsets[item.filename] = item.header_offset + 30 + name_size
                next_offset = item.header_offset + 30 + name_size + item.compress_size
            if next_offset != archive.start_dir:
                raise AuditError("ZIP contains data between members and central directory")
        for item in archive.infolist():
            safe_name(item.filename.rstrip("/"))
            if item.is_dir() or item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16):
                raise AuditError(f"Unexpected directory/encrypted/link ZIP entry: {item.filename}")
            if item.filename.casefold() in seen or item.filename not in expected:
                raise AuditError(f"Unexpected/duplicate ZIP entry: {item.filename}")
            seen.add(item.filename.casefold())
            if item.file_size != expected[item.filename]["sizeBytes"]:
                raise AuditError(f"ZIP size differs from approved manifest: {item.filename}")
            if item.compress_type != zipfile.ZIP_DEFLATED or item.compress_size > item.file_size + max(65536, item.file_size // 1000):
                raise AuditError("Unexpected release compression method/size")
            with path.open("rb") as physical:
                physical.seek(data_offsets[item.filename])
                compressed = physical.read(item.compress_size)
            decoder = zlib.decompressobj(-15)
            data = decoder.decompress(compressed, item.file_size + 1)
            if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or len(data) != item.file_size:
                raise AuditError(f"ZIP compressed stream has trailing/unconsumed data: {item.filename}")
            if zlib.crc32(data) & 0xFFFFFFFF != item.CRC:
                raise AuditError(f"ZIP CRC mismatch: {item.filename}")
            if record(item.filename, data) != expected[item.filename]:
                raise AuditError(f"ZIP differs from approved staged bytes: {item.filename}")
            inspect_bytes(item.filename, data, policy, approved_binary=True)
    if seen != {name.casefold() for name in expected}:
        raise AuditError("ZIP has missing manifest entries")
    with path.open("rb") as handle:
        return {"file": path.name, "sizeBytes": path.stat().st_size, "sha256": hashlib.file_digest(handle, "sha256").hexdigest(), "entries": len(expected), "crc": "all members passed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "prepare", "finalize", "verify-archives"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--stage", type=Path)
    parser.add_argument("--portable", type=Path)
    parser.add_argument("--publish", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    policy = load_json(root / "scripts/release-policy.json")
    if args.command == "check":
        print(json.dumps({"sourceFiles": len(audit_source(root, policy)), "vendorFiles": len(audit_vendor(root, policy))}))
    elif args.command == "prepare":
        prepare(root, args.stage)
    elif args.command == "finalize":
        finalize(root, args.stage, args.portable)
    else:
        manifest = load_json(args.stage / "candidate-manifest.json")
        artifacts = []
        for kind, suffix in (("source", "source"), ("portable", "win-x64")):
            path = args.publish / f"MD-Audio-Player-{manifest['version']}-{suffix}.zip"
            row = verify_archive(path, manifest[kind], policy)
            artifacts.append(row)
            (path.parent / (path.name + ".sha256")).write_text(f"{row['sha256']}  {path.name}\n", encoding="utf-8")
        manifest["artifacts"] = artifacts
        manifest_path = args.publish / "release-manifest.json"
        write_json(manifest_path, manifest)
        (args.publish / "release-manifest.json.sha256").write_text(f"{digest(manifest_path.read_bytes())}  release-manifest.json\n", encoding="utf-8")
        print(json.dumps({"version": manifest["version"], "artifacts": artifacts}))


if __name__ == "__main__":
    try:
        main()
    except (AuditError, OSError, ValueError, zipfile.BadZipFile, tarfile.TarError) as error:
        raise SystemExit(f"Release audit failed: {error}")
