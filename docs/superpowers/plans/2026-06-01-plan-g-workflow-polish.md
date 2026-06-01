# Plan G — Workflow Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent workflow-polish features — picker wiring (Plan C carryover), retry-all-failed bulk action, per-workflow USD cost cap with real-time tracking.

**Architecture:** All work lives in atlas-web + workflow-engine + (small) llm-provider. No new roles, no canvas renderers, no template changes, no infrastructure. The cost cap introduces a new `LLMUsageTracker` interface in `@atlas/llm-provider` that the workflow engine instantiates per-run and threads through `ritualEngine.start()`.

**Tech Stack:** TypeScript pnpm monorepo, Zod 3.23, vitest, drizzle + postgres for the new schema column + migration.

**Spec reference:** `docs/superpowers/specs/2026-06-01-plan-g-workflow-polish-design.md`

**Depends on:** Plans A–F + D.2 merged. Branch off current `main` (`e27d89e`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `apps/atlas-web/lib/actions/classifyAndCreateProject.ts` | Server Action: create project + classify entry; no ritual start |
| `apps/atlas-web/test/actions/classifyAndCreateProject.test.ts` | Tests for the new action |
| `apps/atlas-web/lib/actions/retryAllFailedNodes.ts` | Server Action: bulk-retry every failed node in a run |
| `apps/atlas-web/test/actions/retryAllFailedNodes.test.ts` | Tests |
| `apps/atlas-web/app/projects/new/_components/PromptFormWithPicker.tsx` | Client wrapper: classify → picker → start |
| `apps/atlas-web/test/app/projects/new/PromptFormWithPicker.test.tsx` | Wrapper tests |
| `packages/llm-provider/src/usage-tracker.ts` | `LLMUsageTracker` interface + in-memory impl + pricing table |
| `packages/llm-provider/test/usage-tracker.test.ts` | Tests for record + totalUsd math |
| `packages/workflow-engine/test/engine-cost-cap.test.ts` | Cap-exceeded abort path |
| `packages/spec-graph-data/migrations/00XX_workflow_runs_cost_cap.sql` (or wherever migrations live) | `ALTER TABLE workflow_runs ADD COLUMN cost_cap_usd numeric` |

### Modified files
| File | Change |
|---|---|
| `apps/atlas-web/app/projects/new/page.tsx` | Picker-flag gate: when on, mount `PromptFormWithPicker` |
| `apps/atlas-web/components/workflow/WorkflowHeader.tsx` | Retry-all-failed button + running-cost display |
| `apps/atlas-web/components/workflow/WorkflowApprovalPanel.tsx` | Optional cost-cap input |
| `apps/atlas-web/test/components/workflow/WorkflowHeader.test.tsx` | New assertions for retry-all + cost display |
| `packages/workflow-engine/src/types.ts` | `costCapUsd?: number` on WorkflowRunSchema + `StartWorkflowInput` |
| `packages/workflow-engine/src/engine.ts` | Per-run `LLMUsageTracker` instance; thread into `ritualEngine.start`; cap check post-ritual |
| `packages/workflow-engine/src/scheduler.ts` | Cap-exceeded abort branch |
| `packages/spec-graph-data/src/schema/workflow-runs.ts` | Add `costCapUsd: numeric` column to drizzle schema |
| `packages/spec-graph-data/src/repo/workflow-run.repo.ts` | Include `costCapUsd` in select/insert |
| `apps/atlas-web/lib/actions/startWorkflow.ts` | Accept `costCapUsd?: number` from input |

---

## Tasks

### Task 1: `LLMUsageTracker` interface + in-memory impl + pricing table

**Files:**
- Create: `packages/llm-provider/src/usage-tracker.ts`
- Create: `packages/llm-provider/test/usage-tracker.test.ts`
- Modify: `packages/llm-provider/src/index.ts` — export the new symbols

- [ ] **Step 1: Failing test** at `packages/llm-provider/test/usage-tracker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryUsageTracker, computeUsd, MODEL_PRICING } from "../src/usage-tracker.js";

describe("InMemoryUsageTracker", () => {
  it("starts at $0.00", () => {
    const t = new InMemoryUsageTracker();
    expect(t.totalUsd()).toBe(0);
  });

  it("accumulates token cost across multiple records", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 });
    // Claude Sonnet 4.6 input price = $3.00/MTok (per MODEL_PRICING)
    expect(t.totalUsd()).toBeCloseTo(3.00, 4);
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 0, outputTokens: 1_000_000 });
    // + output price = $15.00/MTok
    expect(t.totalUsd()).toBeCloseTo(18.00, 4);
  });

  it("treats an unknown model as zero cost (logged but not summed)", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "no-such-model", { inputTokens: 10_000_000, outputTokens: 0 });
    expect(t.totalUsd()).toBe(0);
  });
});

describe("computeUsd", () => {
  it("multiplies tokens by the model's per-MTok pricing", () => {
    const cost = computeUsd("anthropic", "claude-sonnet-4-6", { inputTokens: 500_000, outputTokens: 100_000 });
    // 500K * $3 / 1M + 100K * $15 / 1M = $1.50 + $1.50 = $3.00
    expect(cost).toBeCloseTo(3.00, 4);
  });
  it("returns 0 for an unknown model", () => {
    const cost = computeUsd("anthropic", "no-such-model", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBe(0);
  });
});

describe("MODEL_PRICING", () => {
  it("includes the three currently-used models", () => {
    expect(MODEL_PRICING["anthropic:claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["anthropic:claude-haiku-4-5"]).toBeDefined();
    expect(MODEL_PRICING["google:gemini-2.5-flash"]).toBeDefined();
  });
});
```

Note: if the project uses different exact model IDs in production, adjust the keys in `MODEL_PRICING` to match. Look at `packages/llm-provider/src/` for any existing model-name constants and reuse them.

- [ ] **Step 2:** Run, expect failure:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/llm-provider test usage-tracker
```

- [ ] **Step 3: Implement** `packages/llm-provider/src/usage-tracker.ts`:

```ts
/**
 * Per-provider/per-model pricing in USD per 1M tokens.
 * Public list pricing as of 2026-06-01. Update manually when providers
 * change their pricing tables (we don't fetch this at runtime).
 */
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "anthropic:claude-opus-4-7":   { inputPerMTok: 15.00, outputPerMTok: 75.00 },
  "anthropic:claude-sonnet-4-6": { inputPerMTok:  3.00, outputPerMTok: 15.00 },
  "anthropic:claude-haiku-4-5":  { inputPerMTok:  1.00, outputPerMTok:  5.00 },
  "google:gemini-2.5-pro":       { inputPerMTok:  1.25, outputPerMTok:  5.00 },
  "google:gemini-2.5-flash":     { inputPerMTok:  0.075, outputPerMTok: 0.30 }
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function computeUsd(provider: string, model: string, usage: TokenUsage): number {
  const price = MODEL_PRICING[`${provider}:${model}`];
  if (!price) return 0;
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
}

export interface LLMUsageTracker {
  record(provider: string, model: string, usage: TokenUsage): void;
  totalUsd(): number;
}

export class InMemoryUsageTracker implements LLMUsageTracker {
  private total = 0;

  record(provider: string, model: string, usage: TokenUsage): void {
    this.total += computeUsd(provider, model, usage);
  }

  totalUsd(): number {
    return this.total;
  }
}
```

- [ ] **Step 4: Export** from `packages/llm-provider/src/index.ts`:

```ts
export {
  InMemoryUsageTracker,
  computeUsd,
  MODEL_PRICING,
  type LLMUsageTracker,
  type TokenUsage
} from "./usage-tracker.js";
```

- [ ] **Step 5: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/llm-provider test
cd F:/claude/ai_builder && pnpm -F @atlas/llm-provider typecheck
git add packages/llm-provider/src/usage-tracker.ts packages/llm-provider/src/index.ts packages/llm-provider/test/usage-tracker.test.ts
git commit -m "feat(llm-provider): LLMUsageTracker interface + InMemoryUsageTracker + MODEL_PRICING table (Plan G Task 1)"
```

---

### Task 2: Schema migration + repo update for `cost_cap_usd`

**Files:**
- Modify: `packages/spec-graph-data/src/schema/workflow-runs.ts` — add column
- Create: a new migration in `packages/spec-graph-data/migrations/` (or wherever existing migrations live — check `0010_eval_verdicts` from earlier commit and mirror its location)
- Modify: `packages/spec-graph-data/src/repo/workflow-run.repo.ts` — include the column in insert/select/findById return shape

- [ ] **Step 1: Investigate the migration convention**

```bash
ls packages/spec-graph-data | head -10
find F:/claude/ai_builder/packages/spec-graph-data -name "*.sql" 2>&1 | head -10
cat packages/spec-graph-data/src/schema/workflow-runs.ts
```

Find the existing migration directory + numbering. If migrations are in `packages/spec-graph-data/migrations/`, use the next sequential number. If they live elsewhere (e.g. `docker/postgres/init/`), put the new file there. STOP and report NEEDS_CONTEXT if the convention is unclear.

- [ ] **Step 2: Add the column to the drizzle schema**

In `packages/spec-graph-data/src/schema/workflow-runs.ts`, add `cost_cap_usd: numeric("cost_cap_usd")` (nullable — no default).

```ts
import { integer, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
// ...existing code...
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    // ... existing columns ...
    costCapUsd: numeric("cost_cap_usd"),  // Plan G — optional USD budget for the run
    // ... rest of existing columns ...
  },
  // ...
);
```

- [ ] **Step 3: Add the SQL migration**

```sql
-- migrations/00XX_workflow_runs_cost_cap.sql
ALTER TABLE workflow_runs ADD COLUMN cost_cap_usd numeric;
```

Use whatever filename pattern the existing migrations use (e.g. `0011_workflow_runs_cost_cap.sql` if 0010 was the most recent).

- [ ] **Step 4: Update the repo**

In `packages/spec-graph-data/src/repo/workflow-run.repo.ts`:
- `insert()` accepts `costCapUsd?: number` and writes it
- `findById()` returns `costCapUsd: string | null` (drizzle returns numeric as string)

Update the matching test fixtures if necessary.

- [ ] **Step 5: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/spec-graph-data test
cd F:/claude/ai_builder && pnpm -F @atlas/spec-graph-data typecheck
git add packages/spec-graph-data
git commit -m "feat(spec-graph-data): workflow_runs.cost_cap_usd column + migration (Plan G Task 2)"
```

---

### Task 3: Thread `costCapUsd` through workflow-engine types + start input

**Files:**
- Modify: `packages/workflow-engine/src/types.ts` — add `costCapUsd?: number` to WorkflowRunSchema + StartWorkflowInput
- Modify: `packages/workflow-engine/src/engine.ts` — accept costCapUsd, persist via runRepo.insert, expose on snapshot

- [ ] **Step 1: Failing test**

Add a focused test (e.g. `packages/workflow-engine/test/engine-cost-cap.test.ts`) that asserts:
- `engine.start({...costCapUsd: 5.00})` persists costCapUsd on the run row
- `engine.getRun(runId)` returns a snapshot whose `costCapUsd === 5.00`

- [ ] **Step 2:** Update WorkflowRunSchema + StartWorkflowInput in `types.ts`:

```ts
export const WorkflowRunSchema = z.object({
  // ... existing fields ...
  costCapUsd: z.number().positive().optional(),
  // ... rest ...
});

export interface StartWorkflowInput {
  // ... existing fields ...
  costCapUsd?: number;
}
```

- [ ] **Step 3:** In `engine.ts`'s `start()`, pass `costCapUsd` to `runRepo.insert`. In `buildSnapshot()`, include `costCapUsd` from the row (convert numeric string → number).

- [ ] **Step 4:** Run + commit:

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine
git commit -m "feat(workflow-engine): costCapUsd field on WorkflowRun + StartWorkflowInput (Plan G Task 3)"
```

---

### Task 4: Per-run `LLMUsageTracker` + thread through `ritualEngine.start`

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts` — `IRitualEngine.start` accepts `usageTracker?: LLMUsageTracker`; engine creates a tracker per run, threads into every `makeLaunchRitual` call
- (Optional) Modify: `packages/ritual-engine/src/engine.ts` — `StartInput` declares `usageTracker?: LLMUsageTracker`. Roles can record via this.

For Plan G v1, role-level usage recording is OUT OF SCOPE — the tracker is plumbed but role wiring (record on each LLM call) is a future polish task. Just thread the tracker so the engine + scheduler have access; record manually in a stub in the test.

- [ ] **Step 1: Failing test** asserts that when costCapUsd is set, the engine creates a tracker and exposes it via a test-only seam.

Actually simpler: assert that the engine reads `tracker.totalUsd()` between rituals (introduce a small `_getUsageTracker(workflowRunId): LLMUsageTracker | undefined` test-seam).

- [ ] **Step 2:** Implement: engine creates one `InMemoryUsageTracker` per workflow run; stores it in a Map keyed by `workflowRunId`; passes it into `ritualEngine.start({usageTracker})` for each node ritual.

- [ ] **Step 3:** Run + commit.

---

### Task 5: Cost cap enforcement — scheduler aborts when cap exceeded

**Files:**
- Modify: `packages/workflow-engine/src/scheduler.ts` — after each ritual completion, check tracker total vs run.costCapUsd; if exceeded, set scheduler in abort mode
- Modify: `packages/workflow-engine/src/engine.ts` — wire the check + persistence of the abort reason
- Create: `packages/workflow-engine/test/engine-cost-cap-abort.test.ts`

- [ ] **Step 1: Failing test** asserts:
  - A workflow with `costCapUsd: 0.01` and a fake ritual engine whose start() records $0.05 worth of usage into the passed-in tracker → after one ritual completes, the scheduler aborts the workflow with status `"aborted"` and `failure.error` containing `"cost cap exceeded"`.

- [ ] **Step 2:** Implement the check + abort path. After each `awaitRitual` resolution in the scheduler, look up the tracker for the run and call `tracker.totalUsd()`. If > run.costCapUsd (and costCapUsd is non-null), set the workflow status to `"aborted"`, persist the abort reason on the run, abort any in-flight node rituals via `ritualEngine.abort`, and stop the scheduler loop.

- [ ] **Step 3:** Run + commit.

---

### Task 6: `WorkflowHeader` — running cost + retry-all-failed button

**Files:**
- Modify: `apps/atlas-web/components/workflow/WorkflowHeader.tsx`
- Modify: `apps/atlas-web/test/components/workflow/WorkflowHeader.test.tsx`
- Create: `apps/atlas-web/lib/actions/retryAllFailedNodes.ts` + test

- [ ] **Step 1: `retryAllFailedNodes` Server Action** — loops over `snapshot.nodes`, calls `retryNode(projectId, runId, nodeId)` for each `status === "failed"`. Returns `{ retriedCount, errors: Array<{nodeId, error}> }`. Errors don't abort the loop.

- [ ] **Step 2: Failing test** for `WorkflowHeader`:
  - Renders running cost `"$X.XX"` when `snapshot.totalCostUsd` is defined (new optional field on snapshot)
  - Renders `"$X.XX / $Y.YY"` when both `totalCostUsd` and `costCapUsd` are defined
  - Color flips amber at 80% and red at 100% of cap
  - Renders "Retry all failed (N)" button when `snapshot.status === "escalated"` AND failed-node count > 0
  - Button click calls `retryAllFailedNodes` with `{projectId, workflowRunId}`

- [ ] **Step 3:** Implement the header updates + the retryAll action.

- [ ] **Step 4:** Run + commit.

---

### Task 7: Snapshot exposes `totalCostUsd`

**Files:**
- Modify: `packages/workflow-engine/src/types.ts` — add `totalCostUsd?: number` to WorkflowRunSchema
- Modify: `packages/workflow-engine/src/engine.ts` — `buildSnapshot()` reads `tracker.totalUsd()` and includes it on the returned snapshot

- [ ] **Step 1: Failing test** asserts `engine.getRun(runId).totalCostUsd === tracker.totalUsd()` after a ritual that records usage.

- [ ] **Step 2:** Implement.

- [ ] **Step 3:** Run + commit.

---

### Task 8: `classifyAndCreateProject` Server Action

**Files:**
- Create: `apps/atlas-web/lib/actions/classifyAndCreateProject.ts`
- Create: `apps/atlas-web/test/actions/classifyAndCreateProject.test.ts`

The new action does what `submitPromptedProject` does today MINUS the ritual start. It:
1. Auth-gates
2. Creates the project via ProjectsRepo
3. Pre-warms the sandbox (fire-and-forget, same as today)
4. Calls `classifyEntry(prompt)` via the LLM provider
5. Returns `{ projectId, mode, suggestedKinds, reasoning }` to the client

It does NOT start a ritual. It does NOT redirect.

- [ ] **Step 1: Failing test** — auth gate, project creation, classifier result returned, no ritual started.

- [ ] **Step 2: Implement** using `submitPromptedProject` as the template — copy the project-creation + sandbox-prewarm + classifier blocks; drop the ritual-start + redirect.

- [ ] **Step 3:** Run + commit.

---

### Task 9: `PromptFormWithPicker` client wrapper + page wiring

**Files:**
- Create: `apps/atlas-web/app/projects/new/_components/PromptFormWithPicker.tsx`
- Create: `apps/atlas-web/test/app/projects/new/PromptFormWithPicker.test.tsx`
- Modify: `apps/atlas-web/app/projects/new/page.tsx` — read `isFeatureEnabledForRequest("workflow-picker")` and mount the right form
- Modify: `apps/atlas-web/components/workflow/WorkflowApprovalPanel.tsx` — add optional cost-cap input

- [ ] **Step 1:** Build `PromptFormWithPicker`:
  - Wraps existing `PromptForm`, intercepts submit
  - Calls `classifyAndCreateProject(formData)`
  - If `result.mode === "workflow"`: renders `WorkflowPickerChecklist`. On confirm: `startWorkflow({projectId, prompt, suggestedKinds: kinds, costCapUsd})`. On downgrade: `startRitual({projectId, prompt})`. Then router.push to the right page.
  - If `result.mode === "ritual"`: directly calls `startRitual` and redirects.
  - Shows pending states via `useTransition`.

- [ ] **Step 2:** Failing test — covers happy path (classify → workflow → picker → confirm → startWorkflow), downgrade path, error surfacing.

- [ ] **Step 3:** Implement + flag-gate in `page.tsx`.

- [ ] **Step 4:** Add optional cost-cap input to `WorkflowApprovalPanel` (number input, USD). Threads through to `approveWorkflowPlan` if the engine accepts a cap-set-at-approval-time path; otherwise the cap is only settable at startWorkflow time and this UI is informational. Decide based on Task 5's implementation.

- [ ] **Step 5:** Run + commit.

---

### Task 10: End-to-end test — cost cap exceeded mid-run

**Files:**
- Create: `packages/workflow-engine/test/integration-cost-cap-exceeded.test.ts`

3-node DAG (backend → frontend → tests). Fake ritual engine records $0.05 of usage per call. `costCapUsd: 0.10`. After 2 rituals complete, cap is exceeded → scheduler aborts → 3rd ritual never starts.

- [ ] **Step 1:** Write the test mirroring Plan D.2 Task 5's structure. Assert:
  - Workflow status ends as `"aborted"`
  - At most 2 ritualEngine.start() calls happened (the 3rd node never started)
  - The failed run's abort reason contains "cost cap exceeded"

- [ ] **Step 2:** Run + commit.

---

## Plan G — Self-review checklist

- [ ] Spec §"Picker wiring" → Tasks 8, 9
- [ ] Spec §"Retry-all-failed" → Task 6 (button + action)
- [ ] Spec §"Cost cap" → Tasks 1, 2, 3, 4, 5, 7, 10

**Shippable result:** Users can override the entry classifier via the picker checklist before workflows start. Escalated workflows have a one-click bulk retry. Per-workflow cost caps abort runs when budget is exceeded with a clear reason. The workflow story now feels finished at the polish layer.
