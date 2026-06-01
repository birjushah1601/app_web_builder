# Plan G — Workflow Polish (picker wiring + retry-all + cost cap)

**Status:** Approved 2026-06-01
**Parent spec:** `docs/superpowers/specs/2026-05-26-multi-artifact-workflow-design.md` (§9 picker, §11 ops, §13 cost)
**Predecessors:** Plans A–F + D.2 merged
**Successor (planned):** Plan G.2 — add-node mid-workflow + multi-workflow cost rollup + per-role cost breakdowns

---

## Goal

Three independent workflow-polish features that bring the workflow story from "works" to "feels finished":

1. **Picker wiring** — connect Plan C's `WorkflowPickerChecklist` component into the new-project flow so users can override the entry classifier's `suggestedKinds` before a workflow starts (deferred from Plan C Task 10).
2. **Retry-all-failed** — one-click bulk retry for every failed node in an escalated workflow run, via `WorkflowHeader`.
3. **Per-workflow cost cap** — optional USD budget on each workflow run; engine tracks LLM token cost in real time; scheduler aborts when the cap is exceeded.

All three are pure atlas-web + workflow-engine work — no new infrastructure, no roles, no canvas renderers, no template changes.

## Architecture decisions (locked)

### Picker wiring

1. **Split `submitPromptedProject`** (today: classify + start ritual + redirect) into two actions:
   - `classifyAndCreateProject(formData)` → `{ projectId, mode, suggestedKinds, reasoning }` (no start — leaves the project provisioned but no ritual launched)
   - existing `startWorkflow` / `startRitual` server actions invoked from the client AFTER the user confirms via the picker
2. **Flag gate:** `ATLAS_FF_WORKFLOW_PICKER` flag stays the on/off switch (already wired in the feature-flag system since Plan C). When off, the new-project form keeps today's behavior (single fire-and-forget action + redirect). When on, the form uses the split flow.
3. **Client wraps `PromptForm`** with `PromptFormWithPicker`. The wrapper handles the picker-vs-direct branch + `useTransition` for pending states + redirect.
4. **Downgrade path** ("Use single-ritual instead" button): calls `startRitual` directly with the same prompt. The project already exists; no rollback needed since the workflow hasn't started.

### Retry-all-failed

5. **`retryAllFailedNodes(workflowRunId)`** Server Action: loops over the run's nodes, calls existing `retryNode` for each `status === "failed"`. Errors aggregate; partial success is OK (some nodes succeed, others surface their own error).
6. **UI:** new button on `WorkflowHeader` shown only when `snapshot.status === "escalated"` AND at least one node has `status: "failed"`. Disabled while pending. Mirrors the existing Abort button.

### Cost cap

7. **`LLMUsageTracker` interface** (new `packages/llm-provider/src/usage-tracker.ts` or similar):
   ```ts
   interface LLMUsageTracker {
     record(provider: string, model: string, usage: { inputTokens, outputTokens }): void;
     totalUsd(): number;
   }
   ```
8. **In-memory implementation** for v1: pricing table keyed by `{provider}:{model}`, computes `(inputTokens × priceIn + outputTokens × priceOut) / 1_000_000` per record, sums to `totalUsd()`. Pricing table lives next to the tracker; starts with the 3 models currently used (claude-sonnet-4, claude-haiku-4, gemini-2.5-flash).
9. **Per-workflow tracker instance:** WorkflowEngine creates a fresh tracker for each workflow run. The tracker is threaded into `ritualEngine.start(...)` via a new optional `usageTracker?: LLMUsageTracker` field on the input — the ritual engine + its roles record via this tracker.
10. **Cap enforcement at scheduler-tick time:** after every ritual completion, the scheduler checks `tracker.totalUsd() > run.costCapUsd`. If exceeded, the scheduler aborts the workflow with reason `"cost cap exceeded: $X.XX > $Y.YY"`.
11. **Schema change:** add `cost_cap_usd: numeric` nullable column to `workflow_runs`. Add `costCapUsd?: number` to `StartWorkflowInput` + `WorkflowRunSnapshot`. Backward-compatible (null = no cap).
12. **Cost cap default:** off (no cap) unless `ATLAS_DEFAULT_WORKFLOW_COST_CAP_USD` env var is set OR the user provides a cap at `startWorkflow` / approval time. The approval panel gets a new optional "Cost cap (USD)" input field.
13. **UI surface:** `WorkflowHeader` shows running cost `$X.XX` (and `/ $Y.YY` when a cap is set). Color flips amber at 80% and red at 100% of cap. Abort reason text propagates via the existing abort-event flow.

## Out of scope (Plan G.2 / later)

- **Add-node mid-workflow** (DAG mutation while running) — meaningful complexity, deferred
- **Per-role cost breakdowns** (the UI shows aggregate, not per-role bars)
- **Multi-workflow rollup** (project-level budgets, monthly spend dashboards)
- **Cost prediction before approval** (asking the planner to estimate spend)
- **Resume-after-cap** (raise cap + continue from last checkpoint)
- **Streaming cost updates over SSE** (today's UX reads cost from the snapshot, not live-updated mid-ritual)
- **Real LLM pricing fetch from provider APIs** (we use a hardcoded table; refresh is a manual code edit)

## Affected packages + new files

**New files:**
- `apps/atlas-web/lib/actions/classifyAndCreateProject.ts` — new Server Action
- `apps/atlas-web/lib/actions/retryAllFailedNodes.ts` — bulk retry action
- `apps/atlas-web/app/projects/new/_components/PromptFormWithPicker.tsx` — client wrapper handling the picker flow
- `packages/llm-provider/src/usage-tracker.ts` — `LLMUsageTracker` interface + in-memory impl + pricing table
- Per-file test files in matching locations

**Modified files:**
- `apps/atlas-web/app/projects/new/page.tsx` — when the picker flag is on, mount `PromptFormWithPicker`
- `apps/atlas-web/app/projects/new/actions.ts` — keep `submitPromptedProject` for the flag-off path; add note pointing to the new split actions
- `apps/atlas-web/components/workflow/WorkflowHeader.tsx` — add retry-all-failed button + running-cost display
- `apps/atlas-web/components/workflow/WorkflowApprovalPanel.tsx` — add optional cost-cap input
- `packages/workflow-engine/src/types.ts` — add `costCapUsd?: number` to WorkflowRunSchema
- `packages/workflow-engine/src/engine.ts` — thread `LLMUsageTracker` per-run; cap check at scheduler tick
- `packages/workflow-engine/src/scheduler.ts` — cap-exceeded abort path
- `packages/spec-graph-data/src/schema/workflow-runs.ts` — add `cost_cap_usd` column
- Plus a new migration file in the appropriate location

## Shippable result

- A user submitting a prompt with `ATLAS_FF_WORKFLOW_PICKER=true` sees the suggested-kinds checklist between "Create project" and the workflow starting. They can untick kinds OR downgrade to single-ritual without losing the project.
- A user looking at an escalated workflow sees a "Retry all failed (N)" button; one click queues all failed nodes back to pending and re-runs the scheduler.
- A user setting `costCapUsd: 5.00` at workflow start sees `$X.XX / $5.00` in the header; if the running total crosses $5.00, the workflow aborts with a clear reason rather than burning through unbounded budget.
