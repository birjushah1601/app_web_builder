# Plan F.3 — Deploy persistence + smoke HTTP execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two F.2 carryover gaps — persist `node.deployResult` to disk via a new `workflow_nodes.deploy_result jsonb` column, and actually run `DeployArtifact.smokeTests[]` via HTTP after Argo Healthy. Smoke failures roll back the deploy. UI surfaces per-row pass/fail in `DeployCanvas`.

**Architecture:** Two roughly-independent threads (DB persistence + smoke runner) merge via the engine's existing post-producer deploy hook. Reuses Plan F.2's `runDeployFromArtifacts` machinery; adds smoke execution as a new step between Argo-Healthy and result-return.

**Tech Stack:** TypeScript pnpm monorepo, drizzle + Postgres jsonb, vitest, native `fetch`.

**Spec reference:** `docs/superpowers/specs/2026-06-02-plan-f3-deploy-persistence-smoke-design.md`

**Depends on:** Plans A–G + D.2 + F + F.2 merged. Branch off current `main` (`c483d0b`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/spec-graph-data/drizzle/0012_workflow_nodes_deploy_result.sql` | Adds `deploy_result jsonb` column |
| `packages/deploy-orchestrator/src/smoke-runner.ts` | `runSmokeTests` pure-ish helper (HTTP only) |
| `packages/deploy-orchestrator/test/smoke-runner.test.ts` | Smoke runner tests |
| `packages/workflow-engine/test/engine-deploy-result-persistence.test.ts` | Integration: deploy result round-trips via repo |

### Modified files
| File | Change |
|---|---|
| `packages/spec-graph-data/src/schema/workflow-nodes.ts` | `deployResult: jsonb("deploy_result")` column |
| `packages/spec-graph-data/src/repo/workflow-node.repo.ts` | `setDeployResult` real drizzle impl; `findByRunId` row shape now includes `deployResult` |
| `packages/workflow-engine/src/types.ts` | `SmokeTestResultSchema` + `smokeResults` on `DeployResultSchema` |
| `packages/workflow-engine/src/engine.ts` | `buildSnapshot` includes `deployResult` from row; `runDeployHookIfApplicable` no longer swallows "not implemented" |
| `packages/deploy-orchestrator/src/deploy-from-artifacts.ts` | After Argo Healthy, call `runSmokeTests`; on smoke failure → rollback + throw |
| `packages/deploy-orchestrator/src/index.ts` | Export `runSmokeTests`, `SmokeTestResult`, `SmokeRunnerOptions` |
| `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx` | Per-smoke badges + latency when `deployResult.smokeResults` is set |
| `apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx` | New assertions for the badges |

---

## Tasks

### Task 1: `workflow_nodes.deploy_result jsonb` column + migration

**Files:**
- Modify: `packages/spec-graph-data/src/schema/workflow-nodes.ts`
- Create: `packages/spec-graph-data/drizzle/0012_workflow_nodes_deploy_result.sql`

- [ ] **Step 1:** Read the existing schema + migrations:

```bash
cat F:/claude/ai_builder/packages/spec-graph-data/src/schema/workflow-nodes.ts
ls F:/claude/ai_builder/packages/spec-graph-data/drizzle/ | tail -5
```

Confirm the most recent migration is `0011_workflow_runs_cost_cap.sql` (Plan G Task 2). Use `0012_workflow_nodes_deploy_result.sql`.

- [ ] **Step 2:** Add the column to the drizzle schema:

```ts
// packages/spec-graph-data/src/schema/workflow-nodes.ts
export const workflowNodes = pgTable(
  "workflow_nodes",
  {
    // ... existing columns ...
    failure: jsonb("failure"),
    // Plan F.3 — deploy runtime result (publicUrl + Argo app + applied manifests + smoke results)
    deployResult: jsonb("deploy_result"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  // ...
);
```

Place after `failure` (the closest semantic neighbour).

- [ ] **Step 3:** Write the SQL migration:

```sql
-- packages/spec-graph-data/drizzle/0012_workflow_nodes_deploy_result.sql
-- Plan F.3 — persist DeployOrchestrator.deployFromArtifacts result per node.
-- Null = node has not run a runtime deploy (today's default).
ALTER TABLE workflow_nodes ADD COLUMN deploy_result jsonb;
```

- [ ] **Step 4:** Run tests against the live test DB to confirm migration replays:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/spec-graph-data test
```

The repo's `test/setup.ts` auto-replays every `.sql` in `drizzle/`. Tests for `WorkflowNodeRepo` should still pass. New `deployResult` column should round-trip as `string | null` (drizzle jsonb shape) — confirm by adding a tiny inline check to an existing repo test OR by Task 2's tests catching it.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data
git commit -m "feat(spec-graph-data): workflow_nodes.deploy_result column + migration (Plan F.3 Task 1)"
```

---

### Task 2: `WorkflowNodeRepo.setDeployResult` real impl + findByRunId surface

**Files:**
- Modify: `packages/spec-graph-data/src/repo/workflow-node.repo.ts`
- Modify: `packages/spec-graph-data/test/workflow-node.repo.test.ts` (if exists; otherwise add)

- [ ] **Step 1:** Failing test — append to the workflow-node repo test file (or create one if missing):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// ... existing imports + pool setup ...

describe("WorkflowNodeRepo.setDeployResult (Plan F.3)", () => {
  it("writes + reads deployResult round-trip", async () => {
    // Seed a workflow_run + workflow_node
    const runId = randomUUID();
    await runRepo.insert({ /* ... */, id: runId });
    await repo.insertMany([{ id: "deploy", workflowRunId: runId, artifactKind: "deploy", summary: "d", dependsOn: [], consumes: [], policy: {}, status: "running" }]);

    const result = {
      deployId: "d-1",
      publicUrl: "https://x.atlas.dev",
      argoApplicationName: "x",
      branchSchemaName: "main",
      appliedManifests: [{ namespace: "atlas-projects", kind: "Service", name: "api" }],
      phase: "healthy",
      startedAt: "2026-06-02T00:00:00.000Z"
    };
    await repo.setDeployResult(runId, "deploy", result);

    const rows = await repo.findByRunId(runId);
    const row = rows.find(r => r.id === "deploy")!;
    expect(row.deployResult).toEqual(result);
  });

  it("does NOT throw 'not implemented' anymore", async () => {
    const runId = randomUUID();
    await runRepo.insert({ /* ... */, id: runId });
    await repo.insertMany([{ id: "deploy", workflowRunId: runId, artifactKind: "deploy", summary: "d", dependsOn: [], consumes: [], policy: {}, status: "running" }]);
    await expect(repo.setDeployResult(runId, "deploy", { phase: "healthy" })).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2:** Replace the throwing stub with a real drizzle impl:

```ts
// packages/spec-graph-data/src/repo/workflow-node.repo.ts
async setDeployResult(runId: string, nodeId: string, deployResult: unknown): Promise<void> {
  await this.db
    .update(workflowNodes)
    .set({ deployResult })
    .where(and(eq(workflowNodes.workflowRunId, runId), eq(workflowNodes.id, nodeId)));
}
```

(Remove the "not implemented" throw + the explanatory comment block; it's now implemented.)

- [ ] **Step 3:** `findByRunId` and `findOne` will automatically include `deployResult` via drizzle's `$inferSelect`. Confirm by running the test.

- [ ] **Step 4: Engine** — `WorkflowEngine.runDeployHookIfApplicable` currently catches errors containing "not implemented" and logs a warning instead of treating them as failure. Remove that catch path now that the repo doesn't throw. Find it:

```bash
grep -n "not implemented" packages/workflow-engine/src/engine.ts
```

Remove the swallow + the warning log; let real errors propagate.

- [ ] **Step 5: buildSnapshot** — include `deployResult` from the row. Find `buildSnapshot` in engine.ts; add to the per-node mapping:

```ts
...(row.deployResult !== undefined && row.deployResult !== null
  ? { deployResult: row.deployResult as WorkflowNode["deployResult"] }
  : {})
```

- [ ] **Step 6:** Run + typecheck + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/spec-graph-data test
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine typecheck

git add packages/spec-graph-data packages/workflow-engine
git commit -m "feat(spec-graph-data,workflow-engine): real setDeployResult + buildSnapshot exposes it (Plan F.3 Task 2)"
```

NOTE: The 8 pre-existing test-DB failures from Plan G's cost_cap_usd migration should also disappear if the test DB has the migration applied. If they persist, that's the OPS environment issue — flag it; don't try to fix in this task.

---

### Task 3: `SmokeTestResult` + extend `DeployResult` schema

**Files:**
- Modify: `packages/workflow-engine/src/types.ts`
- Create: `packages/workflow-engine/test/types-smoke-result.test.ts`

- [ ] **Step 1: Failing test** at `packages/workflow-engine/test/types-smoke-result.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SmokeTestResultSchema, DeployResultSchema, type SmokeTestResult } from "../src/types.js";

describe("SmokeTestResultSchema (Plan F.3)", () => {
  const valid: SmokeTestResult = {
    url: "/health",
    method: "get",
    status: 200,
    ok: true,
    latencyMs: 42,
    expectStatus: 200,
    bodyExcerpt: '{"status":"ok"}'
  };

  it("accepts a passed smoke result", () => {
    expect(SmokeTestResultSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a failed smoke result with error message", () => {
    const r = SmokeTestResultSchema.safeParse({
      ...valid, ok: false, status: 0, error: "ECONNREFUSED"
    });
    expect(r.success).toBe(true);
  });

  it("rejects status > 599 or < 0", () => {
    expect(SmokeTestResultSchema.safeParse({ ...valid, status: 600 }).success).toBe(false);
    expect(SmokeTestResultSchema.safeParse({ ...valid, status: -1 }).success).toBe(false);
  });

  it("rejects negative latency", () => {
    expect(SmokeTestResultSchema.safeParse({ ...valid, latencyMs: -1 }).success).toBe(false);
  });
});

describe("DeployResultSchema.smokeResults (Plan F.3)", () => {
  const baseResult = {
    deployId: "d-1", publicUrl: "https://x.atlas.dev",
    argoApplicationName: "x", branchSchemaName: "main",
    appliedManifests: [], phase: "healthy" as const,
    startedAt: "x"
  };

  it("accepts omitted smokeResults", () => {
    expect(DeployResultSchema.safeParse(baseResult).success).toBe(true);
  });

  it("accepts an empty smokeResults array", () => {
    expect(DeployResultSchema.safeParse({ ...baseResult, smokeResults: [] }).success).toBe(true);
  });

  it("accepts a populated smokeResults array", () => {
    expect(DeployResultSchema.safeParse({
      ...baseResult,
      smokeResults: [{
        url: "/health", method: "get", status: 200, ok: true,
        latencyMs: 42, expectStatus: 200
      }]
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2:** Run, expect failure.

- [ ] **Step 3: Implement** in `packages/workflow-engine/src/types.ts`:

```ts
export const SmokeTestResultSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["get", "post", "put", "patch", "delete", "head"]),
  status: z.number().int().min(0).max(599),
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  expectStatus: z.number().int().min(100).max(599),
  expectBodyContains: z.string().optional(),
  bodyExcerpt: z.string().optional(),
  error: z.string().optional()
});
export type SmokeTestResult = z.infer<typeof SmokeTestResultSchema>;
```

Add to `DeployResultSchema`:

```ts
// Plan F.3 — present when smoke tests ran post-deploy. Omitted when the
// artifact had no smoke definitions OR runtime hasn't smoke-tested yet.
smokeResults: z.array(SmokeTestResultSchema).optional()
```

- [ ] **Step 4:** Run + typecheck + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine
git commit -m "feat(workflow-engine): SmokeTestResult schema + DeployResult.smokeResults field (Plan F.3 Task 3)"
```

---

### Task 4: `runSmokeTests` pure-ish helper

**Files:**
- Create: `packages/deploy-orchestrator/src/smoke-runner.ts`
- Create: `packages/deploy-orchestrator/test/smoke-runner.test.ts`

Pure HTTP runner. Takes `{deployArtifact, publicUrl, fetcher?}`. Returns `SmokeTestResult[]`. Default fetcher = global fetch. Per-smoke timeout default = 10s.

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi } from "vitest";
import { runSmokeTests } from "../src/smoke-runner.js";
import type { DeployArtifact } from "@atlas/workflow-engine";

const DEPLOY: DeployArtifact = {
  schemaVersion: "1", kind: "deploy", target: "k8s",
  argoApplication: { file: "x", name: "x", repoUrl: "x", path: "x", content: "x" },
  imageBuilds: [],
  smokeTests: [
    { url: "/health", expectStatus: 200 },
    { url: "/api/v1/status", method: "post", expectStatus: 201, expectBodyContains: "ok" }
  ]
};

describe("runSmokeTests", () => {
  it("returns empty array when artifact has no smoke tests", async () => {
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [] },
      publicUrl: "https://x.atlas.dev",
      fetcher: vi.fn()
    });
    expect(r).toEqual([]);
  });

  it("returns ok=true when status matches expectStatus", async () => {
    const fetcher = vi.fn(async () =>
      new Response('{"status":"ok"}', { status: 200, headers: { "content-type": "application/json" } })
    );
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.ok).toBe(true);
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.bodyExcerpt).toContain("ok");
    expect(fetcher).toHaveBeenCalledWith("https://x.atlas.dev/health", expect.objectContaining({ method: "GET" }));
  });

  it("returns ok=false when status doesn't match expectStatus", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.status).toBe(500);
    expect(r[0]?.error).toMatch(/status 500.*expected 200/i);
  });

  it("returns ok=false with status=0 when fetch throws (network failure)", async () => {
    const fetcher = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.status).toBe(0);
    expect(r[0]?.error).toMatch(/ECONNREFUSED/);
  });

  it("checks expectBodyContains when set", async () => {
    const fetcher = vi.fn(async () => new Response("hello world", { status: 200 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/x", expectStatus: 200, expectBodyContains: "missing" }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/body did not contain "missing"/i);
  });

  it("uses the method specified on the smoke test (default GET)", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 201 }));
    await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [
        { url: "/x", method: "post", expectStatus: 201 },
        { url: "/y", expectStatus: 200 }
      ]},
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://x.atlas.dev/x", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://x.atlas.dev/y", expect.objectContaining({ method: "GET" }));
  });

  it("caps bodyExcerpt at 200 chars", async () => {
    const longBody = "x".repeat(500);
    const fetcher = vi.fn(async () => new Response(longBody, { status: 200 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/x", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.bodyExcerpt?.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2:** Run, expect failure.

- [ ] **Step 3: Implement** `packages/deploy-orchestrator/src/smoke-runner.ts`:

```ts
import type { DeployArtifact, SmokeTestResult } from "@atlas/workflow-engine";

export type SmokeFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunSmokeTestsInput {
  deployArtifact: DeployArtifact;
  publicUrl: string;
  fetcher?: SmokeFetcher;
  perSmokeTimeoutMs?: number;
}

const BODY_EXCERPT_MAX = 200;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function runSmokeTests(input: RunSmokeTestsInput): Promise<SmokeTestResult[]> {
  const fetcher = input.fetcher ?? ((u, i) => fetch(u, i));
  const timeoutMs = input.perSmokeTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: SmokeTestResult[] = [];

  for (const smoke of input.deployArtifact.smokeTests) {
    const method = (smoke.method ?? "get") as SmokeTestResult["method"];
    const httpMethod = method.toUpperCase();
    const targetUrl = `${input.publicUrl}${smoke.url}`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let status = 0;
    let ok = false;
    let bodyExcerpt: string | undefined;
    let error: string | undefined;

    try {
      const res = await fetcher(targetUrl, { method: httpMethod, signal: controller.signal });
      status = res.status;
      const text = await res.text().catch(() => "");
      bodyExcerpt = text.slice(0, BODY_EXCERPT_MAX);

      const statusMatches = status === smoke.expectStatus;
      const bodyMatches = smoke.expectBodyContains
        ? text.includes(smoke.expectBodyContains)
        : true;
      ok = statusMatches && bodyMatches;

      if (!statusMatches) {
        error = `status ${status} did not match expected ${smoke.expectStatus}`;
      } else if (!bodyMatches) {
        error = `body did not contain "${smoke.expectBodyContains}"`;
      }
    } catch (err) {
      status = 0;
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startedAt;

    const result: SmokeTestResult = {
      url: smoke.url,
      method,
      status,
      ok,
      latencyMs,
      expectStatus: smoke.expectStatus,
      ...(smoke.expectBodyContains !== undefined ? { expectBodyContains: smoke.expectBodyContains } : {}),
      ...(bodyExcerpt !== undefined ? { bodyExcerpt } : {}),
      ...(error !== undefined ? { error } : {})
    };
    results.push(result);
  }

  return results;
}
```

- [ ] **Step 4:** Export from `packages/deploy-orchestrator/src/index.ts`:

```ts
export { runSmokeTests, type SmokeFetcher, type RunSmokeTestsInput } from "./smoke-runner.js";
```

- [ ] **Step 5:** Run + typecheck + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): runSmokeTests HTTP runner (Plan F.3 Task 4)"
```

---

### Task 5: Wire `runSmokeTests` into `deploy-from-artifacts`; rollback on failure

**Files:**
- Modify: `packages/deploy-orchestrator/src/deploy-from-artifacts.ts`
- Modify: `packages/deploy-orchestrator/test/deploy-from-artifacts.test.ts`

After Argo reports Healthy, run the smoke tests. If ANY smoke result has `ok: false`, ROLL BACK the deploy (same path as Argo-unhealthy) and throw a `DeployError` with a clear message listing the failed smoke URL(s). On all-pass, attach the results to the returned `DeployFromArtifactsResult`.

- [ ] **Step 1: Update `DeployFromArtifactsResult` type** to optionally include `smokeResults: SmokeTestResult[]`:

```ts
import type { SmokeTestResult } from "@atlas/workflow-engine";

export interface DeployFromArtifactsResult {
  // ... existing fields ...
  smokeResults?: SmokeTestResult[];
}
```

- [ ] **Step 2: Update `DeployFromArtifactsOptions`** to accept an optional `smokeFetcher`:

```ts
import type { SmokeFetcher } from "./smoke-runner.js";

export interface DeployFromArtifactsOptions {
  // ... existing ...
  smokeFetcher?: SmokeFetcher;
  smokeTimeoutMs?: number;
}
```

- [ ] **Step 3: After the Argo Healthy check**, before `return`, run smoke tests:

```ts
// (right after the `if (health !== "Healthy") { rollback; throw }` block)
const smokeResults = await runSmokeTests({
  deployArtifact: input.deployArtifact,
  publicUrl: `https://${fqdn}`,
  ...(opts.smokeFetcher ? { fetcher: opts.smokeFetcher } : {}),
  ...(opts.smokeTimeoutMs !== undefined ? { perSmokeTimeoutMs: opts.smokeTimeoutMs } : {})
});

const failedSmokes = smokeResults.filter((s) => !s.ok);
if (failedSmokes.length > 0) {
  // Roll back same as Argo-unhealthy
  await opts.cloudflare.deleteDnsRecord(input.apex, fqdn).catch(() => {});
  for (const m of [...applied].reverse()) {
    await opts.kubernetes.delete(m.namespace, m.kind, m.name).catch(() => {});
  }
  const failedUrls = failedSmokes.map((s) => `${s.url} (${s.error ?? `status ${s.status}`})`).join(", ");
  throw new DeployError(`${failedSmokes.length} smoke test(s) failed: ${failedUrls}; deployment rolled back`);
}

return {
  deployId,
  publicUrl: `https://${fqdn}`,
  argoApplicationName: input.deployArtifact.argoApplication.name,
  branchSchemaName: branch.schemaName,
  appliedManifests: applied,
  phase: "healthy",
  startedAt,
  ...(smokeResults.length > 0 ? { smokeResults } : {})
};
```

- [ ] **Step 4: Add failing tests** to `deploy-from-artifacts.test.ts`:

```ts
describe("runDeployFromArtifacts — Plan F.3 smoke tests", () => {
  it("attaches smokeResults when all smoke tests pass", async () => {
    const opts = makeOpts();
    opts.kubernetes.setHealth("proj-main", "Healthy");
    // injected smokeFetcher that returns 200 for every URL
    opts.smokeFetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await runDeployFromArtifacts(opts, {
      projectId: "p", branchId: "b", subdomain: "sd", apex: "atlas.dev",
      iacArtifact: IAC,
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] }
    });
    expect(r.smokeResults).toBeDefined();
    expect(r.smokeResults).toHaveLength(1);
    expect(r.smokeResults?.[0]?.ok).toBe(true);
  });

  it("rolls back when a smoke test fails", async () => {
    const opts = makeOpts();
    opts.kubernetes.setHealth("proj-main", "Healthy");
    opts.smokeFetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(runDeployFromArtifacts(opts, {
      projectId: "p", branchId: "b", subdomain: "sd", apex: "atlas.dev",
      iacArtifact: IAC,
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] }
    })).rejects.toThrow(/smoke test.*failed|rolled back/i);
    // All applied manifests should be deleted via the rollback
  });

  it("omits smokeResults when artifact has zero smoke tests", async () => {
    const opts = makeOpts();
    opts.kubernetes.setHealth("proj-main", "Healthy");
    const r = await runDeployFromArtifacts(opts, {
      projectId: "p", branchId: "b", subdomain: "sd", apex: "atlas.dev",
      iacArtifact: IAC,
      deployArtifact: { ...DEPLOY, smokeTests: [] }
    });
    expect(r.smokeResults).toBeUndefined();
  });
});
```

- [ ] **Step 5:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/deploy-orchestrator test
git add packages/deploy-orchestrator
git commit -m "feat(deploy-orchestrator): runDeployFromArtifacts runs smoke tests + rolls back on failure (Plan F.3 Task 5)"
```

---

### Task 6: `DeployCanvas` — per-smoke badges + latency

**Files:**
- Modify: `apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx`
- Modify: `apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx`

The existing smoke-tests table renders one row per `artifact.smokeTests[]` entry. When `deployResult.smokeResults` is set, look up the matching result by URL and render a pass/fail badge + latency on the row.

- [ ] **Step 1: Failing test** — append to `DeployCanvas.test.tsx`:

```ts
describe("DeployCanvas — Plan F.3 smoke result badges", () => {
  const ARTIFACT_WITH_SMOKE = {
    ...ARTIFACT,
    smokeTests: [
      { url: "/health", expectStatus: 200 },
      { url: "/api/v1/status", method: "post" as const, expectStatus: 201 }
    ]
  };

  it("renders a pass badge when the smoke result is ok", () => {
    render(<DeployCanvas
      artifact={ARTIFACT_WITH_SMOKE}
      deployResult={{
        ...DEPLOY_RESULT,
        smokeResults: [
          { url: "/health", method: "get", status: 200, ok: true, latencyMs: 42, expectStatus: 200 },
          { url: "/api/v1/status", method: "post", status: 201, ok: true, latencyMs: 88, expectStatus: 201 }
        ]
      }}
    />);
    const healthRow = screen.getByTestId("deploy-smoke-row-/health");
    expect(healthRow).toHaveTextContent(/200/);
    expect(healthRow).toHaveTextContent(/42 ?ms/);
    expect(healthRow.className).not.toMatch(/red/);
  });

  it("renders a fail badge with error message when ok is false", () => {
    render(<DeployCanvas
      artifact={ARTIFACT_WITH_SMOKE}
      deployResult={{
        ...DEPLOY_RESULT,
        smokeResults: [
          { url: "/health", method: "get", status: 500, ok: false, latencyMs: 100, expectStatus: 200, error: "status 500 did not match expected 200" }
        ]
      }}
    />);
    const row = screen.getByTestId("deploy-smoke-row-/health");
    expect(row).toHaveTextContent(/fail|500/i);
    expect(row).toHaveTextContent(/did not match/i);
  });

  it("renders no badges when deployResult is unset (today's Plan F.2 behavior)", () => {
    render(<DeployCanvas artifact={ARTIFACT_WITH_SMOKE} />);
    const row = screen.getByTestId("deploy-smoke-row-/health");
    expect(row).not.toHaveTextContent(/ms/);
  });
});
```

- [ ] **Step 2:** Run, expect failure.

- [ ] **Step 3: Implement** — update the per-smoke row render in DeployCanvas:

```tsx
{artifact.smokeTests.map((s) => {
  const result = deployResult?.smokeResults?.find((r) => r.url === s.url);
  return (
    <tr
      key={s.url}
      data-testid={`deploy-smoke-row-${s.url}`}
      className={`border-t border-slate-100 ${result && !result.ok ? "bg-red-50" : ""}`}
    >
      <td className="px-3 py-1 font-mono text-slate-800">{s.url}</td>
      <td className="px-3 py-1 text-[11px] uppercase text-slate-600">{s.method ?? "get"}</td>
      <td className="px-3 py-1 text-slate-700">{s.expectStatus}</td>
      <td className="px-3 py-1 font-mono text-[11px] text-slate-500">{s.expectBodyContains ?? "—"}</td>
      {result && (
        <td className="px-3 py-1 text-[11px]">
          {result.ok ? (
            <span className="text-emerald-700">✓ {result.status} · {result.latencyMs}ms</span>
          ) : (
            <span className="text-red-700">✗ {result.error ?? `status ${result.status}`}</span>
          )}
        </td>
      )}
    </tr>
  );
})}
```

Adjust the table's `<thead>` to add a "Result" column when `deployResult?.smokeResults` is set.

- [ ] **Step 4:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web test DeployCanvas
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
git add apps/atlas-web/components/canvas/renderers/DeployCanvas.tsx apps/atlas-web/test/components/canvas/renderers/DeployCanvas.test.tsx
git commit -m "feat(atlas-web): DeployCanvas per-smoke pass/fail badges + latency (Plan F.3 Task 6)"
```

---

## Plan F.3 — Self-review checklist

- [ ] Spec §"`deploy_result` DB persistence" → Tasks 1, 2
- [ ] Spec §"Smoke tests actually run" → Tasks 3, 4, 5
- [ ] Spec §"UI surfaces per-row pass/fail" → Task 6

**Shippable result:** Deploy runtime state survives process restarts via the new `workflow_nodes.deploy_result` column. Every workflow deploy with smoke definitions actually fires HTTP requests against `publicUrl`; pass/fail badges appear inline in DeployCanvas with per-smoke latency; failure rolls back the deploy cleanly. The deploy story now reads "applied, healthy, smoked, persisted" end-to-end.
