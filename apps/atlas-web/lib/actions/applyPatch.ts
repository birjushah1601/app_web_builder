"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { applyPatch as enginePatch } from "@atlas/edit-patch-engine";
import type { EditPatch } from "@atlas/edit-patch-engine";

export interface ApplyPatchInput {
  projectId: string;
  /** Full sandbox file path including /code/ prefix, e.g. /code/src/app/page.tsx */
  filePath: string;
  patch: EditPatch;
}

export interface ApplyPatchOutput {
  ok: boolean;
  inverse?: EditPatch;
  error?: "unauthorized" | "not-found" | "parse-error" | "unsupported" | "sandbox-error";
  detail?: string;
}

/** Server Action that applies a single EditPatch to a single sandbox file:
 *  1) Reads the current file content from the live E2B sandbox.
 *  2) Runs the patch through @atlas/edit-patch-engine's applyPatch.
 *  3) On ok, writes the new content back (HMR picks it up).
 *  Returns the inverse patch so the client can push it onto its undo stack. */
export async function applyPatch(input: ApplyPatchInput): Promise<ApplyPatchOutput> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };

  try {
    const session = await getSandboxFactory().getOrProvision(input.projectId);
    const { Sandbox } = await import("@e2b/sdk");
    const sdk = await Sandbox.connect(session.record.sandboxId, {
      apiKey: process.env.E2B_API_KEY ?? ""
    });
    const files = (sdk as unknown as {
      files: { read: (p: string) => Promise<string>; write: (p: string, c: string) => Promise<unknown> };
    }).files;
    const source = await files.read(input.filePath);
    const result = enginePatch(source, input.patch);
    if (!result.ok || !result.newContent) {
      const out: ApplyPatchOutput = { ok: false };
      if (result.error) out.error = result.error;
      if (result.detail) out.detail = result.detail;
      return out;
    }
    await files.write(input.filePath, result.newContent);
    const out: ApplyPatchOutput = { ok: true };
    if (result.inverse) out.inverse = result.inverse;
    return out;
  } catch (err) {
    return {
      ok: false,
      error: "sandbox-error",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}
