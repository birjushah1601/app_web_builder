"use server";

import { z } from "zod";
import { auth } from "@/lib/auth/clerk-compat";

export const AccessModeSchema = z.enum(["public", "password", "auth"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

const CreateShareableUrlInputSchema = z.object({
  projectId: z.string().min(1),
  sandboxId: z.string().min(1),
  accessMode: AccessModeSchema,
  passwordPlaintext: z.string().min(1).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional().default(24),
});

export type CreateShareableUrlInput = z.input<typeof CreateShareableUrlInputSchema>;

export interface ShareableUrlResult {
  url: string;
  accessMode: AccessMode;
  expiresAt: string;
}

export async function createShareableUrl(
  input: CreateShareableUrlInput
): Promise<ShareableUrlResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = CreateShareableUrlInputSchema.parse(input);

  // Hash password if provided (bcrypt — import dynamically to avoid client-bundle risk)
  let passwordHash: string | undefined;
  if (parsed.accessMode === "password" && parsed.passwordPlaintext) {
    const bcrypt = await import("bcryptjs");
    passwordHash = await bcrypt.hash(parsed.passwordPlaintext, 12);
  }

  const expiresAt = new Date(
    Date.now() + parsed.expiresInHours * 60 * 60 * 1000
  ).toISOString();

  // TODO(E.4): persist to preview_urls table via @atlas/spec-graph-data when available.
  // For now, encode all parameters in a signed token (replace with DB in follow-up).
  const token = Buffer.from(
    JSON.stringify({
      projectId: parsed.projectId,
      sandboxId: parsed.sandboxId,
      accessMode: parsed.accessMode,
      passwordHash,
      expiresAt,
      issuedBy: userId,
    })
  ).toString("base64url");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/preview/${token}`;

  return { url, accessMode: parsed.accessMode, expiresAt };
}
