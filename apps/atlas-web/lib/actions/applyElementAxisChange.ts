"use server";
/**
 * Plan UXO Task 8 — persist a slider-driven axis change.
 *
 * Two paths:
 *   1. `tokenKey` axes (the V1-supported path) — writes the change into
 *      `/code/src/design-tokens.json` inside the project's E2B sandbox.
 *      Tailwind picks up the file change via HMR and the preview iframe
 *      re-renders with the new token value.
 *   2. `cssProperty` axes — runtime-only in V1 (the spec calls this an
 *      acceptable limitation). The edit-bridge inside the sandbox is the
 *      surface that would apply a scoped class to the element; no source
 *      file is written from the host. A follow-up V2 task should extend
 *      this action to mutate `page.tsx` for cssProperty axes that can't
 *      be mapped to a token.
 *
 * Imported lazily (`await import("@e2b/sdk")`) so this server action does
 * not pull the SDK into the build of routes that never need it — matches
 * the pattern in lib/actions/code/openPr.ts and getTestResults.ts.
 */
import { getSandboxFactory } from "@/lib/sandbox/factory";

export interface ApplyElementAxisChangeInput {
  projectId: string;
  selector: string;
  axis: { tokenKey?: string; cssProperty?: string };
  value: string;
}

/** Minimal shape of the E2B v2.5 filesystem API we rely on. Kept local so
 *  this Server Action does not couple to @e2b/sdk's internal package
 *  layout — same pattern as the rest of lib/actions/code. */
interface E2BFiles {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

interface E2BConnectable {
  files: E2BFiles;
}

export async function applyElementAxisChange(input: ApplyElementAxisChangeInput): Promise<void> {
  const session = await getSandboxFactory().getOrProvision(input.projectId);
  const { Sandbox } = await import("@e2b/sdk");
  const sdk = (await Sandbox.connect(session.record.sandboxId, {
    apiKey: process.env.E2B_API_KEY ?? ""
  })) as unknown as E2BConnectable;

  if (input.axis.tokenKey) {
    // Read design-tokens.json, patch the key, write back. Tailwind rebuilds on save.
    const txt = await sdk.files.read("/code/src/design-tokens.json");
    const tokens = JSON.parse(txt) as Record<string, unknown>;
    setNested(tokens, input.axis.tokenKey, input.value);
    await sdk.files.write("/code/src/design-tokens.json", JSON.stringify(tokens, null, 2));
    return;
  }
  if (input.axis.cssProperty) {
    // V1 limitation: cssProperty axes are runtime-only; the edit-bridge in
    // the sandbox handles the visible update. Persisting to source (i.e.
    // appending a className inside page.tsx) is a V2 follow-up tracked in
    // the spec's "Out of scope" section.
    return;
  }
}

function setNested(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (next === null || next === undefined || typeof next !== "object") {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
