"""Environment resolution and masked diagnostics shared by verification and execution.

Inheritance is preserved deliberately. The signed release wins over caller and host values, but
the report remains consumer output: it does not turn a process environment into a box guarantee.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import cast

from ._contract import target_adapter
from .errors import ScrollcaseConsumerError
from .models import (
    BoxTarget,
    EnvironmentReport,
    EnvironmentSource,
    EnvironmentSourceValue,
    EnvironmentVariableReport,
)

_MASKED_VALUE = "<masked>"


def _normalized_name(name: str, platform: str) -> str:
    return name.upper() if platform == "windows" else name


def _entries(
    values: Mapping[str, str] | None,
    source: EnvironmentSource,
) -> tuple[tuple[str, str], ...]:
    if values is None:
        return ()
    if not isinstance(values, Mapping) or not all(
        isinstance(name, str)
        and name
        and "=" not in name
        and "\0" not in name
        and isinstance(value, str)
        and "\0" not in value
        for name, value in values.items()
    ):
        raise ScrollcaseConsumerError(
            f"Box execution {source} environment must map valid names to string values."
        )
    return tuple(values.items())


def resolve_environment(
    target: BoxTarget,
    layers: Sequence[tuple[EnvironmentSource, Mapping[str, str] | None]],
    *,
    expanded: bool = False,
    reveal_host_values: bool = False,
) -> tuple[dict[str, str], EnvironmentReport]:
    """Resolve layers in precedence order and return the exact child env plus its diagnostic."""

    adapter = target_adapter(target)
    records: dict[str, list[EnvironmentSourceValue]] = {}
    environment: dict[str, str] = {}
    environment_names: dict[str, str] = {}

    for source, values in layers:
        for name, value in _entries(values, source):
            normalized = _normalized_name(name, target.platform)
            records.setdefault(normalized, []).append(
                EnvironmentSourceValue(source=source, name=name, value=value)
            )
            previous = environment_names.get(normalized)
            if previous is not None and previous != name:
                environment.pop(previous, None)
            environment_names[normalized] = name
            environment[name] = value

    dangerous = {
        _normalized_name(name, target.platform)
        for name in adapter.execution_affecting_environment_variables
    }
    variables: list[tuple[EnvironmentVariableReport, bool]] = []
    for normalized, sources in records.items():
        winner = sources[-1]
        host_source = next(
            (source for source in sources if source.source == "host"),
            None,
        )
        execution_affecting = normalized in dangerous and host_source is not None
        conflict = len({source.value for source in sources}) > 1

        def visible(source: EnvironmentSourceValue) -> EnvironmentSourceValue:
            if source.source == "host" and not reveal_host_values:
                return EnvironmentSourceValue(
                    source=source.source,
                    name=source.name,
                    value=_MASKED_VALUE,
                )
            return source

        visible_sources = tuple(visible(source) for source in sources)
        visible_winner = visible(winner)
        variable = EnvironmentVariableReport(
            name=winner.name,
            source=winner.source,
            value=visible_winner.value,
            execution_affecting=execution_affecting,
            conflict=conflict,
            sources=visible_sources,
        )
        selected = (
            any(source.source == "release" for source in sources)
            or execution_affecting
            or conflict
        )
        variables.append((variable, selected))

    variables.sort(key=lambda item: item[0].name)
    selected_variables = tuple(
        variable
        for variable, selected in variables
        if expanded or selected
    )
    all_variables = tuple(variable for variable, _ in variables)
    report = EnvironmentReport(
        mode="full" if expanded else "summary",
        host_values_revealed=reveal_host_values,
        release_variable_count=sum(
            any(source.source == "release" for source in variable.sources)
            for variable in all_variables
        ),
        conflict_count=sum(variable.conflict for variable in all_variables),
        dangerous_host_variables=tuple(
            next(
                source for source in variable.sources if source.source == "host"
            ).name
            for variable in all_variables
            if variable.execution_affecting
        ),
        remaining_variable_count=len(all_variables) - len(selected_variables),
        variables=selected_variables,
    )
    return environment, report


def release_environment_report(
    release: Mapping[str, object],
    target: BoxTarget,
    *,
    expanded: bool = False,
    reveal_host_values: bool = False,
) -> EnvironmentReport:
    """Return a verification-time host plus release snapshot without executing anything."""

    declared = cast(Mapping[str, str] | None, release.get("environment"))
    return resolve_environment(
        target,
        (("host", os.environ), ("release", declared)),
        expanded=expanded,
        reveal_host_values=reveal_host_values,
    )[1]
