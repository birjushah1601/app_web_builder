# Plan G.2 — Workflow Polish Follow-ups (Design)

**Date:** 2026-06-02
**Status:** In flight

## Problem

Two carry-overs from Plan G left rough edges in the workflow UX:

1. **Final cost vanishes after terminal status.** `WorkflowEngine.buildSnapshot()`
   surfaces `totalCostUsd` by reading the per-run `LLMUsageTracker`. Plan G Task 5
   cleans up that tracker in `onSchedulerExit` to avoid a memory leak. The side
   effect is that `snapshot.totalCostUsd` flips to `undefined` immediately after
   the workflow completes/escalates/aborts — the WorkflowHeader's cost badge
   disappears just when users want to inspect the final spend.

2. **No cost cap input on the approval panel.** Plan G Task 9 placed the cost
   cap input on `PromptFormWithPicker` (the new-project entry point). Users who
   start a workflow without the cap UI (e.g. legacy entry, picker disabled, or
   forgot to set it) cannot add or adjust a cap before approving. There is no
   approval-time control.

Other Plan G follow-ups (add-node mid-workflow, per-role cost breakdowns) are
explicitly deferred to F.5+ and H respectively — they need separate data plumbing.

## Decision

### A — Freeze the final cost on the run row

- New column `workflow_runs.total_cost_usd numeric` (nullable). Migration `0013`.
- The drizzle schema + `WorkflowRunRepo` learn a new `updateTotalCostUsd(id, totalCostUsd)`.
- `IWorkflowRunRepo` (the engine's interface) is extended with the same method
  plus `totalCostUsd?: number | string | null` on the `findById` return shape so
  in-memory fakes can mirror the real repo.
- `WorkflowEngine.buildSchedulerDeps.onSchedulerExit` persists the tracker's
  `totalUsd()` to the run row **before** deleting the map entry.
- `buildSnapshot` prefers the live tracker when present; otherwise falls back to
  the persisted column. Same `Number` normalization as `costCapUsd`.

### B — Approval-time cost cap input

- `WorkflowEngine.setCostCap(workflowRunId, costCapUsd)` writes the cap to the
  run row via a new `runRepo.updateCostCap(id, costCapUsd)`. Validates `> 0`.
  Passing `undefined` clears the cap (writes NULL). Throws `WorkflowNotFoundError`
  for unknown runs.
- `approveWorkflowPlan` Server Action gains `costCapUsd?: number`. When defined,
  calls `engine.setCostCap` BEFORE `engine.approvePlan` so the scheduler picks
  up the new cap in its `buildSchedulerDeps` call.
- `WorkflowApprovalPanel` adds a number input next to the Approve button. The
  initial value is the snapshot's existing `costCapUsd` (or empty when unset).
  Submitting passes the parsed value through to the action.

## Non-goals

- Add-node mid-workflow (deferred to F.5+).
- Per-role cost breakdowns (deferred to Plan H — needs role-level usage
  recording first).
- Editing the cap after approval (the panel only renders pre-approval).
- Migrating projection of historical runs — old rows with `total_cost_usd = NULL`
  simply show no cost badge after terminal status (same as today's behavior).

## Files

### Created
- `packages/spec-graph-data/drizzle/0013_workflow_runs_total_cost_usd.sql`
- `docs/superpowers/specs/2026-06-02-plan-g2-workflow-polish-followups-design.md` (this)
- `docs/superpowers/plans/2026-06-02-plan-g2-workflow-polish-followups.md`
- Tests covering the two engine paths + the approval panel cost-cap input.

### Modified
- `packages/spec-graph-data/src/schema/workflow-runs.ts` — add column.
- `packages/spec-graph-data/src/repo/workflow-run.repo.ts` — `updateTotalCostUsd`, `updateCostCap`.
- `packages/workflow-engine/src/engine.ts` — `IWorkflowRunRepo` updates,
  `setCostCap`, freeze final cost in `onSchedulerExit`, prefer persisted value
  in `buildSnapshot`.
- `apps/atlas-web/lib/actions/approveWorkflowPlan.ts` — accept `costCapUsd`.
- `apps/atlas-web/components/workflow/WorkflowApprovalPanel.tsx` — input.

## Risk

- Forgetting to migrate `atlas_dev` breaks every workflow-engine integration
  test that exercises real Postgres. Plan G.2 ends with the explicit
  `docker compose exec` migration command.
- The `onSchedulerExit` path is best-effort (errors are logged & swallowed by
  the scheduler). A persistence failure leaves `total_cost_usd = NULL`, which
  degrades gracefully to today's behavior.
