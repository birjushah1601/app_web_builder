import { describe, it, expect } from "vitest";
import { cacheImage } from "@/lib/assets/image-cache";

describe("cacheImage", () => {
  it("writes a sha256-named jpg + returns a stable URL", async () => {
    const buf = Buffer.from(`fake-jpg-bytes-${Date.now()}-${Math.random()}`);
    const url1 = await cacheImage(buf);
    const url2 = await cacheImage(buf);
    expect(url1).toBe(url2);
    expect(url1).toMatch(/^\/atlas-assets\/[a-f0-9]{64}\.jpg$/);
  });

  it("creates the cache directory on first call (works when .next/cache/atlas-assets doesn't exist yet)", async () => {
    // Random buffer guarantees a fresh sha so we exercise mkdir + writeFile paths.
    const buf = Buffer.from(`first-call-${Math.random()}`);
    const url = await cacheImage(buf);
    expect(url).toMatch(/^\/atlas-assets\/[a-f0-9]{64}\.jpg$/);
  });

  it("produces different URLs for different bytes", async () => {
    const a = await cacheImage(Buffer.from("aaa"));
    const b = await cacheImage(Buffer.from("bbb"));
    expect(a).not.toBe(b);
  });
});
