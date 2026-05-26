"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { WorkflowRunSnapshot } from "@atlas/workflow-engine";

export interface GetWorkflowRunInput {
  projectId: string;
  workflowRunId: string;
}

export async function getWorkflowRun(
  input: GetWorkflowRunInput
): Promise<WorkflowRunSnapshot | undefined> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  return engine.getRun(input.workflowRunId);
}
