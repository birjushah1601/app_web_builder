"""The Python InvariantCode enum must match the TS source of truth exactly."""
from __future__ import annotations


def test_invariant_code_enum_matches_bundled_artifact(bundled_invariant_codes: list[str]) -> None:
    from spec_graph_schema.invariants import InvariantCode, INVARIANT_CODES

    python_codes = {code.value for code in InvariantCode}
    ts_codes = set(bundled_invariant_codes)
    assert python_codes == ts_codes, f"drift: TS-Python = {ts_codes - python_codes}; Python-TS = {python_codes - ts_codes}"

    assert sorted(INVARIANT_CODES) == sorted(bundled_invariant_codes)


def test_invariant_code_cardinality(bundled_invariant_codes: list[str]) -> None:
    """Python enum cardinality must equal the bundled TS artifact.

    The exact count grows as new invariants are added in TS (B.1 shipped
    with 17 codes across 14 invariants; later invariants add I15, I16…).
    We no longer hard-code the count — the TS artifact is the source of
    truth, and the enum-vs-artifact parity test above is the real gate.
    """
    from spec_graph_schema.invariants import InvariantCode

    assert len(list(InvariantCode)) == len(bundled_invariant_codes)
    assert len(bundled_invariant_codes) >= 17, "invariant-codes.json regressed below B.1 baseline"


def test_invariant_code_format(bundled_invariant_codes: list[str]) -> None:
    import re
    pattern = re.compile(r"^I\d{2}_[A-Z0-9_]+$")
    for code in bundled_invariant_codes:
        assert pattern.match(code), f"code {code!r} does not match I\\d{{2}}_... pattern"
