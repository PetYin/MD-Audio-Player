"""Independent full-import audit; run against private local assets, never ship them.

python engine/tests/audit_import.py --game ... --data ... --events ...
Optional --reference-assets compares original-name/raw-SHA coverage with an
independent inventory. The report contains aggregate results, no game content.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from safety import Boundary, digest, read_json, signature


def audit(game: Path, data: Path, events: Path, reference: Path | None = None, reference_events: Path | None = None):
    boundary = Boundary(game, data)
    records, done, errors = {}, None, []
    for line in events.read_text(encoding="utf-8-sig").splitlines():
        event = json.loads(line)
        if event["type"] == "record":
            records[event["record"]["id"]] = event["record"]
        elif event["type"] == "done":
            done = event
        elif event["type"] == "error":
            errors.append(event["message"])
    source_index = read_json(boundary.output("cache/source-index.json"), {})
    def check_source(item):
        relative, expected = item
        path = boundary.source(boundary.game / relative)
        return relative if signature(path) != expected["signature"] or digest(path) != expected["sha256"] else None
    with ThreadPoolExecutor(max_workers=4) as executor:
        source_changed = [value for value in executor.map(check_source, source_index.items()) if value]
    ready = [r for r in records.values() if r["status"] == "ready"]
    failed_records = [r["id"] for r in records.values() if r["status"] == "failed"]
    media = {r["mediaId"]: r for r in ready}
    def check_media(item):
        media_id, record = item
        path = boundary.output(record["relativePath"])
        return media_id if path.stat().st_size != record["bytes"] or digest(path) != media_id else None
    with ThreadPoolExecutor(max_workers=4) as executor:
        media_changed = [value for value in executor.map(check_media, media.items()) if value]
    invalid_waveforms = [r["id"] for r in ready if len(r["peaks"]) != 240 or any(not 0 <= p <= 1 for p in r["peaks"]) or r["duration"] <= 0]
    coverage, scenarios, derived_coverage = {}, {}, {}
    if reference:
        inventory = [a for a in read_json(reference)["assets"] if a.get("status") == "success" and a.get("raw_sha256")]
        expected = {(a["name"], a["raw_sha256"]) for a in inventory}
        actual_map = {(r["originalName"], s["payloadHash"]): r for r in ready if not r["id"].startswith("event_") for s in r["sources"]}
        actual = set(actual_map)
        differences = []
        for original in inventory:
            record = actual_map.get((original["name"], original["raw_sha256"]))
            if record is None:
                continue
            audio = original.get("audio", {}).get("source", {}).get("audio", {})
            rate = audio.get("sample_rate", original["source_metadata"]["sample_rate"])
            channels = audio.get("channels", original["source_metadata"]["channels"])
            duration = audio.get("duration_seconds", original["source_metadata"]["duration_seconds"])
            if rate != record["sampleRate"] or channels != record["channels"] or abs(duration - record["duration"]) > 4 / rate:
                differences.append({"name": original["name"], "expected": [rate, channels, duration], "actual": [record["sampleRate"], record["channels"], record["duration"]]})
        coverage = {"referenceRecords": len(inventory), "expected": len(expected), "actual": len(actual), "matched": len(expected & actual),
                    "missing": sorted(expected - actual), "additional": sorted(actual - expected), "metadataDifferences": differences}
        music = [a for a in inventory if a.get("kind") == "音乐"]
        voice = [a for a in inventory if a.get("kind") == "语音"]
        loops = [a for a in inventory if "TRUE" in a.get("loop", {}).get("label_loop_modes", [])]
        def sample(items):
            if not items:
                return None
            original = max(items, key=lambda a: a["source_metadata"]["duration_seconds"])
            record = actual_map.get((original["name"], original["raw_sha256"]))
            return {"name": original["name"], "ready": bool(record), "duration": record["duration"] if record else None,
                    "sampleRate": record["sampleRate"] if record else None, "channels": record["channels"] if record else None}
        scenarios = {"longMusic": sample(music), "voice": sample(voice),
                     "loopLabelledSourceCount": len(loops), "loopLabelledSourcesImported": sum((a["name"], a["raw_sha256"]) in actual for a in loops),
                     "loopNote": "Reference game label marks these sources looping; import decodes one complete pass. UI looping is tested separately.",
                     "completeActions": sum(r["form"] == "完整动作" for r in ready), "actionBodies": sum(r["form"] == "动作主体" for r in ready),
                     "cardAliases": sum(r["id"].startswith("event_card_cutin_") for r in ready)}
    rules = read_json(Path(__file__).resolve().parents[1] / "rules/recipes.json")
    version_matches = all((boundary.game / lock["path"]).is_file() and digest(boundary.source(boundary.game / lock["path"])) == lock["sha256"] for lock in rules["locks"])
    if reference_events:
        expected_events = {e["id"] for e in read_json(reference_events)["events"] if e.get("status") == "success"}
        actual_events = {r["id"] for r in ready if r["id"].startswith("event_")}
        derived_coverage = {"referenceEvents": len(expected_events), "matched": len(expected_events & actual_events),
                            "missing": sorted(expected_events - actual_events), "additional": sorted(actual_events - expected_events)}
    else:
        expected_events = {e["id"] for e in rules["recipes"]}
        actual_events = {r["id"] for r in ready if r["id"].startswith("event_")}
        derived_coverage = {"recipeEvents": len(expected_events), "matched": len(expected_events & actual_events),
                            "missing": sorted(expected_events - actual_events), "additional": sorted(actual_events - expected_events)}
    return {
        "passed": bool(done) and done["failures"] == 0 and not done["cancelled"] and not errors and not failed_records and not source_changed and not media_changed and not invalid_waveforms and not coverage.get("missing") and not coverage.get("metadataDifferences") and (not version_matches or not derived_coverage["missing"]),
        "logicalRecords": len(records), "recordStates": dict(Counter(r["status"] for r in records.values())),
        "readyForms": dict(Counter(r["form"] for r in ready)), "readyKinds": dict(Counter(r["kind"] for r in ready)),
        "uniqueMedia": len(media), "assetBytes": sum(r["bytes"] for r in media.values()),
        "checkedSourceFiles": len(source_index), "sourceChanges": source_changed, "mediaHashFailures": media_changed,
        "invalidWaveforms": invalid_waveforms, "failedRecords": failed_records, "coverage": coverage, "derivedCoverage": derived_coverage, "recipeVersionMatches": version_matches,
        "scenarios": scenarios, "errors": errors, "done": done,
        "validationMethods": {
            "realGame": "Native AssetStudio + vgmstream import from the actual installation; filesystem sandbox grants no game-directory writes.",
            "sourceIntegrity": "SHA-256 and size/mtime of every scanned bundle/dependency compared with the pre-extraction source index.",
            "realProcesses": ["genuine Unity/Vorbis packaged-engine fixture in a renamed account and Chinese path", "synthetic PCM FSB5 through real vgmstream", "FFmpeg overlapping high-gain sample mix and final peak verification", "running child-process cancellation"],
            "realFilesystem": ["Windows junction write-boundary rejection", "source junction skipping", "renamed accounts", "portable-directory move", "same-size media corruption repair", "truncated WAV"],
            "injectedFailures": ["disk_usage returning no free space", "importer AudioClip extraction failure result", "importer logged object parse failure result"],
            "desktopPlayback": "Validated by separate Electron desktop test report; this audit does not substitute for interactive playback.",
        },
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--events", type=Path, required=True)
    parser.add_argument("--reference-assets", type=Path)
    parser.add_argument("--reference-events", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit(args.game, args.data, args.events, args.reference_assets, args.reference_events)
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    print(text)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
