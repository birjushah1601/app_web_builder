import { describe, it, expect, vi } from "vitest";
import { KlingClient } from "../src/client.js";
import { KlingApiError } from "../src/errors.js";

type Call = { url: string; init?: RequestInit };

function makeFetch(handler: (call: Call) => { ok: boolean; status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler({ url, init });
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const queuedBody = {
  id: "kjob_1",
  status: "queued",
  submitted_at: "2026-04-22T00:00:00.000Z",
  updated_at: "2026-04-22T00:00:00.000Z"
};

const succeededBody = {
  id: "kjob_1",
  status: "succeeded",
  video_url: "https://cdn.klingai.com/v/kjob_1.mp4",
  thumbnail_url: "https://cdn.klingai.com/t/kjob_1.jpg",
  duration: 5.2,
  usage_usd: 0.35,
  submitted_at: "2026-04-22T00:00:00.000Z",
  updated_at: "2026-04-22T00:01:30.000Z"
};

describe("KlingClient.submit", () => {
  it("POSTs to /videos/generations with bearer + JSON body", async () => {
    const { fn, calls } = makeFetch(() => ({ ok: true, body: queuedBody }));
    const c = new KlingClient({ apiKey: "sk_live_x", fetchFn: fn });
    const job = await c.submit({ prompt: "a sunrise" });
    expect(job.jobId).toBe("kjob_1");
    expect(job.status).toBe("queued");

    const call = calls[0]!;
    expect(call.url).toBe("https://api.klingai.com/v1/videos/generations");
    expect(call.init?.method).toBe("POST");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk_live_x");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(call.init!.body as string);
    expect(body.prompt).toBe("a sunrise");
    expect(body.model).toBe("kling-v1-5"); // default
    expect(body.duration).toBe(5); // default
  });

  it("sends idempotency-key header when provided", async () => {
    const { fn, calls } = makeFetch(() => ({ ok: true, body: queuedBody }));
    const c = new KlingClient({ apiKey: "k", fetchFn: fn });
    await c.submit({ prompt: "x", idempotencyKey: "ritual-42" });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("ritual-42");
  });

  it("throws KlingApiError on non-2xx", async () => {
    const { fn } = makeFetch(() => ({ ok: false, status: 502, body: {} }));
    const c = new KlingClient({ apiKey: "k", fetchFn: fn });
    await expect(c.submit({ prompt: "x" })).rejects.toThrow(KlingApiError);
  });

  it("throws KlingApiError on malformed response", async () => {
    const { fn } = makeFetch(() => ({ ok: true, body: { not_a_job: true } }));
    const c = new KlingClient({ apiKey: "k", fetchFn: fn });
    await expect(c.submit({ prompt: "x" })).rejects.toThrow(KlingApiError);
  });

  it("supports base-URL override for sovereign deployments", async () => {
    const { fn, calls } = makeFetch(() => ({ ok: true, body: queuedBody }));
    const c = new KlingClient({
      apiKey: "k",
      baseUrl: "https://kling.internal.atlas-sovereign.example/v1",
      fetchFn: fn
    });
    await c.submit({ prompt: "x" });
    expect(calls[0]!.url).toBe(
      "https://kling.internal.atlas-sovereign.example/v1/videos/generations"
    );
  });
});

describe("KlingClient.getJob", () => {
  it("GETs the job and normalizes the response to KlingJob shape", async () => {
    const { fn, calls } = makeFetch(() => ({ ok: true, body: succeededBody }));
    const c = new KlingClient({ apiKey: "k", fetchFn: fn });
    const job = await c.getJob("kjob_1");
    expect(job.status).toBe("succeeded");
    expect(job.videoUrl).toBe("https://cdn.klingai.com/v/kjob_1.mp4");
    expect(job.actualDurationSec).toBe(5.2);
    expect(job.usageUsd).toBe(0.35);
    expect(calls[0]!.url).toBe("https://api.klingai.com/v1/videos/generations/kjob_1");
  });

  it("url-encodes the job id", async () => {
    const { fn, calls } = makeFetch(() => ({ ok: true, body: queuedBody }));
    const c = new KlingClient({ apiKey: "k", fetchFn: fn });
    await c.getJob("kjob/slashy");
    expect(calls[0]!.url).toContain("kjob%2Fslashy");
  });

  it("throws KlingApiError on 404", async () => {
    const { fn } = makeFetch(() => ({ ok: false, status: 404, body: {} }));
    const c = new KlingClient({ apiKey: "k", fetchFn: fn });
    await expect(c.getJob("missing")).rejects.toThrow(KlingApiError);
  });
});
