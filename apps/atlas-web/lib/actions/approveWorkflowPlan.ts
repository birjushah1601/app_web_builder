"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { PlanEdit } from "@atlas/workflow-engine";

export interface ApproveWorkflowPlanInput {
  projectId: string;
  workflowRunId: string;
  edits?: PlanEdit[];
}

export async function approveWorkflowPlan(
  input: ApproveWorkflowPlanInput
): Promise<void> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  await engine.approvePlan(input.workflowRunId, input.edits);
}
