# Plan G.2 — Workflow Polish Follow-ups (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-06-02-plan-g2-workflow-polish-followups-design.md`
**Depends on:** Plan G shipped (cost cap + tracker + snapshot.totalCostUsd).

---

## Tasks

### Task 1 — Migration 0013 + drizzle column for `workflow_runs.total_cost_usd`

- Create `packages/spec-graph-data/drizzle/0013_workflow_runs_total_cost_usd.sql`.
- Add `totalCostUsd: numeric("total_cost_usd")` to `workflow-runs.ts` schema.

### Task 2 — Repo: `updateTotalCostUsd` + `updateCostCap`

- Add both methods to `WorkflowRunRepo`. Both perform a single-line UPDATE.
- `updateCostCap` writes NULL when `costCapUsd === undefined`.

### Task 3 — Engine: extend `IWorkflowRunRepo`, persist final cost in `onSchedulerExit`,
  prefer persisted value in `buildSnapshot`.

- Failing tests: (a) snapshot.totalCostUsd after terminal status matches the
  recorded cost; (b) no tracker, persisted value still surfaces.

### Task 4 — Engine: `setCostCap(workflowRunId, costCapUsd?)`

- Failing tests: (a) sets the cap; (b) clears via undefined; (c) throws for
  unknown run; (d) rejects non-positive.
- Implement.

### Task 5 — Server Action: `approveWorkflowPlan` accepts `costCapUsd`

- Failing test: action calls `engine.setCostCap` before `engine.approvePlan`
  when `costCapUsd` is set.
- Implement.

### Task 6 — `WorkflowApprovalPanel` cost-cap input

- Failing test: renders input, seeded from snapshot.costCapUsd; submitting with
  a value passes it to `approveWorkflowPlan`; empty value omits the field.
- Implement.

### Final — Migrate `atlas_dev`

```bash
docker compose exec -T postgres psql -U atlas -d atlas_dev \
  -f /dev/stdin < packages/spec-graph-data/drizzle/0013_workflow_runs_total_cost_usd.sql
```
