"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface GetWorkflowEventLogInput {
  projectId: string;
  workflowRunId: string;
  /** When provided, only return checkpoints for this specific node. */
  nodeId?: string;
}

/** Checkpoint row shape returned to callers (plain JSON-serializable). */
export interface WorkflowCheckpointEntry {
  id: string;
  workflowRunId: string;
  nodeId: string;
  kind: string;
  payload: unknown;
  ritualEventId: string | null | undefined;
  createdAt: string;
}

/**
 * Returns checkpoint rows for a workflow run (or a single node within it).
 * Plan A: thin wrapper over WorkflowCheckpointRepo — no event-log aggregation.
 * Plan G will polish this into a proper structured event log with full
 * broker-subscription replay and de-duplication.
 */
export async function getWorkflowEventLog(
  input: GetWorkflowEventLogInput
): Promise<WorkflowCheckpointEntry[]> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const { Pool } = await import("pg");
  const { WorkflowCheckpointRepo } = await import("@atlas/spec-graph-data");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const repo = new WorkflowCheckpointRepo(pool);

  const rows = input.nodeId
    ? await repo.listForNode(input.workflowRunId, input.nodeId)
    : await repo.listForRun(input.workflowRunId);

  return rows.map((r) => ({
    id: r.id,
    workflowRunId: r.workflowRunId,
    nodeId: r.nodeId,
    kind: r.kind,
    payload: r.payload,
    ritualEventId: r.ritualEventId,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)
  }));
}
