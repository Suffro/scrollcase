#!/usr/bin/env python3
"""Inspect wheel and sdist contents without installing either artifact."""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from email.parser import BytesParser
from email.policy import default
from pathlib import Path
from typing import Any, cast

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 distribution checks install the test extra.
    import tomli as tomllib

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


def project_metadata() -> tuple[str, str, str]:
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    parsed = cast(dict[str, Any], tomllib.loads(pyproject.read_text(encoding="utf-8")))
    project = cast(dict[str, Any], parsed["project"])
    return (
        cast(str, project["name"]),
        cast(str, project["version"]),
        cast(str, project["requires-python"]),
    )


def expected_suffixes() -> tuple[str, ...]:
    return (
        *(f"scrollcase_consumer/{name}" for name in PACKAGE_FILES),
        *(f"scrollcase_consumer/schemas/{name}" for name in SCHEMA_FILES),
    )


def inspect_wheel(
    path: Path,
    canonical: Path,
    expected_metadata: tuple[str, str, str],
) -> None:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        for suffix in expected_suffixes():
            matches = [name for name in names if name.endswith(suffix)]
            if len(matches) != 1:
                raise SystemExit(f"{path.name}: expected one {suffix}, found {len(matches)}")
        metadata = [name for name in names if name.endswith(".dist-info/METADATA")]
        if len(metadata) != 1:
            raise SystemExit(f"{path.name}: missing wheel metadata")
        raw_metadata = archive.read(metadata[0])
        if b"\nAuthor:" in raw_metadata:
            raise SystemExit(f"{path.name}: unexpected author metadata")
        parsed = BytesParser(policy=default).parsebytes(raw_metadata)
        actual_metadata = (
            parsed["Name"],
            parsed["Version"],
            parsed["Requires-Python"],
        )
        if actual_metadata != expected_metadata:
            raise SystemExit(
                f"{path.name}: metadata {actual_metadata!r} does not match "
                f"{expected_metadata!r}"
            )
        licences = [name for name in names if name.endswith(".dist-info/licenses/LICENSE")]
        if len(licences) != 1:
            raise SystemExit(
                f"{path.name}: expected one packaged LICENSE, found {len(licences)}"
            )
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
        for suffix in ("pyproject.toml", "README.md", "LICENSE"):
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
    expected_metadata = project_metadata()
    saw_wheel = False
    saw_sdist = False
    for artifact in options.artifacts:
        if artifact.suffix == ".whl":
            inspect_wheel(artifact, canonical, expected_metadata)
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
