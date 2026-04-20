"""The canonical fixture must parse via Pydantic and round-trip to equal JSON."""
from __future__ import annotations

import json


def test_spec_graph_parses(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema import SpecGraph

    graph = SpecGraph.model_validate(valid_forgot_password_graph)
    assert graph is not None


def test_spec_graph_roundtrips(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema import SpecGraph

    graph = SpecGraph.model_validate(valid_forgot_password_graph)
    dumped = graph.model_dump(mode="json", by_alias=True, exclude_none=True)

    # Round-trip equality modulo key ordering
    input_canon = json.dumps(valid_forgot_password_graph, sort_keys=True)
    dumped_canon = json.dumps(dumped, sort_keys=True)
    assert input_canon == dumped_canon, (
        f"round-trip mismatch:\n"
        f"  input  = {input_canon[:300]}...\n"
        f"  dumped = {dumped_canon[:300]}..."
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

    assert isinstance(sgs.INVARIANT_CODES, list) and len(sgs.INVARIANT_CODES) == 17
    assert callable(sgs.validate_structural)
