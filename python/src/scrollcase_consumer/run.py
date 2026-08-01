"""Shell-free execution of prepared boxes.

The verified release selects the interpreter and script or module. Callers may add argument strings,
environment values, and standard streams, but execution always uses an argv array with ``shell``
disabled and the box's own interpreter.
"""

from __future__ import annotations

import os
import shutil
import signal
import stat
import subprocess
import tempfile
import threading
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from types import FrameType
from typing import IO, Any, Protocol, TypeAlias, cast

from ._contract import (
    assert_execution_files,
    assert_native_host,
    path_under,
)
from .errors import ScrollcaseConsumerError
from .extract import collect_files, sha256_file
from .models import (
    BoxRunResult,
    PreparedBox,
    PythonModuleExecution,
    PythonScriptExecution,
)
from .verify import prepared_box_state, verify_and_extract_box

Stdio: TypeAlias = int | IO[Any] | None


class ChildProcess(Protocol):
    """The subprocess behavior required by the injectable execution seam."""

    returncode: int | None

    def wait(self) -> int: ...

    def send_signal(self, signal_number: int) -> None: ...


PopenFactory: TypeAlias = Callable[..., ChildProcess]


def _arguments(values: Sequence[str]) -> tuple[str, ...]:
    if isinstance(values, (str, bytes)) or not all(
        isinstance(value, str) for value in values
    ):
        raise ScrollcaseConsumerError(
            "Box execution arguments must be a sequence of strings."
        )
    return tuple(values)


def _environment(values: Mapping[str, str] | None) -> dict[str, str]:
    environment = dict(os.environ)
    if values is None:
        return environment
    if not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in values.items()
    ):
        raise ScrollcaseConsumerError(
            "Box execution environment must map strings to strings."
        )
    environment.update(values)
    return environment


def _verify_required_assets(prepared: PreparedBox) -> None:
    root = Path(prepared.root)
    for asset in prepared.required_assets:
        path = path_under(root, asset.relative_path)
        try:
            metadata = path.lstat()
        except FileNotFoundError as error:
            raise ScrollcaseConsumerError(
                f"Required on-demand asset is missing: {asset.relative_path}."
            ) from error
        if not stat.S_ISREG(metadata.st_mode):
            raise ScrollcaseConsumerError(
                f"Required on-demand asset is not a regular file: {asset.relative_path}."
            )
        if metadata.st_size != asset.size_bytes:
            raise ScrollcaseConsumerError(
                f"Required on-demand asset size mismatch: {asset.relative_path}."
            )
        if sha256_file(path) != asset.sha256:
            raise ScrollcaseConsumerError(
                f"Required on-demand asset SHA-256 mismatch: {asset.relative_path}."
            )


def _forwarded_signals() -> tuple[signal.Signals, ...]:
    names = ("SIGINT", "SIGTERM", "SIGHUP")
    return tuple(
        cast(signal.Signals, getattr(signal, name))
        for name in names
        if hasattr(signal, name)
    )


def _wait_for_child(child: ChildProcess) -> BoxRunResult:
    previous: dict[signal.Signals, Any] = {}

    def forward(
        signal_number: int,
        _frame: FrameType | None,
    ) -> None:
        try:
            child.send_signal(signal_number)
        except OSError:
            pass

    try:
        if threading.current_thread() is threading.main_thread():
            for forwarded in _forwarded_signals():
                previous[forwarded] = signal.getsignal(forwarded)
                signal.signal(forwarded, forward)
        return_code = child.wait()
    finally:
        for forwarded, handler in previous.items():
            signal.signal(forwarded, handler)
    if return_code < 0:
        try:
            signal_name = signal.Signals(-return_code).name
        except ValueError:
            signal_name = f"SIG{-return_code}"
        return BoxRunResult(exit_code=None, signal=signal_name)
    return BoxRunResult(exit_code=return_code, signal=None)


def run_extracted_box(
    prepared: PreparedBox,
    *,
    args: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    stdin: Stdio = None,
    stdout: Stdio = None,
    stderr: Stdio = None,
    popen_factory: PopenFactory = subprocess.Popen,
) -> BoxRunResult:
    """Execute a verified prepared box with its own interpreter."""

    state = prepared_box_state(prepared)
    execution = state.execution
    if execution is None:
        raise ScrollcaseConsumerError(
            "Box does not declare an execution entry point."
        )
    caller_args = _arguments(args)
    assert_native_host(state.target)
    root = Path(prepared.root)
    try:
        metadata = root.lstat()
    except FileNotFoundError as error:
        raise ScrollcaseConsumerError(
            "Prepared box root no longer matches the prepared box."
        ) from error
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_dev != state.root_device
        or metadata.st_ino != state.root_inode
    ):
        raise ScrollcaseConsumerError(
            "Prepared box root no longer matches the prepared box."
        )
    resolvable_paths = frozenset(collect_files(root))
    if prepared.python_entry_point not in resolvable_paths:
        raise ScrollcaseConsumerError(
            f"Prepared box is missing {prepared.python_entry_point}."
        )
    assert_execution_files(
        execution,
        state.target,
        cast(str, state.release["provenance"]["pythonVersion"]),
        resolvable_paths,
    )
    _verify_required_assets(prepared)

    python = path_under(root, prepared.python_entry_point)
    if isinstance(execution, PythonScriptExecution):
        execution_args = [str(path_under(root, execution.script))]
    elif isinstance(execution, PythonModuleExecution):
        execution_args = ["-m", execution.module]
    else:
        raise ScrollcaseConsumerError(
            f"Unsupported execution kind: {execution.kind}."
        )
    execution_args.extend(execution.default_args)
    execution_args.extend(caller_args)
    try:
        child = popen_factory(
            [str(python), *execution_args],
            cwd=str(root),
            env=_environment(env),
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            shell=False,
        )
    except OSError as error:
        raise ScrollcaseConsumerError(
            f"Box application failed to start: {error}"
        ) from error
    return _wait_for_child(child)


def run_box(
    release_document_path: str | os.PathLike[str],
    *,
    public_key_path: str | os.PathLike[str],
    archive: str | os.PathLike[str] | None = None,
    args: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    stdin: Stdio = None,
    stdout: Stdio = None,
    stderr: Stdio = None,
    temporary_directory: str | os.PathLike[str] | None = None,
    on_prepared: Callable[[PreparedBox], None] | None = None,
    popen_factory: PopenFactory = subprocess.Popen,
) -> BoxRunResult:
    """Verify, temporarily extract, execute, and remove one local box."""

    temporary_parent = (
        Path(temporary_directory).resolve()
        if temporary_directory is not None
        else Path(tempfile.gettempdir()).resolve()
    )
    temporary_root = Path(
        tempfile.mkdtemp(prefix="scrollcase-run-", dir=temporary_parent)
    )
    try:
        prepared = verify_and_extract_box(
            release_document_path,
            public_key_path=public_key_path,
            archive=archive,
            destination=temporary_root / "box",
        )
        if on_prepared is not None:
            on_prepared(prepared)
        return run_extracted_box(
            prepared,
            args=args,
            env=env,
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            popen_factory=popen_factory,
        )
    finally:
        shutil.rmtree(temporary_root)
