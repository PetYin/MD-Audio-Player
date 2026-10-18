"""Archive exactly one verified staged manifest with stable entry metadata."""
from pathlib import Path
import argparse
import importlib.util
import zipfile

spec = importlib.util.spec_from_file_location("release_audit", Path(__file__).with_name("release-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def make_zip(root: Path, target: Path, rows, policy):
    if target.exists() or target.with_suffix(target.suffix + ".part").exists():
        raise audit.AuditError(f"Refusing to overwrite an existing archive: {target}")
    if target.resolve().is_relative_to(root.resolve()):
        raise audit.AuditError("Archive destination must be outside staged input")
    audit.verify_tree(root, audit.expected_map(rows), policy)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".part")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for row in sorted(rows, key=lambda r: r["path"]):
            data = (root / row["path"]).read_bytes()
            if audit.record(row["path"], data) != row:
                raise audit.AuditError(f"Staged file changed while archiving: {row['path']}")
            info = zipfile.ZipInfo(row["path"], (2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=6)
    audit.verify_archive(temporary, rows, policy)
    temporary.rename(target)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--kind", choices=("source", "portable"), required=True)
    parser.add_argument("--policy", required=True, type=Path)
    args = parser.parse_args()
    try:
        manifest = audit.load_json(args.manifest)
        make_zip(args.directory, args.target, manifest[args.kind], audit.load_json(args.policy))
        print(f"Verified archive created: {args.target.name}")
    except (audit.AuditError, OSError, ValueError, zipfile.BadZipFile) as error:
        raise SystemExit(f"Release ZIP rejected: {error}")
