from __future__ import annotations

import base64
import hashlib
import json
import platform
import stat
import sys
import tempfile
import warnings
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from scrollcase_consumer._contract import (
    PAYLOAD_DIGEST_FILE,
    PAYLOAD_DIGEST_FORMAT,
    PayloadDigestEntry,
    payload_digest_stream,
)


def native_target() -> dict[str, str]:
    machine = platform.machine().lower()
    if sys.platform == "darwin" and machine in ("arm64", "aarch64"):
        return {"platform": "macos", "arch": "aarch64", "accelerator": "cpu"}
    if sys.platform.startswith("linux") and machine in ("amd64", "x86_64", "x64"):
        return {"platform": "linux", "arch": "x86_64", "accelerator": "cpu"}
    if sys.platform == "win32" and machine in ("amd64", "x86_64", "x64"):
        return {"platform": "windows", "arch": "x86_64", "accelerator": "cpu"}
    raise RuntimeError(f"Unsupported test host: {sys.platform}/{machine}")


def python_entry_point(target: dict[str, str]) -> str:
    if target["platform"] == "windows":
        return "venv/python.exe"
    return "venv/bin/python"


@dataclass
class ArchiveEntry:
    path: str
    data: bytes = b""
    mode: int = 0o644
    file_type: int = stat.S_IFREG


@dataclass
class ConsumerFixture:
    root: Path
    archive_path: Path
    release_path: Path
    public_key_path: Path
    private_key: Ed25519PrivateKey
    key_id: str
    release: dict[str, Any]
    entries: list[ArchiveEntry]

    def sign(self) -> None:
        payload = (json.dumps(self.release, indent=2) + "\n").encode("utf-8")
        signed = {
            "schemaVersion": 2,
            "payloadEncoding": "base64-json-utf8",
            "payloadBase64": base64.b64encode(payload).decode("ascii"),
            "payloadSha256": hashlib.sha256(payload).hexdigest(),
            "signatures": [
                {
                    "algorithm": "ed25519",
                    "keyId": self.key_id,
                    "signatureBase64": base64.b64encode(
                        self.private_key.sign(payload)
                    ).decode("ascii"),
                }
            ],
        }
        self.release_path.write_text(
            json.dumps(signed, indent=2) + "\n",
            encoding="utf-8",
        )

    def write_archive(
        self,
        entries: list[ArchiveEntry] | None = None,
        *,
        encrypted: bool = False,
    ) -> None:
        write_zip(self.archive_path, self.entries if entries is None else entries)
        if encrypted:
            data = bytearray(self.archive_path.read_bytes())
            local = data.find(b"PK\x03\x04")
            central = data.find(b"PK\x01\x02")
            if local < 0 or central < 0:
                raise AssertionError("test ZIP lacks required headers")
            data[local + 6 : local + 8] = (
                int.from_bytes(data[local + 6 : local + 8], "little") | 0x1
            ).to_bytes(2, "little")
            data[central + 8 : central + 10] = (
                int.from_bytes(data[central + 8 : central + 10], "little") | 0x1
            ).to_bytes(2, "little")
            self.archive_path.write_bytes(data)
        self.release["archive"]["sha256"] = file_sha256(self.archive_path)
        self.release["archive"]["sizeBytes"] = self.archive_path.stat().st_size
        self.sign()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_zip(path: Path, entries: list[ArchiveEntry]) -> None:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Duplicate name:")
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in entries:
                info = zipfile.ZipInfo(entry.path)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (entry.file_type | entry.mode) << 16
                archive.writestr(info, entry.data)


_DEFAULT_EXECUTION = object()


def create_fixture(
    *,
    target: dict[str, str] | None = None,
    execution: dict[str, Any] | None | object = _DEFAULT_EXECUTION,
    required_asset: dict[str, Any] | None = None,
    interpreter: bytes = b"test interpreter placeholder",
    script: bytes = b'print("consumer fixture")\n',
    payload_digest: bool = True,
    environment: dict[str, str] | None = None,
) -> ConsumerFixture:
    root = Path(tempfile.mkdtemp(prefix="scrollcase-python-consumer-fixture-"))
    resolved_target = native_target() if target is None else target
    entry_point = python_entry_point(resolved_target)
    resolved_execution = (
        {
            "kind": "python-script",
            "script": "app/main.py",
            "defaultArgs": ["--default", "value with spaces"],
        }
        if execution is _DEFAULT_EXECUTION
        else execution
    )
    shared: dict[str, Any] = {
        "schemaVersion": 2,
        "boxId": "consumer-fixture",
        "modelId": "example-consumer-model",
        "runtimeId": "example-consumer-runtime",
        "version": "2.0.0",
        "target": resolved_target,
        "pythonEntryPoint": entry_point,
        "modelCacheSubdir": "model-cache/consumer-fixture",
        "selfTest": {"pythonImports": ["json"], "timeoutSeconds": 30},
        "provenance": {
            "scrollId": "consumer-fixture-scroll",
            "scrollVersion": "2.0.0",
            "builderRevision": "0123456789abcdef0123456789abcdef01234567",
            "sourceTreeDirty": False,
            "sourceRevision": "fedcba9876543210",
            "pythonVersion": "3.11.15",
            "pixiVersion": "0.73.0",
            "dependencyLockSha256": "a" * 64,
            "builtAt": "2026-07-29T00:00:00.000Z",
        },
    }
    if resolved_execution is not None:
        shared["execution"] = resolved_execution
    if environment is not None:
        shared["environment"] = environment
    if required_asset is not None:
        shared["weights"] = "on-demand"
        shared["assets"] = [required_asset]
    entries = [
        ArchiveEntry(entry_point, interpreter, 0o755),
    ]
    if isinstance(resolved_execution, dict):
        if resolved_execution["kind"] == "python-script":
            entries.append(ArchiveEntry(resolved_execution["script"], script))
        else:
            entries.append(
                ArchiveEntry(
                    resolved_execution["module"].replace(".", "/") + ".py",
                    b'print("consumer fixture")\n',
                )
            )
    box_json = (json.dumps(shared, indent=2) + "\n").encode("utf-8")
    entries.append(ArchiveEntry("box.json", box_json))
    # Written last and never listed in itself, exactly as the build does it. This fixture has no
    # payload directory at all, so the list is derived from the entries — which is why the shared
    # golden vectors exist: they are what proves this derivation agrees with the Node one.
    payload_digest_value = None
    if payload_digest:
        stream = payload_digest_stream(
            PayloadDigestEntry(
                path=entry.path,
                kind="link" if entry.file_type == stat.S_IFLNK else "file",
                content_sha256=hashlib.sha256(entry.data).hexdigest(),
            )
            for entry in entries
        )
        entries.append(ArchiveEntry(PAYLOAD_DIGEST_FILE, stream))
        payload_digest_value = {
            "format": PAYLOAD_DIGEST_FORMAT,
            "sha256": hashlib.sha256(stream).hexdigest(),
        }
    installed_size = sum(len(entry.data) for entry in entries)
    archive_path = root / "box.zip"
    write_zip(archive_path, entries)
    release = {
        **shared,
        "kind": "scrollcase.box.release",
        "compatibility": {"hostEnvironments": ["native"]},
        "archive": {
            "format": "zip",
            "url": "https://assets.example.org/consumer-fixture.zip",
            "sha256": file_sha256(archive_path),
            "sizeBytes": archive_path.stat().st_size,
        },
        "installedSizeBytes": installed_size,
    }
    if payload_digest_value is not None:
        release["payloadDigest"] = payload_digest_value
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    raw_public_key = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    key_id = f"scrollcase-{hashlib.sha256(raw_public_key).hexdigest()[:16]}"
    public_key_path = root / "public.json"
    public_key_path.write_text(
        json.dumps(
            {
                "algorithm": "ed25519",
                "keyId": key_id,
                "publicKeyBase64": base64.b64encode(raw_public_key).decode("ascii"),
                "publicKeyPem": public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo,
                ).decode("ascii"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    fixture = ConsumerFixture(
        root=root,
        archive_path=archive_path,
        release_path=root / "release.json",
        public_key_path=public_key_path,
        private_key=private_key,
        key_id=key_id,
        release=release,
        entries=entries,
    )
    fixture.sign()
    return fixture
