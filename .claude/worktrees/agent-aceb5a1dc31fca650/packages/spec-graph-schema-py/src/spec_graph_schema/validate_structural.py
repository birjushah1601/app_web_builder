"""Draft 2020-12 JSON Schema structural validation.

This is intentionally *not* equivalent to the TS `validate()` function
— it runs no invariant logic. Python consumers that need invariant
checks call across to the TS validator via a future HTTP endpoint.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator

from ._schema_artifact import load_schema


@dataclass(frozen=True)
class StructuralIssue:
    path: tuple[str | int, ...]
    message: str


@dataclass(frozen=True)
class StructuralValidationResult:
    ok: bool
    issues: list[StructuralIssue] = field(default_factory=list)


def validate_structural(graph: Any) -> StructuralValidationResult:
    """Run JSON Schema 2020-12 structural validation over `graph`.

    Returns a StructuralValidationResult. When `ok` is False, `issues`
    is populated with one StructuralIssue per schema violation found.
    """
    schema = load_schema()
    validator = Draft202012Validator(schema)
    raw_errors = sorted(validator.iter_errors(graph), key=lambda e: list(e.absolute_path))

    issues = [
        StructuralIssue(path=tuple(err.absolute_path), message=err.message)
        for err in raw_errors
    ]
    return StructuralValidationResult(ok=(len(issues) == 0), issues=issues)
