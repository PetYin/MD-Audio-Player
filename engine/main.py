"""Portable MD audio engine. stdout is the shared/contracts.ts JSONL protocol.

No game file is ever opened for writing. Cache and staging are confined to the
portable data directory; the source installation is not a working directory.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import time
import uuid

from classify import RULES_ROOT, classify
from media import Cancelled, Media, Runner, ensure_space
from safety import Boundary, account_parts, contained, digest, read_json, reparse, signature, stable_hash

ENGINE_VERSION = "md-audio-1.0.0"
# Cache compatibility is deliberately independent of the application release.
REPORT_VERSION = "md-audio-1.0.1"
BATCH_SIZE = 128
MEDIA_FIELDS = ("mediaId", "relativePath", "bytes", "duration", "sampleRate", "channels", "peaks", "status")


def cache_number(value, low=0, high=float("inf"), integer=False):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value) and low <= value <= high and (not integer or int(value) == value)
    except (OverflowError, ValueError):
        return False


def valid_media_structure(info) -> bool:
    if not isinstance(info, dict) or info.get("status") != "ready":
        return False
    media_id, relative, peaks = info.get("mediaId"), info.get("relativePath"), info.get("peaks")
    return (isinstance(media_id, str) and re.fullmatch(r"[a-f0-9]{64}", media_id) is not None
            and relative == f"assets/audio/{media_id}.wav" and cache_number(info.get("duration"))
            and cache_number(info.get("sampleRate"), high=768000, integer=True)
            and cache_number(info.get("channels"), high=64, integer=True)
            and cache_number(info.get("bytes"), high=2 ** 53 - 1, integer=True)
            and isinstance(peaks, list) and len(peaks) <= 4096 and all(cache_number(value, high=1) for value in peaks))


def valid_record_structure(record) -> bool:
    """Reject corrupt caches before their records reach the desktop protocol.

    Keep bounds aligned with desktop/validation.ts engineRecordSchema; media
    bytes are independently verified by Media.valid(). Cache records are ready
    audio, so hashes and origins must additionally be complete.
    """
    def text(value, limit):
        if not isinstance(value, str):
            return False
        try:
            # Zod string lengths use JavaScript UTF-16 code units.
            return len(value.encode("utf-16-le")) // 2 <= limit
        except UnicodeError:
            return False

    def strings(value, limit):
        return isinstance(value, list) and len(value) <= limit and all(text(entry, 80) and entry.strip() for entry in value)

    if not isinstance(record, dict):
        return False
    if any(not text(record.get(field), limit) for field, limit in
           (("id", 200), ("title", 1000), ("originalName", 1000), ("form", 200), ("description", 20000))):
        return False
    if (not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}", record["id"])
            or record.get("kind") not in ("sfx", "music", "voice") or record.get("status") != "ready"
            or not strings(record.get("category"), 8) or not strings(record.get("tags"), 100)
            or not valid_media_structure(record)):
        return False
    sources = record.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 5000:
        return False
    for source in sources:
        if (not isinstance(source, dict) or any(not text(source.get(field), limit) for field, limit in
                                              (("key", 2000), ("bundle", 2000), ("account", 200), ("payloadHash", 128)))
                or not re.fullmatch(r"[a-f0-9]{64}", source["payloadHash"])):
            return False
    return True


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), flush=True)


def inspect(game: Path) -> dict:
    game = game.resolve()
    directories, errors = [], []
    try:
        local = game / "LocalData"
        if local.exists():
            if reparse(local):
                raise ValueError("LocalData 不能是符号链接或目录联接。")
            for path in sorted(local.iterdir()):
                try:
                    if not stat.S_ISDIR(path.lstat().st_mode):
                        continue
                    if reparse(path):
                        raise ValueError("账号目录不能是符号链接或目录联接。")
                    resources = path / "0000"
                    try:
                        info = resources.lstat()
                    except FileNotFoundError:
                        continue
                    if reparse(resources):
                        raise ValueError("0000 目录不能是符号链接或目录联接。")
                    if stat.S_ISDIR(info.st_mode):
                        directories.append({"name": path.name, "modifiedAt": info.st_mtime_ns // 1_000_000,
                                            "modifiedNs": str(info.st_mtime_ns)})
                except (OSError, ValueError) as exc:
                    errors.append(f"无法读取账号 {path.name} 的 0000 目录修改时间: {exc}")
    except (OSError, ValueError) as exc:
        errors.append("无法读取账号目录: " + str(exc))
    accounts = [item["name"] for item in directories]
    valid = (game / "masterduel.exe").is_file() and ((game / "masterduel_Data").is_dir() or bool(accounts))
    latest = min(directories, key=lambda item: (-int(item["modifiedNs"]), item["name"])) if directories else None
    return {"path": str(game), "valid": valid, "accounts": accounts,
            "accountDirectories": directories, "latestAccount": latest["name"] if latest and not errors else None,
            "selectionError": " | ".join(errors) if errors else None,
            "message": f"找到 {len(accounts)} 个本地账号资源目录。" if valid else "请选择包含 masterduel.exe 的游戏安装目录。"}


def validate_accounts(accounts, scan_mode):
    if scan_mode not in ("all", "latest"):
        raise ValueError("扫描模式必须为 all 或 latest。")
    if not isinstance(accounts, list) or any(not isinstance(name, str) or not name or name in (".", "..")
                                            or any(c in name for c in '/\\:\0') for name in accounts):
        raise ValueError("账号名单必须是仅包含账号目录名的 JSON 数组。")
    if len(accounts) != len(set(accounts)) or (scan_mode == "latest" and len(accounts) > 1):
        raise ValueError("账号名单重复或与扫描模式不匹配。")
    return list(accounts)


def account_root(boundary: Boundary, account: str) -> Path:
    root = boundary.game
    for name in ("LocalData", account, "0000"):
        root = root / name
        if reparse(root) or not stat.S_ISDIR(root.lstat().st_mode):
            raise ValueError(f"所选账号目录无效或已变成目录联接: {account}")
    return boundary.source(root)


def walk_readonly(root: Path, game: Path, on_error):
    if not root.exists() or reparse(root):
        return
    if root.is_file():
        yield root
        return
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=on_error):
        base = Path(directory)
        safe_dirs = []
        for name in dirs:
            path = base / name
            try:
                if not reparse(path):
                    safe_dirs.append(name)
            except OSError as exc:
                on_error(exc)
        dirs[:] = sorted(safe_dirs)
        for name in sorted(files):
            path = base / name
            try:
                if not reparse(path):
                    yield path
            except OSError as exc:
                on_error(exc)


def scan(boundary: Boundary, runner: Runner, progress, error, scan_mode="all", accounts=None) -> tuple[list[dict], list[dict], dict]:
    game = boundary.game
    installation = inspect(game)
    if not installation["valid"]:
        raise ValueError(installation["message"])
    if accounts is None:
        if installation["selectionError"]:
            raise ValueError(installation["selectionError"])
        accounts = installation["accounts"] if scan_mode == "all" else ([installation["latestAccount"]] if installation["latestAccount"] else [])
    accounts = validate_accounts(accounts, scan_mode)
    roots = [game / "masterduel_Data"]
    roots.extend(account_root(boundary, account) for account in accounts)
    # StreamingAssets and public .assets / data.unity3d are included by the
    # masterduel_Data walk; account names are never assumed to be fixed UUIDs.
    bundles, standalone, dependencies = [], [], []
    audit = Counter()
    visited = set()
    for root in roots:
        runner.check()
        if root != roots[0]:
            account_root(boundary, root.parent.name)
        for path in walk_readonly(root, game, lambda exc: error("无法读取资源目录: " + str(exc))):
            runner.check()
            relative = path.relative_to(game).as_posix()
            if relative in visited:
                continue
            visited.add(relative)
            try:
                info = {"path": relative, "signature": signature(path)}
                with path.open("rb") as stream:
                    header = stream.read(16)
                if header.startswith((b"UnityFS\0", b"UnityRaw\0", b"UnityWeb\0")) or path.suffix.lower() == ".assets":
                    bundles.append(info)
                    audit["bundles"] += 1
                elif path.suffix.lower() in (".resource", ".ress"):
                    dependencies.append(info)
                    audit["dependencies"] += 1
                elif header.startswith((b"FSB5", b"FSB4", b"OggS", b"RIFF", b"ID3", b"fLaC")):
                    standalone.append(info)
                    audit["standalone"] += 1
                else:
                    audit["other"] += 1
            except (OSError, ValueError) as exc:
                error(relative + ": " + str(exc))
                audit["unreadable"] += 1
            if len(visited) % 100 == 0:
                progress("scanning", f"已检查 {len(visited):,} 个文件", len(visited), 0)
        if root != roots[0]:
            account_root(boundary, root.parent.name)
    return bundles, standalone, {"counts": dict(audit), "dependencies": dependencies, "accounts": accounts,
                                 "scanMode": scan_mode, "accountDirectories": [d for d in installation["accountDirectories"] if d["name"] in accounts]}


class Importer:
    def __init__(self, game: Path, data: Path, tools: Path, cancel_file: Path | None = None, output=emit, *, scan_mode="all", accounts=None):
        self.boundary = Boundary(game, data)
        self.tools, self.output = tools.resolve(), output
        self.runner = Runner(cancel_file)
        self.media = Media(self.boundary, self.tools, self.runner)
        self.imported = self.duplicates = self.failures = 0
        self.seen = {}
        self.by_payload = {}
        self.errors = []
        self.attempt_errors = []
        if scan_mode not in ("all", "latest"):
            raise ValueError("扫描模式必须为 all 或 latest。")
        self.scan_mode = scan_mode
        self.accounts = validate_accounts(accounts, scan_mode) if accounts is not None else None
        self.phase_seconds = {key: 0.0 for key in ("scan", "fingerprintCache", "extractDecode", "actions")}
        self.active_phase = None
        self.phase_started = time.monotonic()
        self.metrics = dict.fromkeys(("bundleCount", "uniqueBundleTasks", "deduplicatedBundles", "pendingBundleTasks",
                                     "cacheReusedBundles", "sameRunReusedBundles", "extractorCalls", "retries"), 0)
        self.index = {}
        self.bundle_hashes = {}
        self.stages = set()
        self.started = time.time()

    def progress(self, stage: str, message: str, current=0, total=0):
        if stage in ("scanning", "extracting", "decoding", "actions"):
            if self.accounts is None:
                scope = "全部目录" if self.scan_mode == "all" else "最新目录"
            elif not self.accounts:
                scope = "仅公共资源"
            elif self.scan_mode == "latest":
                scope = "最新目录 " + self.accounts[0] + " + 公共资源"
            else:
                scope = f"全部 {len(self.accounts)} 个目录 + 公共资源"
            message = scope + " · " + message
        self.output({"type": "progress", "stage": stage, "message": message, "current": current, "total": total,
                     "imported": self.imported, "duplicates": self.duplicates, "failures": self.failures})

    def error(self, message: str):
        self.failures += 1
        self.errors.append(message)
        self.output({"type": "error", "message": message})

    def attempt_error(self, message: str):
        # A recoverable attempt is diagnostic, not a permanently failed asset.
        self.attempt_errors.append(message)

    def phase(self, name=None):
        now = time.monotonic()
        if self.active_phase is not None:
            self.phase_seconds[self.active_phase] += now - self.phase_started
        self.active_phase, self.phase_started = name, now

    def current_source(self, item: dict):
        self.runner.check()
        # source() rejects redirected ancestors; account roots are separately
        # validated at scan boundaries, avoiding three lstat calls per file.
        source = self.boundary.source(self.boundary.game / item["path"])
        if reparse(source) or signature(source) != item["signature"]:
            raise OSError("游戏资源已发生变化，未绑定来源；请重新扫描。")
        return source

    def stage(self) -> str:
        relative = "cache/staging/" + uuid.uuid4().hex
        self.boundary.mkdir(relative)
        self.stages.add(relative)
        return relative

    def cleanup(self, relative):
        self.boundary.remove_stage(relative)
        self.stages.discard(relative)

    def publish(self, record: dict, cached=False):
        previous = self.seen.get(record["id"])
        if previous:
            sources = {s["key"]: s for s in [*previous["sources"], *record["sources"]]}
            record = {**record, "sources": list(sources.values())}
            self.duplicates += 1
        elif cached:
            self.duplicates += 1
        elif record["status"] == "ready":
            self.imported += 1
        self.seen[record["id"]] = record
        for source in record["sources"]:
            if record["status"] == "ready" and source["payloadHash"]:
                self.by_payload[(record["originalName"], source["payloadHash"])] = record
        self.output({"type": "record", "record": record})

    def source_hash(self, item: dict) -> str:
        relative, fingerprint = item["path"], item["signature"]
        previous = self.index.get(relative)
        if isinstance(previous, dict) and previous.get("signature") == fingerprint and isinstance(previous.get("sha256"), str):
            value = previous["sha256"]
        else:
            path = self.current_source(item)
            value = digest(path)
            if signature(path) != fingerprint:
                raise OSError("扫描时游戏资源已发生变化，请等待游戏更新结束后重新扫描。")
            self.index[relative] = {"signature": fingerprint, "sha256": value}
        canonical = account_parts(relative)[1]
        self.bundle_hashes.setdefault(canonical, set()).add(value)
        return value

    def record(self, asset: dict, stage: str) -> dict:
        source = asset["source"]
        relative = source["bundle"]
        account, canonical = account_parts(relative)
        payload = asset["payload_hash"]
        original = asset["name"]
        identity = [canonical, source["serialized_file"], str(asset["path_id"]), original, payload]
        record_id = stable_hash(["asset-v1", *identity])
        subsound = int(asset.get("source_metadata", {}).get("subsound_index", 0))
        media_cache = "cache/media/" + stable_hash([payload, subsound, self.decoder_key]) + ".json"
        info = read_json(self.boundary.output(media_cache))
        if not valid_media_structure(info) or not self.media.valid(info):
            raw_path = self.boundary.output(Path(stage) / asset["raw_path"])
            if not contained(raw_path, self.boundary.output(stage)) or digest(raw_path) != payload:
                raise ValueError("提取载荷校验失败。")
            metadata = asset.get("source_metadata", {})
            estimated = int(metadata.get("duration_seconds", 0) * metadata.get("sample_rate", 48000) * metadata.get("channels", 2) * 4)
            info = self.media.decode(raw_path, stage, subsound, max(0, estimated))
            self.boundary.json(media_cache, info)
        info = {field: info[field] for field in MEDIA_FIELDS}
        classification = classify(original, payload, source.get("container", ""))
        source_info = {"key": stable_hash([relative, record_id, payload]), "bundle": relative, "account": account, "payloadHash": payload}
        return {"id": record_id, "originalName": original, **classification, **info, "sources": [source_info]}

    def replay(self, cached: dict, item: dict):
        # Rebind origins when the same account-independent cache is reused for
        # another account or after moving/renaming a portable installation.
        account = account_parts(item["path"])[0]
        self.current_source(item)
        for dependency in item.get("dependencies", []):
            self.current_source(dependency)
        for original in cached["records"]:
            self.runner.check()
            record = copy.deepcopy(original)
            for source in record["sources"]:
                source.update(bundle=item["path"], account=account)
                source["key"] = stable_hash([item["path"], record["id"], source["payloadHash"]])
            self.publish(record, cached=True)

    def bundle_cache(self, item: dict):
        cached = read_json(self.boundary.output(item["cache"]))
        if not isinstance(cached, dict) or cached.get("version") != ENGINE_VERSION or not isinstance(cached.get("records"), list):
            return None
        for record in cached["records"]:
            self.runner.check()
            if not valid_record_structure(record) or not self.media.valid(record):
                return None
        # Empty records is a valid completed bundle that contains no audio.
        return cached

    def bundle_batch(self, batch: list[dict]):
        stage = self.stage()
        try:
            self.extract_batch(batch, stage)
        finally:
            self.cleanup(stage)

    def extract_batch(self, batch: list[dict], stage: str):
        inputs = [str(self.current_source(item)) for item in batch]
        input_file = self.boundary.json(Path(stage) / "inputs.json", inputs)
        executable = self.tools / "importer" / ("AudioInventory.exe" if os.name == "nt" else "AudioInventory")
        self.metrics["extractorCalls"] += 1
        result = self.runner.run([str(executable), str(input_file), str(self.boundary.game), str(self.boundary.output(stage))], timeout=600)
        try:
            document = json.loads(result.stdout.decode("utf-8-sig"))
            if not isinstance(document.get("assets"), list) or not isinstance(document.get("inputs"), list):
                raise ValueError("Invalid importer result")
            if (any(not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("loaded"), bool) for item in document["inputs"])
                    or any(not isinstance(asset, dict) or not isinstance(asset.get("source"), dict) for asset in document["assets"])):
                raise ValueError("Invalid importer entries")
        except (ValueError, UnicodeError, AttributeError) as exc:
            raise ValueError("Unity 提取器返回了无效的数据。") from exc
        parse_errors = [line for line in document.get("log", []) if isinstance(line, str) and line.lower().startswith("error")]
        if parse_errors:
            # AssetStudio can load a serialized file while failing individual
            # object constructors. Treat those logged errors as extraction
            # failure, not as an apparently successful zero-audio bundle.
            raise RuntimeError("Unity 资源解析失败: " + " | ".join(parse_errors[:3])[-1800:])
        grouped = defaultdict(list)
        for asset in document["assets"]:
            grouped[asset.get("source", {}).get("bundle")].append(asset)
        loaded = {x["path"]: x["loaded"] for x in document["inputs"]}
        for item in batch:
            self.runner.check()
            relative = item["path"]
            try:
                self.current_source(item)
                for dependency in item.get("dependencies", []):
                    self.current_source(dependency)
            except (OSError, ValueError) as exc:
                self.attempt_error(relative + ": " + str(exc))
                continue
            if not loaded.get(relative):
                self.attempt_error(relative + ": Unity 资源未能加载。")
                continue
            records, failed = [], False
            for asset in grouped.get(relative, []):
                self.runner.check()
                try:
                    if asset.get("status") != "success":
                        raise ValueError(asset.get("error", "载荷提取失败"))
                    self.progress("decoding", "解码 · " + asset["name"], self.bundle_current, self.bundle_total)
                    record = self.record(asset, stage)
                    records.append(record)
                    self.publish(record)
                except (OSError, ValueError, RuntimeError, KeyError) as exc:
                    failed = True
                    self.attempt_error(asset.get("name", relative) + ": " + str(exc))
            if not failed:
                self.current_source(item)
                for dependency in item.get("dependencies", []):
                    self.current_source(dependency)
                self.boundary.json(item["cache"], {"version": ENGINE_VERSION, "records": records})

    def import_bundles(self, bundles, dependencies):
        self.phase("fingerprintCache")
        self.metrics["bundleCount"] = len(bundles)
        dependency_key = []
        dependency_accounts = set()
        for item in dependencies:
            self.runner.check()
            dependency_key.append([account_parts(item["path"])[1], self.source_hash(item)])
            if account_parts(item["path"])[0]:
                dependency_accounts.add(account_parts(item["path"])[0])
        groups = {}
        self.bundle_total = len(bundles)
        self.bundle_current = 0
        for index, item in enumerate(bundles):
            self.runner.check()
            self.bundle_current = index + 1
            try:
                value = self.source_hash(item)
                account, canonical = account_parts(item["path"])
                if account and dependency_accounts:
                    relevant = [(dep, key) for dep, key in zip(dependencies, dependency_key) if account_parts(dep["path"])[0] in ("", account)]
                    item["dependencies"] = [dep for dep, _ in relevant]
                    key = stable_hash(["account-dependencies-v1", ENGINE_VERSION, account, canonical, value,
                                       [key for _, key in relevant], self.decoder_key])
                else:
                    # Exact 1.0.0 key shape remains valid for ordinary bundles.
                    item["dependencies"] = dependencies
                    key = stable_hash([ENGINE_VERSION, canonical, value, dependency_key, self.decoder_key])
                item["cache"] = "cache/bundles/" + key + ".json"
                groups.setdefault(item["cache"], []).append(item)
            except (OSError, ValueError) as exc:
                self.error(item["path"] + ": " + str(exc))
            if index % 100 == 0:
                self.progress("extracting", "检查资源指纹与增量缓存", index + 1, len(bundles))
        self.metrics["uniqueBundleTasks"] = len(groups)
        self.metrics["deduplicatedBundles"] = sum(len(items) - 1 for items in groups.values())
        pending = defaultdict(list)
        for items in groups.values():
            self.runner.check()
            cached = self.bundle_cache(items[0])
            if cached is not None:
                for item in items:
                    try:
                        self.replay(cached, item)
                        self.metrics["cacheReusedBundles"] += 1
                    except (OSError, ValueError) as exc:
                        self.error(item["path"] + ": " + str(exc))
            else:
                pending[str(Path(items[0]["path"]).parent)].append(items[0])
        # Fingerprints are complete before extraction starts. Persist once for
        # resume instead of rewriting the same large index every ten batches.
        self.save_index()
        self.phase("extractDecode")
        batches = []
        for items in pending.values():
            batch, size = [], 0
            for item in items:
                if batch and (len(batch) >= BATCH_SIZE or size + item["signature"][0] > 256 * 1024 * 1024):
                    batches.append(batch)
                    batch, size = [], 0
                batch.append(item)
                size += item["signature"][0]
            if batch:
                batches.append(batch)
        self.bundle_total = sum(len(batch) for batch in batches)
        self.metrics["pendingBundleTasks"] = self.bundle_total
        self.bundle_current = 0
        for index, batch in enumerate(batches):
            self.runner.check()
            self.progress("extracting", f"提取去重后的资源 · {self.bundle_current:,} / {self.bundle_total:,} 个任务（原始 {len(bundles):,} 个资源包）", self.bundle_current, self.bundle_total)
            try:
                ensure_space(self.boundary.data, sum(item["signature"][0] for item in batch))
                self.bundle_batch(batch)
            except (OSError, ValueError, RuntimeError) as exc:
                self.attempt_error("提取批次失败: " + str(exc))
            for representative in batch:
                self.runner.check()
                items = groups[representative["cache"]]
                successful = representative
                # A batch may have committed some members before failing.
                # Their valid caches are authoritative; never extract again.
                cached = self.bundle_cache(representative)
                if cached is None:
                    for candidate in items:
                        self.runner.check()
                        self.metrics["retries"] += 1
                        try:
                            ensure_space(self.boundary.data, candidate["signature"][0])
                            self.bundle_batch([candidate])
                        except (OSError, ValueError, RuntimeError) as exc:
                            self.attempt_error(candidate["path"] + ": " + str(exc))
                        self.runner.check()
                        cached = self.bundle_cache(candidate)
                        if cached is not None:
                            successful = candidate
                            break
                if cached is None:
                    self.error(representative["path"] + f": {len(items)} 份等价资源均未完成提取；可重新扫描重试。")
                else:
                    for item in items:
                        self.runner.check()
                        if item is successful:
                            continue
                        try:
                            self.replay(cached, item)
                            self.metrics["sameRunReusedBundles"] += 1
                        except (OSError, ValueError) as exc:
                            self.error(item["path"] + ": " + str(exc))
            self.bundle_current += len(batch)
        self.phase()

    def import_standalone(self, files):
        for index, item in enumerate(files):
            self.runner.check()
            stage = self.stage()
            try:
                source = self.boundary.source(self.boundary.game / item["path"])
                payload = self.source_hash(item)
                key = stable_hash([ENGINE_VERSION, account_parts(item["path"])[1], payload, self.decoder_key])
                cached_path = "cache/standalone/" + key + ".json"
                cached = read_json(self.boundary.output(cached_path))
                if (isinstance(cached, dict) and cached.get("version") == ENGINE_VERSION
                        and isinstance(cached.get("records"), list) and cached["records"]
                        and all(valid_record_structure(record) and self.media.valid(record) for record in cached["records"])):
                    self.replay(cached, item)
                    continue
                raw = self.boundary.output(Path(stage) / ("raw" + source.suffix))
                shutil.copyfile(source, raw)
                if signature(source) != item["signature"] or digest(raw) != payload:
                    raise ValueError("复制时源文件变化。")
                record = self.record({"name": source.stem, "path_id": "standalone", "payload_hash": payload, "raw_path": raw.name,
                                      "source": {"bundle": item["path"], "serialized_file": source.name, "container": ""}}, stage)
                self.publish(record)
                self.boundary.json(cached_path, {"version": ENGINE_VERSION, "records": [record]})
            except (OSError, ValueError, RuntimeError) as exc:
                self.error(item["path"] + ": " + str(exc))
            finally:
                self.cleanup(stage)
            self.progress("decoding", "导入独立音频", index + 1, len(files))

    def version_matches(self, recipe_data):
        for lock in recipe_data["locks"]:
            self.runner.check()
            path = self.boundary.game / lock["path"]
            try:
                self.boundary.source(path)
                if not path.is_file() or digest(path) != lock["sha256"]:
                    return False
            except (OSError, ValueError):
                return False
        return True

    def build_actions(self):
        configuration = read_json(RULES_ROOT / "recipes.json")
        compatible = self.version_matches(configuration)
        timeline_compatible = all(lock["sha256"] in self.bundle_hashes.get(lock["path"], set()) for lock in configuration.get("timelineLocks", []))
        recipes = configuration["recipes"]
        for index, recipe in enumerate(recipes):
            self.runner.check()
            self.progress("actions", "整理动作 · " + recipe["title"], index + 1, len(recipes))
            record = {"id": recipe["id"], "originalName": recipe["name"], "title": recipe["title"], "kind": "sfx", "form": recipe["form"],
                      "category": recipe["category"], "tags": recipe["tags"], "description": recipe["description"],
                      "mediaId": None, "relativePath": None, "bytes": 0, "duration": 0, "sampleRate": 0, "channels": 0, "peaks": [], "sources": [], "status": "unavailable"}
            needs_timelines = any(f"event_{family}_summon_" in recipe["id"] for family in ("fusion", "ritual", "synchro", "pendulum"))
            components = [self.by_payload.get((c["name"], c["rawHash"])) for c in recipe["components"]]
            if not compatible or (needs_timelines and not timeline_compatible):
                record["description"] = "当前游戏版本与已验证配方不匹配，暂不可生成。" + record["description"]
            elif not components or any(c is None for c in components):
                record["description"] = "所需素材尚未下载、导入失败或素材版本不匹配，暂不可生成。" + record["description"]
            elif recipe["alias"]:
                source = components[0]
                record.update({key: source[key] for key in ("mediaId", "relativePath", "bytes", "duration", "sampleRate", "channels", "peaks", "status")})
                # Aliases share physical media but do not pretend to originate
                # a second independent recording of the same attribute layer.
                record["sources"] = [{**s, "key": stable_hash([recipe["id"], s["key"]])} for s in source["sources"]]
            else:
                cache_key = stable_hash([ENGINE_VERSION, recipe, [c["mediaId"] for c in components], self.decoder_key])
                cached = read_json(self.boundary.output("cache/actions/" + cache_key + ".json"))
                try:
                    if valid_media_structure(cached) and self.media.valid(cached):
                        record.update({field: cached[field] for field in MEDIA_FIELDS})
                    else:
                        stage = self.stage()
                        try:
                            record.update(self.media.mix(recipe, components, stage))
                            self.boundary.json("cache/actions/" + cache_key + ".json", {k: record[k] for k in ("mediaId", "relativePath", "bytes", "duration", "sampleRate", "channels", "peaks", "status")})
                        finally:
                            self.cleanup(stage)
                    source_map = {s["key"]: s for c in components for s in c["sources"]}
                    record["sources"] = [{**s, "key": stable_hash([recipe["id"], s["key"]])} for s in source_map.values()]
                except (OSError, ValueError, RuntimeError) as exc:
                    record["status"] = "failed"
                    record["description"] = str(exc) + " " + record["description"]
                    self.error(recipe["title"] + ": " + str(exc))
            self.publish(record)

    def save_index(self):
        self.boundary.json("cache/source-index.json", self.index)

    def run(self):
        cancelled = fatal = False
        self.boundary.mkdir("cache/staging")
        self.boundary.mkdir("assets/audio")
        self.index = read_json(self.boundary.output("cache/source-index.json"), {})
        if not isinstance(self.index, dict):
            self.index = {}
        try:
            # Missing binaries are reported once, before any large scan starts.
            executables = [self.media.ffmpeg, self.media.vgmstream, str(self.tools / "importer" / ("AudioInventory.exe" if os.name == "nt" else "AudioInventory"))]
            for executable in executables:
                if not Path(executable).is_file():
                    raise FileNotFoundError("缺少播放器组件: " + Path(executable).name + "。请重新解压完整发行包。")
            self.decoder_key = stable_hash([[Path(p).name, digest(Path(p))] for p in executables])
            self.phase("scan")
            if self.accounts is None:
                installation = inspect(self.boundary.game)
                if installation["selectionError"]:
                    raise ValueError(installation["selectionError"])
                self.accounts = installation["accounts"] if self.scan_mode == "all" else ([installation["latestAccount"]] if installation["latestAccount"] else [])
            self.progress("scanning", "已固定账号：" + "、".join(self.accounts) if self.scan_mode == "all" and self.accounts else "开始扫描")
            bundles, standalone, audit = scan(self.boundary, self.runner, self.progress, self.error, self.scan_mode, self.accounts)
            self.boundary.json("cache/last-scan.json", {"version": REPORT_VERSION, **audit, "bundleCount": len(bundles), "standaloneCount": len(standalone)})
            self.import_bundles(bundles, audit["dependencies"])
            self.phase("extractDecode")
            self.import_standalone(standalone)
            for account in self.accounts:
                account_root(self.boundary, account)
            self.save_index()
            self.phase("actions")
            self.build_actions()
        except Cancelled:
            cancelled = True
        except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
            fatal = True
            self.error(str(exc))
        finally:
            self.phase()
            for stage in list(self.stages):
                try:
                    self.cleanup(stage)
                except (OSError, ValueError) as exc:
                    self.error("暂存清理失败: " + str(exc))
            try:
                self.save_index()
                self.boundary.json("cache/last-import.json", {"version": REPORT_VERSION, "cacheVersion": ENGINE_VERSION,
                                                              "scanMode": self.scan_mode, "accounts": self.accounts or [],
                                                              "phaseSeconds": {name: round(value, 4) for name, value in self.phase_seconds.items()}, **self.metrics,
                                                              "imported": self.imported, "duplicates": self.duplicates,
                                                              "failures": self.failures, "cancelled": cancelled, "elapsed": round(time.time() - self.started, 2),
                                                              "errors": self.errors, "attemptErrors": self.attempt_errors, "logicalRecords": len(self.seen)})
            except (OSError, ValueError) as exc:
                self.error(str(exc))
            stage = "cancelled" if cancelled else "failed" if fatal else "complete"
            self.progress(stage, "已取消；已完成的资产保留，可继续扫描。" if cancelled else "导入失败；已完成的资产保留。" if fatal else "导入完成", len(self.seen), len(self.seen))
            self.output({"type": "done", "imported": self.imported, "duplicates": self.duplicates, "failures": self.failures, "cancelled": cancelled})
        return 1 if fatal else 0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="MD audio import engine")
    subcommands = parser.add_subparsers(dest="command", required=True)
    check = subcommands.add_parser("inspect")
    check.add_argument("--game", type=Path, required=True)
    command = subcommands.add_parser("import")
    command.add_argument("--game", type=Path, required=True)
    command.add_argument("--data", type=Path, required=True)
    command.add_argument("--tools", type=Path, required=True)
    command.add_argument("--cancel-file", type=Path)
    command.add_argument("--scan-mode", choices=("all", "latest"), default="all")
    command.add_argument("--accounts-json", help="Frozen JSON account-name array; [] selects public resources only")
    args = parser.parse_args()
    if args.command == "inspect":
        emit(inspect(args.game))
        return 0
    try:
        accounts = json.loads(args.accounts_json) if args.accounts_json is not None else None
        if args.accounts_json is not None:
            accounts = validate_accounts(accounts, args.scan_mode)
        return Importer(args.game, args.data, args.tools, args.cancel_file, scan_mode=args.scan_mode, accounts=accounts).run()
    except (OSError, ValueError) as exc:
        emit({"type": "error", "message": str(exc)})
        emit({"type": "done", "imported": 0, "duplicates": 0, "failures": 1, "cancelled": False})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
