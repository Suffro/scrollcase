"""Verification and durable preparation of caller-supplied local boxes.

No interpreter, script, module, or import from a box is run here. Signature and schema checks,
archive identity, safe entries, manifest agreement, interpreter layout, and execution discovery all
complete before extraction reaches the caller's destination.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import shutil
import tempfile
import weakref
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, cast

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from ._contract import (
    assert_execution_files,
    execution_from_json,
    required_assets_from_json,
    target_adapter,
    target_from_json,
    target_id,
    validate_schema,
)
from .errors import ScrollcaseConsumerError
from .extract import (
    extract_zip_archive,
    list_zip_entries,
    payload_size,
    read_zip_entry,
    sha256_file,
)
from .models import BoxExecution, BoxTarget, PreparedBox

_AGREEMENT_FIELDS = (
    "schemaVersion",
    "boxId",
    "modelId",
    "runtimeId",
    "version",
    "target",
    "pythonEntryPoint",
    "modelCacheSubdir",
    "selfTest",
    "execution",
    "weights",
    "assets",
    "provenance",
)


@dataclass(frozen=True, slots=True)
class _PreparedState:
    release: dict[str, Any]
    target: BoxTarget
    execution: BoxExecution | None
    root_device: int
    root_inode: int


_PREPARED_STATES: weakref.WeakKeyDictionary[PreparedBox, _PreparedState] = (
    weakref.WeakKeyDictionary()
)


def prepared_box_state(prepared: object) -> _PreparedState:
    """Return private verification state bound to an exact prepared receipt."""

    if not isinstance(prepared, PreparedBox):
        raise ScrollcaseConsumerError(
            "Expected a PreparedBox returned by verify_and_extract_box()."
        )
    state = _PREPARED_STATES.get(prepared)
    if state is None:
        raise ScrollcaseConsumerError(
            "Expected a PreparedBox returned by verify_and_extract_box()."
        )
    return state


def _read_json(path: Path, label: str) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ScrollcaseConsumerError(f"Invalid {label}: {error}") from error


def _decode_base64(value: object, label: str) -> bytes:
    if not isinstance(value, str):
        raise ScrollcaseConsumerError(f"Invalid {label}.")
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ScrollcaseConsumerError(f"Invalid {label}.") from error


def _trusted_keys(value: object) -> list[Mapping[str, Any]]:
    if isinstance(value, Mapping) and isinstance(value.get("keys"), list):
        entries = cast(list[object], value["keys"])
    else:
        entries = [value]
    if not all(isinstance(entry, Mapping) for entry in entries):
        raise ScrollcaseConsumerError("Invalid trusted ed25519 key file.")
    return [cast(Mapping[str, Any], entry) for entry in entries]


def _verify_signed_document(
    signed: dict[str, Any],
    public_key_path: Path,
) -> tuple[bytes, dict[str, Any]]:
    payload_bytes = _decode_base64(signed["payloadBase64"], "signed payload base64")
    if sha256_bytes(payload_bytes) != signed["payloadSha256"]:
        raise ScrollcaseConsumerError("Signed payload SHA-256 mismatch.")
    trusted = _trusted_keys(_read_json(public_key_path, "trusted ed25519 key file"))
    valid = False
    for signature in cast(list[dict[str, Any]], signed["signatures"]):
        key = next(
            (
                candidate
                for candidate in trusted
                if candidate.get("keyId") == signature["keyId"]
            ),
            None,
        )
        if key is None or not isinstance(key.get("publicKeyPem"), str):
            continue
        try:
            loaded = serialization.load_pem_public_key(
                cast(str, key["publicKeyPem"]).encode("utf-8")
            )
            if not isinstance(loaded, Ed25519PublicKey):
                continue
            loaded.verify(
                _decode_base64(signature["signatureBase64"], "ed25519 signature"),
                payload_bytes,
            )
            valid = True
            break
        except (InvalidSignature, ValueError, TypeError):
            continue
    if not valid:
        raise ScrollcaseConsumerError(
            "Document has no valid signature from a trusted ed25519 key."
        )
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ScrollcaseConsumerError(f"Invalid signed JSON payload: {error}") from error
    if not isinstance(payload, dict):
        raise ScrollcaseConsumerError("Invalid signed JSON payload: expected an object.")
    return payload_bytes, cast(dict[str, Any], payload)


def sha256_bytes(value: bytes) -> str:
    """Return the lowercase SHA-256 digest of exact signed bytes."""

    import hashlib

    return hashlib.sha256(value).hexdigest()


def _assert_manifest_agreement(
    box: dict[str, Any],
    release: dict[str, Any],
) -> None:
    for field in _AGREEMENT_FIELDS:
        if box.get(field) != release.get(field):
            raise ScrollcaseConsumerError(f"box.json mismatch: {field}")


@dataclass(frozen=True, slots=True)
class _InspectedBox:
    archive_path: Path
    signed: dict[str, Any]
    release: dict[str, Any]
    target: BoxTarget
    execution: BoxExecution | None
    regular_files: frozenset[str]


def _inspect_box_archive(
    release_document_path: str | os.PathLike[str],
    public_key_path: str | os.PathLike[str],
    archive: str | os.PathLike[str] | None,
) -> _InspectedBox:
    release_path = Path(release_document_path).resolve()
    signed_value = _read_json(release_path, "signed document")
    if isinstance(signed_value, Mapping) and signed_value.get("schemaVersion") == 1:
        raise ScrollcaseConsumerError(
            "Unsupported schemaVersion 1; rebuild this box with Scrollcase v2."
        )
    validate_schema(signed_value, "signed-document.schema.json", "signed document")
    signed = cast(dict[str, Any], signed_value)
    _, release = _verify_signed_document(signed, Path(public_key_path).resolve())
    if release.get("schemaVersion") == 1:
        raise ScrollcaseConsumerError(
            "Unsupported schemaVersion 1; rebuild this box with Scrollcase v2."
        )
    if release.get("schemaVersion") != 2:
        raise ScrollcaseConsumerError(
            f"Unsupported schemaVersion {release.get('schemaVersion')}; expected 2."
        )
    validate_schema(release, "release-manifest.schema.json", "release manifest")
    kind = cast(str, release["kind"])
    if kind.rsplit(".", maxsplit=1)[-1] != "release":
        raise ScrollcaseConsumerError("Document is not a box release.")

    target = target_from_json(cast(dict[str, Any], release["target"]))
    adapter = target_adapter(target)
    if release["pythonEntryPoint"] != adapter.python_entry_point:
        raise ScrollcaseConsumerError(
            f"{adapter.platform}-{adapter.arch} boxes must use Python entry point "
            f"{adapter.python_entry_point}"
        )
    archive_path = (
        Path(archive).resolve()
        if archive is not None
        else release_path.parent / f"{release['archive']['sha256']}.zip"
    )
    if not archive_path.is_file():
        raise ScrollcaseConsumerError(f"Archive not found: {archive_path}")
    archive_stat = archive_path.stat()
    if archive_stat.st_size != release["archive"]["sizeBytes"]:
        raise ScrollcaseConsumerError("Archive size mismatch.")
    if sha256_file(archive_path) != release["archive"]["sha256"]:
        raise ScrollcaseConsumerError("Archive SHA-256 mismatch.")

    entries = list_zip_entries(archive_path)
    regular_files = frozenset(
        entry.path for entry in entries if entry.kind == "file"
    )
    if "box.json" not in regular_files:
        raise ScrollcaseConsumerError("Archive is missing box.json.")
    try:
        box_value = json.loads(read_zip_entry(archive_path, "box.json"))
    except json.JSONDecodeError as error:
        raise ScrollcaseConsumerError(f"Invalid box.json: {error}") from error
    validate_schema(box_value, "box-manifest.schema.json", "box.json")
    box = cast(dict[str, Any], box_value)
    _assert_manifest_agreement(box, release)
    if release["pythonEntryPoint"] not in regular_files:
        raise ScrollcaseConsumerError(
            f"Archive is missing {release['pythonEntryPoint']}."
        )
    execution = execution_from_json(
        cast(dict[str, Any] | None, release.get("execution"))
    )
    assert_execution_files(
        execution,
        target,
        cast(str, release["provenance"]["pythonVersion"]),
        regular_files,
    )
    return _InspectedBox(
        archive_path=archive_path,
        signed=signed,
        release=release,
        target=target,
        execution=execution,
        regular_files=regular_files,
    )


def verify_and_extract_box(
    release_document_path: str | os.PathLike[str],
    *,
    public_key_path: str | os.PathLike[str],
    destination: str | os.PathLike[str],
    archive: str | os.PathLike[str] | None = None,
) -> PreparedBox:
    """Verify and atomically prepare one local box without executing its code."""

    final_root = Path(destination).resolve()
    if final_root.exists() or final_root.is_symlink():
        raise ScrollcaseConsumerError(f"Destination already exists: {final_root}")
    inspected = _inspect_box_archive(
        release_document_path,
        public_key_path,
        archive,
    )
    release = inspected.release
    required_assets = required_assets_from_json(
        cast(list[Mapping[str, Any]] | None, release.get("assets"))
        if release.get("weights") == "on-demand"
        else None
    )
    final_root.parent.mkdir(parents=True, exist_ok=True)
    if final_root.exists() or final_root.is_symlink():
        raise ScrollcaseConsumerError(f"Destination already exists: {final_root}")
    stage_root = Path(
        tempfile.mkdtemp(
            prefix=f".scrollcase-prepare-{final_root.name}-",
            dir=final_root.parent,
        )
    )
    extracted_root = stage_root / "payload"
    try:
        extract_zip_archive(inspected.archive_path, extracted_root)
        extracted_size = payload_size(extracted_root)
        installed_size = release.get("installedSizeBytes")
        if installed_size is not None and extracted_size != installed_size:
            raise ScrollcaseConsumerError(
                "Extracted payload size does not match the signed release."
            )
        if sha256_file(inspected.archive_path) != release["archive"]["sha256"]:
            raise ScrollcaseConsumerError(
                "Archive SHA-256 changed during extraction."
            )
        staged_metadata = extracted_root.stat()
        if final_root.exists() or final_root.is_symlink():
            raise ScrollcaseConsumerError(
                f"Destination already exists: {final_root}"
            )
        extracted_root.rename(final_root)
        installed_metadata = final_root.stat()
        if (
            installed_metadata.st_dev != staged_metadata.st_dev
            or installed_metadata.st_ino != staged_metadata.st_ino
        ):
            raise ScrollcaseConsumerError(
                "Prepared destination identity changed during installation."
            )
        target = inspected.target
        receipt = PreparedBox(
            status="prepared",
            root=str(final_root),
            box_id=cast(str, release["boxId"]),
            model_id=cast(str, release["modelId"]),
            runtime_id=cast(str, release["runtimeId"]),
            version=cast(str, release["version"]),
            target=target,
            target_id=target_id(target),
            python_entry_point=cast(str, release["pythonEntryPoint"]),
            execution=inspected.execution,
            required_assets=required_assets,
            signing_key_ids=tuple(
                cast(str, signature["keyId"])
                for signature in cast(list[dict[str, Any]], inspected.signed["signatures"])
            ),
            release_payload_sha256=cast(str, inspected.signed["payloadSha256"]),
            archive_sha256=cast(str, release["archive"]["sha256"]),
            archive_size_bytes=cast(int, release["archive"]["sizeBytes"]),
            installed_size_bytes=extracted_size,
        )
        _PREPARED_STATES[receipt] = _PreparedState(
            release=release,
            target=target,
            execution=inspected.execution,
            root_device=installed_metadata.st_dev,
            root_inode=installed_metadata.st_ino,
        )
        return receipt
    finally:
        shutil.rmtree(stage_root)
