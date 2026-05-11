import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: () => ({ userId: "test-user" })
}));

async function importRoute() {
  return await import("@/app/api/projects/[projectId]/events/route");
}

/** Re-import broker-singleton AFTER route import so both share the same
 *  module instance (vi.resetModules across tests would otherwise split them). */
async function importBroker() {
  return await import("@/lib/events/broker-singleton");
}

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/projects/p-1/events", { headers });
}

async function readSseFrames(stream: ReadableStream<Uint8Array>, n: number, timeoutMs = 500): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  const timer = setTimeout(() => reader.cancel("test timeout"), timeoutMs);
  try {
    let buf = "";
    while (frames.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        frames.push(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (frames.length >= n) break;
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
  return frames;
}

describe("/api/projects/[projectId]/events SSE route (plan E.0)", () => {
  beforeEach(async () => {
    const { __resetEventBrokerForTesting } = await importBroker();
    __resetEventBrokerForTesting();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: null }) }));
    vi.resetModules();
    const { GET } = await importRoute();
    const res = await GET(buildRequest(), { params: Promise.resolve({ projectId: "p-1" }) });
    expect(res.status).toBe(401);
    vi.doUnmock("@/lib/auth/clerk-compat");
    vi.resetModules();
  });

  it("returns text/event-stream content type with no-cache", async () => {
    const { GET } = await importRoute();
    const res = await GET(buildRequest(), { params: Promise.resolve({ projectId: "p-1" }) });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    await res.body!.cancel();
  });

  it("publishes from the broker reach the SSE response as id+data frames", async () => {
    const { GET } = await importRoute();
    const res = await GET(buildRequest(), { params: Promise.resolve({ projectId: "p-1" }) });

    await new Promise((r) => setTimeout(r, 20));
    await (await importBroker()).getEventBroker().publish({
      projectId: "p-1",
      ritualId: "r-1",
      type: "ritual.started",
      payload: { intent: "hello" },
      ts: Date.now()
    });

    // Read frames; the first frame is the ":connected" comment, the second the event.
    const frames = await readSseFrames(res.body!, 2, 1000);
    const eventFrame = frames.find((f) => f.startsWith("id: "));
    expect(eventFrame).toBeDefined();
    expect(eventFrame!).toMatch(/^id: p-1:1\ndata: \{/);
    const dataLine = eventFrame!.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.type).toBe("ritual.started");
    expect(parsed.payload.intent).toBe("hello");
  });

  it("honours Last-Event-ID by replaying from cursor", async () => {
    const { GET } = await importRoute();
    await (await importBroker()).getEventBroker().publish({
      projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: { i: 1 }, ts: 1
    });
    await (await importBroker()).getEventBroker().publish({
      projectId: "p-1", ritualId: "r-1", type: "role.started", payload: { i: 2 }, ts: 2
    });
    const res = await GET(buildRequest({ "Last-Event-ID": "p-1:1" }), {
      params: Promise.resolve({ projectId: "p-1" })
    });
    const frames = await readSseFrames(res.body!, 2, 500);
    const eventFrame = frames.find((f) => f.startsWith("id: "));
    expect(eventFrame).toMatch(/^id: p-1:2\n/);
  });

  it("emits a `: keepalive` comment within ~15s of inactivity", async () => {
    vi.useFakeTimers();
    const { GET } = await importRoute();
    const res = await GET(buildRequest(), { params: Promise.resolve({ projectId: "p-1" }) });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First chunk is the ":connected" comment — drain it.
    await reader.read();

    // Advance fake time by 15 seconds — the keepalive interval should fire.
    await vi.advanceTimersByTimeAsync(15_000);
    const { value } = await reader.read();
    expect(decoder.decode(value!)).toContain(": keepalive");
    await reader.cancel();
    vi.useRealTimers();
  });
});
