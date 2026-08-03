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
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath

from ._contract import (
    PAYLOAD_DIGEST_FILE,
    PAYLOAD_DIGEST_FORMAT,
    PayloadDigestEntry,
    find_entry_through_link,
    find_unresolvable_link,
    path_under,
    payload_digest_stream,
    safe_relative_path,
)
from .errors import ScrollcaseConsumerError

_METADATA_LIMIT = 1024 * 1024
# A real link target is a file name. Anything approaching a path limit is corrupt, or an
# attempt to make reading the archive expensive.
_LINK_TARGET_LIMIT = 1024


@dataclass(frozen=True, slots=True)
class ZipEntry:
    """A prevalidated ZIP member."""

    member_index: int
    path: str
    kind: str
    size: int
    mode: int
    link_target: str | None = None


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
        if info.file_size > _LINK_TARGET_LIMIT:
            raise ScrollcaseConsumerError(
                f"Archive link target is too long: {path}"
            )
        # The target is the entry's own content, so it is not known here; list_zip_entries reads
        # it before anything is validated, and nothing is extracted until it has.
        return ZipEntry(
            member_index=member_index,
            path=path,
            kind="link",
            size=info.file_size,
            mode=0o777,
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
            infos = archive.infolist()
            entries = [_classify(info, index) for index, info in enumerate(infos)]
            entries = [
                entry
                if entry.kind != "link"
                else replace(
                    entry,
                    link_target=archive.read(infos[entry.member_index]).decode(
                        "utf-8", "replace"
                    ),
                )
                for entry in entries
            ]
    except (zipfile.BadZipFile, OSError) as error:
        raise ScrollcaseConsumerError(f"Invalid ZIP archive: {error}") from error
    _assert_no_collisions(entries)
    # Every link is judged by the rule the builder applied, against the archive as received rather
    # than as intended. A box assembled by hand gets no benefit of the doubt.
    unresolvable = find_unresolvable_link(entries)
    if unresolvable is not None:
        raise ScrollcaseConsumerError(
            f"Archive link does not resolve to a file inside the payload: {unresolvable}"
        )
    through_link = find_entry_through_link(entries)
    if through_link is not None:
        raise ScrollcaseConsumerError(
            f"Archive entry would be written through a link: {through_link}"
        )
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
                if entry.kind == "link":
                    # Written as the relative string it was validated as, never resolved: the link
                    # must mean the same thing wherever the box is extracted.
                    os.symlink(entry.link_target or "", output)
                    continue
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


@dataclass(frozen=True, slots=True)
class PayloadEntry:
    """One entry of an extracted payload, classified before anything reads it."""

    path: str
    kind: str
    link_target: str | None = None


def collect_entries(root: Path, current: Path | None = None) -> list[PayloadEntry]:
    """Return every payload entry in stable code-point order, links classified as such.

    One walk, one exclusion list, one refusal of special nodes — ``collect_files`` and the payload
    digest both read this, so there is no second place where the two could drift apart.
    """

    directory = root if current is None else current
    collected: list[PayloadEntry] = []
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
        relative = path.relative_to(root).as_posix()
        # Order matters: a symlink to a directory reports is_dir(follow_symlinks=False) as false,
        # but classifying links first keeps that from ever depending on the check order.
        if entry.is_symlink():
            # Normalised to forward slashes for the same reason archive paths are: the digest is
            # computed on one host and checked on another. No Windows box carries links at all, so
            # this is a no-op there rather than a guess about what it would mean.
            target = os.readlink(entry.path).replace(os.sep, "/")
            collected.append(PayloadEntry(path=relative, kind="link", link_target=target))
        elif entry.is_dir(follow_symlinks=False):
            collected.extend(collect_entries(root, path))
        elif entry.is_file(follow_symlinks=False):
            collected.append(PayloadEntry(path=relative, kind="file"))
        else:
            raise ScrollcaseConsumerError(
                f"box special entries are not allowed: {relative}"
            )
    return collected


def collect_files(root: Path, current: Path | None = None) -> list[str]:
    """Return every payload path backed by a file or a link, in stable code-point order.

    Links are listed beside regular files because a payload link resolves to a regular file inside
    the same payload — a box reaches its interpreter through one — while special nodes are refused.
    """

    return [entry.path for entry in collect_entries(root, current)]


def payload_digest_entries(root: Path) -> list[PayloadDigestEntry]:
    """Describe every payload entry the way the digest records it.

    The list file itself is skipped, and by name rather than by whether it happens to exist: a build
    computes this before writing it and a verifier after, and the two must produce one answer.
    """

    described: list[PayloadDigestEntry] = []
    for entry in collect_entries(root):
        if entry.path == PAYLOAD_DIGEST_FILE:
            continue
        if entry.kind == "link":
            content = hashlib.sha256((entry.link_target or "").encode("utf-8")).hexdigest()
        else:
            content = sha256_file(path_under(root, entry.path))
        described.append(
            PayloadDigestEntry(path=entry.path, kind=entry.kind, content_sha256=content)
        )
    return described


def payload_digest(root: Path) -> dict[str, str]:
    """Compute what a release commits to about one extracted tree.

    This reads every payload byte, which on a box carrying embedded weights is tens of gigabytes.
    The cost is deliberate and paid only where a caller asked for it — never on the path that
    merely prepares, attaches, or runs a box.
    """

    stream = payload_digest_stream(payload_digest_entries(root))
    return {
        "format": PAYLOAD_DIGEST_FORMAT,
        "sha256": hashlib.sha256(stream).hexdigest(),
    }


def validate_extracted_tree(root: Path) -> None:
    """Reject special nodes after extraction."""

    collect_files(root)


def payload_size(root: Path) -> int:
    """Return what an extracted payload actually occupies.

    ``lstat``, not ``stat``: a link costs its own few bytes, not the size of what it points at.
    Counting the target would restore on paper the duplication that carrying links removes from
    disk, and this number is what free space is checked against.
    """

    total = 0
    for relative_path in collect_files(root):
        total += path_under(root, relative_path).lstat().st_size
        if total > (2**53 - 1):
            raise ScrollcaseConsumerError(
                "box installed size exceeds the safe integer range."
            )
    return total
