#!/usr/bin/env python3
"""Copy the canonical consumer schemas into the Python distribution, or check for drift."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCHEMA_FILES = (
    "signed-document.schema.json",
    "release-manifest.schema.json",
    "box-manifest.schema.json",
    "target.schema.json",
    "execution.schema.json",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    source_root = repo_root / "src" / "contract" / "schema"
    destination_root = (
        repo_root
        / "python"
        / "src"
        / "scrollcase_consumer"
        / "schemas"
    )
    destination_root.mkdir(parents=True, exist_ok=True)
    drift: list[str] = []
    for name in SCHEMA_FILES:
        source = (source_root / name).read_bytes()
        destination = destination_root / name
        if options.check:
            if not destination.exists() or destination.read_bytes() != source:
                drift.append(name)
        else:
            destination.write_bytes(source)
    if drift:
        print(
            "Python schema copies are stale: "
            + ", ".join(drift)
            + ". Run python scripts/sync_schemas.py.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
