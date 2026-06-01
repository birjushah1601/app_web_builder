"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface RetryAllFailedNodesInput {
  projectId: string;
  workflowRunId: string;
}

export interface RetryAllFailedNodesResult {
  retriedCount: number;
  errors: Array<{ nodeId: string; error: string }>;
}

export async function retryAllFailedNodes(
  input: RetryAllFailedNodesInput
): Promise<RetryAllFailedNodesResult> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const engine = await getWorkflowEngine(input.projectId);
  const snapshot = await engine.getRun(input.workflowRunId);
  if (!snapshot) {
    return { retriedCount: 0, errors: [] };
  }

  const failed = snapshot.nodes.filter((n) => n.status === "failed");
  const errors: Array<{ nodeId: string; error: string }> = [];
  let retriedCount = 0;

  for (const n of failed) {
    try {
      await engine.retryNode(input.workflowRunId, n.id);
      retriedCount++;
    } catch (err) {
      errors.push({
        nodeId: n.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return { retriedCount, errors };
}
