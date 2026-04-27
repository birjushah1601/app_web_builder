"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";
import type { EditClass } from "@atlas/ritual-engine";

export interface StartRitualInput {
  projectId: string;
  userTurn: string;
  editClass: EditClass;
}

/** Plain JSON-serializable shape returned to the client. ChatPanel renders
 *  the artifact + roleEvents + developerOutput inline so users see what
 *  the ritual actually produced instead of a silent success. */
export interface StartRitualResult {
  ritualId: string;
  /** Final architect plan when triage passed and pass2 ran. */
  artifact?: unknown;
  /** Every event each role emitted in this ritual chain — architect's
   *  pass1/pass2/needs_input, developer's anthropic/google/reviewer/completed,
   *  plus any failure events. */
  roleEvents: Array<{ eventType: string; payload: unknown }>;
  /** Developer role's diff + summary when the chain reached the developer
   *  step (architect produced an artifact AND editClass !== "cosmetic"). */
  developerOutput?: { diff: string; summary?: string };
}

export async function startRitual(input: StartRitualInput): Promise<StartRitualResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  const ritualId = await engine.start({
    userTurn: input.userTurn,
    editClass: input.editClass,
    projectId: input.projectId,
    userId
  });
  // Snapshot is in-memory; same engine instance is cached per-request via
  // React `cache()` in factory.ts, so this getRitual() always finds the
  // ritual we just started.
  const snapshot = engine.getRitual(ritualId);
  return {
    ritualId,
    artifact: snapshot?.artifact,
    roleEvents: snapshot?.roleEvents ?? [],
    developerOutput: snapshot?.developerOutput
  };
}
