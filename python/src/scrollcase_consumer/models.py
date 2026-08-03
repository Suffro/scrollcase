"""Immutable public receipts and execution models.

The signed JSON remains the wire format. These Python values are a typed, immutable view of the
fields a consumer needs after that wire format has passed verification.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias


@dataclass(frozen=True, slots=True)
class BoxTarget:
    """The platform, architecture, and accelerator carried by a box."""

    platform: Literal["macos", "linux", "windows"]
    arch: Literal["aarch64", "x86_64"]
    accelerator: Literal["cpu", "metal", "cuda"]
    cuda_version: str | None = None


@dataclass(frozen=True, slots=True)
class PythonScriptExecution:
    """A signed direct-script entry point."""

    kind: Literal["python-script"]
    script: str
    default_args: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PythonModuleExecution:
    """A signed dotted-module entry point."""

    kind: Literal["python-module"]
    module: str
    default_args: tuple[str, ...]


BoxExecution: TypeAlias = PythonScriptExecution | PythonModuleExecution


@dataclass(frozen=True, slots=True)
class RequiredAsset:
    """Signed bytes the caller must materialize before execution."""

    url: str
    relative_path: str
    size_bytes: int
    sha256: str


# Deliberately without ``slots=True``, unlike every other model here: the instance must keep
# ``__weakref__`` to be a WeakKeyDictionary key, which is how execution authority is bound. And
# ``eq=False`` keeps identity comparison, so a field-identical forgery cannot collide with a real
# entry. Adding slots, or restoring equality, breaks both producers at the binding step.
@dataclass(frozen=True, eq=False)
class PreparedBox:
    """The immutable result of verifying and durably extracting one local box.

    Construction alone does not grant execution authority. ``run_extracted_box`` also requires the
    private verification state bound to the exact instance returned by ``verify_and_extract_box``
    or ``attach_extracted_box``.
    """

    # Which producer minted it, because they do not prove the same thing. ``prepared`` means the
    # bytes came from an archive whose signed hash was checked in this process; ``attached`` means
    # an existing directory was re-identified against a signed release, with no archive to check.
    status: Literal["prepared", "attached"]
    root: str
    box_id: str
    model_id: str
    runtime_id: str
    version: str
    target: BoxTarget
    target_id: str
    python_entry_point: str
    execution: BoxExecution | None
    required_assets: tuple[RequiredAsset, ...]
    signing_key_ids: tuple[str, ...]
    release_payload_sha256: str
    archive_sha256: str
    archive_size_bytes: int
    installed_size_bytes: int


@dataclass(frozen=True, slots=True)
class BoxRunResult:
    """The child application's terminal result."""

    exit_code: int | None
    signal: str | None


@dataclass(frozen=True, slots=True)
class PayloadVerification:
    """The result of comparing an extracted tree against the list its release commits to."""

    status: Literal["verified"]
    root: str
    box_id: str
    version: str
    target_id: str
    entry_count: int
