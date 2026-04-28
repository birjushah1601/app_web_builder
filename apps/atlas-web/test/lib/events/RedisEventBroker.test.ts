import { describe, it, expect } from "vitest";
import { RedisEventBroker, FakeRedisStreams } from "@/lib/events/RedisEventBroker";

describe("RedisEventBroker (stub) — interface conformance", () => {
  it("publish assigns an id and stores it in the underlying streams client", async () => {
    const fake = new FakeRedisStreams();
    const b = new RedisEventBroker(fake);
    const out = await b.publish({
      projectId: "p-1",
      ritualId: "r-1",
      type: "ritual.started",
      payload: {},
      ts: 12345
    });
    expect(out.id).toMatch(/^p-1:/);
    expect(fake.entries("ritual-events:p-1")).toHaveLength(1);
  });

  it("subscribe yields each published event in order", async () => {
    const fake = new FakeRedisStreams();
    const b = new RedisEventBroker(fake);
    const ac = new AbortController();
    const sub = b.subscribe("p-1", { signal: ac.signal });
    const collector = (async () => {
      const out: unknown[] = [];
      for await (const e of sub) {
        out.push(e);
        if (out.length >= 2) break;
      }
      return out;
    })();

    await b.publish({ projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: { i: 1 }, ts: 1 });
    await b.publish({ projectId: "p-1", ritualId: "r-1", type: "role.started", payload: { i: 2 }, ts: 2 });

    const events = await collector;
    expect(events).toHaveLength(2);
    ac.abort();
  });

  it("aborting the signal stops the iterator", async () => {
    const fake = new FakeRedisStreams();
    const b = new RedisEventBroker(fake);
    const ac = new AbortController();
    const it = b.subscribe("p-1", { signal: ac.signal })[Symbol.asyncIterator]();
    ac.abort();
    const result = await it.next();
    expect(result.done).toBe(true);
  });
});
