"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface StartWorkflowInput {
  projectId: string;
  prompt: string;
  suggestedKinds?: string[];
  concurrencyCap?: number;
}

export async function startWorkflow(
  input: StartWorkflowInput
): Promise<{ workflowRunId: string }> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  const workflowRunId = await engine.start({
    projectId: input.projectId,
    userId,
    prompt: input.prompt,
    ...(input.suggestedKinds && input.suggestedKinds.length > 0
      ? { artifactKindHint: input.suggestedKinds[0] }
      : {}),
    ...(input.concurrencyCap !== undefined ? { concurrencyCap: input.concurrencyCap } : {})
  });
  return { workflowRunId };
}
