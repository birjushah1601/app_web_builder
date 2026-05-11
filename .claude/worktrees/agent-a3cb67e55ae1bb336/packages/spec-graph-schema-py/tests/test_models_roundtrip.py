"""The canonical fixture must parse via Pydantic and round-trip semantically.

Semantic equivalence means: after dumping with `exclude_defaults=True` and
normalizing ISO datetime milliseconds, the dumped form equals the input
modulo key ordering. Default-valued fields (authRequired=False, empty
lists, empty dicts) are not required to appear in either the fixture or
the dump — they're the same graph either way.
"""
from __future__ import annotations

import json


def test_spec_graph_parses(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema import SpecGraph

    graph = SpecGraph.model_validate(valid_forgot_password_graph)
    assert graph is not None


def test_spec_graph_roundtrips(valid_forgot_password_graph: dict) -> None:
    """The canonical fixture round-trips through Pydantic modulo:
       - default-valued fields (Pydantic serializes defaults; fixture omits them)
       - datetime millisecond canonicalization (.000Z ↔ Z)
       - key ordering
    """
    import re
    from spec_graph_schema import SpecGraph

    graph = SpecGraph.model_validate(valid_forgot_password_graph)
    dumped = graph.model_dump(
        mode="json", by_alias=True, exclude_none=True, exclude_defaults=True
    )

    def normalize(obj):
        if isinstance(obj, dict):
            return {k: normalize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [normalize(v) for v in obj]
        if isinstance(obj, str):
            # Canonicalize trailing zero milliseconds in ISO datetimes
            return re.sub(r"(T\d{2}:\d{2}:\d{2})\.000Z$", r"\1Z", obj)
        return obj

    input_canon = json.dumps(normalize(valid_forgot_password_graph), sort_keys=True)
    dumped_canon = json.dumps(normalize(dumped), sort_keys=True)

    if input_canon != dumped_canon:
        # Produce a readable diff for debugging
        import difflib
        diff_lines = list(difflib.unified_diff(
            input_canon.splitlines(),
            dumped_canon.splitlines(),
            fromfile="input",
            tofile="dumped",
            n=3,
        ))
        diff_text = "\n".join(diff_lines) if diff_lines else "(empty diff; see canon strings)"
        raise AssertionError(
            f"semantic round-trip mismatch:\n"
            f"  input  = {input_canon[:500]}\n"
            f"  dumped = {dumped_canon[:500]}\n"
            f"diff:\n{diff_text}"
        )


def test_public_exports_are_importable() -> None:
    """Spec §7 public API must be importable from the top-level package."""
    import spec_graph_schema as sgs

    expected = {
        # Root
        "SpecGraph",
        # 14 nodes
        "Page", "Route", "Component", "ClientState", "Model", "Endpoint",
        "Flow", "AuthBoundary", "Test", "DesignToken", "Dependency",
        "ComplianceClass", "AIFeature", "MediaAsset",
        # 13 edges
        "RendersEdge", "FetchesEdge", "ReadsEdge", "MutatesEdge",
        "RequiresEdge", "CoversEdge", "DependsOnEdge", "StyledByEdge",
        "SubjectToEdge", "SupersedesEdge", "PowersEdge", "DisplaysEdge",
        "ManagesEdge",
        # Error vocabulary
        "InvariantCode", "INVARIANT_CODES",
        # Validation
        "validate_structural", "StructuralValidationResult", "StructuralIssue",
    }
    missing = expected - set(sgs.__all__)
    assert not missing, f"missing from spec_graph_schema.__all__: {missing}"

    # Verify each name resolves to a real attribute.
    for name in expected:
        assert hasattr(sgs, name), f"spec_graph_schema has no attribute {name!r}"

    assert isinstance(sgs.INVARIANT_CODES, list) and len(sgs.INVARIANT_CODES) >= 17
    assert callable(sgs.validate_structural)
