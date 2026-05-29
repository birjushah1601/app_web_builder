# Plan E — Tests Artifact Kind (Vitest unit tests against frontend)

**Status:** Approved 2026-05-29
**Parent spec:** `docs/superpowers/specs/2026-05-26-multi-artifact-workflow-design.md` (§4, §10)
**Predecessors:** Plans A (engine core), B (workflow-planner), C (graph view UI), D (backend artifact + typed handoff)
**Successor (planned):** Plan E.2 — Playwright e2e + pytest for backend

---

## Goal

A workflow node with `artifactKind: "tests"` that `consumes` a frontend node runs `role-tester` against the existing frontend sandbox: the role generates Vitest unit tests for the frontend's components, runs them, parses the JSON results, and emits a typed `TestsArtifact`. The user sees a pass/fail results table in the canvas (replacing Plan C's `TestsStubCanvas`). The typed handoff machinery from Plan D Task 8.5 already merges this artifact into any downstream consumer.

This is the second producer plan after Plan D. Same shape; smaller surface (no UI iframe, no separate sandbox).

## Architecture decisions (locked)

1. **Framework = Vitest only for v1.** Playwright e2e + pytest for backend deferred to E.2.
2. **Target = frontend nodes** (the role activates when the ritual's artifactKind is `tests` AND its consumes include a `frontend-app` node).
3. **Sandbox = the frontend node's existing sandbox.** Install Vitest at ritual time via `sandbox.exec("pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom")`. ~30s install; no template rebuild. Tests live in `__tests__/*.test.tsx` next to components.
4. **Role flow** mirrors Plan D's role-developer + BackendArtifactRole split:
   - **TestsRole.run()** does: install runner → read upstream frontend artifact's `pages` list → LLM emit test files → write to sandbox → execute `vitest run --reporter=json` → parse JSON → construct + validate TestsArtifact → emit `ritual.artifact_emitted` event.
   - One role does everything (no second "TestsEmitterRole") because there's no separate gate to gate on; the runner is the gate.
5. **Renderer = TestsCanvas results table.** Reads `artifact.specs[]` for the row list, `artifact.coverage` for the summary footer. Replaces `TestsStubCanvas.tsx` at the `test-results` mode ID.
6. **Workflow-engine wiring.** Plan D Task 8.5 already calls `ritualEngine.start({ priorArtifact: { upstream } })`. For a tests node, the per-node ritual targets a new role chain (`role-tester` only — no architect/developer/build-gate). Add a small per-node role-router (an extension to the ritual-engine OR to atlas-web's factory) so the tests artifactKind dispatches `role-tester` instead of `role-architect → role-developer → ...`.

## Per-kind shape

```ts
TestsArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("tests"),
  framework: z.enum(["vitest", "playwright", "pytest"]),
  specs: z.array(z.object({
    file: z.string(),
    targets: z.array(z.string()),       // upstream node ids the spec exercises
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    lastError: z.string().optional()    // first failure message, if any
  })),
  coverage: z.object({
    lines: z.number(),                  // percent 0-100
    branches: z.number()
  }).optional()
})
```

## Out of scope (Plan E.2 / later)

- Playwright e2e (separate sandbox + frontend running)
- pytest for backend (atlas-fastapi already has pytest in dev deps)
- Coverage thresholds / fail-on-coverage-below-N
- Test retries / quarantine
- Cross-stack integration tests (backend ↔ frontend)
- Per-spec re-run controls in the UI
- Visual regression tests
- GraphQL backend tests

## Affected packages + new files

**New packages:**
- `packages/role-tester/` — the new role package (src, test, package.json, tsconfig)

**New files:**
- `packages/workflow-engine/src/artifact-contracts/tests.ts` — TestsArtifactSchema + registration
- `packages/role-tester/src/build-artifact.ts` — pure: vitest JSON output + spec metadata → TestsArtifact
- `packages/role-tester/src/parse-vitest-json.ts` — pure: vitest JSON shape → normalized SpecResult[]
- `packages/role-tester/src/role.ts` — TestsRole implements Role
- `apps/atlas-web/components/canvas/renderers/TestsCanvas.tsx` — replaces TestsStubCanvas
- Test files for all of the above

**Modified files:**
- `packages/workflow-engine/src/artifact-contracts/index.ts` — side-effect import
- `apps/atlas-web/lib/engine/factory.ts` — register TestsRole in the conductor; route tests-kind rituals through it
- `apps/atlas-web/components/canvas/register-renderers.tsx` — swap stub → real
- Possibly `packages/workflow-engine/src/engine.ts` — if launchRitual needs to thread an `artifactKindHint` to the ritual engine so it can pick a role chain (TBD during planning).

**Deleted files:**
- `apps/atlas-web/components/canvas/renderers/TestsStubCanvas.tsx`

## Shippable result

A user submits a prompt → workflow-planner emits a DAG that includes a tests node consuming the frontend node. The frontend node runs, produces `FrontendArtifact`. The scheduler launches the tests node; `priorArtifact.upstream[frontendNodeId]` carries the FrontendArtifact. TestsRole installs Vitest into the sandbox, LLM-generates test files based on the artifact's pages list, runs vitest, parses results, emits a TestsArtifact. The user drills into the tests node and sees a results table (pass/fail per spec, runtime, last error, coverage). Plan D.2 and future consumers can read the artifact off the workflow node.
