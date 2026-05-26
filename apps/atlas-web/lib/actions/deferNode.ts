"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { setNodePolicy } from "./setNodePolicy";

export interface DeferNodeInput {
  projectId: string;
  workflowRunId: string;
  nodeId: string;
}

/** Convenience wrapper: sets runMode="deferred" on the node policy. */
export async function deferNode(input: DeferNodeInput): Promise<void> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  await setNodePolicy({
    projectId: input.projectId,
    workflowRunId: input.workflowRunId,
    nodeId: input.nodeId,
    policy: { runMode: "deferred" }
  });
}
