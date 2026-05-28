# Plan D — Backend Artifact Kind + Typed Handoff Foundation

**Status:** Approved 2026-05-29
**Parent spec:** `docs/superpowers/specs/2026-05-26-multi-artifact-workflow-design.md` (§4, §10)
**Predecessors:** Plans A (engine core), B (workflow-planner role), C (graph view UI)
**Successor (planned):** Plan D.2 — frontend cross-stack consumption of `BackendArtifact` via `openapi-typescript`

---

## Goal

A workflow node with `artifactKind: "backend-rest-api"` runs the existing `role-developer` against the `atlas-fastapi` E2B template, emits a typed `BackendArtifact` (validated against a Zod schema), passes a Python build gate, and the user sees real Swagger UI in the canvas — replacing `BackendStubCanvas`. Plumbing along the way unblocks Plans E/F by giving them a real typed-artifact handoff to build on.

This is the first plan that proves the multi-artifact workflow pillar's central thesis (typed artifact handoff between rituals) end-to-end on a real backend.

## Architecture decisions (locked)

1. **Scope = producer end-to-end.** Backend node produces a typed artifact, validated, displayed in the canvas. Frontend cross-stack consumption (openapi-typescript client generation) is Plan D.2.
2. **Swagger UI = iframe to sandbox `/docs`.** FastAPI auto-serves Swagger UI; matches today's `PreviewCanvas` iframe pattern; zero new deps.
3. **awaitRitual unstub is in Plan D scope.** Currently the engine's `makeAwaitRitual()` is a Plan A stub returning a hardcoded generic artifact. Unstubbing it is foundation work that benefits every subsequent artifact kind (D/E/F), but rolling it into Plan D keeps the plan a single coherent shipping unit.
4. **Handoff mechanism = `ritual.artifact.produced` event.** Role emits a typed-artifact event on the ritual's SSE stream before terminal state. awaitRitual reads it. Keeps RitualEngine's public surface unchanged, uses existing communication channel, gives crash-safe artifact recovery for free via event log replay.

## Architecture

### 1. Typed artifact handoff (foundation)

New event type `ritual.artifact.produced` carrying `{ artifactKind: string, artifact: unknown }`. The role emits it before its terminal `ritual.completed` event.

WorkflowEngine's `awaitRitual` is replaced with a real implementation that:

1. Polls `ritualEngine.getRitual(ritualId)` until state ∈ `{completed, failed, aborted}`. Polling interval starts at 250ms; backs off to 2s after 10s elapsed.
2. Walks the ritual's `roleEvents` newest-first looking for `ritual.artifact.produced`.
3. Validates the artifact against `ArtifactContractRegistry.get(artifactKind)`. Missing kind → falls back to `GenericArtifactSchema` (today's behaviour preserved for unknown kinds).
4. Returns `{ kind: "done", artifact, artifactKind }` or `{ kind: "failed", error }`.

If the role completes but emits no artifact event, awaitRitual synthesizes a generic-shaped artifact `{ schemaVersion: "1", kind: "generic", payload: {} }` so today's stub callers (frontend rituals that don't yet emit artifacts) keep working unchanged.

**Event ordering invariant:** artifact event MUST be published before the terminal event. The role enforces this; awaitRitual treats an artifact-after-terminal scenario as "no artifact produced" rather than failing.

### 2. BackendArtifact contract

New file `packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts` exporting:

```ts
BackendArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("backend-rest-api"),
  openApiSpec: z.record(z.unknown()),                   // OpenAPI 3.1 doc
  routes: z.array(z.object({
    method: z.enum(["get","post","put","patch","delete","head","options"]),
    path: z.string(),
    opId: z.string().optional(),
    requestSchema: z.record(z.unknown()).optional(),
    responseSchema: z.record(z.unknown()).optional()
  })),
  dbDdl: z.string().optional(),
  envContract: z.array(z.object({
    name: z.string(),
    required: z.boolean(),
    description: z.string().optional()
  })),
  sandboxId: z.string(),
  previewUrl: z.string().url().optional()
})
```

Registered against `ArtifactContractRegistry` at module load. Matches spec §4 verbatim.

### 3. Role emits the artifact

After the developer role applies its diff to the FastAPI sandbox AND the build gate passes:

1. Role waits for `GET {previewUrl}/health` to return ok (existing readiness pattern).
2. Role hits `GET {previewUrl}/openapi.json` → that's `openApiSpec` (FastAPI generates it lazily on first request).
3. Walks `openApiSpec.paths` to derive the flat `routes[]` list.
4. Reads env contract by parsing `pydantic-settings` symbols in `app/config.py` (convention: a single `Settings(BaseSettings)` class with typed fields; each field becomes an env entry with `required = field.default is None`).
5. Constructs `BackendArtifact`, validates locally against the schema, publishes `ritual.artifact.produced` on the broker. Validation failure → role fails with the Zod error message (engine marks the node `failed`).

Only fires when `artifactKind === "backend-rest-api"`. For frontend rituals today, role-developer keeps doing what it does (no artifact event → engine synthesizes generic).

### 4. Python build gate

The `atlas-fastapi` template already ships `ruff` and `pytest`. We add `pyright` to the template's `pyproject.toml` (verify it lands in the next template build).

New `packages/gate-build-python` mirrors `packages/gate-build`'s shape:
- Exports `PythonBuildGateRole` (sibling to today's `BuildGateRole`) and `runPythonBuildCheck({ sandbox })`.
- `runPythonBuildCheck` does:
  - `sandbox.exec("uv run ruff check app/ --output-format=json")` — lint
  - `sandbox.exec("uv run pyright app/ --outputjson")` — types
  - Returns `{ passed: boolean, failures: Array<{ tool: "ruff"|"pyright", file: string, line: number, message: string }> }`
- `PythonBuildGateRole` produces the same `BuildReport` shape as `BuildGateRole` so the ritual-engine's `priorRitualContext.buildReport` consumers (today: developer-role retry path) work unchanged across languages.

Wired into the ritual-engine's post-developer chain (the same place `BuildGateRole` is dispatched today) via a small switch on the active sandbox template: `atlas-fastapi` → `PythonBuildGateRole`, anything else → today's `BuildGateRole`. The selector lives in the ritual-engine, not in the gate package, so each gate package stays language-pure.

**Fallback:** if adding pyright bloats the E2B image past acceptable size, fall back to mypy. Decision deferred until the template rebuild is benchmarked.

### 5. Swagger UI canvas renderer

Replace `BackendStubCanvas` with a real `BackendCanvas` component:

```tsx
<div className="flex h-full flex-col">
  <header className="flex items-center gap-2 border-b px-3 py-2 text-xs">
    <span className="font-mono">{previewUrl}</span>
    <button onClick={copyCurl}>Copy curl example</button>
  </header>
  <iframe
    src={`${previewUrl}/docs`}
    className="h-full w-full border-0"
    data-testid="backend-swagger-iframe"
  />
  {previewError && <ErrorOverlay error={previewError} />}
</div>
```

Renderer reads `BackendArtifact` from the workflow node's `artifact` field so it can show routes + curl examples even without consulting the sandbox. Error overlay mirrors today's `previewError` UX in `PreviewCanvas`.

Registered against the `swagger` mode ID — `register-renderers.tsx` swaps `BackendStubCanvas` for `BackendCanvas` (the placeholder shipped in Plan C Task 11).

### 6. Testing strategy

**Unit:**
- `packages/workflow-engine/test/artifact-contracts/backend-rest-api.test.ts` — Zod validation happy/sad paths
- `packages/workflow-engine/test/engine-await-ritual.test.ts` — awaitRitual happy path with mock ritual events, generic-artifact fallback, failed ritual surfaces the error string, polling backoff
- `packages/role-developer/test/backend-artifact-emission.test.ts` — artifact construction from a fixture `openapi.json`
- `apps/atlas-web/test/components/canvas/renderers/BackendCanvas.test.tsx` — renders iframe with right `src`; error overlay when previewError set; curl example uses first route from artifact
- `packages/gate-build-python/test/parse-output.test.ts` — parses ruff/pyright JSON output into `failures[]`

**Integration:**
- `packages/workflow-engine/test/integration-backend-real-handoff.test.ts` — uses an in-process fake ritual engine that emits a real BackendArtifact event; asserts engine persists the validated artifact and downstream nodes see it in `priorArtifact.upstream`.

**E2E:** None in Plan D. Full backend E2E against E2B is deferred since it needs API credit. The component tests cover the renderer; the integration test covers the engine handoff; the future Plan D.2 covers the cross-stack flow.

### 7. Risks + explicit out-of-scope

**Risks:**
- Pyright availability in the template image (mitigation: mypy fallback)
- OpenAPI fetch race (mitigation: wait for `/health` first; FastAPI generates `/openapi.json` lazily on first hit)
- Event ordering between `ritual.artifact.produced` and `ritual.completed` (mitigation: role publishes synchronously in order; awaitRitual treats out-of-order as no-artifact rather than failing)

**Out of scope:**
- Frontend cross-stack consumption (`openapi-typescript` client generation) → Plan D.2
- GraphQL backend (kind exists but template doesn't) → future plan
- Auth code generation from `dependencyProfile.auth` choice (e.g., Keycloak integration scaffolding) → future plan
- Cross-stack integration gates ("does frontend's fetch match backend's OpenAPI") → deferred per parent spec §1
- Cloud deploy targets, Terraform, k8s manifests → Plans F+ or later

## Affected packages + new files

**New packages:**
- `packages/gate-build-python/` — Python build gate

**New files:**
- `packages/workflow-engine/src/artifact-contracts/backend-rest-api.ts`
- `apps/atlas-web/components/canvas/renderers/BackendCanvas.tsx` (replaces `BackendStubCanvas`)
- Plus the test files listed in §6.

**Modified files:**
- `packages/workflow-engine/src/engine.ts` — replace `makeAwaitRitual()` stub with real implementation
- `packages/workflow-engine/src/types.ts` (or events file) — add `ritual.artifact.produced` event type
- `packages/role-developer/src/role.ts` — backend-rest-api branch emits artifact event after build gate passes
- `packages/role-developer/src/` — new helper for OpenAPI → BackendArtifact construction
- `packages/sandbox-e2b/templates/atlas-fastapi/pyproject.toml` — add pyright dep
- `apps/atlas-web/components/canvas/register-renderers.tsx` — swap stub for real BackendCanvas
- `apps/atlas-web/components/canvas/renderers/BackendStubCanvas.tsx` — delete or fold into BackendCanvas
- `packages/ritual-engine/src/engine.ts` — at the post-developer gate-dispatch point, switch on the active sandbox template to choose `PythonBuildGateRole` vs `BuildGateRole`

## Shippable result

A user can submit a prompt that the workflow-planner classifies as needing a backend node. The node runs the developer role against the `atlas-fastapi` sandbox. Ruff + pyright gate the code. On pass, the role fetches the live OpenAPI spec, constructs a typed `BackendArtifact`, emits it. The engine persists the validated artifact and surfaces it on the workflow node. The user drills into the backend node and sees real Swagger UI (FastAPI's `/docs`) with their generated endpoints, plus a copy-curl affordance. The typed artifact is now sitting in the database, ready for Plan D.2 to consume from a frontend node.
