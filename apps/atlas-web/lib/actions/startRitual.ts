"use server";

import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory";
import type { EditClass } from "@atlas/ritual-engine";

export interface StartRitualInput {
  projectId: string;
  userTurn: string;
  editClass: EditClass;
}

export async function startRitual(input: StartRitualInput): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  return engine.start({
    userTurn: input.userTurn,
    editClass: input.editClass,
    projectId: input.projectId,
    userId
  });
}
