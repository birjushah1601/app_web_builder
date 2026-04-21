"use server";
import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory.js";

export async function escalateRitual({ projectId, ritualId, reason }: { projectId: string; ritualId: string; reason: string }): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(projectId);
  await engine.escalate(ritualId, reason, userId);
}
