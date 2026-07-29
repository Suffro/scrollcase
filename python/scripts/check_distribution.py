#!/usr/bin/env python3
"""Inspect wheel and sdist contents without installing either artifact."""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from pathlib import Path

SCHEMA_FILES = (
    "signed-document.schema.json",
    "release-manifest.schema.json",
    "box-manifest.schema.json",
    "target.schema.json",
    "execution.schema.json",
)
PACKAGE_FILES = (
    "__init__.py",
    "_contract.py",
    "errors.py",
    "extract.py",
    "models.py",
    "run.py",
    "verify.py",
    "py.typed",
)


def expected_suffixes() -> tuple[str, ...]:
    return (
        *(f"scrollcase_consumer/{name}" for name in PACKAGE_FILES),
        *(f"scrollcase_consumer/schemas/{name}" for name in SCHEMA_FILES),
    )


def inspect_wheel(path: Path, canonical: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        for suffix in expected_suffixes():
            matches = [name for name in names if name.endswith(suffix)]
            if len(matches) != 1:
                raise SystemExit(f"{path.name}: expected one {suffix}, found {len(matches)}")
        metadata = [name for name in names if name.endswith(".dist-info/METADATA")]
        if len(metadata) != 1:
            raise SystemExit(f"{path.name}: missing wheel metadata")
        if b"\nAuthor:" in archive.read(metadata[0]):
            raise SystemExit(f"{path.name}: unexpected author metadata")
        for name in SCHEMA_FILES:
            packaged = archive.read(f"scrollcase_consumer/schemas/{name}")
            if packaged != (canonical / name).read_bytes():
                raise SystemExit(f"{path.name}: stale schema {name}")


def inspect_sdist(path: Path, canonical: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        names = archive.getnames()
        for suffix in expected_suffixes():
            matches = [name for name in names if name.endswith(suffix)]
            if len(matches) != 1:
                raise SystemExit(f"{path.name}: expected one {suffix}, found {len(matches)}")
        for suffix in ("pyproject.toml", "README.md"):
            matches = [name for name in names if name.endswith(suffix)]
            if len(matches) != 1:
                raise SystemExit(
                    f"{path.name}: expected one source file {suffix}, found {len(matches)}"
                )
        if any("/tests/" in name or "/scripts/" in name for name in names):
            raise SystemExit(f"{path.name}: repository-only tests or scripts leaked into sdist")
        for name in SCHEMA_FILES:
            member = next(
                item
                for item in archive.getmembers()
                if item.name.endswith(f"scrollcase_consumer/schemas/{name}")
            )
            extracted = archive.extractfile(member)
            if extracted is None or extracted.read() != (canonical / name).read_bytes():
                raise SystemExit(f"{path.name}: stale schema {name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifacts", nargs="+", type=Path)
    options = parser.parse_args()
    canonical = Path(__file__).resolve().parents[2] / "src" / "contract" / "schema"
    saw_wheel = False
    saw_sdist = False
    for artifact in options.artifacts:
        if artifact.suffix == ".whl":
            inspect_wheel(artifact, canonical)
            saw_wheel = True
        elif artifact.name.endswith(".tar.gz"):
            inspect_sdist(artifact, canonical)
            saw_sdist = True
        else:
            raise SystemExit(f"Unsupported distribution artifact: {artifact}")
    if not saw_wheel or not saw_sdist:
        raise SystemExit("Expected both one wheel and one sdist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
