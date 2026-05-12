"use server";

/**
 * Plan UXO Task 6 — uploadReference Server Action.
 *
 * Stores a user-dropped reference image in a sha256-keyed file cache under
 * `.next/cache/atlas-references/` and returns the URL the browser can use
 * to fetch it back via `/api/atlas-references/<hash>.<ext>`.
 *
 * Why the .next/cache directory: it survives between requests, is gitignored
 * by default, and is the conventional Next.js per-deployment scratch area.
 * Files are content-addressed (sha256 of the byte stream) so re-uploading
 * the same screenshot is idempotent and the architect's `referenceImages`
 * array remains stable across re-submits of the same prompt.
 *
 * The 5MB cap is intentionally low — Atlas's downstream prompts inline the
 * URL but the architect role does not (yet) fetch the bytes; a generous
 * cap would invite abuse without functional benefit. Bump per spec change.
 */

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-references");
const MAX_BYTES = 5 * 1024 * 1024;

export interface UploadReferenceResult {
  url: string;
}

export async function uploadReference(formData: FormData): Promise<UploadReferenceResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("file required");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error("file too large (>5MB)");
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  // Best-effort extension detection. The serving route mirrors this
  // mapping so the Content-Type header agrees with what the browser sees.
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = join(CACHE_DIR, `${sha}.${ext}`);
  try {
    await fs.access(path);
  } catch {
    await fs.writeFile(path, buf);
  }
  return { url: `/api/atlas-references/${sha}.${ext}` };
}
