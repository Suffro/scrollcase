"""Typed local verification and execution for Scrollcase boxes."""

from .errors import ScrollcaseConsumerError
from .models import (
    BoxExecution,
    BoxRunResult,
    BoxTarget,
    EnvironmentReport,
    EnvironmentSource,
    EnvironmentSourceValue,
    EnvironmentVariableReport,
    PayloadVerification,
    PreparedBox,
    PythonModuleExecution,
    PythonScriptExecution,
    RequiredAsset,
)
from .run import run_box, run_extracted_box
from .verify import (
    parse_trusted_keys,
    attach_extracted_box,
    verify_and_extract_box,
    verify_extracted_payload,
)

__all__ = [
    "BoxExecution",
    "BoxRunResult",
    "BoxTarget",
    "EnvironmentReport",
    "EnvironmentSource",
    "EnvironmentSourceValue",
    "EnvironmentVariableReport",
    "PayloadVerification",
    "PreparedBox",
    "PythonModuleExecution",
    "PythonScriptExecution",
    "RequiredAsset",
    "ScrollcaseConsumerError",
    "attach_extracted_box",
    "run_box",
    "run_extracted_box",
    "parse_trusted_keys",
    "verify_and_extract_box",
    "verify_extracted_payload",
]
