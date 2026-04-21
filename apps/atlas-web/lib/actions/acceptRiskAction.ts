"use server";

import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface AcceptRiskInput {
  projectId: string;
  ritualId: string;
  gate: "L4-security" | "L5-compliance" | "L6-a11y-advisory" | "L7-visual-advisory";
  persona: PersonaTier;
  failureSummary: string;
  rationale: string;
  scope: "single-commit" | "session" | "permanent-for-project";
}

export async function acceptRiskAction(input: AcceptRiskInput): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  await engine.acceptRisk(input.ritualId, {
    gate: input.gate,
    failureSummary: input.failureSummary,
    acceptedBy: { personaTier: input.persona, userId, timestamp: new Date().toISOString() },
    rationale: input.rationale,
    scope: input.scope
  });
}
