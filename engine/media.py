"""Cancellable decoders, full-sample waveform envelopes and verified mixing."""
from __future__ import annotations

from array import array
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import wave

from safety import Boundary, digest


class Cancelled(Exception):
    pass


class Runner:
    def __init__(self, cancel_file: Path | None = None):
        self.cancel_file = cancel_file

    def check(self):
        if self.cancel_file and self.cancel_file.exists():
            raise Cancelled()

    def run(self, command: list[str], *, timeout: int = 300, cwd: Path | None = None) -> subprocess.CompletedProcess:
        import time
        self.check()
        child = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        started = time.monotonic()
        try:
            while True:
                self.check()
                if time.monotonic() - started > timeout:
                    raise RuntimeError(f"{Path(command[0]).name} 超时，资源可在重新扫描时重试。")
                try:
                    out, err = child.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    continue
        except BaseException:
            child.kill()
            child.communicate()
            raise
        if child.returncode:
            raise RuntimeError(f"{Path(command[0]).name} 退出 {child.returncode}: " + (err or out).decode("utf-8", errors="replace")[-1500:])
        return subprocess.CompletedProcess(command, child.returncode, out, err)


def ensure_space(destination: Path, expected: int = 0):
    if shutil.disk_usage(destination).free < max(32 * 1024 * 1024, expected * 2 + 16 * 1024 * 1024):
        raise OSError("播放器所在磁盘空间不足；已完成的资料保留，释放空间后可继续扫描。")


def wav_metadata(path: Path, runner: Runner, bins: int = 240) -> dict:
    """Envelope is max absolute amplitude of every sample, not synthetic bars."""
    with wave.open(str(path), "rb") as audio:
        frames, channels, rate, width = audio.getnframes(), audio.getnchannels(), audio.getframerate(), audio.getsampwidth()
        if frames <= 0 or not 1 <= channels <= 32 or not 1000 <= rate <= 768000 or width not in (1, 2, 3, 4):
            raise ValueError("WAV 音频参数无效或解码为空。")
        peaks = []
        read_frames = 0
        for index in range(bins):
            runner.check()
            count = (frames * (index + 1)) // bins - (frames * index) // bins
            block = audio.readframes(count)
            if len(block) != count * channels * width:
                raise ValueError("WAV 载荷截断，未提交此音频。")
            read_frames += count
            if not block:
                peaks.append(0.0)
                continue
            if width == 1:
                peak = max(abs(v - 128) for v in block) / 128
            elif width in (2, 4):
                values = array("h" if width == 2 else "i")
                values.frombytes(block)
                if sys.byteorder != "little":
                    values.byteswap()
                peak = max(abs(min(values)), abs(max(values))) / (2 ** (width * 8 - 1))
            else:
                low = high = 0
                for offset in range(0, len(block), 3):
                    value = int.from_bytes(block[offset:offset + 3], "little", signed=True)
                    low, high = min(low, value), max(high, value)
                peak = max(-low, high) / 8388608
            peaks.append(round(min(1.0, peak), 6))
        assert read_frames == frames
        return {"duration": frames / rate, "sampleRate": rate, "channels": channels, "peaks": peaks}


class Media:
    def __init__(self, boundary: Boundary, tools: Path, runner: Runner):
        self.boundary, self.runner = boundary, runner
        suffix = ".exe" if os.name == "nt" else ""
        self.ffmpeg = str(tools / "ffmpeg" / ("ffmpeg" + suffix))
        self.ffprobe = str(tools / "ffmpeg" / ("ffprobe" + suffix))
        self.vgmstream = str(tools / "vgmstream" / ("vgmstream-cli" + suffix))
        self.verified: set[str] = set()

    def valid(self, record: dict) -> bool:
        try:
            media_id = record["mediaId"]
            if not re.fullmatch(r"[0-9a-f]{64}", media_id or ""):
                return False
            expected = f"assets/audio/{media_id}.wav"
            if record["relativePath"] != expected:
                return False
            path = self.boundary.output(expected)
            if not path.is_file() or path.stat().st_size != record["bytes"]:
                return False
            if media_id not in self.verified:
                if digest(path) != media_id:
                    return False
                self.verified.add(media_id)
            return True
        except (OSError, KeyError, ValueError, TypeError):
            return False

    def commit(self, wav: Path) -> dict:
        try:
            info = wav_metadata(wav, self.runner)
        except (wave.Error, EOFError) as exc:
            raise ValueError("解码后的 WAV 格式损坏: " + str(exc)) from exc
        media_id = digest(wav)
        relative = f"assets/audio/{media_id}.wav"
        destination = self.boundary.output(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and digest(destination) == media_id:
            wav.unlink()
        else:
            self.runner.check()
            os.replace(wav, destination)
        self.verified.add(media_id)
        return {**info, "mediaId": media_id, "relativePath": relative, "bytes": destination.stat().st_size, "status": "ready"}

    def decode(self, raw: Path, stage_relative: str, subsound: int = 0, expected: int = 0) -> dict:
        ensure_space(self.boundary.data, expected)
        destination = self.boundary.output(Path(stage_relative) / "decoded.wav")
        with raw.open("rb") as stream:
            header = stream.read(4)
        if header == b"RIFF":
            # Preserve native sample rate / channels / source bits on direct WAV.
            shutil.copyfile(raw, destination)
        elif header in (b"FSB5", b"FSB4"):
            # vgmstream's C CLI uses ANSI argv on Windows. The OS accepts a
            # Unicode working directory; ASCII relative names then open safely
            # inside it even when the portable app is in a Chinese-named path.
            stage_root = self.boundary.output(stage_relative)
            command = [self.vgmstream, "-i", "-o", destination.name]
            if subsound > 0:
                command.extend(["-s", str(subsound + 1)])
            command.append(raw.relative_to(stage_root).as_posix())
            self.runner.run(command, cwd=stage_root)
        else:
            self.runner.run([self.ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(raw), "-map", "0:a:0", "-vn", "-c:a", "pcm_s24le", str(destination)])
        return self.commit(destination)

    def peak(self, path: Path) -> float:
        measured = self.runner.run([self.ffmpeg, "-nostdin", "-v", "info", "-i", str(path), "-af",
                                    "aformat=sample_fmts=dblp,aresample=192000:filter_size=64:phase_shift=10:cutoff=1,astats=metadata=0:reset=0",
                                    "-c:a", "pcm_f64le", "-f", "null", "-"])
        peaks = [float(x) for x in re.findall(r"Peak level dB:\s+(-?[\d.]+)", measured.stderr.decode("utf-8", errors="replace"))]
        if not peaks and b"Peak level dB: -inf" not in measured.stderr:
            raise ValueError("无法验证动作混音峰值。")
        return max(peaks, default=-math.inf)

    def mix(self, recipe: dict, records: list[dict], stage_relative: str) -> dict:
        ensure_space(self.boundary.data, max(1, recipe.get("minimumSamples", 0)) * 32)
        stage = self.boundary.mkdir(stage_relative)
        mix = self.boundary.output(Path(stage_relative) / "mixed.wav")
        output = self.boundary.output(Path(stage_relative) / "decoded.wav")
        args = [self.ffmpeg, "-nostdin", "-v", "error", "-y"]
        filters = []
        for index, (component, record) in enumerate(zip(recipe["components"], records, strict=True)):
            args.extend(["-i", str(self.boundary.output(record["relativePath"]))])
            pitch = round(48000 * 2 ** (component.get("pitch", 0) / 1200))
            steps = ["aresample=48000", "aformat=sample_fmts=dblp:channel_layouts=stereo"]
            if pitch != 48000:
                steps.extend([f"asetrate={pitch}", "aresample=48000"])
            steps.append(f"volume={component.get('gain', 1):.14g}:precision=double")
            if "end" in component:
                count = component["end"] - component["start"]
                if count <= 0:
                    raise ValueError("动作配方的结束时间无效。")
                steps.append(f"atrim=end_sample={count}")
            steps.extend(["asetpts=PTS-STARTPTS", f"adelay={component['start']}S:all=1"])
            filters.append(f"[{index}:a]" + ",".join(steps) + f"[c{index}]")
        labels = "".join(f"[c{i}]" for i in range(len(records)))
        final = f"{labels}amix=inputs={len(records)}:duration=longest:dropout_transition=0:normalize=0"
        if recipe.get("minimumSamples", 0) > 0:
            final += f",apad=whole_len={recipe['minimumSamples']}"
        filters.append(final + "[out]")
        # A filter script avoids the Windows command-line length limit for
        # long, repeated chains. It contains only trusted bundled recipe data.
        script = self.boundary.output(Path(stage_relative) / "mix-filter.txt")
        script.write_text(";\n".join(filters), encoding="utf-8")
        args.extend(["-filter_complex_script", str(script), "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_f64le", str(mix)])
        self.runner.run(args)
        peak = self.peak(mix)
        gain = -1.1 - peak if peak > -1.0 else 0.0
        self.runner.run([self.ffmpeg, "-nostdin", "-v", "error", "-y", "-i", str(mix), "-af", f"volume={gain:.8f}dB:precision=double",
                         "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", str(output)])
        if self.peak(output) > -1.0:
            raise ValueError("动作最终 WAV 的过采样峰值超过 -1 dBFS，未提交音频。")
        return self.commit(output)
