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
    absolute_path,
    assert_execution_files,
    assert_native_host,
    path_under,
)
from .errors import ScrollcaseConsumerError
from .environment import resolve_environment
from .extract import collect_files, sha256_file
from .models import (
    BoxRunResult,
    EnvironmentReport,
    PreparedBox,
    PythonModuleExecution,
    PythonScriptExecution,
)
from .verify import prepared_box_state, verify_and_extract_box, verify_required_assets

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


def _forwarded_signals() -> tuple[signal.Signals, ...]:
    names = ("SIGINT", "SIGTERM", "SIGHUP")
    return tuple(
        cast(signal.Signals, getattr(signal, name))
        for name in names
        if hasattr(signal, name)
    )


def _wait_for_child(
    child: ChildProcess,
    environment_report: EnvironmentReport,
) -> BoxRunResult:
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
        return BoxRunResult(
            exit_code=None,
            signal=signal_name,
            environment_report=environment_report,
        )
    return BoxRunResult(
        exit_code=return_code,
        signal=None,
        environment_report=environment_report,
    )


def run_extracted_box(
    prepared: PreparedBox,
    *,
    args: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    stdin: Stdio = None,
    stdout: Stdio = None,
    stderr: Stdio = None,
    env_report: bool = False,
    env_report_values: bool = False,
    on_environment_report: Callable[[EnvironmentReport], None] | None = None,
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
    verify_required_assets(Path(prepared.root), prepared.required_assets)

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
    environment, environment_report = resolve_environment(
        state.target,
        (
            ("host", os.environ),
            ("caller", env),
            (
                "release",
                cast(Mapping[str, str] | None, state.release.get("environment")),
            ),
        ),
        expanded=env_report or env_report_values,
        reveal_host_values=env_report_values,
    )
    if on_environment_report is not None:
        on_environment_report(environment_report)
    try:
        child = popen_factory(
            [str(python), *execution_args],
            cwd=str(root),
            env=environment,
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            shell=False,
        )
    except OSError as error:
        raise ScrollcaseConsumerError(
            f"Box application failed to start: {error}"
        ) from error
    return _wait_for_child(child, environment_report)


def run_box(
    release_document_path: str | os.PathLike[str],
    *,
    public_key_path: str | os.PathLike[str] | None = None,
    trusted_keys: Sequence[Mapping[str, Any]] | None = None,
    archive: str | os.PathLike[str] | None = None,
    args: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    stdin: Stdio = None,
    stdout: Stdio = None,
    stderr: Stdio = None,
    env_report: bool = False,
    env_report_values: bool = False,
    on_environment_report: Callable[[EnvironmentReport], None] | None = None,
    temporary_directory: str | os.PathLike[str] | None = None,
    on_prepared: Callable[[PreparedBox], None] | None = None,
    popen_factory: PopenFactory = subprocess.Popen,
) -> BoxRunResult:
    """Verify, temporarily extract, execute, and remove one local box."""

    temporary_parent = (
        absolute_path(temporary_directory)
        if temporary_directory is not None
        else absolute_path(tempfile.gettempdir())
    )
    temporary_root = Path(
        tempfile.mkdtemp(prefix="scrollcase-run-", dir=temporary_parent)
    )
    try:
        prepared = verify_and_extract_box(
            release_document_path,
            public_key_path=public_key_path,
            trusted_keys=trusted_keys,
            archive=archive,
            destination=temporary_root / "box",
            env_report=env_report,
            env_report_values=env_report_values,
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
            env_report=env_report,
            env_report_values=env_report_values,
            on_environment_report=on_environment_report,
            popen_factory=popen_factory,
        )
    finally:
        shutil.rmtree(temporary_root)
