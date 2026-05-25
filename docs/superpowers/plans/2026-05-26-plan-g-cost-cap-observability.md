# Plan G — Cost Cap + Observability Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflows safe to enable in production. Two pieces: (1) cost cap — every LLM call records tokens + cost to `workflow_usage`; scheduler blocks new nodes when a per-workflow cap is reached; (2) observability polish — a "History" tab on the workflow graph view renders the full event log chronologically.

**Architecture:** Provider-side instrumentation hooks per LLM call. A `WorkflowUsageAccumulator` listens to provider events filtered by workflowRunId, sums tokens + computes USD via a hardcoded `packages/llm-provider/src/pricing.ts` table, writes to `workflow_usage`. Scheduler reads the sum before launching new nodes and compares to `ATLAS_WORKFLOW_MAX_COST_USD`. The History tab queries `workflow_node_checkpoints` (Plan A) and renders chronologically.

**Tech Stack:** Same. No new deps.

**Spec reference:** Section 11 (cost cap + observability + API surface).

**Depends on:** Plans A + B + C + D + E + F merged.

---

## File Structure

### New
| Path | Purpose |
|---|---|
| `packages/llm-provider/src/pricing.ts` | Hardcoded per-provider/model cost rates (input/output per 1M tokens) |
| `packages/llm-provider/src/usage-instrumentation.ts` | Hook for providers to emit usage events |
| `packages/workflow-engine/src/usage-accumulator.ts` | Listens for usage events, persists to workflow_usage, exposes sumForRun |
| `packages/workflow-engine/src/errors.ts` (extend) | `CostCapReachedError` |
| `apps/atlas-web/components/workflow/WorkflowHistoryTab.tsx` | Chronological event log UI |
| `apps/atlas-web/components/workflow/WorkflowCostBadge.tsx` | "$0.42 / $5.00" header chip in the graph view |

### Modifications
| File | Change |
|---|---|
| `packages/llm-provider/src/anthropic.ts` | After every call, invoke `recordUsage(...)` |
| `packages/llm-provider/src/google.ts` | Same |
| `apps/atlas-web/lib/engine/openai-compat-provider.ts` | Same |
| `apps/atlas-web/lib/engine/routing-provider.ts` | Propagates the `workflowRunId` + `workflowNodeId` execution context |
| `packages/workflow-engine/src/scheduler.ts` | Check usage sum against cap before launching new node |
| `packages/workflow-engine/src/engine.ts` | Pass `workflowRunId` + per-node context into ritual launches |
| `apps/atlas-web/components/workflow/WorkflowHeader.tsx` | Add cost badge + edit-cap action |
| `apps/atlas-web/lib/actions/getWorkflowEventLog.ts` | Already exists from Plan A; fleshes out the response shape |

---

## Tasks

### Task 1: Pricing table

**Files:**
- Create: `packages/llm-provider/src/pricing.ts`
- Test: `packages/llm-provider/test/pricing.test.ts`

- [ ] **Step 1: Implement**

```ts
// pricing.ts
// Rates as of 2026-05-26. Refresh periodically.
// Cost in USD per 1M tokens.

export interface ModelPricing {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cacheReadUsdPer1M?: number;
  cacheWriteUsdPer1M?: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  // Anthropic direct + via local proxy
  "claude-opus-4-7": { inputUsdPer1M: 15, outputUsdPer1M: 75, cacheReadUsdPer1M: 1.5, cacheWriteUsdPer1M: 18.75 },
  "claude-sonnet-4-6": { inputUsdPer1M: 3, outputUsdPer1M: 15, cacheReadUsdPer1M: 0.30, cacheWriteUsdPer1M: 3.75 },
  "claude-haiku-4-5": { inputUsdPer1M: 1, outputUsdPer1M: 5 },
  // OpenRouter
  "anthropic/claude-sonnet-4.5": { inputUsdPer1M: 3, outputUsdPer1M: 15 },
  "anthropic/claude-haiku-4.5": { inputUsdPer1M: 1, outputUsdPer1M: 5 },
  "google/gemini-2.5-flash": { inputUsdPer1M: 0.075, outputUsdPer1M: 0.30 },
  "google/gemini-2.5-pro": { inputUsdPer1M: 1.25, outputUsdPer1M: 5 },
  "meta-llama/llama-3.3-70b-instruct": { inputUsdPer1M: 0.20, outputUsdPer1M: 0.60 }
};

export function getPricing(model: string): ModelPricing {
  // Try exact match first; fallback to a conservative default.
  if (PRICING_TABLE[model]) return PRICING_TABLE[model];
  // Strip provider prefix (anthropic/) for a second try
  const stripped = model.replace(/^[^/]+\//, "");
  if (PRICING_TABLE[stripped]) return PRICING_TABLE[stripped];
  // Unknown model — assume a high-ish default so cost-cap errs on safety
  console.warn(`[pricing] unknown model "${model}"; using conservative default`);
  return { inputUsdPer1M: 5, outputUsdPer1M: 15 };
}

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = getPricing(model);
  return (inputTokens / 1_000_000) * p.inputUsdPer1M + (outputTokens / 1_000_000) * p.outputUsdPer1M;
}
```

- [ ] **Step 2: Tests + commit**

Test exact matches, prefix stripping, fallback for unknowns.

```bash
git commit -m "feat(llm-provider): per-provider/model pricing table + computeCostUsd"
```

---

### Task 2: Usage instrumentation hook

**Files:**
- Create: `packages/llm-provider/src/usage-instrumentation.ts`

Provides a simple register/emit API providers call from their `complete` / `completeWithToolUse` / streaming methods.

- [ ] **Step 1: Implement**

```ts
// usage-instrumentation.ts
export interface UsageEvent {
  provider: string;                // "anthropic" | "google" | "openai-compat" | etc.
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Carrier-supplied context: which workflow + node was this call for? */
  context?: { workflowRunId?: string; nodeId?: string };
  ts: number;
}

type Listener = (e: UsageEvent) => void;
const listeners = new Set<Listener>();

export function onUsage(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function emitUsage(e: UsageEvent): void {
  for (const l of listeners) {
    try { l(e); } catch (err) { console.error("[usage] listener threw", err); }
  }
}

/** AsyncLocalStorage-like execution context for the workflowRunId + nodeId
 *  to thread through providers without each provider knowing about workflows. */
import { AsyncLocalStorage } from "node:async_hooks";
const ctx = new AsyncLocalStorage<{ workflowRunId?: string; nodeId?: string }>();

export function runWithUsageContext<T>(context: { workflowRunId?: string; nodeId?: string }, fn: () => Promise<T>): Promise<T> {
  return ctx.run(context, fn);
}

export function currentUsageContext(): { workflowRunId?: string; nodeId?: string } | undefined {
  return ctx.getStore();
}
```

- [ ] **Step 2: Provider hooks** — modify each provider's complete/completeWithToolUse to call `emitUsage(...)` with the response's usage stats + `currentUsageContext()`.

- [ ] **Step 3: Tests + commit**

```bash
git commit -m "feat(llm-provider): usage instrumentation hook + AsyncLocalStorage context"
```

---

### Task 3: WorkflowUsageAccumulator

**Files:**
- Create: `packages/workflow-engine/src/usage-accumulator.ts`
- Test: `packages/workflow-engine/test/usage-accumulator.test.ts`

- [ ] **Step 1: Implement**

```ts
// usage-accumulator.ts
import { onUsage, type UsageEvent } from "@atlas/llm-provider";
import { computeCostUsd } from "@atlas/llm-provider";
import type { WorkflowUsageRepo } from "@atlas/spec-graph-data";

export class WorkflowUsageAccumulator {
  private off?: () => void;
  constructor(private readonly repo: WorkflowUsageRepo) {}

  start(): void {
    this.off = onUsage(async (e) => {
      if (!e.context?.workflowRunId || !e.context?.nodeId) return; // not a workflow LLM call
      const costUsd = computeCostUsd(e.model, e.inputTokens, e.outputTokens);
      await this.repo.append({
        workflowRunId: e.context.workflowRunId,
        nodeId: e.context.nodeId,
        provider: e.provider,
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUsd: String(costUsd)
      });
    });
  }
  stop(): void { this.off?.(); }
}
```

- [ ] **Step 2: Wire in factory.ts (singleton per process; subscribes at app start)**

```ts
// apps/atlas-web/lib/engine/factory.ts (one-time init)
const acc = new WorkflowUsageAccumulator(usageRepo);
acc.start();
```

- [ ] **Step 3: Tests + commit**

```bash
git commit -m "feat(workflow-engine): WorkflowUsageAccumulator (usage events → workflow_usage rows)"
```

---

### Task 4: Thread workflowRunId + nodeId through ritual launches

**Files:**
- Modify: `packages/workflow-engine/src/engine.ts` (launchNodeRitual)

Wrap each `ritualEngine.start({...})` in `runWithUsageContext({workflowRunId, nodeId}, () => ritualEngine.start({...}))`. AsyncLocalStorage carries the context down through providers.

- [ ] Implement + commit (`feat(workflow-engine): thread workflowRunId+nodeId into LLM execution context`)

---

### Task 5: Cost-cap enforcement in scheduler

**Files:**
- Modify: `packages/workflow-engine/src/scheduler.ts`
- Modify: `packages/workflow-engine/src/errors.ts` — add `CostCapReachedError`

- [ ] **Step 1: Read env var + per-run cap**

```ts
// In scheduler.ts before launching a node:
const capUsd = this.run.maxCostUsd ?? Number(process.env.ATLAS_WORKFLOW_MAX_COST_USD ?? "");
if (!isNaN(capUsd) && capUsd > 0) {
  const usage = await this.deps.getUsageSum(this.run.id);
  if (usage.costUsd >= capUsd) {
    // Mark all remaining nodes as blocked with reason cost_cap_reached
    for (const n of this.run.nodes) {
      if (n.status === "pending") {
        n.status = "blocked";
        n.failure = { error: `cost_cap_reached: ${usage.costUsd.toFixed(2)}/$${capUsd.toFixed(2)}`, attempts: 0 };
        await this.deps.persistNodeState(n.id, { status: "blocked", failure: n.failure });
      }
    }
    await this.deps.persistWorkflowStatus("escalated");
    return;
  }
}
```

- [ ] **Step 2: Extend SchedulerDeps to include `getUsageSum`**

- [ ] **Step 3: Server Action to raise the cap mid-run**

```ts
// apps/atlas-web/lib/actions/setWorkflowCostCap.ts
"use server";
export async function setWorkflowCostCap(input: { workflowRunId: string; maxCostUsd: number }): Promise<void> {
  // auth check
  // update workflow_runs.max_cost_usd
  // The scheduler picks it up on the next loop iteration
}
```

Add a column to `workflow_runs` if not present: `max_cost_usd numeric(12,4)`.

- [ ] **Step 4: Tests + commit**

```bash
git commit -m "feat(workflow-engine): cost cap enforcement in scheduler + mid-run cap raise action"
```

---

### Task 6: WorkflowCostBadge UI

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowCostBadge.tsx`
- Modify: `apps/atlas-web/components/workflow/WorkflowHeader.tsx`

Shows live "$0.42 / $5.00" or just "$0.42" if no cap. Click → modal to set/edit the cap.

```tsx
"use client";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { useMemo, useState } from "react";

export function WorkflowCostBadge({ workflowRunId, costUsd, capUsd, onCapChange }: { workflowRunId: string; costUsd: number; capUsd?: number; onCapChange: (cap: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const fraction = capUsd ? Math.min(1, costUsd / capUsd) : null;
  return (
    <button onClick={() => setEditing(true)} className={`px-2 py-0.5 text-xs rounded ${fraction !== null && fraction >= 0.9 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>
      ${costUsd.toFixed(2)}{capUsd !== undefined ? ` / $${capUsd.toFixed(2)}` : ""}
    </button>
  );
}
```

(The live cost number flows in via a new SSE event `workflow.usage.recorded` that the WorkflowUsageAccumulator should also emit when it persists a row — add to EventBroker types.)

- [ ] Implement + commit

---

### Task 7: WorkflowHistoryTab

**Files:**
- Create: `apps/atlas-web/components/workflow/WorkflowHistoryTab.tsx`
- Modify: `apps/atlas-web/lib/actions/getWorkflowEventLog.ts` — flesh out (Plan A defined the signature; this implements)

The action:
```ts
"use server";
import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowCheckpointRepo } from "@/lib/engine/factory";

export interface WorkflowEvent {
  id: string;
  workflowRunId: string;
  nodeId: string;
  kind: string;
  payload: unknown;
  createdAt: string;
}

export async function getWorkflowEventLog(input: { workflowRunId: string }): Promise<WorkflowEvent[]> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const repo = getWorkflowCheckpointRepo();
  const rows = await repo.listForRun(input.workflowRunId);
  return rows.map((r) => ({
    id: r.id,
    workflowRunId: r.workflowRunId,
    nodeId: r.nodeId,
    kind: r.kind,
    payload: r.payload,
    createdAt: r.createdAt.toISOString()
  }));
}
```

The component:
```tsx
"use client";
import { useEffect, useState } from "react";
import { getWorkflowEventLog, type WorkflowEvent } from "@/lib/actions/getWorkflowEventLog";

export function WorkflowHistoryTab({ workflowRunId }: { workflowRunId: string }) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  useEffect(() => {
    void getWorkflowEventLog({ workflowRunId }).then(setEvents);
  }, [workflowRunId]);
  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500"><th className="px-2 py-1">Time</th><th>Node</th><th>Kind</th><th>Payload</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t border-slate-200">
              <td className="px-2 py-1 font-mono">{e.createdAt.slice(11, 19)}</td>
              <td className="px-2 py-1">{e.nodeId}</td>
              <td className="px-2 py-1 font-mono">{e.kind}</td>
              <td className="px-2 py-1 font-mono text-[10px] truncate max-w-[400px]">{JSON.stringify(e.payload)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] Implement + add tab toggle in WorkflowGraphClient (Graph | History | Chat) + commit

---

### Task 8: Migration for max_cost_usd

**Files:**
- Create: `migrations/<next-num>_workflow_max_cost.sql`

```sql
alter table workflow_runs add column if not exists max_cost_usd numeric(12,4);
```

- [ ] Add + apply + commit

---

### Task 9: E2E test

**Files:**
- Create: `apps/atlas-web/e2e/tests/workflow-cost-cap.spec.ts`

Set `ATLAS_WORKFLOW_MAX_COST_USD=0.01`. Kick off a workflow. Verify: after one LLM call exceeds the cap, remaining nodes are blocked and workflow escalates with `cost_cap_reached` failure reason.

- [ ] Implement + commit

---

## Plan G — Self-review checklist
- [ ] Spec section 11 (cost cap: workflow_usage accumulator + pricing.ts + scheduler check + mid-run raise) → Tasks 1, 2, 3, 5
- [ ] Spec section 11 (observability: History tab) → Task 7
- [ ] Spec section 11 (public API: getWorkflowEventLog) → Task 7 (flesh out)
- [ ] Spec section 6 (workflow_usage table) → Plan A Task 4 already; this plan reads it
- [ ] Spec section 11 (telemetry-only checkpoints for cost — covered by Plan A's checkpoint recorder which already records developer_candidate_delta_batch etc.)

**Shippable result:** Workflows are now production-safe. Cost cap prevents runaway burn; History tab gives ops/debug visibility. Master flag `ATLAS_FF_WORKFLOW` can flip on in production with confidence.
