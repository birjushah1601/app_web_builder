// Workflow seed helpers for Plan C E2E tests.
//
// The atlas-web workflow page expects a workflow_run row + N workflow_node
// rows in Postgres. These helpers let a Playwright spec seed a known
// workflow snapshot without spinning up the real engine.
//
// Cleanup is the caller's responsibility — pass the returned ids to
// deleteWorkflow() in test.afterEach so the DB doesn't accumulate junk
// across runs.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export type SeedNode = {
  id: string;
  artifactKind: string;
  summary: string;
  dependsOn?: string[];
  consumes?: string[];
  status?: "pending" | "ready" | "running" | "done" | "failed" | "skipped" | "blocked";
  ritualId?: string;
  policy?: { priority: number; runMode: "active" | "background" | "deferred" };
};

export type SeedWorkflowInput = {
  projectId: string;
  userId: string;
  prompt?: string;
  status?: "planning" | "awaiting_approval" | "running" | "completed" | "escalated" | "aborted";
  nodes: ReadonlyArray<SeedNode>;
};

export async function seedWorkflow(
  pool: Pool,
  input: SeedWorkflowInput
): Promise<{ workflowRunId: string; nodeIds: string[] }> {
  const workflowRunId = randomUUID();
  await pool.query(
    `INSERT INTO workflow_runs
       (id, project_id, user_id, prompt, status, dependency_profile, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [
      workflowRunId,
      input.projectId,
      input.userId,
      input.prompt ?? "e2e-seeded workflow",
      input.status ?? "awaiting_approval",
      JSON.stringify({ schemaVersion: "1" })
    ]
  );

  const nodeIds: string[] = [];
  for (const n of input.nodes) {
    await pool.query(
      `INSERT INTO workflow_nodes
         (id, workflow_run_id, artifact_kind, summary, depends_on, consumes, policy, status, ritual_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        n.id,
        workflowRunId,
        n.artifactKind,
        n.summary,
        JSON.stringify(n.dependsOn ?? []),
        JSON.stringify(n.consumes ?? []),
        JSON.stringify(n.policy ?? { priority: 0, runMode: "active" }),
        n.status ?? "pending",
        n.ritualId ?? null
      ]
    );
    nodeIds.push(n.id);
  }

  return { workflowRunId, nodeIds };
}

export async function deleteWorkflow(pool: Pool, workflowRunId: string): Promise<void> {
  await pool.query("DELETE FROM workflow_runs WHERE id = $1", [workflowRunId]);
}

export async function updateNodeStatus(
  pool: Pool,
  workflowRunId: string,
  nodeId: string,
  status: SeedNode["status"]
): Promise<void> {
  await pool.query(
    "UPDATE workflow_nodes SET status = $1 WHERE workflow_run_id = $2 AND id = $3",
    [status, workflowRunId, nodeId]
  );
}

export async function updateRunStatus(
  pool: Pool,
  workflowRunId: string,
  status: SeedWorkflowInput["status"]
): Promise<void> {
  await pool.query(
    "UPDATE workflow_runs SET status = $1, updated_at = NOW() WHERE id = $2",
    [status, workflowRunId]
  );
}
