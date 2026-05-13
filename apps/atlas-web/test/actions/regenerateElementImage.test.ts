import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/assets/image-cache", () => ({ cacheImage: async () => "/atlas-assets/abc.jpg" }));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
});

import { regenerateElementImage } from "@/lib/actions/regenerateElementImage";

describe("regenerateElementImage", () => {
  it("calls gpt-image-1 with the supplied instruction and returns the cached URL", async () => {
    const fakeBuf = Buffer.from("fake").toString("base64");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeBuf }] })
    }) as unknown as typeof fetch;

    const result = await regenerateElementImage({ instruction: "a sunset over the beach" });
    expect(result.ok).toBe(true);
    expect(result.url).toBe("/atlas-assets/abc.jpg");

    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    expect(calls[0]![0]).toBe("https://api.openai.com/v1/images/generations");
    const body = JSON.parse(calls[0]![1].body as string);
    expect(body.prompt).toContain("a sunset over the beach");
    expect(body.model).toBe("gpt-image-1");

    globalThis.fetch = originalFetch;
  });

  it("returns ok=false when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await regenerateElementImage({ instruction: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAI_API_KEY/);
  });
});
