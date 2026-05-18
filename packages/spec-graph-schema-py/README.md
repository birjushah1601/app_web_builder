# spec-graph-schema (Python)

Python Pydantic v2 bindings for the Atlas Spec Graph v1 schema.

This package is a **generated-from-TypeScript** mirror of `@atlas/spec-graph-schema`. The canonical source of truth is the Zod schema in `packages/spec-graph-schema/src/`; this package re-publishes that schema's JSON Schema artifact as typed Pydantic models so that Python consumers (notably `cloud_migration`) can parse and serialize Spec Graph documents without re-implementing the shape.

## What this package provides

- `SpecGraph` — root Pydantic model (generated)
- Every node and edge type as a Pydantic model (generated; see `spec_graph_schema.models`)
- `InvariantCode` — `Enum` of the 17 canonical invariant code strings
- `INVARIANT_CODES` — sorted `list[str]` of those codes
- `validate_structural(graph)` — Draft 2020-12 JSON Schema structural validator; returns `StructuralValidationResult(ok, issues)`

## What this package does NOT provide

- **The 14 structural invariants.** Invariant logic lives in the TS package (`@atlas/spec-graph-schema/validate`) and is canonical there. Python consumers that need invariant-level checks call the TS validator via a future HTTP endpoint, not a duplicated Python port.

## Install

This package is workspace-private; it is not on PyPI. To use it in a sibling Python project:

```bash
# from the repo root, editable install
uv pip install -e packages/spec-graph-schema-py
```

## Usage

```python
import json
from spec_graph_schema import SpecGraph, validate_structural, InvariantCode

# Structural validation
graph = json.loads(open("my_graph.json").read())
result = validate_structural(graph)
if not result.ok:
    for issue in result.issues:
        print(f"{issue.path}: {issue.message}")

# Typed parse
model = SpecGraph.model_validate(graph)
print(model.project_id, len(model.nodes))

# Error vocabulary shared with the TS validator
print(InvariantCode.I01_PAGE_MISSING_ROUTEREF.value)
```

## Generator policy

The file `src/spec_graph_schema/models.py` is **generated** — do not hand-edit. Its first line is the banner:

```
# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT
```

To regenerate (after a TS schema change):

```bash
pnpm -F @atlas/spec-graph-schema build   # rebuilds JSON Schema + invariant codes
pnpm py:gen                               # syncs artifacts + regenerates models.py
```

The generator is `tools/generate-pydantic.mjs` (invoked via `uv run datamodel-codegen`, version-pinned in `pyproject.toml`'s dev dependency group).

## Drift check

`pnpm py:check` regenerates `models.py` and runs `git diff --exit-code` against the committed file. It fails if the two do not match — catching the case where a Zod schema change wasn't followed by a Python regeneration. Run before every commit that touches the TS schema; the check is CI-ready when CI is wired (not in B.2 scope).

## Testing

```bash
cd packages/spec-graph-schema-py
uv sync
uv run pytest
```

Tests read TS fixtures at `../spec-graph-schema/test/fixtures/` — no duplicated fixture corpus. The test suite includes:
- `test_invariant_codes.py` — drift parity between the Python `InvariantCode` enum and the TS-emitted `invariant-codes.json`.
- `test_validate_structural.py` — Draft 2020-12 structural validator over the canonical fixture + synthetic malformed inputs.
- `test_generated_banner.py` — guards against hand-edits to `models.py`.
- `test_models_roundtrip.py` — parses the §5.5 forgot-password fixture and asserts semantic round-trip equivalence.
- `test_drift_check.py` — negative test for `pnpm py:check`: mutating the source schema makes the check fail; restoring it makes it pass.
