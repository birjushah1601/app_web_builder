import { randomUUID } from "node:crypto";
import type { Database } from "../src/client.js";
import { SpecGraphRepo } from "../src/repo/spec-graph.repo.js";

export function uniqueProjectId(): string {
  return randomUUID();
}

export async function truncateAllTables(db: Database): Promise<void> {
  await db.pool.query(
    "TRUNCATE spec_graphs, spec_events, spec_snapshots, sandbox_spend_log, projects, workflow_runs, workflow_nodes, workflow_node_checkpoints, workflow_usage, eval_verdicts RESTART IDENTITY CASCADE"
  );
}

/** Seed a project row so FK-constrained inserts (e.g. workflow_runs.project_id)
 *  satisfy the projects(project_id) → spec_graphs(project_id) chain.
 *  Uses SpecGraphRepo.create (which sets app.project_id for RLS) for the
 *  spec_graphs row, then inserts the projects row via raw SQL (projects has
 *  no RLS policy). Returns the projectId that was seeded. */
export async function seedProject(db: Database, projectId?: string): Promise<string> {
  const id = projectId ?? uniqueProjectId();
  const graphRepo = new SpecGraphRepo(db.pool);
  // 1. spec_graphs row via repo (handles RLS app.project_id session var)
  await graphRepo.create(id, {});
  // 2. projects row — no RLS on this table
  await db.pool.query(
    "INSERT INTO projects (project_id, user_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [id, "user_test", "Test Project"]
  );
  return id;
}
