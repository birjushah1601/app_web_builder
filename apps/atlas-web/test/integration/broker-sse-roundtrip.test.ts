/**
 * Broker → SSE round-trip integration test.
 *
 * Stack: real InMemoryEventBroker (process singleton) → real SSE route
 * handler (invoked in-process, no HTTP layer) → manual SSE frame parsing
 * (we cannot use the browser EventSource in node — vitest jsdom does not
 * implement streaming reads). This proves the end-to-end pipe holds; the
 * full Plan D-style E2E with a live HTTP server lives in Plan E's
 * playwright suite.
 *
 * NO MOCKS for broker / route / sink — only the auth shim is stubbed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: "test-user" }) }));

async function importBroker() {
  return await import("@/lib/events/broker-singleton");
}

async function readSseFrames(stream: ReadableStream<Uint8Array>, n: number, timeoutMs = 1000): Promise<{ id?: string; data?: string }[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const frames: { id?: string; data?: string }[] = [];
  const t = setTimeout(() => reader.cancel("test timeout"), timeoutMs);
  try {
    let buf = "";
    while (frames.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (block.startsWith(":")) continue;
        const f: { id?: string; data?: string } = {};
        for (const line of block.split("\n")) {
          if (line.startsWith("id: ")) f.id = line.slice(4);
          else if (line.startsWith("data: ")) f.data = line.slice(6);
        }
        frames.push(f);
        if (frames.length >= n) break;
      }
    }
  } finally {
    clearTimeout(t);
    await reader.cancel().catch(() => {});
  }
  return frames;
}

describe("broker → SSE round-trip (integration)", () => {
  beforeEach(async () => {
    const { __resetEventBrokerForTesting } = await importBroker();
    __resetEventBrokerForTesting();
  });

  it("a published event reaches the SSE response in real time", async () => {
    const { GET } = await import("@/app/api/projects/[projectId]/events/route");
    const res = await GET(
      new Request("http://localhost/api/projects/p-int/events"),
      { params: Promise.resolve({ projectId: "p-int" }) }
    );

    await new Promise((r) => setTimeout(r, 20));

    const { getEventBroker } = await importBroker();
    await getEventBroker().publish({
      projectId: "p-int",
      ritualId: "r-int",
      type: "role.completed",
      payload: { roleId: "architect", attempts: 1 },
      ts: Date.now()
    });

    const frames = await readSseFrames(res.body!, 1, 2000);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.id).toBe("p-int:1");
    const parsed = JSON.parse(frames[0]!.data!);
    expect(parsed.type).toBe("role.completed");
    expect(parsed.payload.roleId).toBe("architect");
  });

  it("disconnect-then-reconnect with Last-Event-ID resumes from cursor", async () => {
    const { GET } = await import("@/app/api/projects/[projectId]/events/route");
    const { getEventBroker } = await importBroker();

    await getEventBroker().publish({
      projectId: "p-int", ritualId: "r-int", type: "ritual.started",
      payload: { i: 1 }, ts: 1
    });
    await getEventBroker().publish({
      projectId: "p-int", ritualId: "r-int", type: "role.started",
      payload: { i: 2 }, ts: 2
    });
    await getEventBroker().publish({
      projectId: "p-int", ritualId: "r-int", type: "role.completed",
      payload: { i: 3 }, ts: 3
    });

    const res1 = await GET(
      new Request("http://localhost/api/projects/p-int/events"),
      { params: Promise.resolve({ projectId: "p-int" }) }
    );
    await new Promise((r) => setTimeout(r, 20));
    await getEventBroker().publish({
      projectId: "p-int", ritualId: "r-int", type: "role.completed",
      payload: { i: 4 }, ts: 4
    });
    const frames1 = await readSseFrames(res1.body!, 1, 1000);
    expect(frames1[0]!.id).toBe("p-int:4");
    // readSseFrames already cancels its reader; res1.body's lock prevents body.cancel().

    const res2 = await GET(
      new Request("http://localhost/api/projects/p-int/events", {
        headers: { "Last-Event-ID": "p-int:4" }
      }),
      { params: Promise.resolve({ projectId: "p-int" }) }
    );
    await new Promise((r) => setTimeout(r, 20));
    await getEventBroker().publish({
      projectId: "p-int", ritualId: "r-int", type: "ritual.completed",
      payload: { i: 5 }, ts: 5
    });
    const frames2 = await readSseFrames(res2.body!, 1, 1000);
    expect(frames2[0]!.id).toBe("p-int:5");
    const parsed2 = JSON.parse(frames2[0]!.data!);
    expect(parsed2.payload.i).toBe(5);
  });

  it("unauthorized request returns 401 — flag state irrelevant", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: null }) }));
    vi.resetModules();
    const { GET } = await import("@/app/api/projects/[projectId]/events/route");
    const res = await GET(
      new Request("http://localhost/api/projects/p-int/events"),
      { params: Promise.resolve({ projectId: "p-int" }) }
    );
    expect(res.status).toBe(401);
    vi.doUnmock("@/lib/auth/clerk-compat");
    vi.resetModules();
  });
});
