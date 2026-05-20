import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Plan SPU — sha256-keyed local cache for AI-generated hero images.
 * Writes jpgs to `.next/cache/atlas-assets/<sha>.jpg` and returns the
 * stable public URL. A Next rewrite + API route serves the cached file
 * back via `/atlas-assets/<sha>.jpg`.
 *
 * The cache dir is created lazily (it doesn't exist on first run). Two
 * calls with the same bytes return the same URL — gpt-image-1 is
 * expensive, so de-duping by content hash is the easy win.
 */
const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-assets");

export async function cacheImage(buf: Buffer): Promise<string> {
  const sha = createHash("sha256").update(buf).digest("hex");
  const filePath = join(CACHE_DIR, `${sha}.jpg`);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, buf);
  }
  return `/atlas-assets/${sha}.jpg`;
}
