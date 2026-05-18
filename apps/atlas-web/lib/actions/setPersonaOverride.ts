"use server";
import { auth } from "@/lib/auth/clerk-compat";
import type { PersonaTier } from "@atlas/ritual-engine";

export async function setPersonaOverride({ projectId, persona }: { projectId: string; persona: PersonaTier }): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const { Pool } = await import("pg");
  const { PreferencesRepo } = await import("@atlas/spec-graph-data");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const repo = new PreferencesRepo(pool);
  await repo.upsertOverride(userId, projectId, persona);
}
