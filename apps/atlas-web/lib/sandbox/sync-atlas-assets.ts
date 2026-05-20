import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Plan SPU follow-up — copy AI-generated hero images from atlas-web's
 * `.next/cache/atlas-assets/` into the sandbox's `/code/public/atlas-assets/`
 * folder so the developer's `<img src="/atlas-assets/<sha>.jpg" />` references
 * resolve INSIDE the sandbox rather than 404ing against the sandbox's origin.
 *
 * Without this, the developer prompt's verbatim URL only works on atlas-web
 * (which serves `/atlas-assets/<sha>.jpg` via a Next rewrite to the
 * `/api/atlas-assets/[hash]` route). The iframe loading the sandbox's
 * page.tsx is a different origin, so the relative path resolves to the
 * sandbox — where nothing exists at that path.
 *
 * Sync strategy: copy every jpg/png in the local cache directory each time.
 * The cache is small (1-2 images per ritual) and the cost of a few stray
 * copies is negligible compared to the per-image gpt-image-1 generation cost.
 *
 * Failure-safe: missing cache directory → no-op (returns copied: 0). Per-file
 * failures are warned but do not interrupt the batch — the developer's code
 * still works, the user just sees a broken image which is visibly diagnosable.
 */

interface SandboxFilesAPI {
  write: (path: string, content: Buffer | Uint8Array | string) => Promise<unknown>;
}

const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-assets");
const SANDBOX_PUBLIC_DIR = "/code/public/atlas-assets";

export interface SyncAtlasAssetsResult {
  copied: number;
  failed: number;
  /** Files we tried (or successfully sent). */
  files: ReadonlyArray<{ name: string; bytes: number; ok: boolean; error?: string }>;
}

export async function syncAtlasAssetsToSandbox(
  sdk: { files: SandboxFilesAPI }
): Promise<SyncAtlasAssetsResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(CACHE_DIR);
  } catch {
    return { copied: 0, failed: 0, files: [] };
  }

  const files: SyncAtlasAssetsResult["files"][number][] = [];
  let copied = 0;
  let failed = 0;

  for (const name of entries) {
    if (!name.endsWith(".jpg") && !name.endsWith(".png")) continue;
    try {
      const buf = await fs.readFile(join(CACHE_DIR, name));
      await sdk.files.write(`${SANDBOX_PUBLIC_DIR}/${name}`, buf);
      copied += 1;
      files.push({ name, bytes: buf.length, ok: true });
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[atlas-assets-sync] failed to copy ${name}:`, msg);
      files.push({ name, bytes: 0, ok: false, error: msg });
    }
  }

  return { copied, failed, files };
}
