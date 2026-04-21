"use server";

import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory";
import type { PersonaTier } from "@atlas/ritual-engine";

export type ApprovalInput =
  | { kind: "approved"; persona: PersonaTier }
  | { kind: "changes_requested"; notes: string };

export async function approveRitual({ projectId, ritualId, decision }: { projectId: string; ritualId: string; decision: ApprovalInput }): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(projectId);
  if (decision.kind === "approved") {
    await engine.approve(ritualId, { kind: "approved", approvedBy: userId, persona: decision.persona });
  } else {
    await engine.approve(ritualId, { kind: "changes_requested", requestedBy: userId, notes: decision.notes });
  }
}
