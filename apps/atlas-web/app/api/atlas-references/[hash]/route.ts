/**
 * Plan UXO Task 6 — serve reference images cached by uploadReference().
 *
 * URL shape: /api/atlas-references/<sha256>.<ext>
 *
 * The dynamic segment captures the full `<sha256>.<ext>` filename as one
 * `hash` param; we split it ourselves to reject anything that isn't a
 * 64-char lowercase hex string + a known extension. That keeps the route
 * from being usable as a generic file-server / path-traversal vector.
 *
 * Today we accept png and jpg (uploadReference normalises the extension
 * to "png" only when the upload was image/png; everything else falls
 * through to "jpg"). The Content-Type header agrees with the extension.
 */

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export const dynamic = "force-dynamic";

const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-references");
const VALID_FILENAME = /^([0-9a-f]{64})\.(png|jpg)$/;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg"
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> }
): Promise<Response> {
  const { hash } = await params;
  const match = VALID_FILENAME.exec(hash);
  if (!match) return new Response("not found", { status: 404 });

  const ext = match[2] as keyof typeof CONTENT_TYPE_BY_EXT;
  const filePath = join(CACHE_DIR, hash);

  try {
    const buf = await fs.readFile(filePath);
    // Convert Node Buffer to a fresh ArrayBuffer slice so the Web Response
    // ctor's typed-array overload is unambiguous (Node's Buffer.buffer is
    // a shared SharedArrayBuffer-style pool; slicing produces a clean copy).
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return new Response(ab, {
      headers: {
        "Content-Type": CONTENT_TYPE_BY_EXT[ext],
        // Content-addressed = immutable. One year is the conventional max.
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
