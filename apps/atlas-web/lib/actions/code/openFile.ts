"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { readMirroredFile } from "@atlas/spec-graph-sync";
import { languageFromPath } from "../../code/languageHint.js";

export interface OpenFileInput {
  projectId: string;
  filePath: string;
}

export interface OpenFileResult {
  content: string;
  language: string;
}

export async function openFile(input: OpenFileInput): Promise<OpenFileResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  try {
    const content = await readMirroredFile({
      projectId: input.projectId,
      filePath: input.filePath,
    });
    return { content, language: languageFromPath(input.filePath) };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("NOT_FOUND");
    throw err;
  }
}
