import { describe, it, expect } from "vitest";
import type { EventBroker, PublishInput } from "@/lib/events/EventBroker";
import { InMemoryEventBroker } from "@/lib/events/InMemoryEventBroker";
import { RedisEventBroker, FakeRedisStreams } from "@/lib/events/RedisEventBroker";

const factories: Array<[string, () => EventBroker]> = [
  ["InMemoryEventBroker", () => new InMemoryEventBroker()],
  ["RedisEventBroker(FakeRedisStreams)", () => new RedisEventBroker(new FakeRedisStreams())]
];

function evt(projectId: string, payload: Record<string, unknown> = {}): PublishInput {
  return { projectId, ritualId: "r-1", type: "ritual.started", payload, ts: 1 };
}

async function collect<T>(iter: AsyncIterable<T>, n: number, timeoutMs = 200): Promise<T[]> {
  const out: T[] = [];
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for await (const x of iter) {
      out.push(x);
      if (out.length >= n) break;
      if (ac.signal.aborted) break;
    }
  } finally {
    clearTimeout(t);
  }
  return out;
}

for (const [name, make] of factories) {
  describe(`Broker conformance — ${name}`, () => {
    it("publish returns an event with a non-empty id", async () => {
      const b = make();
      const out = await b.publish(evt("p-1"));
      expect(out.id).toBeTruthy();
      expect(out.projectId).toBe("p-1");
    });

    it("subscribe receives events published after subscribe was called", async () => {
      const b = make();
      const ac = new AbortController();
      const sub = b.subscribe("p-1", { signal: ac.signal });
      const collector = collect(sub, 1, 300);
      await new Promise((r) => setTimeout(r, 10));
      await b.publish(evt("p-1", { i: 1 }));
      const result = await collector;
      expect(result).toHaveLength(1);
      ac.abort();
    });

    it("subscribe respects projectId scoping (no cross-project leak)", async () => {
      const b = make();
      const ac = new AbortController();
      const sub = b.subscribe("p-1", { signal: ac.signal });
      const collector = collect(sub, 1, 200);
      await new Promise((r) => setTimeout(r, 10));
      await b.publish(evt("p-2", { wrong: true }));
      await b.publish(evt("p-1", { right: true }));
      const result = await collector;
      expect(result).toHaveLength(1);
      expect((result[0]!.payload as { right: boolean }).right).toBe(true);
      ac.abort();
    });

    it("aborting signal cleanly ends the iterator", async () => {
      const b = make();
      const ac = new AbortController();
      const it = b.subscribe("p-1", { signal: ac.signal })[Symbol.asyncIterator]();
      ac.abort();
      const result = await it.next();
      expect(result.done).toBe(true);
    });
  });
}
