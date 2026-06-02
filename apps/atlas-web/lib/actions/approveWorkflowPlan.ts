"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { PlanEdit } from "@atlas/workflow-engine";

export interface ApproveWorkflowPlanInput {
  projectId: string;
  workflowRunId: string;
  edits?: PlanEdit[];
  /**
   * Plan G.2 — approval-time cost cap edit. When set to a positive number,
   * the action calls engine.setCostCap BEFORE engine.approvePlan so the
   * scheduler picks up the new cap as soon as it runs. Pass `null` to clear
   * any pre-existing cap on the run. Omit to leave the cap untouched.
   */
  costCapUsd?: number | null;
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

  // Plan G.2 — apply the cap edit first so engine.approvePlan's scheduler
  // build picks it up via runRepo.findById on the next line.
  if (input.costCapUsd !== undefined) {
    const cap = input.costCapUsd === null ? undefined : input.costCapUsd;
    await engine.setCostCap(input.workflowRunId, cap);
  }
  await engine.approvePlan(input.workflowRunId, input.edits);
}
