import { randomUUID } from "node:crypto";
import type { Database } from "../src/client.js";

export function uniqueProjectId(): string {
  return randomUUID();
}

export async function truncateAllTables(db: Database): Promise<void> {
  await db.pool.query(
    "TRUNCATE spec_graphs, spec_events, spec_snapshots, sandbox_spend_log, projects, workflow_runs, workflow_nodes, workflow_node_checkpoints, workflow_usage RESTART IDENTITY CASCADE"
  );
}
