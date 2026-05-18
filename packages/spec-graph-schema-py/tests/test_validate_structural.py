"""JSON-Schema-only structural validation.

Invariant logic (the 14 graph-level checks) is NOT ported in B.2;
`validate_structural` runs only Draft 2020-12 schema validation.
"""
from __future__ import annotations


def test_valid_fixture_passes(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema.validate_structural import validate_structural

    result = validate_structural(valid_forgot_password_graph)
    assert result.ok is True, f"expected ok, got issues: {result.issues}"
    assert result.issues == []


def test_missing_required_field_fails() -> None:
    from spec_graph_schema.validate_structural import validate_structural

    malformed = {
        # "schemaVersion" deliberately missing
        "projectId": "11111111-1111-4111-8111-111111111111",
        "name": "demo",
        "complianceClasses": ["baseline"],
        "nodes": {},
        "edges": [],
    }
    result = validate_structural(malformed)
    assert result.ok is False
    assert len(result.issues) >= 1
    joined = " ".join(issue.message for issue in result.issues).lower()
    assert "schemaversion" in joined or "required" in joined


def test_wrong_type_fails() -> None:
    from spec_graph_schema.validate_structural import validate_structural

    malformed = {
        "schemaVersion": "1.0.0",
        "projectId": 12345,  # should be a UUID string
        "name": "demo",
        "complianceClasses": ["baseline"],
        "databaseProvider": {"tier": "atlas-run", "provider": "neon", "region": "us-east-1", "connectionStringRef": "env:DB"},
        "templateDigest": "sha256:" + "0" * 64,
        "createdAt": "2026-04-20T00:00:00.000Z",
        "updatedAt": "2026-04-20T00:00:00.000Z",
        "nodes": {},
        "edges": [],
    }
    result = validate_structural(malformed)
    assert result.ok is False


def test_issue_path_is_tuple_of_str_or_int() -> None:
    from spec_graph_schema.validate_structural import validate_structural

    malformed = {"schemaVersion": 1}  # many required fields missing, and wrong type
    result = validate_structural(malformed)
    assert result.ok is False
    for issue in result.issues:
        assert isinstance(issue.path, tuple)
        for segment in issue.path:
            assert isinstance(segment, (str, int)), f"segment {segment!r} has type {type(segment)}"
