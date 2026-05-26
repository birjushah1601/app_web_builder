"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface RetryNodeInput {
  projectId: string;
  workflowRunId: string;
  nodeId: string;
}

export async function retryNode(input: RetryNodeInput): Promise<void> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  await engine.retryNode(input.workflowRunId, input.nodeId);
}
