/**
 * Read a curated set of "what does the live sandbox look like right now" files
 * so the architect can build a plan that respects what already exists instead
 * of recreating from scratch.
 *
 * Why a curated list (not a recursive ls)?
 *   - The architect's prompt budget is finite. Whole-tree dumps would
 *     overflow on any non-trivial project.
 *   - The three files below are the "anchor surface" of the atlas-next-ts
 *     template — Page (entry), Layout (chrome), and globals.css (styling
 *     conventions). Together they tell the model "here's how this app is
 *     structured today."
 *
 * Failure modes are silent (return [] / skip):
 *   - Sandbox not provisioned yet → no factory call, return [].
 *   - File doesn't exist in the sandbox → skip that entry.
 *   - File ≥ size budget → still include path + content (deep-plan's
 *     renderCurrentFilesSection handles head/tail elision).
 *   - Any other error → log + return whatever we have so far. Never throws.
 */

import type { CurrentFileEntry } from "@atlas/role-architect";

/** Files we always try to fetch. Order matters — these appear in this order
 *  in the architect's "## Current sandbox files" section, which puts the
 *  user-facing entry point (page.tsx) on top. */
const ANCHOR_FILES = [
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/app/globals.css"
] as const;

/** Per-file size cap (in chars/UTF-16 code units, matches String.length).
 *  Files smaller are inlined verbatim; larger ones are still emitted with
 *  their content so the architect can rely on the fact "this file exists"
 *  — the deep-plan renderer truncates head/tail to fit prompt budget. */
const PER_FILE_BYTE_BUDGET = 4 * 1024;

interface SandboxFilesAdapter {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/** Pure helper — given a sandbox files adapter, return the curated entries.
 *  Exists as a seam so unit tests can stub the adapter in-memory. */
export async function readCurrentFiles(fs: SandboxFilesAdapter): Promise<CurrentFileEntry[]> {
  const out: CurrentFileEntry[] = [];
  for (const path of ANCHOR_FILES) {
    try {
      const exists = await fs.exists(path);
      if (!exists) continue;
      const content = await fs.read(path);
      // We don't truncate here — the architect prompt assembler does the
      // head/tail elision so the budget stays in one place. We do skip the
      // entry entirely if read returned anything that isn't a string
      // (defensive — adapters in the wild have been observed to return
      // Buffer | undefined when the underlying call doesn't normalize).
      if (typeof content !== "string") continue;
      out.push({ path, content });
    } catch (err) {
      // Per-file failure (E2B "file not found" sometimes throws instead of
      // returning false to exists()). Don't fail the whole prompt — log and
      // skip this file. Architect just sees fewer anchor files.
      console.warn(
        `[atlas-web] readCurrentFiles: ${path} unavailable, skipping:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return out;
}

/** Apps-web wiring: connect to the project's live E2B sandbox via the existing
 *  factory + adapter, then call readCurrentFiles. Wraps the whole thing in a
 *  try/catch so a missing sandbox / E2B outage / spend-cap rejection just
 *  yields [] (architect runs with no anchor files — same as a fresh project). */
export async function readCurrentFilesForProject(projectId: string): Promise<CurrentFileEntry[]> {
  try {
    const { getSandboxFactory } = await import("./factory");
    const { Sandbox } = await import("@e2b/sdk");
    const session = await getSandboxFactory().getOrProvision(projectId);
    const sdk = await Sandbox.connect(session.record.sandboxId, {
      apiKey: process.env.E2B_API_KEY ?? ""
    });
    // E2B SDK exposes `readonly files: Filesystem`. Narrow to the two methods
    // we actually use; avoids importing the full Filesystem type just for a
    // type assertion.
    const files = (sdk as unknown as {
      files: { read: (p: string) => Promise<string>; exists: (p: string) => Promise<boolean> };
    }).files;
    return await readCurrentFiles(files);
  } catch (err) {
    console.warn(
      "[atlas-web] readCurrentFilesForProject: sandbox unavailable, architect will run without anchor files:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

export { PER_FILE_BYTE_BUDGET, ANCHOR_FILES };
