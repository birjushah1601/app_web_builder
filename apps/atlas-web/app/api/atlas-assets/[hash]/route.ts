import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Plan SPU — serves cached AI-hero images written by cacheImage().
 * The Next rewrite in next.config.ts maps `/atlas-assets/<hash>.jpg`
 * to this route. Hash is validated as 64 hex chars to prevent path
 * traversal; non-matching paths return 400. Missing files return 404
 * (cache may have been purged after a `.next` clean).
 */
const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-assets");

export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  const { hash } = await params;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return new Response("invalid hash", { status: 400 });
  }
  try {
    const buf = await fs.readFile(join(CACHE_DIR, `${hash}.jpg`));
    return new Response(buf as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
