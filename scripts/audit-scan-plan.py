"""Read-only historical-index scheduling audit, not an extraction benchmark.

Only the JSON report destination is written. No supplied source/cache is changed.
python scripts/audit-scan-plan.py --cache <1.0.0-player/cache> --output <report.json>
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from safety import account_parts, stable_hash


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def audit(cache: Path):
    inputs = [cache / name for name in ("source-index.json", "last-scan.json", "last-import.json")]
    before = {path.name: sha256(path) for path in inputs}
    index, scan, imported = [json.loads(path.read_text(encoding="utf-8-sig")) for path in inputs]
    dependencies = {item["path"] for item in scan["dependencies"]}
    assert all(not account_parts(name)[0] for name in dependencies), "Account dependencies require account-isolated cache grouping; this audit expects the historical public-only dependency set."
    dependency_key = [[account_parts(item["path"])[1], index[item["path"]]["sha256"]] for item in scan["dependencies"]]
    bundles = {name: item for name, item in index.items() if name not in dependencies}
    assert len(bundles) == scan["bundleCount"], "Index cannot establish bundle identities without exact scan/index coverage."
    assert scan["standaloneCount"] == 0, "This historical-index audit requires a bundle-only source index."
    groups = defaultdict(list)
    accounts = defaultdict(set)
    for name, item in bundles.items():
        account, canonical = account_parts(name)
        # ENGINE_VERSION, global dependency list and decoder key are identical
        # for every source in this run. A common decoder sentinel preserves the
        # equality relation without claiming to recover a concrete cache name.
        key = stable_hash([scan["version"], canonical, item["sha256"], dependency_key, "same-historical-decoder-key"])
        groups[key].append(name)
        if account:
            accounts[account].add((canonical, item["sha256"]))
    equivalence = defaultdict(list)
    for account, resources in sorted(accounts.items()):
        equivalence[stable_hash(sorted(resources))].append(account)
    after = {path.name: sha256(path) for path in inputs}
    assert before == after, "Historical input content changed during audit."
    count, unique = len(bundles), len(groups)
    assert count == 320481 and unique == 42047, f"Historical fixture expectation changed: {count} -> {unique}"
    return {
        "passed": True,
        "kind": "index-only scheduling simulation; no Unity extraction or performance benchmark",
        "bundleCount": count,
        "uniqueBundleTasks": unique,
        "deduplicatedBundles": count - unique,
        "duplicateFraction": round((count - unique) / count, 6),
        "sourceCopiesPerTask": dict(sorted(Counter(len(values) for values in groups.values()).items())),
        "accountBundleCounts": {name: len(resources) for name, resources in sorted(accounts.items())},
        "identicalAccountGroups": list(equivalence.values()),
        "publicDependencyCount": len(dependencies),
        "historicalImportSeconds": imported["elapsed"],
        "historicalPhaseTimingsAvailable": False,
        "inputSha256": before,
        "inputContentUnchanged": before == after,
        "limitations": ["Counts use previously recorded source hashes, not rehashed game files.", "This proves scheduling equivalence for this index, not a runtime speedup ratio.", "Latest-directory selection cannot be inferred from historical index file mtimes; it uses live 0000 directory metadata."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cache, output = args.cache.resolve(), args.output.resolve()
    if output.is_relative_to(cache.parent):
        raise SystemExit("Report must be outside the supplied player/cache tree.")
    report = audit(cache)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("passed", "kind", "bundleCount", "uniqueBundleTasks", "deduplicatedBundles", "inputContentUnchanged")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
