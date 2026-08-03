"""The small Python mirror of target and path behavior.

Schemas stay canonical in ``src/contract`` and are copied into this package by a checked generation
step. Code is limited to behavior schemas cannot express at runtime: host adapters, target IDs,
safe filesystem joins, and static module discovery.
"""

from __future__ import annotations

import json
import os
import platform
import re
import sys
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from pathlib import Path
from typing import Any, Collection, Iterable, Mapping, cast

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
    execution_affecting_environment_variables: tuple[str, ...]


_ADAPTERS = {
    ("macos", "aarch64"): TargetAdapter(
        platform="macos",
        arch="aarch64",
        host_platform="darwin",
        host_arch="aarch64",
        python_entry_point="venv/bin/python",
        standard_library="venv/lib",
        execution_affecting_environment_variables=(
            "PYTHONPATH",
            "PYTHONHOME",
            "PYTHONSTARTUP",
            "PYTHONBREAKPOINT",
            "DYLD_INSERT_LIBRARIES",
        ),
    ),
    ("linux", "x86_64"): TargetAdapter(
        platform="linux",
        arch="x86_64",
        host_platform="linux",
        host_arch="x86_64",
        python_entry_point="venv/bin/python",
        standard_library="venv/lib",
        execution_affecting_environment_variables=(
            "PYTHONPATH",
            "PYTHONHOME",
            "PYTHONSTARTUP",
            "PYTHONBREAKPOINT",
            "LD_PRELOAD",
        ),
    ),
    ("windows", "x86_64"): TargetAdapter(
        platform="windows",
        arch="x86_64",
        host_platform="win32",
        host_arch="x86_64",
        python_entry_point="venv/python.exe",
        standard_library="venv/Lib",
        execution_affecting_environment_variables=(
            "PYTHONPATH",
            "PYTHONHOME",
            "PYTHONSTARTUP",
            "PYTHONBREAKPOINT",
        ),
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


def absolute_path(value: str | os.PathLike[str]) -> Path:
    """Make a caller's path absolute without consulting the filesystem.

    ``Path.resolve()`` is not this: it walks the disk and replaces every symbolic link with its
    destination, which silently turns a path the caller named into a different one. That is a
    behaviour, not a formatting step, and it is not the behaviour the Node consumer has — its
    ``resolve()`` is purely lexical. Two implementations of one contract may not disagree about
    which directory a caller meant, so every caller-supplied path goes through here.

    The leading-slash case is the one place ``abspath`` still parts company with Node. POSIX leaves
    a path beginning with *exactly* two slashes implementation-defined; Python keeps it and Node
    collapses it, so ``base + "/" + name`` with ``base = "/"`` would be reported two different ways.
    Three or more slashes already agree, and the rule is skipped on Windows, where a leading ``\\\\``
    is a UNC path both implementations preserve on purpose.
    """

    absolute = os.path.abspath(value)
    if os.name != "nt" and absolute.startswith("//") and not absolute.startswith("///"):
        absolute = absolute[1:]
    return Path(absolute)


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
    resolvable_paths: Collection[str],
) -> None:
    """Prove a signed script or module resolves from a payload path.

    A payload link resolves to a regular file inside the same payload, so the caller passes
    links alongside regular files: a box may reach its entry point through one.
    """

    if execution is None:
        return
    if isinstance(execution, PythonScriptExecution):
        script = safe_relative_path(execution.script)
        if script not in resolvable_paths:
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
        (f"{root}/{candidate}" if root else candidate) in resolvable_paths
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


# What a release commits to about its own extracted tree, mirroring
# ``src/contract/payload-digest.mjs``. The archive's SHA-256 proves every payload byte only while
# the archive still exists; a box installed once and run for months has none. So the payload also
# carries an entry list, and the release signs that list's SHA-256 — one field rather than the
# megabytes a per-file table would add to a prefix holding twenty thousand files.
PAYLOAD_DIGEST_FORMAT = "sha256-path-list-v1"
PAYLOAD_DIGEST_FILE = "payload-digest.v1"

# How far a reader will go before refusing: the list arrives with the untrusted tree it describes,
# and reading it must not be what exhausts memory. At roughly a hundred bytes per record this is
# some two million entries, an order of magnitude past the densest real prefix.
MAX_PAYLOAD_DIGEST_BYTES = 256 * 1024 * 1024

_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
_SHA256_HEX_LENGTH = 64
_KIND_BYTE = {"file": b"f", "link": b"l"}
_BYTE_KIND = {ord("f"): "file", ord("l"): "link"}


@dataclass(frozen=True, slots=True)
class PayloadDigestEntry:
    """One payload entry as the digest records it.

    ``content_sha256`` hashes the file's bytes for a regular file, and the UTF-8 bytes of the link
    body for a link. A link is never opened: hashing what it points at would record the target's
    content twice, once under its own name and once under the link's, and would make a link
    indistinguishable from a copy — which is the distinction ``kind`` exists to keep.
    """

    path: str
    kind: str
    content_sha256: str


def payload_digest_stream(entries: Iterable[PayloadDigestEntry]) -> bytes:
    """Serialise payload entries into the canonical bytes a release commits to.

    The format name is inside the stream rather than only beside it in the manifest, so a later
    revision cannot produce the same bytes for different rules.

    Records are sorted by their own bytes rather than by their paths compared as strings. The two
    are the same ordering — a path cannot contain NUL, and NUL sorts below every byte a path can
    hold — but only one of them is unambiguous across languages, where JavaScript orders by UTF-16
    code unit and Python by code point.
    """

    records: list[bytes] = []
    seen: set[str] = set()
    for entry in entries:
        kind_byte = _KIND_BYTE.get(entry.kind)
        if kind_byte is None:
            raise ScrollcaseConsumerError(f"Unsupported payload entry kind: {entry.kind}")
        # Asserted rather than assumed: a NUL would end the path field early and let two different
        # trees produce one stream.
        if entry.path == "" or "\0" in entry.path:
            raise ScrollcaseConsumerError(f"Unsupported payload entry path: {entry.path!r}")
        if entry.path in seen:
            raise ScrollcaseConsumerError(f"Duplicate payload entry: {entry.path}")
        seen.add(entry.path)
        if not _SHA256_HEX.match(entry.content_sha256):
            raise ScrollcaseConsumerError(
                f"Invalid payload entry digest for {entry.path}: {entry.content_sha256}"
            )
        records.append(
            entry.path.encode("utf-8")
            + b"\0"
            + kind_byte
            + b"\0"
            + entry.content_sha256.encode("ascii")
            + b"\n"
        )
    # Bytewise. In Python this happens to coincide with sorting the decoded strings, because UTF-8
    # preserves code-point order — but the JavaScript mirror has no such luck, and the format is
    # defined on the bytes so that neither implementation has to know that.
    records.sort()
    return PAYLOAD_DIGEST_FORMAT.encode("utf-8") + b"\n" + b"".join(records)


def parse_payload_digest_stream(data: bytes) -> list[PayloadDigestEntry]:
    """Read a list back, refusing anything a serialiser could not have produced.

    Written as a scanner over a fixed frame rather than a split on separators: a newline is legal
    inside a filename, and only the NUL delimiter and the fixed-width hash field make the framing
    unambiguous. A caller must already have compared the stream's hash against the signed release —
    parsing is not a trust decision, and nothing here makes untrusted bytes safe.
    """

    header = PAYLOAD_DIGEST_FORMAT.encode("utf-8") + b"\n"
    if not data.startswith(header):
        raise ScrollcaseConsumerError(
            "Payload digest list does not carry the expected format header."
        )

    entries: list[PayloadDigestEntry] = []
    seen: set[str] = set()
    cursor = len(header)
    previous: bytes | None = None
    while cursor < len(data):
        path_end = data.find(b"\0", cursor)
        if path_end < 0:
            raise ScrollcaseConsumerError("Payload digest list ends inside a record.")
        end = path_end + _SHA256_HEX_LENGTH + 4
        if end > len(data):
            raise ScrollcaseConsumerError("Payload digest list ends inside a record.")
        kind = _BYTE_KIND.get(data[path_end + 1])
        if kind is None or data[path_end + 2] != 0 or data[end - 1] != 0x0A:
            raise ScrollcaseConsumerError("Payload digest list holds a malformed record.")
        try:
            path = data[cursor:path_end].decode("utf-8")
            content_sha256 = data[path_end + 3 : end - 1].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ScrollcaseConsumerError(
                "Payload digest list holds bytes that are not valid UTF-8."
            ) from error
        if not _SHA256_HEX.match(content_sha256):
            raise ScrollcaseConsumerError(
                f"Payload digest list holds an invalid digest for {path}."
            )
        if path in seen:
            raise ScrollcaseConsumerError(f"Payload digest list names {path} twice.")
        seen.add(path)

        # Order is part of the format, not a convenience: a reader that accepted any order would
        # accept streams the builder cannot emit, and two trees could then share one hash.
        record = data[cursor:end]
        if previous is not None and previous >= record:
            raise ScrollcaseConsumerError("Payload digest list is not in canonical order.")
        previous = record

        entries.append(
            PayloadDigestEntry(path=path, kind=kind, content_sha256=content_sha256)
        )
        cursor = end
    return entries


# The rule deciding which symbolic links a box payload may carry, mirroring
# ``src/contract/links.mjs``. A conda prefix stores every large shared library two or three times
# through the soname convention, and materialising all of it made most of an extracted Linux box
# duplicates of its own bytes. Preserving those links costs nothing to store and everything to get
# wrong, because a link is the classic way an archive writes outside the directory it was extracted
# into — so the rule is narrow, lexical, and re-checked here rather than trusted from the builder.
MAX_PAYLOAD_LINK_DEPTH = 8


def is_relative_link_target(target: object) -> bool:
    """Whether a raw link target is shaped like one a payload may carry."""

    if not isinstance(target, str) or target == "":
        return False
    if "\0" in target or "\\" in target:
        return False
    if target.startswith("/"):
        return False
    return re.match(r"^[A-Za-z]:", target) is None


def resolve_payload_link_target(link_path: str, target: object) -> str | None:
    """Resolve a link target against the link's own directory, staying inside the payload."""

    if not is_relative_link_target(target):
        return None
    segments = link_path.split("/")
    if not segments or segments[-1] == "":
        return None
    stack = segments[:-1]
    for part in cast(str, target).split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            # Underflow means the target climbed past the payload root: the escape this exists to
            # stop, which is why it is checked per segment rather than on the result.
            if not stack:
                return None
            stack.pop()
            continue
        stack.append(part)
    if not stack:
        return None
    resolved = "/".join(stack)
    return None if resolved == link_path else resolved


def find_entry_through_link(entries: Collection[Any]) -> str | None:
    """Return the first entry whose path passes through a link, or None."""

    links = {entry.path for entry in entries if entry.kind == "link"}
    if not links:
        return None
    for entry in entries:
        parts = entry.path.split("/")
        for index in range(1, len(parts)):
            if "/".join(parts[:index]) in links:
                return cast(str, entry.path)
    return None


def find_unresolvable_link(entries: Collection[Any]) -> str | None:
    """Return the first link that does not end at a regular file in the payload, or None."""

    by_path = {entry.path: entry for entry in entries}
    directories: set[str] = set()
    for entry in entries:
        if entry.kind == "directory":
            directories.add(entry.path)
        parts = entry.path.split("/")
        for index in range(1, len(parts)):
            directories.add("/".join(parts[:index]))
    for entry in entries:
        if entry.kind != "link":
            continue
        seen = {entry.path}
        current = entry
        depth = 0
        while True:
            if depth >= MAX_PAYLOAD_LINK_DEPTH:
                return cast(str, entry.path)
            resolved = resolve_payload_link_target(
                current.path, getattr(current, "link_target", None) or ""
            )
            if resolved is None:
                return cast(str, entry.path)
            # A directory may exist implicitly through its children, so this is asked before the
            # path is looked up as an entry of its own.
            if resolved in directories:
                return cast(str, entry.path)
            following = by_path.get(resolved)
            if following is None:
                return cast(str, entry.path)
            if following.kind == "file":
                break
            if following.kind != "link" or following.path in seen:
                return cast(str, entry.path)
            seen.add(following.path)
            current = following
            depth += 1
    return None
