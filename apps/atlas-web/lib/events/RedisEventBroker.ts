import type { EventBroker, PublishInput, RitualEvent, SubscribeOptions } from "./EventBroker";

/**
 * RedisEventBroker — STUB used only to prove the EventBroker interface
 * holds against a streams-style storage model.
 *
 * NOT wired to any deployment surface in Plan E.0. Redis itself is not
 * a runtime dependency. The point of this file is the parameterized
 * conformance suite (broker-conformance.test.ts) — running every
 * contract test against both InMemory and Redis stubs proves the
 * interface boundary is real, not aspirational.
 *
 * When Atlas eventually moves to multi-instance deployment, the stub's
 * public class shape stays — only the FakeRedisStreams gets replaced
 * with a real ioredis client and XADD/XREAD calls.
 */

/** Minimal Redis-streams-shaped surface the stub depends on. The real
 *  Redis client (ioredis, node-redis) implements XADD/XRANGE/XREAD with
 *  the same conceptual semantics — read after a stream id, blocking
 *  until new entries arrive. We model only the slice we need. */
export interface RedisStreamsLike {
  xadd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  xrange(key: string, start: string, end: string): Promise<Array<[string, Record<string, string>]>>;
  /** Resolves with the next entry after `lastId`. Returns null if the
   *  signal aborts. Real Redis uses XREAD with BLOCK; the stub uses an
   *  internal Promise that publishers resolve on xadd. */
  xread(key: string, lastId: string, signal: AbortSignal): Promise<[string, Record<string, string>] | null>;
}

/** In-memory mock of the streams subset above. Used by tests; never
 *  shipped. The implementation is deliberately verbose so the test
 *  suite reads exactly like it would against a real Redis client. */
export class FakeRedisStreams implements RedisStreamsLike {
  private streams = new Map<string, Array<[string, Record<string, string>]>>();
  private waiters = new Map<string, Set<() => void>>();

  async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    const entries = this.streams.get(key) ?? [];
    entries.push([id, fields]);
    this.streams.set(key, entries);
    const waiters = this.waiters.get(key);
    if (waiters) for (const w of waiters) w();
    return id;
  }

  async xrange(
    key: string,
    start: string,
    end: string
  ): Promise<Array<[string, Record<string, string>]>> {
    const entries = this.streams.get(key) ?? [];
    return entries.filter(([id]) => (start === "-" || id >= start) && (end === "+" || id <= end));
  }

  async xread(
    key: string,
    lastId: string,
    signal: AbortSignal
  ): Promise<[string, Record<string, string>] | null> {
    while (!signal.aborted) {
      const entries = this.streams.get(key) ?? [];
      const next = entries.find(([id]) => id > lastId);
      if (next) return next;
      await new Promise<void>((resolve) => {
        const set = this.waiters.get(key) ?? new Set();
        set.add(resolve);
        this.waiters.set(key, set);
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    return null;
  }

  /** Test helper. */
  entries(key: string): Array<[string, Record<string, string>]> {
    return this.streams.get(key) ?? [];
  }
}

const KEY = (projectId: string) => `ritual-events:${projectId}`;

export class RedisEventBroker implements EventBroker {
  // Counters are per-instance (not module-scoped) to avoid cross-test
  // pollution and to mirror the per-broker isolation of InMemoryEventBroker.
  private readonly counters = new Map<string, bigint>();

  constructor(private readonly redis: RedisStreamsLike) {}

  private nextId(projectId: string): string {
    const c = (this.counters.get(projectId) ?? 0n) + 1n;
    this.counters.set(projectId, c);
    return `${projectId}:${c.toString()}`;
  }

  async publish(input: PublishInput): Promise<RitualEvent> {
    const id = this.nextId(input.projectId);
    const event: RitualEvent = { ...input, id };
    await this.redis.xadd(KEY(input.projectId), id, {
      ritualId: event.ritualId,
      type: event.type,
      payload: JSON.stringify(event.payload),
      ts: String(event.ts)
    });
    return event;
  }

  subscribe(projectId: string, opts: SubscribeOptions = {}): AsyncIterable<RitualEvent> {
    const key = KEY(projectId);
    const redis = this.redis;
    const cursor = opts.sinceEventId ?? "-";
    const signal = opts.signal ?? new AbortController().signal;

    return {
      async *[Symbol.asyncIterator]() {
        if (cursor !== "-") {
          const replay = await redis.xrange(key, cursor, "+");
          for (const [id, fields] of replay) {
            if (signal.aborted) return;
            if (id === cursor) continue;
            yield decode(projectId, id, fields);
          }
        }
        let lastId = cursor === "-" ? "0" : cursor;
        while (!signal.aborted) {
          const next = await redis.xread(key, lastId, signal);
          if (!next) return;
          const [id, fields] = next;
          lastId = id;
          yield decode(projectId, id, fields);
        }
      }
    };
  }
}

function decode(projectId: string, id: string, fields: Record<string, string>): RitualEvent {
  return {
    id,
    projectId,
    ritualId: fields.ritualId ?? "",
    type: fields.type as RitualEvent["type"],
    payload: JSON.parse(fields.payload ?? "{}"),
    ts: Number(fields.ts ?? "0")
  };
}
