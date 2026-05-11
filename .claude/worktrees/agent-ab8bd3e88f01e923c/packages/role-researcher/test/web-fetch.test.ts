import { describe, it, expect, vi } from "vitest";
import { BraveSearchAdapter, type WebFetchAdapter, type WebHit } from "../src/web-fetch.js";
import { WebFetchError } from "../src/errors.js";

describe("BraveSearchAdapter", () => {
  it("issues GET to brave api with the right query", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            { title: "Linear", url: "https://linear.app", description: "Issue tracking", thumbnail: { src: "x.jpg" } }
          ]
        }
      })
    });
    const adapter = new BraveSearchAdapter({ apiKey: "test-key", fetchImpl: fetchSpy as unknown as typeof fetch });
    const hits = await adapter.search("best saas-marketing websites 2026");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("api.search.brave.com");
    expect(String(url)).toContain("q=best+saas-marketing+websites+2026");
    expect((opts as RequestInit).headers).toMatchObject({ "X-Subscription-Token": "test-key" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "Linear", url: "https://linear.app" });
  });

  it("returns up to maxResults results", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `R${i}`,
            url: `https://r${i}.com`,
            description: `d${i}`
          }))
        }
      })
    });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch, maxResults: 3 });
    const hits = await adapter.search("q");
    expect(hits).toHaveLength(3);
  });

  it("throws WebFetchError on non-2xx", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch });
    await expect(adapter.search("q")).rejects.toThrow(WebFetchError);
  });

  it("returns [] when results array is missing (graceful degrade)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ web: {} }) });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch });
    const hits = await adapter.search("q");
    expect(hits).toEqual([]);
  });

  it("times out via AbortController after timeoutMs", async () => {
    const fetchSpy = vi.fn().mockImplementation((_url, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = opts.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const adapter = new BraveSearchAdapter({ apiKey: "k", fetchImpl: fetchSpy as unknown as typeof fetch, timeoutMs: 50 });
    await expect(adapter.search("q")).rejects.toThrow(/aborted|timeout/i);
  });
});

describe("WebFetchAdapter contract", () => {
  it("can be implemented by a mock", async () => {
    const mock: WebFetchAdapter = {
      async search(_q: string): Promise<WebHit[]> {
        return [{ title: "X", url: "https://x", description: "y" }];
      }
    };
    const hits = await mock.search("anything");
    expect(hits[0].title).toBe("X");
  });
});
