# @atlas/postgres-branching

Schema-per-branch Postgres branching for Atlas Run preview environments. Per ADR-001 §3, each Atlas project branch lives in its own Postgres `schema` within a shared cluster — no Neon, no separate-DB-per-branch.

## API

- `branchSchemaName(projectId, branchId)` — deterministic `br_<16-hex>` name from `sha256(projectId|branchId)`. Identifier-safe.
- `PgBranchingAdapter` — `ensureBranch` (idempotent), `dropBranch` (idempotent), `listBranches`.
- `replayMigrationsToSchema({ pool, schemaName, migrationsDir })` — replays drizzle SQL files (in numeric order) against the branch schema's `search_path`.

## Usage

```ts
const adapter = new PgBranchingAdapter(pool);
const { schemaName, created } = await adapter.ensureBranch(projectId, "preview-42");
if (created) {
  await replayMigrationsToSchema({ pool, schemaName, migrationsDir: "packages/spec-graph-data/drizzle" });
}
// Workload connects with: SET search_path TO "br_<hex>"
```

## Non-goals

- Cross-branch foreign keys are not allowed. The adapter does not stop you, but the deploy orchestrator validates against this.
- Cross-cluster branching. For multi-region, the orchestrator picks the per-region cluster; branches stay within a cluster.
