"""Filesystem boundaries shared by the scanner, cache and audio workers."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import uuid


def contained(path: Path, root: Path) -> bool:
    # resolve() follows junctions on Windows, including existing ancestors of a
    # not-yet-created leaf. normcase also enforces Windows case insensitivity.
    child = os.path.normcase(str(path.resolve()))
    parent = os.path.normcase(str(root.resolve()))
    try:
        return os.path.commonpath((child, parent)) == parent
    except ValueError:
        return False


def reparse(path: Path) -> bool:
    info = path.lstat()
    return path.is_symlink() or bool(getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


class Boundary:
    def __init__(self, game: Path, data: Path):
        self.game = game.resolve()
        self.data = data.resolve()
        if contained(self.game, self.data) or contained(self.data, self.game):
            raise ValueError("播放器资料目录与游戏目录不能重叠，请移动播放器后重试。")
        self._game_key = os.path.normcase(str(self.game))
        self._data_key = os.path.normcase(str(self.data))

    @staticmethod
    def _inside(path: str, root: str) -> bool:
        return path == root or path.startswith(root.rstrip(os.sep) + os.sep)

    def output(self, relative: str | Path) -> Path:
        relative = Path(relative)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("拒绝越界的资产路径。")
        target = self.data / relative
        resolved = os.path.normcase(str(target.resolve()))
        if not self._inside(resolved, self._data_key) or self._inside(resolved, self._game_key):
            raise ValueError("拒绝写入游戏目录或资料目录外部（包括目录联接）。")
        # Reject links even if they resolve back inside the data directory;
        # this prevents aliasing cache files and replacements through links.
        if resolved != os.path.normcase(str(target)):
            raise ValueError("资料路径不能包含符号链接或目录联接。")
        return target

    def source(self, path: Path) -> Path:
        resolved = os.path.normcase(str(path.resolve()))
        if not self._inside(resolved, self._game_key):
            raise ValueError("游戏资源路径越界。")
        if resolved != os.path.normcase(str(path.absolute())):
            raise ValueError("跳过游戏中的符号链接或目录联接。")
        return path

    def mkdir(self, relative: str | Path) -> Path:
        path = self.output(relative)
        path.mkdir(parents=True, exist_ok=True)
        return self.output(relative)

    def json(self, relative: str | Path, value) -> Path:
        path = self.output(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
        self.output(temporary.relative_to(self.data))
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.output(relative))
        return path

    def remove_stage(self, relative: str | Path):
        path = self.output(relative)
        stage_root = self.output("cache/staging")
        if path == stage_root or not contained(path, stage_root):
            raise ValueError("拒绝删除暂存目录以外的文件。")
        if path.exists():
            # No traversal is permitted through a reparse point in cleanup.
            for directory, dirs, files in os.walk(path, followlinks=False):
                for name in dirs + files:
                    if reparse(Path(directory) / name):
                        raise ValueError("暂存目录含有目录联接，已停止清理。")
            shutil.rmtree(path)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def signature(path: Path) -> list[int]:
    info = path.stat()
    return [info.st_size, info.st_mtime_ns]


def read_json(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, UnicodeError):
        return fallback


def stable_hash(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def account_parts(relative: str) -> tuple[str, str]:
    parts = relative.replace("\\", "/").split("/")
    if len(parts) >= 3 and parts[0].lower() == "localdata" and parts[2] == "0000":
        return parts[1], "/".join(["LocalData", "{account}", *parts[2:]])
    return "", "/".join(parts)
