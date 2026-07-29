"""The small Python mirror of target and path behavior.

Schemas stay canonical in ``src/contract`` and are copied into this package by a checked generation
step. Code is limited to behavior schemas cannot express at runtime: host adapters, target IDs,
safe filesystem joins, and static module discovery.
"""

from __future__ import annotations

import json
import platform
import re
import sys
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from pathlib import Path
from typing import Any, Collection, Mapping, cast

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .errors import ScrollcaseConsumerError
from .models import (
    BoxExecution,
    BoxTarget,
    PythonModuleExecution,
    PythonScriptExecution,
    RequiredAsset,
)

SCHEMA_FILES = (
    "signed-document.schema.json",
    "release-manifest.schema.json",
    "box-manifest.schema.json",
    "target.schema.json",
    "execution.schema.json",
)
_CUDA_VERSION = re.compile(r"^[1-9][0-9]*\.[0-9]+$")


@dataclass(frozen=True, slots=True)
class TargetAdapter:
    """Runtime-relevant target layout mirrored from the canonical target adapters."""

    platform: str
    arch: str
    host_platform: str
    host_arch: str
    python_entry_point: str
    standard_library: str


_ADAPTERS = {
    ("macos", "aarch64"): TargetAdapter(
        platform="macos",
        arch="aarch64",
        host_platform="darwin",
        host_arch="aarch64",
        python_entry_point="venv/bin/python",
        standard_library="venv/lib",
    ),
    ("linux", "x86_64"): TargetAdapter(
        platform="linux",
        arch="x86_64",
        host_platform="linux",
        host_arch="x86_64",
        python_entry_point="venv/bin/python",
        standard_library="venv/lib",
    ),
    ("windows", "x86_64"): TargetAdapter(
        platform="windows",
        arch="x86_64",
        host_platform="win32",
        host_arch="x86_64",
        python_entry_point="venv/python.exe",
        standard_library="venv/Lib",
    ),
}
_ACCELERATORS = {
    ("macos", "aarch64"): frozenset(("metal", "cpu")),
    ("linux", "x86_64"): frozenset(("cpu", "cuda")),
    ("windows", "x86_64"): frozenset(("cpu", "cuda")),
}


def safe_relative_path(value: object) -> str:
    """Return a forward-slash relative path that cannot leave a box root."""

    normalized = str(value).replace("\\", "/")
    if (
        not normalized
        or normalized.startswith("/")
        or "\0" in normalized
        or re.match(r"^[A-Za-z]:/", normalized)
        or any(part in ("", "..") for part in normalized.split("/"))
    ):
        raise ScrollcaseConsumerError(f"Unsafe relative path: {value}")
    return normalized


def path_under(root: Path, relative_path: str) -> Path:
    """Join a path only after applying the shared traversal rule."""

    return root.joinpath(*safe_relative_path(relative_path).split("/"))


def target_from_json(value: Mapping[str, Any]) -> BoxTarget:
    """Convert a validated target document into its immutable Python form."""

    return BoxTarget(
        platform=cast(Any, value["platform"]),
        arch=cast(Any, value["arch"]),
        accelerator=cast(Any, value["accelerator"]),
        cuda_version=cast(str | None, value.get("cudaVersion")),
    )


def target_id(target: BoxTarget) -> str:
    """Return the canonical target slug, rejecting unsupported combinations."""

    accelerators = _ACCELERATORS.get((target.platform, target.arch))
    if accelerators is None or target.accelerator not in accelerators:
        raise ScrollcaseConsumerError(
            f"Unsupported box target: {target.platform}/{target.arch}/{target.accelerator}"
        )
    if target.accelerator == "cuda":
        if target.cuda_version is None or _CUDA_VERSION.fullmatch(target.cuda_version) is None:
            raise ScrollcaseConsumerError(
                "A CUDA box target requires a numeric major.minor CUDA version"
            )
        return f"{target.platform}-{target.arch}-cuda{target.cuda_version}"
    if target.cuda_version is not None:
        raise ScrollcaseConsumerError("Only CUDA box targets may declare a CUDA version")
    return f"{target.platform}-{target.arch}-{target.accelerator}"


def target_adapter(target: BoxTarget) -> TargetAdapter:
    """Return the runtime adapter for a supported target."""

    target_id(target)
    adapter = _ADAPTERS.get((target.platform, target.arch))
    if adapter is None:
        raise ScrollcaseConsumerError(
            f"No box target adapter exists for {target.platform}/{target.arch}"
        )
    return adapter


def assert_native_host(target: BoxTarget) -> None:
    """Reject execution when the local OS or architecture cannot run the box."""

    adapter = target_adapter(target)
    host_platform = sys.platform
    machine = platform.machine().lower()
    host_arch = {
        "amd64": "x86_64",
        "x64": "x86_64",
        "arm64": "aarch64",
    }.get(machine, machine)
    if host_platform != adapter.host_platform or host_arch != adapter.host_arch:
        raise ScrollcaseConsumerError(
            f"Box target {target_id(target)} cannot run on {host_platform}/{host_arch}; "
            f"requires {adapter.host_platform}/{adapter.host_arch}."
        )


def execution_from_json(value: Mapping[str, Any] | None) -> BoxExecution | None:
    """Convert validated execution metadata into an immutable tagged union."""

    if value is None:
        return None
    default_args = tuple(cast(list[str], value["defaultArgs"]))
    if value["kind"] == "python-script":
        return PythonScriptExecution(
            kind="python-script",
            script=cast(str, value["script"]),
            default_args=default_args,
        )
    return PythonModuleExecution(
        kind="python-module",
        module=cast(str, value["module"]),
        default_args=default_args,
    )


def required_assets_from_json(values: list[Mapping[str, Any]] | None) -> tuple[RequiredAsset, ...]:
    """Convert signed on-demand descriptors into immutable values."""

    if values is None:
        return ()
    return tuple(
        RequiredAsset(
            url=cast(str, value["url"]),
            relative_path=safe_relative_path(value["relativePath"]),
            size_bytes=cast(int, value["sizeBytes"]),
            sha256=cast(str, value["sha256"]),
        )
        for value in values
    )


def _python_major_minor(version: str) -> str:
    match = re.match(r"^(\d+)\.(\d+)(?:\.|$)", version)
    if match is None:
        raise ScrollcaseConsumerError(
            f"Invalid Python version for execution discovery: {version}."
        )
    return f"{match.group(1)}.{match.group(2)}"


def assert_execution_files(
    execution: BoxExecution | None,
    target: BoxTarget,
    python_version: str,
    regular_files: Collection[str],
) -> None:
    """Prove a signed script or module resolves from regular payload files."""

    if execution is None:
        return
    if isinstance(execution, PythonScriptExecution):
        script = safe_relative_path(execution.script)
        if script not in regular_files:
            raise ScrollcaseConsumerError(
                f"Execution script is missing from the box: {script}."
            )
        return
    adapter = target_adapter(target)
    module_path = execution.module.replace(".", "/")
    candidates = (f"{module_path}.py", f"{module_path}/__main__.py")
    version = _python_major_minor(python_version)
    standard_library = (
        adapter.standard_library
        if target.platform == "windows"
        else f"{adapter.standard_library}/python{version}"
    )
    roots = ("", standard_library, f"{standard_library}/site-packages")
    if not any(
        (f"{root}/{candidate}" if root else candidate) in regular_files
        for root in roots
        for candidate in candidates
    ):
        raise ScrollcaseConsumerError(
            f"Execution module is not discoverable in the box: {execution.module}."
        )


@lru_cache(maxsize=1)
def _schema_registry() -> tuple[dict[str, dict[str, Any]], Registry[Any]]:
    schemas: dict[str, dict[str, Any]] = {}
    registry: Registry[Any] = Registry()
    schema_root = files("scrollcase_consumer.schemas")
    for name in SCHEMA_FILES:
        schema = cast(
            dict[str, Any],
            json.loads(schema_root.joinpath(name).read_text(encoding="utf-8")),
        )
        schemas[name] = schema
        registry = registry.with_resource(
            cast(str, schema["$id"]),
            Resource.from_contents(schema),
        )
    return schemas, registry


def validate_schema(value: object, schema_name: str, label: str) -> None:
    """Validate against a bundled canonical schema copy with one concise failure."""

    schemas, registry = _schema_registry()
    validator = Draft202012Validator(schemas[schema_name], registry=registry)
    error = next(iter(validator.iter_errors(value)), None)
    if error is None:
        return
    location = "/" + "/".join(str(part) for part in error.absolute_path)
    if location == "/":
        location = "document"
    raise ScrollcaseConsumerError(f"Invalid {label}: {location} {error.message}.")
