# Plan G.3 — Per-Role Cost Breakdowns (Design Spec)

**Status:** Draft
**Depends on:** Plan G.2 (frozen final cost + approval cost-cap input).
**Defers:** add-node-mid-workflow (DAG mutation while running is its own concern).

---

## Problem

Plan G shipped a per-workflow `LLMUsageTracker` that records
`{provider, model, tokens}` into one totalUsd bucket. Plan G.2 froze that
final total on terminal status. Users now see "this workflow cost $2.70"
but cannot answer "which role spent the most?"

For a multi-role DAG (architect, developer, tester, iac, deployer) the
totalUsd hides where the spend went. A noisy developer or a runaway tester
loop is invisible until cumulative cost crosses the cap.

## Goal

Split the per-workflow USD spend by role so the workflow header can
surface a per-role breakdown alongside the existing total.

## Non-goals

- Per-role cost CAPS. v1 is reporting only; cap stays workflow-wide.
- Per-node breakdown. v1 buckets by role only — multiple nodes can use
  the same role, and aggregating by role is more useful than by node for
  the "where did the money go" question.
- Add-node-mid-workflow. Deferred — DAG mutation while a workflow is
  running is its own architectural concern (concurrency, dependsOn
  re-validation, scheduler restart).
- Migrating existing rows. New `cost_breakdown` column defaults to NULL;
  legacy rows surface no breakdown which is the same as today's
  behaviour for the rest of the snapshot.

---

## Design

### Tracker API extension

`LLMUsageTracker.record` gets an optional `opts.roleId` argument. Roles
that don't pass it (legacy + non-role call sites) bucket under a
synthetic `__unassigned__` key. v1 leaves wiring per-role recording to
the role packages as a follow-up — Plan G.3 only ships the plumbing.

```ts
interface LLMUsageTracker {
  record(
    provider: string,
    model: string,
    usage: TokenUsage,
    opts?: { roleId?: string }
  ): void;
  totalUsd(): number;
  breakdown(): Array<{ roleId: string; totalUsd: number; callCount: number }>;
}
```

`InMemoryUsageTracker` stores:

```
Map<roleId, { totalUsd, callCount }>
```

`breakdown()` returns the entries sorted by `totalUsd` descending. The
overall `totalUsd()` continues to return the sum across all roles.

### Snapshot

New optional field on `WorkflowRunSchema`:

```ts
costBreakdown?: Array<{
  roleId: string;
  totalUsd: number;
  callCount: number;
}>;
```

`buildSnapshot` reads it from the live tracker when present, otherwise
from the persisted `cost_breakdown` column.

### Persistence

- Migration `0014_workflow_runs_cost_breakdown.sql` adds
  `cost_breakdown jsonb` (NULL = never frozen).
- Drizzle schema gets a matching `jsonb("cost_breakdown")` column.
- `WorkflowRunRepo.updateCostBreakdown(id, breakdown)` writes JSON.
- `onSchedulerExit` in `buildSchedulerDeps` calls
  `updateCostBreakdown(runId, tracker.breakdown())` next to
  `updateTotalCostUsd`. Same error-swallow pattern.

### UI

`WorkflowHeader` adds a `<details><summary>` element next to the running
cost. Summary text shows the existing `$X.XX / $Y.YY` totals. Expanding
reveals a sorted list:

```
architect    $0.45  (3 calls)
developer    $2.13  (12 calls)
tester       $0.12  (1 call)
```

Progressive disclosure → no new dependency, no permanent screen real
estate when collapsed. When `costBreakdown` is empty/undefined the
disclosure is hidden entirely.

## Out of scope

- Coloured rows (amber/red) inside the breakdown list — workflow-level
  threshold is enough for v1.
- Tooltip explanations of which artifact-kind maps to which role —
  out of scope; the role IDs match the names users already see in node
  ritual events.
