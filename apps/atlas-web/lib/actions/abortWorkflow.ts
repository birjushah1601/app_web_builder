"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface AbortWorkflowInput {
  projectId: string;
  workflowRunId: string;
  reason?: string;
}

export async function abortWorkflow(input: AbortWorkflowInput): Promise<void> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  await engine.abort(input.workflowRunId, input.reason ?? "user requested abort");
}
