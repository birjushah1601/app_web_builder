# Plan G.3 — Per-Role Cost Breakdowns (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-06-02-plan-g3-per-role-cost-breakdowns-design.md`
**Depends on:** Plan G.2 shipped (frozen final cost + approval cost-cap input).

---

## Tasks

### Task 1 — Extend `LLMUsageTracker.record` with optional `roleId` + add `breakdown()`

- Failing tests in `usage-tracker.test.ts`:
  - `record(provider, model, usage, { roleId: "developer" })` buckets under
    "developer"; second call with same role accumulates.
  - `record` without roleId buckets under `__unassigned__`.
  - `breakdown()` returns entries sorted by totalUsd desc with callCount.
  - `totalUsd()` continues to return the cross-role sum.
- Implement.

### Task 2 — Snapshot: add `costBreakdown` to `WorkflowRunSchema`

- Failing test: parsing a run with `costBreakdown: [{roleId:"a",totalUsd:1,callCount:2}]`
  round-trips; legacy snapshots (no field) still parse.
- Implement: add optional field on `types.ts`.

### Task 3 — Migration 0014 + drizzle column for `workflow_runs.cost_breakdown jsonb`

- Create `packages/spec-graph-data/drizzle/0014_workflow_runs_cost_breakdown.sql`.
- Add `costBreakdown: jsonb("cost_breakdown")` to `workflow-runs.ts`.

### Task 4 — Repo: `updateCostBreakdown`

- Failing test in `workflow-run.repo.test.ts`: writes the JSON payload;
  reading back via findById returns the same array. Plus a test that
  passing an empty array stores an empty array (not null).
- Implement single-line update.

### Task 5 — Engine: `IWorkflowRunRepo.updateCostBreakdown?`, freeze in `onSchedulerExit`,
prefer live tracker in `buildSnapshot`

- Failing tests in `packages/workflow-engine/test/engine-cost-breakdown.test.ts`:
  - `onSchedulerExit` calls `updateCostBreakdown(runId, tracker.breakdown())`.
  - After terminal status, snapshot surfaces persisted breakdown.
  - Live tracker takes precedence during execution.
  - Legacy repo without `updateCostBreakdown` → snapshot has no breakdown (undefined).
- Implement.

### Task 6 — `WorkflowHeader` expandable breakdown

- Failing tests in `WorkflowHeader.test.tsx`:
  - When `costBreakdown` is present + non-empty, renders a
    `data-testid="workflow-cost-breakdown"` `<details>` element listing
    role rows sorted by totalUsd desc.
  - When `costBreakdown` is missing or empty, the disclosure is not rendered.
  - Each row shows roleId, formatted USD, and call count.
- Implement.

### Final — Migrate `atlas_dev`

```bash
docker compose exec -T postgres psql -U atlas -d atlas_dev \
  -f /dev/stdin < packages/spec-graph-data/drizzle/0014_workflow_runs_cost_breakdown.sql
```
