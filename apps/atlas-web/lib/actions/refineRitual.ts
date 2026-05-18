"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { StartRitualResult } from "./startRitual";

export interface RefineRitualInput {
  projectId: string;
  parentRitualId: string;
  userTurn: string;
}

export interface RefineRitualResult extends StartRitualResult {
  parentRitualId: string;
}

export async function refineRitual(input: RefineRitualInput): Promise<RefineRitualResult> {
  if (!isFeatureEnabled("multi-turn")) {
    throw new Error(
      "multi-turn refinement is disabled — set ATLAS_FF_MULTI_TURN=true to enable"
    );
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  // Task B: same anchor-file snapshot as startRitual. Refines benefit from
  // currentFiles in addition to PriorRitualContext because the prior ritual
  // captures intent + the diff that should have landed, while currentFiles
  // captures what the sandbox actually looks like NOW (the user may have
  // edited files manually in the editor between turns).
  const { readCurrentFilesForProject } = await import("@/lib/sandbox/read-current-files");
  const currentFiles = await readCurrentFilesForProject(input.projectId);
  const childId = await engine.refine({
    parentRitualId: input.parentRitualId,
    projectId: input.projectId,
    userId,
    userTurn: input.userTurn,
    ...(currentFiles.length > 0 ? { currentFiles } : {})
  });
  const snapshot = await engine.getRitual(childId);
  return {
    ritualId: childId,
    parentRitualId: input.parentRitualId,
    artifact: snapshot?.artifact,
    roleEvents: snapshot?.roleEvents ?? [],
    developerOutput: snapshot?.developerOutput,
    sandboxApplyResult: snapshot?.sandboxApplyResult,
    fixAttempts: snapshot?.fixAttempts
  };
}
