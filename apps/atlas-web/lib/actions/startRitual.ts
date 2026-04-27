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
 *  the artifact + roleEvents inline so users see the architect's output
 *  instead of a silent success. */
export interface StartRitualResult {
  ritualId: string;
  /** Final architect plan when triage passed and pass2 ran. */
  artifact?: unknown;
  /** Every event the role emitted in this dispatch — pass1.completed,
   *  triage.needs_input (when triage blocks), pass2.started/completed. */
  roleEvents: Array<{ eventType: string; payload: unknown }>;
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
    roleEvents: snapshot?.roleEvents ?? []
  };
}
