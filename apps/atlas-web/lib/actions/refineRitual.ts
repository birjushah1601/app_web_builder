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
  const childId = await engine.refine({
    parentRitualId: input.parentRitualId,
    projectId: input.projectId,
    userId,
    userTurn: input.userTurn
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
