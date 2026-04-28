import { describe, it, expect } from "vitest";
import { InMemoryEventBroker } from "@/lib/events/InMemoryEventBroker";
import type { PublishInput } from "@/lib/events/EventBroker";

const PROJECT_A = "proj-a";
const PROJECT_B = "proj-b";

function evt(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    projectId: PROJECT_A,
    ritualId: "r-1",
    type: "ritual.started",
    payload: {},
    ts: 1_700_000_000_000,
    ...overrides
  };
}

describe("InMemoryEventBroker — publish", () => {
  it("assigns a stable, monotonically increasing id per project", async () => {
    const b = new InMemoryEventBroker();
    const e1 = await b.publish(evt());
    const e2 = await b.publish(evt());
    expect(e1.id).not.toBe(e2.id);
    expect(e1.id < e2.id).toBe(true);
  });

  it("scopes id sequences per project (proj-a counter independent of proj-b)", async () => {
    const b = new InMemoryEventBroker();
    const a1 = await b.publish(evt({ projectId: PROJECT_A }));
    const b1 = await b.publish(evt({ projectId: PROJECT_B }));
    expect(a1.id.startsWith(`${PROJECT_A}:`)).toBe(true);
    expect(b1.id.startsWith(`${PROJECT_B}:`)).toBe(true);
  });

  it("preserves all fields the caller passed (id is added, nothing else mutated)", async () => {
    const b = new InMemoryEventBroker();
    const input = evt({ payload: { foo: "bar" }, ts: 12345 });
    const out = await b.publish(input);
    expect(out).toMatchObject({
      projectId: input.projectId,
      ritualId: input.ritualId,
      type: input.type,
      payload: { foo: "bar" },
      ts: 12345
    });
    expect(typeof out.id).toBe("string");
  });
});

describe("InMemoryEventBroker — ring buffer", () => {
  it("retains the most recent 200 events per project (drop-oldest on overflow)", async () => {
    const b = new InMemoryEventBroker();
    for (let i = 0; i < 250; i++) {
      await b.publish(evt({ payload: { i } }));
    }
    const collected = await collect(b.subscribe(PROJECT_A, { sinceEventId: `${PROJECT_A}:0` }), 201, 100);
    expect(collected[0]!.type).toBe("stream.gap" as never);
    expect(collected.slice(1).map((e) => (e.payload as { i: number }).i)).toEqual(
      Array.from({ length: 200 }, (_, k) => 50 + k)
    );
  });

  it("does NOT cross-contaminate buffers across projects", async () => {
    const b = new InMemoryEventBroker();
    await b.publish(evt({ projectId: PROJECT_A, payload: { who: "a" } }));
    await b.publish(evt({ projectId: PROJECT_B, payload: { who: "b" } }));
    const replayed = await collect(
      b.subscribe(PROJECT_A, { sinceEventId: `${PROJECT_A}:0` }),
      1,
      100
    );
    expect(replayed).toHaveLength(1);
    expect((replayed[0]!.payload as { who: string }).who).toBe("a");
  });
});

async function collect<T>(
  iter: AsyncIterable<T>,
  n: number,
  timeoutMs: number
): Promise<T[]> {
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
