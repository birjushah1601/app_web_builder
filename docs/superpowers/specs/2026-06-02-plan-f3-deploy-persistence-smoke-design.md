# Plan F.3 — Deploy persistence + smoke HTTP execution

**Status:** Approved 2026-06-02
**Parent spec:** `docs/superpowers/specs/2026-06-02-plan-f2-deploy-runtime-design.md`
**Predecessors:** Plans A–G + D.2 + F.2 merged. `DeployOrchestrator.deployFromArtifacts` runs the deploy; `WorkflowEngine`'s post-producer hook calls it; `node.deployResult` is set in-memory (not persisted across restarts).
**Successor (planned):** Plan F.4 — image build + push, GitOps repo push, per-run Postgres branching, OpenStack-specific resources

---

## Goal

Close two carryover gaps from Plan F.2:

1. **`node.deployResult` persists to disk.** New `workflow_nodes.deploy_result jsonb` column + migration; `WorkflowNodeRepo.setDeployResult` writes it; `buildSnapshot` reads it. Reload after process restart shows the persisted deploy state.
2. **Smoke tests actually run.** After Argo reports Healthy, `runDeployFromArtifacts` fires every `DeployArtifact.smokeTests[]` entry via HTTP. Per-smoke results (`status`, `ok`, `latencyMs`, `bodyExcerpt`) land in a new `DeployResult.smokeResults[]` field. Any smoke failure rolls back the deploy with a clear reason. UI surfaces per-row pass/fail badges in DeployCanvas.

## Architecture decisions (locked)

1. **Schema migration follows Plan G Task 2's pattern.** `0012_workflow_nodes_deploy_result.sql` in `packages/spec-graph-data/drizzle/`. Drizzle's `numeric` learning from G2 applies — `jsonb` round-trips as `unknown`; cast at the engine boundary.
2. **`SmokeTestResult` lives in `@atlas/workflow-engine`** alongside `DeployResult`. Per-smoke shape: `{ url, status, ok, latencyMs, bodyExcerpt? }`. `DeployResult.smokeResults?: SmokeTestResult[]` is optional — when no smoke tests are defined, the array is omitted.
3. **`runSmokeTests` is a new exported helper** in `@atlas/deploy-orchestrator`. Pure-ish (HTTP only; no DB/state). Takes `{ deployArtifact, publicUrl, fetcher? }` and returns `SmokeTestResult[]`. Default `fetcher = fetch`. Injected for tests.
4. **One run per smoke; no retries in v1.** A smoke result's `ok` is `false` if HTTP failed OR status didn't match `expectStatus` OR `expectBodyContains` didn't appear in the response body.
5. **Smoke failure rolls back the deploy** — mirrors the Argo-unhealthy path. Every applied manifest is deleted in reverse; DNS is removed; throw. The deploy node ends `failed` with the error.
6. **DeployCanvas's smoke-tests table** gains per-row badges. When `deployResult.smokeResults` is set, each smoke row in the table renders its status badge + latency. When unset (today's behavior), no badges.
7. **Per-smoke body excerpt** is capped at 200 chars to avoid bloating the artifact.
8. **Timeout per smoke = 10s default.** Configurable via `runSmokeTestsOptions.perSmokeTimeoutMs`. The whole batch runs sequentially in v1 (cheaper to reason about; parallel is a future polish).

## `SmokeTestResult` shape

```ts
SmokeTestResultSchema = z.object({
  url: z.string().min(1),               // matches the input smoke test's url
  method: z.enum(["get","post","put","patch","delete","head"]),
  status: z.number().int().min(0).max(599), // 0 = network/timeout failure
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  expectStatus: z.number().int().min(100).max(599),
  expectBodyContains: z.string().optional(),
  bodyExcerpt: z.string().optional(),   // first 200 chars of response body
  error: z.string().optional()          // present when ok=false
});
```

`DeployResult` gains:
```ts
smokeResults: z.array(SmokeTestResultSchema).optional()
```

## Out of scope (Plan F.4+)

- Image build + push
- GitOps repo push (Argo Application via Git PR)
- Real per-run Postgres branching
- OpenStack-specific manifests (LB, Cinder)
- Smoke retry policies
- Parallel smoke execution
- Cross-stack smoke (typed-api-client invocations)
- Backfill: existing `workflow_nodes` rows get `null` for `deploy_result` (no migration data movement)

## Affected packages + new files

**New files:**
- `packages/spec-graph-data/drizzle/0012_workflow_nodes_deploy_result.sql` — migration
- `packages/deploy-orchestrator/src/smoke-runner.ts` — `runSmokeTests` helper
- `packages/deploy-orchestrator/test/smoke-runner.test.ts` — helper tests

**Modified files:**
- `packages/spec-graph-data/src/schema/workflow-nodes.ts` — add `deployResult: jsonb("deploy_result")` column
- `packages/spec-graph-data/src/repo/workflow-node.repo.ts` — `setDeployResult` real impl + `findByRunId` returns it
- `packages/workflow-engine/src/types.ts` — `SmokeTestResultSchema`, extend `DeployResultSchema`
- `packages/workflow-engine/src/engine.ts` — `runDeployHookIfApplicable` stops swallowing "not implemented"; `buildSnapshot` reads `deploy_result` column
- `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` — call `runSmokeTests` after Argo Healthy; on failure → rollback + throw
- `packages/deploy-orchestrator/src/index.ts` — export `runSmokeTests`, `SmokeTestResult`
- `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx` — per-smoke badges + latency

## Shippable result

A workflow's deploy node, with `ATLAS_FF_DEPLOY_RUNTIME=true`, applies its artifacts AND runs every smoke test against the live `publicUrl`. Pass/fail badges appear inline in DeployCanvas. The deploy result (publicUrl + Argo + applied manifests + smoke results) is persisted on disk so reload-after-restart still shows the state. Smoke failures roll back the deploy with the same clean exit path as Argo-unhealthy. No further infra (image build, GitOps push, etc.) yet — those are Plan F.4.
