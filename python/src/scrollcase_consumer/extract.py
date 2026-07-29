"""Defensive ZIP inspection and extraction.

Every entry is classified before bytes are written. Traversal, links, devices, encryption, duplicate
paths, and file/directory collisions are rejected so extraction never delegates security behavior
to whichever platform happens to be running the consumer.
"""

from __future__ import annotations

import hashlib
import os
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from ._contract import path_under, safe_relative_path
from .errors import ScrollcaseConsumerError

_METADATA_LIMIT = 1024 * 1024


@dataclass(frozen=True, slots=True)
class ZipEntry:
    """A prevalidated ZIP member."""

    member_index: int
    path: str
    kind: str
    size: int
    mode: int


def sha256_file(path: Path) -> str:
    """Hash a file without buffering a box archive in memory."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _classify(info: zipfile.ZipInfo, member_index: int) -> ZipEntry:
    if info.flag_bits & 0x1:
        raise ScrollcaseConsumerError(
            f"Encrypted ZIP entries are not allowed: {info.orig_filename}"
        )
    original_name = info.orig_filename
    name = original_name[:-1] if original_name.endswith("/") else original_name
    path = safe_relative_path(name)
    unix_mode = info.external_attr >> 16
    file_type = stat.S_IFMT(unix_mode)
    if file_type == stat.S_IFLNK:
        raise ScrollcaseConsumerError(
            f"Archive links and special entries are not allowed: {path}"
        )
    is_directory = info.is_dir() or file_type == stat.S_IFDIR
    if not is_directory and file_type not in (0, stat.S_IFREG):
        raise ScrollcaseConsumerError(
            f"Archive special entries are not allowed: {path}"
        )
    return ZipEntry(
        member_index=member_index,
        path=path,
        kind="directory" if is_directory else "file",
        size=info.file_size,
        mode=stat.S_IMODE(unix_mode),
    )


def _assert_no_collisions(entries: list[ZipEntry]) -> None:
    seen: dict[str, str] = {}
    parents_with_children: set[str] = set()
    for entry in entries:
        if entry.path in seen:
            raise ScrollcaseConsumerError(
                f"Archive entry collides with another entry: {entry.path}"
            )
        parents = [
            parent.as_posix()
            for parent in PurePosixPath(entry.path).parents
            if parent.as_posix() != "."
        ]
        if any(seen.get(parent) == "file" for parent in parents):
            raise ScrollcaseConsumerError(
                f"Archive entry collides with another entry: {entry.path}"
            )
        parents_with_children.update(parents)
        if entry.kind == "file" and entry.path in parents_with_children:
            raise ScrollcaseConsumerError(
                f"Archive entry collides with another entry: {entry.path}"
            )
        seen[entry.path] = entry.kind


def list_zip_entries(archive_path: Path) -> list[ZipEntry]:
    """List every member only after validating its type, path, and collisions."""

    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            entries = [
                _classify(info, index)
                for index, info in enumerate(archive.infolist())
            ]
    except (zipfile.BadZipFile, OSError) as error:
        raise ScrollcaseConsumerError(f"Invalid ZIP archive: {error}") from error
    _assert_no_collisions(entries)
    return entries


def read_zip_entry(
    archive_path: Path,
    wanted_path: str,
    maximum_bytes: int = _METADATA_LIMIT,
) -> str:
    """Read one bounded metadata file after validating the complete archive."""

    safe_path = safe_relative_path(wanted_path)
    entries = list_zip_entries(archive_path)
    entry = next(
        (
            candidate
            for candidate in entries
            if candidate.path == safe_path and candidate.kind == "file"
        ),
        None,
    )
    if entry is None:
        raise ScrollcaseConsumerError(
            f"ZIP archive does not contain {safe_path}"
        )
    if entry.size > maximum_bytes:
        raise ScrollcaseConsumerError(
            f"ZIP entry is too large to read as metadata: {safe_path}"
        )
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            data = archive.read(archive.infolist()[entry.member_index])
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        raise ScrollcaseConsumerError(f"Invalid ZIP archive: {error}") from error
    if len(data) > maximum_bytes:
        raise ScrollcaseConsumerError(
            f"ZIP entry is too large to read as metadata: {safe_path}"
        )
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ScrollcaseConsumerError(f"{safe_path} is not valid UTF-8 JSON.") from error


def extract_zip_archive(archive_path: Path, destination: Path) -> None:
    """Extract a prevalidated archive without overwriting any filesystem entry."""

    entries = list_zip_entries(archive_path)
    destination.mkdir(parents=True, exist_ok=False)
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            infos = archive.infolist()
            for entry in entries:
                output = path_under(destination, entry.path)
                if entry.kind == "directory":
                    output.mkdir(parents=True, exist_ok=False)
                    continue
                output.parent.mkdir(parents=True, exist_ok=True)
                written = 0
                with archive.open(infos[entry.member_index], "r") as source:
                    with output.open("xb") as target:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            target.write(chunk)
                            written += len(chunk)
                if written != entry.size:
                    raise ScrollcaseConsumerError(
                        f"ZIP entry size changed during extraction: {entry.path}"
                    )
                if os.name != "nt":
                    output.chmod(entry.mode or 0o644)
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        if isinstance(error, ScrollcaseConsumerError):
            raise
        raise ScrollcaseConsumerError(f"ZIP extraction failed: {error}") from error
    validate_extracted_tree(destination)


def collect_files(root: Path, current: Path | None = None) -> list[str]:
    """Return regular payload files in stable code-point order."""

    directory = root if current is None else current
    files: list[str] = []
    try:
        with os.scandir(directory) as iterator:
            entries = sorted(iterator, key=lambda entry: entry.name)
    except OSError as error:
        raise ScrollcaseConsumerError(f"Cannot inspect prepared box: {error}") from error
    for entry in entries:
        if (
            entry.name == "__pycache__"
            or entry.name == ".DS_Store"
            or entry.name.endswith(".pyc")
        ):
            continue
        path = Path(entry.path)
        if entry.is_dir(follow_symlinks=False):
            files.extend(collect_files(root, path))
        elif entry.is_file(follow_symlinks=False):
            files.append(path.relative_to(root).as_posix())
        else:
            relative = path.relative_to(root).as_posix()
            raise ScrollcaseConsumerError(
                f"box links and special entries are not allowed: {relative}"
            )
    return files


def validate_extracted_tree(root: Path) -> None:
    """Reject links and special nodes after extraction."""

    collect_files(root)


def payload_size(root: Path) -> int:
    """Return the logical size of regular files in an extracted payload."""

    total = 0
    for relative_path in collect_files(root):
        total += path_under(root, relative_path).stat().st_size
        if total > (2**53 - 1):
            raise ScrollcaseConsumerError(
                "box installed size exceeds the safe integer range."
            )
    return total
