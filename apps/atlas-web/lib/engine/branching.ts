// Plan F.4 Task 3 — real per-run Postgres BranchingPort + MigratePort.
//
// Replaces the inline stubs in factory.ts:buildDeployRunner. Each deploy run
// now creates a real Postgres schema (one per projectId|branchId pair via
// PgBranchingAdapter's sha256-hashed name) and replays the full spec-graph-data
// drizzle migration history into it before the orchestrator threads the
// schemaName downstream (Knative env contract).
//
// The two helpers below are pure wrappers so they're trivially unit-testable
// without dragging in the live pg Pool — tests inject a structural fake
// for `BranchingAdapter` and a fake `replay` function for the migrate path.

import type { Pool } from "pg";
import type { BranchingPort, MigratePort } from "@atlas/deploy-orchestrator";

/** Structural subset of `@atlas/postgres-branching`'s `PgBranchingAdapter`
 *  used by the deploy runner. Declared as an interface so tests can inject
 *  a vi.fn-backed fake without instantiating the real pg-backed class. The
 *  real adapter satisfies this shape implicitly. */
export interface BranchingAdapter {
  ensureBranch(projectId: string, branchId: string): Promise<{ schemaName: string; created: boolean }>;
  dropBranch(projectId: string, branchId: string): Promise<{ schemaName: string; dropped: boolean }>;
  listBranches(projectId: string): Promise<string[]>;
}

/** Wraps a `BranchingAdapter` into the orchestrator's `BranchingPort`. The
 *  two contracts already match shape-for-shape; this exists so the factory
 *  has a single import + a stable extension point for future per-run
 *  telemetry (e.g. emit `deploy.branch.created` events). */
export function createDeployBranching(adapter: BranchingAdapter): BranchingPort {
  return {
    ensureBranch: (projectId, branchId) => adapter.ensureBranch(projectId, branchId),
    dropBranch: (projectId, branchId) => adapter.dropBranch(projectId, branchId),
    listBranches: (projectId) => adapter.listBranches(projectId)
  };
}

export type ReplayFn = (input: {
  pool: Pool;
  schemaName: string;
  migrationsDir: string;
}) => Promise<{
  schemaName: string;
  applied: number;
  filenames: string[];
}>;

export interface CreateDeployMigrateInput {
  pool: Pool;
  /** Absolute path to the spec-graph-data drizzle/ directory. Resolved by the
   *  factory off `process.cwd()` so new migrations are picked up automatically
   *  with no code change. */
  migrationsDir: string;
  /** Injection point for tests. Defaults to `replayMigrationsToSchema` from
   *  `@atlas/postgres-branching` resolved lazily so the test file doesn't
   *  pull in the pg dependency just to assert call shape. */
  replay?: ReplayFn;
}

export function createDeployMigrate(input: CreateDeployMigrateInput): MigratePort {
  return async ({ schemaName }) => {
    const replay =
      input.replay ?? (await import("@atlas/postgres-branching")).replayMigrationsToSchema;
    return replay({
      pool: input.pool,
      schemaName,
      migrationsDir: input.migrationsDir
    });
  };
}
