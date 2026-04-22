"use server";

import { auth } from "@/lib/auth/clerk-compat.js";
import { writeMirroredFile } from "@atlas/spec-graph-sync";

export interface SaveFileInput {
  projectId: string;
  filePath: string;
  content: string;
}

export interface SaveFileResult {
  ok: boolean;
}

export async function saveFile(input: SaveFileInput): Promise<SaveFileResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  await writeMirroredFile({
    projectId: input.projectId,
    filePath: input.filePath,
    content: input.content,
  });

  return { ok: true };
}
