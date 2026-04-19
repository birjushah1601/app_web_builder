# B.2 — Python Bindings for `@atlas/spec-graph-schema` + C.1/D.1 Directional Refresh

> **Purpose:** Design doc for Plan B.2 (executable task-level plan, to be authored next) and for the directional refresh of Units C.1 and D.1 in `2026-04-18-phase-a-units-b-through-g.md`.
>
> **Author date:** 2026-04-20
> **Predecessors:** Plan B.1 merged at `c7ab760` (43 commits, 164 tests, `@atlas/spec-graph-schema` v0.0.0 shipped).
> **Successor:** `docs/superpowers/plans/2026-04-20-spec-graph-schema-py.md` — executable task list (to be authored by `superpowers:writing-plans`).

---

## 1. Goal

Publish `packages/spec-graph-schema-py/` — a Python 3.11+ package that exposes the Atlas Spec Graph v1 shape as Pydantic v2 models, plus a JSON-Schema-only structural validator and the shared `InvariantCode` enum. It consumes the canonical JSON Schema artifact emitted by the TS package's build (`packages/spec-graph-schema/dist/schema/spec-graph.v1.schema.json`) and is regenerated deterministically from it.

Non-goal for B.2: porting the 14 structural invariants to Python. Invariants stay TS-only until a Python consumer (e.g., `cloud_migration` fusion in Phase B-2) demands offline validation. At that point a follow-up plan (tentatively B.3) will port them.

## 2. Resolved decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | Generator | `datamodel-code-generator` invoked via `uvx`; Pydantic v2 output. |
| D2 | Toolchain + monorepo fit | `uv` + PEP-621 `pyproject.toml`; sibling folder at `packages/spec-graph-schema-py/`; excluded from pnpm workspace glob. |
| D3 | Scope | Bindings-only. No invariant logic port. `InvariantCode` enum is hand-authored and asserted-equal to TS codes via test. |
| D4 | C.1/D.1 deliverable shape | Refresh the directional sections in `2026-04-18-phase-a-units-b-through-g.md`. No new plan files; no task-level detail. |
| D5 | Generator commit strategy | **A** — committed artifacts (`src/spec_graph_schema/models.py` checked in) + `git diff --exit-code` drift check. Matches OpenAPI/GraphQL codegen precedent. |

## 3. Architecture

Source of truth lives in TypeScript (`packages/spec-graph-schema/src/`). The TS build emits `dist/schema/spec-graph.v1.schema.json` and, as a new one-line addition in B.2, a sibling `dist/schema/invariant-codes.json` (the array of 14 code strings).

B.2 adds three things:

1. A Python package folder `packages/spec-graph-schema-py/` (uv-managed, excluded from pnpm workspace).
2. Two Node-authored generator tools under `tools/`:
   - `tools/sync-schema-artifact.mjs` — copies the two TS-emitted JSON artifacts into `packages/spec-graph-schema-py/schema/` and into the Python package as runtime resources.
   - `tools/generate-pydantic.mjs` — spawns `uvx datamodel-code-generator` with deterministic flags and writes `packages/spec-graph-schema-py/src/spec_graph_schema/models.py`.
3. Three root-level `package.json` scripts: `py:gen`, `py:check`, `py:test`.

No `.github/workflows/ci.yml` exists yet. The drift check is authored in B.2 as a local command (`pnpm py:check`) and documented as the required CI job once CI is wired. B.2 does not author CI itself — that is a distinct cross-package concern.

## 4. Components + file layout

Files B.2 creates or modifies. Paths relative to `f:/claude/ai_builder/`.

```
packages/
  spec-graph-schema/                       # MODIFIED — TS package
    scripts/
      generate-json-schema.mjs             # +8 lines: also emit invariant-codes.json

  spec-graph-schema-py/                    # NEW
    pyproject.toml                         # PEP-621; requires-python >=3.11
    uv.lock                                # uv-managed lockfile (committed)
    README.md                              # usage, generator policy, drift-check contract
    schema/
      spec-graph.v1.schema.json            # synced from TS dist/ by sync-schema-artifact.mjs
      invariant-codes.json                 # synced from TS dist/ by sync-schema-artifact.mjs
    src/
      spec_graph_schema/
        __init__.py                        # public API: re-exports
        models.py                          # GENERATED — codegen banner on line 1
        invariants.py                      # hand-authored: InvariantCode Enum + INVARIANT_CODES
        validate_structural.py             # jsonschema.Draft202012Validator wrapper
        _schema_artifact.py                # loads bundled JSON Schema as importlib.resources
        py.typed                           # PEP-561 marker
    tests/
      __init__.py
      test_models_roundtrip.py             # reads TS fixtures, parses via Pydantic
      test_invariant_codes.py              # enum values == TS invariant-codes.json
      test_validate_structural.py          # Draft202012 validator over fixtures
      test_generated_banner.py             # first lines of models.py == banner

tools/                                     # NEW files under existing folder
  sync-schema-artifact.mjs                 # copies JSON artifacts + embeds schema hash
  generate-pydantic.mjs                    # spawns `uvx datamodel-code-generator ...`

pnpm-workspace.yaml                        # MODIFIED — add "!packages/spec-graph-schema-py"
package.json                               # MODIFIED — add py:gen, py:check, py:test scripts
docs/superpowers/plans/
  2026-04-18-phase-a-units-b-through-g.md  # MODIFIED — C.1 and D.1 sections refreshed
```

**Why this shape.** The Python package is a sibling, not a child, of the TS package so uv owns its tree cleanly. Generator scripts live under `tools/` alongside `council.mjs` and `smoke-test.mjs` (existing pattern), not inside the Python package, because they're invoked from Node and shouldn't require a Python interpreter merely to read them. The JSON artifacts are duplicated (once in `dist/schema/` in TS, once in `schema/` in Python) on purpose — the Python package must be standalone-installable and its runtime cannot reach into the TS `dist/`.

## 5. Data flow

```
TS source             TS build            Sync + codegen          Python package
─────────             ────────            ──────────────          ──────────────
src/nodes/*.ts  \
src/edges/*.ts   \
src/graph.ts      ─→  zod-to-json-    ─→  tools/sync-schema-  ─→  schema/spec-graph.v1.schema.json
                      schema               artifact.mjs            schema/invariant-codes.json
src/invariants/  /    generate-json-
                      schema.mjs                  │
                           │                       │
                           │                       ↓
                           │                 tools/generate-
                           │                 pydantic.mjs
                           │                 (uvx datamodel-      ┌─ src/spec_graph_schema/
                           │                  code-generator)  ───┤    models.py (GENERATED)
                           │                                      │    invariants.py (hand)
                           └──────────────────────────────────────┤    validate_structural.py (hand)
                                                                  │    _schema_artifact.py (hand)
                                                                  └── __init__.py (hand)
```

**The drift loop:** developer edits Zod schema → runs `pnpm -F @atlas/spec-graph-schema build` → runs `pnpm py:gen` → commits both the TS change and the regenerated `models.py` in one PR. CI (when wired) re-runs `pnpm py:gen` and fails if git diff is non-empty.

## 6. Testing strategy

**Single source of fixtures.** The TS fixture corpus at `packages/spec-graph-schema/test/fixtures/` is the only committed JSON fixture set. In B.1 this corpus is one file: `valid-forgot-password.json` (the §5.5 example from the spec-graph v1 design). B.1's invariant tests build violation cases inline in vitest via a `baseGraph(extras)` helper rather than committing per-invariant JSON files; B.2 follows the same convention (inline Python literals for structurally-malformed cases).

Python tests read the valid fixture via relative path (`../../spec-graph-schema/test/fixtures/valid-forgot-password.json`) — no duplication.

Four pytest files, data-driven:

| File | Asserts |
|---|---|
| `test_models_roundtrip.py` | `valid-forgot-password.json` parses via `SpecGraph.model_validate()`. `.model_dump(mode="json", by_alias=True, exclude_none=True)` is data-equal to the input modulo key ordering (`json.dumps(sort_keys=True)` equivalence). |
| `test_invariant_codes.py` | `{code.value for code in InvariantCode} == set(json.load(open('schema/invariant-codes.json')))`. Expected cardinality: 17 codes (14 invariants, three of which emit two codes each: I04, I07, I08). |
| `test_validate_structural.py` | `validate_structural(valid_fixture)` returns `ok=True`. `validate_structural(malformed)` — where `malformed` is an inline dict with a missing required field — returns `ok=False` with a populated `issues` list. |
| `test_generated_banner.py` | `models.py` line 1 equals the exact banner string `# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT`. |

No Python-side invariant tests. No duplicated valid corpus.

## 7. Public API

```python
from spec_graph_schema import (
    SpecGraph, Page, Route, Component, ClientState, Model,
    Endpoint, Flow, AuthBoundary, Test, DesignToken, Dependency,
    ComplianceClass, AIFeature, MediaAsset,
)
from spec_graph_schema import (
    RendersEdge, FetchesEdge, ReadsEdge, MutatesEdge, RequiresEdge,
    CoversEdge, DependsOnEdge, StyledByEdge, SubjectToEdge,
    SupersedesEdge, PowersEdge, DisplaysEdge, ManagesEdge,
)
from spec_graph_schema.invariants import InvariantCode, INVARIANT_CODES
from spec_graph_schema import validate_structural, StructuralValidationResult, StructuralIssue
```

`StructuralValidationResult`:

```python
@dataclass(frozen=True)
class StructuralIssue:
    path: tuple[str | int, ...]
    message: str

@dataclass(frozen=True)
class StructuralValidationResult:
    ok: bool
    issues: list[StructuralIssue]
```

Deliberately slimmer than TS `ValidationResult` — no `code: InvariantCode` field because no invariant logic. Python consumers that need invariant checking in Phase A call across to the TS validator via a future HTTP endpoint or a follow-up B.3 port; neither is in B.2 scope.

## 8. Generator determinism

`datamodel-code-generator` is pinned to an exact version in `pyproject.toml` (`datamodel-code-generator==0.26.3` at authoring; plan author verifies at execution). Invocation flags:

```
uvx datamodel-code-generator \
  --input packages/spec-graph-schema-py/schema/spec-graph.v1.schema.json \
  --input-file-type jsonschema \
  --output packages/spec-graph-schema-py/src/spec_graph_schema/models.py \
  --target-python-version 3.11 \
  --output-model-type pydantic_v2.BaseModel \
  --use-schema-description \
  --use-standard-collections \
  --use-union-operator \
  --disable-timestamp \
  --use-field-description \
  --capitalise-enum-members \
  --snake-case-field
```

The `--disable-timestamp` flag is load-bearing — without it, every regeneration churns the header. `--snake-case-field` converts JSON `camelCase` to Python `snake_case` with `alias=` preserved on each Pydantic field so `.model_dump(by_alias=True)` round-trips to JSON correctly.

The generated banner (prepended by `generate-pydantic.mjs` after codegen completes):

```python
# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT
# Source: packages/spec-graph-schema/src/
# Regenerate: pnpm py:gen
# Schema hash: <sha256 of spec-graph.v1.schema.json>
```

## 9. Caveats carried from B.1

1. **Zod v3 `discriminatedUnion` rejects `ZodEffects`.** Affects B.2 only if the generator's interpretation of JSON Schema `oneOf` + `discriminator` produces Pydantic discriminated unions that don't round-trip. Mitigation: `test_models_roundtrip.py` is the canary; if it fires, `generate-pydantic.mjs` gains a post-codegen patch step that rewrites the offending declaration to the `Annotated[Union[...], Field(discriminator=...)]` shape Pydantic v2 wants. Specific patch mechanics are deferred to plan-authoring when the failure (if any) is concrete.
2. **`zod-to-json-schema@3.23.5` silently ignores `target: "jsonSchema2020-12"`.** B.1's `generate-json-schema.mjs` manually injects `$schema: "https://json-schema.org/draft/2020-12/schema"`. B.2 relies on that injection being present — if it's ever removed, `datamodel-code-generator` will downshift to Draft-07 inference. Guard: `test_validate_structural.py` uses `jsonschema.Draft202012Validator` explicitly, which errors out if `$schema` is missing or wrong.

## 10. Rough task decomposition (for writing-plans)

Expected ~18–22 tasks:

- T1–T2: Scaffold `packages/spec-graph-schema-py/` (pyproject, uv.lock, README stub).
- T3: Add `!packages/spec-graph-schema-py` to `pnpm-workspace.yaml`; verify pnpm ignores it.
- T4: Extend `packages/spec-graph-schema/scripts/generate-json-schema.mjs` to also emit `invariant-codes.json`.
- T5: Author `tools/sync-schema-artifact.mjs` (+ test that it copies and hashes).
- T6: Author `tools/generate-pydantic.mjs` (+ test: runs, produces file, banner present).
- T7–T8: Add root scripts `py:gen`, `py:check`, `py:test`; verify each runs clean.
- T9: Hand-author `invariants.py` (InvariantCode Enum + INVARIANT_CODES list).
- T10: Hand-author `_schema_artifact.py` + `__init__.py` re-exports.
- T11: Hand-author `validate_structural.py` around `jsonschema.Draft202012Validator`.
- T12: First `py:gen` run — produces `models.py`; commit it.
- T13–T16: Four pytest files (one task each), TDD-shaped.
- T17: Drift-check smoke test — delete `models.py`, run `pnpm py:check`, assert non-zero exit.
- T18: README for the Python package (install, usage, generator policy).
- T19: Update B.1's handoff section in `2026-04-19-spec-graph-schema.md` pointing to the now-written B.2 plan.
- T20: Update `docs/superpowers/plans/README.md` plan index with the B.2 entry.
- T21–T22: Refresh C.1 and D.1 sections of `2026-04-18-phase-a-units-b-through-g.md` per §11 below.

The plan author (writing-plans) will split, merge, or expand these as appropriate.

## 11. C.1 / D.1 directional refresh

These edits land in the existing `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` as part of B.2 (one commit, small diff). They are **not** new plan files.

### 11.1 Unit C — Skill Framework refresh

Lock these open questions (move from "Open questions" to "Resolved"):

- **OQ1 (skill execution isolation) → main-process loader.** Rationale: B.1 confirmed the schemas-as-data pattern scales — skills stay markdown+frontmatter with no side-effect surface, so process isolation is unnecessary machinery.
- **OQ5 (pinning granularity) → exact pin + dependabot-style upgrade PRs.** Rationale: B.1's exact-version discipline for `zod`, `zod-to-json-schema`, `vitest` caught a silent 3.23.5 target-ignore bug; ranges would have hidden it.

Add these new open questions (to resolve at C.1 plan-authoring time):

- **OQ7 — Registry wiring.** Does the skill framework import `nodeRegistry` + `edgeRegistry` from `@atlas/spec-graph-schema` directly (tight coupling, single source) or re-declare a skill-local projection (looser, decoupled evolution)? Recommendation: direct import; the registry is already a public export and that's what it's for.
- **OQ8 — Cross-field refinement in skill I/O schemas.** B.1 learning: Zod v3 `discriminatedUnion` rejects `ZodEffects`, so `z.discriminatedUnion([...]).refine(...)` fails. Skill input/output schemas often need cross-field rules. Pattern to document: split the discriminator, apply `.superRefine` at the outer level, or use `z.union` + runtime discriminator check.

Leave OQ2, OQ3, OQ4, OQ6 as-is — they're genuinely unresolved and depend on C.1 execution measurements.

### 11.2 Unit D — Conductor + LLM Provider Abstraction refresh

Lock these open questions:

- **OQ1 (Agent-Teams abstraction vs internal lib) → internal lib.** Rationale: Claude Code's Agent Teams primitives are a developer-ergonomics convenience, not a runtime contract. Keeping the Conductor free of that import surface avoids runtime lock-in when Atlas ships as Helm chart (Phase D-5).
- **OQ5 (Browser Verification L3 role cut) → confirmed deferred to Phase B-8.** Rationale: B.1 shipped on time without it; L3 is advisory per PRD §11.4 for Phase A, merge-gating in Phase B. No change to D.1 scope.

Add these new open questions:

- **OQ6 — Prompt-cache prefix shape.** Three-tier structure: (a) skill system prompt (stable across turns), (b) graph context slice keyed by graph version, (c) user turn. Plan D.1 must spell out: how is slice (b) generated from `@atlas/spec-graph-data`? Deterministic ordering of nodes + edges? Content-hash of the slice as cache key?
- **OQ7 — Retry / circuit-breaker location.** Library-level (every LLM call wrapped) or conductor-level (retries per role invocation)? Recommendation: library-level default with per-role override, matching the `@atlas/spec-graph-data` observability pattern.

Sharpen OQ3 (role recovery on failure): B.1's opt-in validator pattern (data layer stays schema-agnostic unless constructor flag is set) is the template. Apply the same to Conductor: roles are retry-agnostic by default; retry policy is conductor-injected per dispatch.

Leave OQ2, OQ4 as-is.

## 12. Handoff to writing-plans

After this spec is committed and user-approved, invoke `superpowers:writing-plans` with inputs:

- This design doc (§1–§11)
- The B.1 plan file `2026-04-19-spec-graph-schema.md` as style reference
- The B.1 package (`packages/spec-graph-schema/`) as the producer whose artifacts B.2 consumes

Output: `docs/superpowers/plans/2026-04-20-spec-graph-schema-py.md` — a task-level TDD plan ready for `superpowers:subagent-driven-development` execution.

## 13. Out of scope (explicit non-goals for B.2)

- Porting the 14 structural invariants to Python (deferred; would be B.3 if ever needed).
- Publishing the Python package to PyPI (workspace-private in Phase A; public publish is a Phase B concern).
- Authoring `.github/workflows/ci.yml` and wiring the drift check into CI (separate cross-package concern).
- Extending `@atlas/spec-graph-schema-py` to any Phase B node types (Region, DataResidency, Runtime, etc.). Those ship with Unit B v1.1 in Phase B-1 and regenerate the Python bindings as an additive minor version.
- A markdown reference doc generator. The B.1 handoff mentioned it; on reflection it's cosmetic and can ride with C.2 (OSS Skill Library) which is itself a docs surface.
