#!/usr/bin/env python3
"""Refuse a Python release tag that does not match pyproject.toml."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, cast

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 release checks install the test extra.
    import tomli as tomllib


def package_version() -> str:
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    parsed = cast(dict[str, Any], tomllib.loads(pyproject.read_text(encoding="utf-8")))
    project = cast(dict[str, Any], parsed["project"])
    return cast(str, project["version"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag", help="Git tag that triggered the release")
    options = parser.parse_args()

    version = package_version()
    expected = f"python-v{version}"
    if options.tag != expected:
        parser.error(
            f"release tag {options.tag!r} does not match package version; "
            f"expected {expected}"
        )
    print(f"{options.tag} matches package version {version}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
