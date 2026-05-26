"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { NodePolicy } from "@atlas/workflow-engine";

export interface SetNodePolicyInput {
  projectId: string;
  workflowRunId: string;
  nodeId: string;
  policy: Partial<NodePolicy>;
}

export async function setNodePolicy(input: SetNodePolicyInput): Promise<void> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  await engine.setNodePolicy(input.workflowRunId, input.nodeId, input.policy);
}
