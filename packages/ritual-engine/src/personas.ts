import { z } from "zod";

export const PersonaTierSchema = z.enum(["ama", "diego", "priya"]);
export type PersonaTier = z.infer<typeof PersonaTierSchema>;

const RANK: Record<PersonaTier, number> = { ama: 0, diego: 1, priya: 2 };

export function isAtLeast(actual: PersonaTier, required: PersonaTier): boolean {
  return RANK[actual] >= RANK[required];
}

export interface PersonaPreferences {
  /** Returns the user's persona for this project. Per-project override falls
   *  back to per-user default; default-default is "ama" (least privileged). */
  getPersona(userId: string, projectId: string): Promise<PersonaTier>;
}
