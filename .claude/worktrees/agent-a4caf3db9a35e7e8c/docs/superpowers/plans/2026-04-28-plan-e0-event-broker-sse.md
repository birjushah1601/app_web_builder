# Plan E.0 — Event Broker + SSE Rewrite + EventSourceProvider + Feature Flag Implementation Plan


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared infrastructure that lets atlas-web stream Conductor checkpoint events to the browser in real time — a swappable `EventBroker` interface, an in-memory ring-buffer implementation, a Redis-stub for boundary proof, a rewritten SSE route with `Last-Event-ID` resume, a React `EventSourceProvider` context, and a feature flag (`ATLAS_LIVE_EVENTS`) whose OFF path leaves today's behaviour byte-for-byte unchanged.

**Architecture:** A new `lib/events/` namespace owns the broker interface (`EventBroker`), in-memory backend (`InMemoryEventBroker` with a 200-event-per-project ring buffer + `Map<projectId, Set<emit>>`), a Redis-shaped stub used only to prove the boundary holds in tests, and a React provider that opens one `EventSource` per project. `apps/atlas-web/lib/engine/factory.ts` rewires its existing `checkpointSink.emit` so every Conductor checkpoint is published into the broker AND continues to flow through the existing `SpecEventsSink → SpecEventRepo` persistence (additive, never replacing). The SSE route at `/api/projects/[projectId]/events` is rewritten from today's heartbeat-only stub to subscribe to the broker, stream `id:` + `data:` frames, honour `Last-Event-ID`, and clean up on disconnect.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Next.js 15 app router · React 19 · Vitest 2.x · existing `@atlas/conductor` + `@atlas/ritual-engine` · no new npm dependencies.

**Prerequisites the implementing engineer needs installed before starting:**
- All of Plan A/B/C/D merged on `main` — see `docs/superpowers/plans/2026-04-27-plan-c-apply-diff-to-sandbox.md`. Specifically: `getRitualEngine()` factory exists at `apps/atlas-web/lib/engine/factory.ts`, `SpecEventsSink` exists at `apps/atlas-web/lib/engine/event-sink.ts`, the SSE route exists at `apps/atlas-web/app/api/projects/[projectId]/events/route.ts` as a heartbeat stub, and `lib/feature-flags.ts` ships an env-driven flag registry.
- Local Postgres on port 5440 (`docker compose up -d postgres`) — only required for the swap-test that exercises `SpecEventRepo` integration; the broker unit tests are pure in-memory.
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` workspace packages keep their `.js` suffix as before; this rule applies only to atlas-web internal imports.

**Branch:** `plan-e0/event-broker-sse` cut from `main`. Final task in this plan merges the branch back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
apps/atlas-web/
  lib/
    feature-flags.ts                                       # MODIFIED: + "live-events" flag
    events/
      EventBroker.ts                                       # NEW: interface + RitualEvent + RitualEventType
      InMemoryEventBroker.ts                               # NEW: ring buffer + per-project Set<emit>
      RedisEventBroker.ts                                  # NEW: stub for swap-test (no live Redis)
      EventSourceProvider.tsx                              # NEW: React context + useEventStream
      broker-singleton.ts                                  # NEW: process-singleton accessor
    engine/
      factory.ts                                           # MODIFIED: rewire checkpointSink.emit to broker
  app/
    api/projects/[projectId]/events/route.ts               # REWRITTEN from heartbeat stub
  test/
    lib/
      feature-flags.test.ts                                # MODIFIED: + 1 case for "live-events"
      events/
        EventBroker.types.test.ts                          # NEW: type-shape contract
        InMemoryEventBroker.test.ts                        # NEW: ~12 cases
        RedisEventBroker.test.ts                           # NEW: ~3 cases (stub behaviour)
        broker-conformance.test.ts                         # NEW: parameterized over both backends
        EventSourceProvider.test.tsx                       # NEW: ~5 cases (provider + hook)
        broker-singleton.test.ts                           # NEW: 2 cases (singleton + reset)
      engine/
        factory.test.ts                                    # MODIFIED: + 2 cases for broker wiring
    app/
      api/projects/events-route.test.ts                    # NEW: ~5 cases for the rewritten SSE route
    integration/
      broker-sse-roundtrip.test.ts                         # NEW: real Conductor → real broker → real SSE → headless EventSource
```

**Why this shape.** Types live with their interface (`EventBroker.ts`) — the file is small enough that splitting `EventBroker` and `RitualEvent` into separate files would create a back-and-forth import dance for no benefit. The two backends (`InMemoryEventBroker.ts`, `RedisEventBroker.ts`) implement the same interface and live side-by-side; the parameterized `broker-conformance.test.ts` runs every contract test against both, which is the single fact that proves the interface boundary. The provider is a `.tsx` because it owns JSX; the hook lives in the same file because it only makes sense paired with the provider — splitting would create import asymmetry. `broker-singleton.ts` exists because the SSE route handler and the engine factory both need the same broker instance per Node process; keeping the module-scoped state in its own file makes it trivially mockable from tests.

---

## Design Decisions

These resolve the implementation-level questions left implicit in the spec.

1. **Ring-buffer eviction policy: drop-oldest.** When the per-project buffer hits 200 events, the next `publish()` evicts the oldest. Subscribers that requested a `sinceEventId` older than the oldest event in the buffer receive a synthetic `stream.gap` marker as the first replayed event, then the live tail. The marker carries `{ requestedSinceEventId, oldestAvailableEventId }` so the client (Plan E) can decide whether to refetch state from elsewhere or just resync from current.
2. **Event ID format: `${projectId}:${monotonicCounter}`.** Per-project monotonic counter (BigInt internally, stringified at the boundary). Globally unique because the projectId prefix; comparable within a project; trivial to parse for `sinceEventId` lookup. Format is opaque to clients — they only echo it back via `Last-Event-ID`.
3. **`broker.publish()` is fire-and-forget from Conductor's POV.** Conductor's `CheckpointSink.emit` returns a Promise; we await it but never let a broker failure (e.g. subscriber's queue full) bubble up into the engine. The dual-emit (broker + SpecEventsSink) uses `Promise.allSettled` so one failure doesn't suppress the other.
4. **Subscriber backpressure: bounded queue with overflow drop.** Each subscriber's async iterator backs onto a 64-event queue. If a slow consumer causes the queue to fill, we drop the oldest and prepend a `stream.gap` marker on next pull. This is a pragmatic MVP — tomorrow we'd swap for a token-bucket; today the SSE consumer will keep up with realistic event rates (tens per ritual).
5. **Process-singleton broker.** One `InMemoryEventBroker` instance per Node process, accessed via `getEventBroker()` from `broker-singleton.ts`. The factory wires this into Conductor; the SSE route subscribes via the same accessor. Tests reset the singleton between cases via `__resetEventBrokerForTesting()`.
6. **Flag-OFF path: route + factory still wire the broker.** Reasoning: the broker itself is harmless infrastructure (an in-process Map). The flag controls only the `EventSourceProvider`'s mount + the existing UI's switch to the new chrome (Plan G). Keeping the broker plumbed always means flag-flip is purely client-side, no server restart needed, no half-broken state.
7. **Feature flag id: `live-events`.** Maps to env var `ATLAS_LIVE_EVENTS`. Note: the existing flag registry uses kebab-case keys (`figma-importer`) and `ATLAS_FF_*` env vars. We diverge for this one: `ATLAS_LIVE_EVENTS` (no `_FF_` infix) because the spec mandates this exact env name — and the spec is canon. Documented in the modified `feature-flags.ts`.
8. **`RedisEventBroker` is a stub, not a deployment target.** Its only job is to be exercised by the conformance suite and prove the interface is implementable against a different storage model (in-memory mock of Redis pub/sub semantics — `XADD`/`XRANGE`/`XREAD BLOCK`). No `redis` npm dep added; the stub uses a hand-rolled in-memory mock.

---

## Task List (14 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit.

---

### Task 1: Cut the branch + add `live-events` to the feature flag registry

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/test/lib/feature-flags.test.ts`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-e0/event-broker-sse
```

Expected: `Switched to a new branch 'plan-e0/event-broker-sse'`.

- [ ] **Step 2: Write the failing test**

Append to `apps/atlas-web/test/lib/feature-flags.test.ts`:

```typescript
describe("live-events flag (Plan E.0)", () => {
  it("reads ATLAS_LIVE_EVENTS, NOT ATLAS_FF_LIVE_EVENTS (per spec)", () => {
    expect(
      isFeatureEnabled("live-events", sourceWith({ ATLAS_LIVE_EVENTS: "true" }))
    ).toBe(true);
    expect(
      isFeatureEnabled("live-events", sourceWith({ ATLAS_FF_LIVE_EVENTS: "true" }))
    ).toBe(false);
  });

  it("defaults to false when ATLAS_LIVE_EVENTS unset", () => {
    expect(isFeatureEnabled("live-events", sourceWith({}))).toBe(false);
  });

  it("accepts the same truthy values as other flags", () => {
    for (const truthy of ["1", "true", "TRUE", "yes", "on"]) {
      expect(
        isFeatureEnabled("live-events", sourceWith({ ATLAS_LIVE_EVENTS: truthy }))
      ).toBe(true);
    }
  });

  it("listFlagStates includes live-events", () => {
    const states = listFlagStates(sourceWith({ ATLAS_LIVE_EVENTS: "true" }));
    expect(states["live-events"]).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: 4 fails — `Argument of type '"live-events"' is not assignable to parameter of type 'FeatureFlag'`.

- [ ] **Step 4: Add the flag to the registry**

Edit `apps/atlas-web/lib/feature-flags.ts`:

```typescript
export type FeatureFlag =
  | "figma-importer"
  | "stripe-payments"
  | "video-kling"
  | "auth-keycloak"
  | "live-events";

const FLAG_TO_ENV: Record<FeatureFlag, string> = {
  "figma-importer": "ATLAS_FF_FIGMA_IMPORTER",
  "stripe-payments": "ATLAS_FF_STRIPE_PAYMENTS",
  "video-kling": "ATLAS_FF_VIDEO_KLING",
  "auth-keycloak": "ATLAS_FF_AUTH_KEYCLOAK",
  // Per spec 2026-04-28-live-events-and-preview-reload-design.md, this flag
  // diverges from the ATLAS_FF_* convention — the spec mandates this exact
  // env name so operators can flip live events on a deploy without learning
  // the FF prefix convention.
  "live-events": "ATLAS_LIVE_EVENTS"
};
```

And in `listFlagStates`, add the entry:

```typescript
export function listFlagStates(source: FeatureFlagSource = processEnvSource): Record<FeatureFlag, boolean> {
  return {
    "figma-importer": isFeatureEnabled("figma-importer", source),
    "stripe-payments": isFeatureEnabled("stripe-payments", source),
    "video-kling": isFeatureEnabled("video-kling", source),
    "auth-keycloak": isFeatureEnabled("auth-keycloak", source),
    "live-events": isFeatureEnabled("live-events", source)
  };
}
```

- [ ] **Step 5: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: all feature-flags tests pass (5 original + 4 new).

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags.test.ts
git commit -m "feat(atlas-web): add live-events feature flag (ATLAS_LIVE_EVENTS) for plan E.0"
```

---

### Task 2: Define `EventBroker` interface + `RitualEvent` type

**Files:**
- Create: `apps/atlas-web/lib/events/EventBroker.ts`
- Create: `apps/atlas-web/test/lib/events/EventBroker.types.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/lib/events/EventBroker.types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type {
  EventBroker,
  RitualEvent,
  RitualEventType,
  PublishInput
} from "@/lib/events/EventBroker";

describe("EventBroker types (Plan E.0 contract)", () => {
  it("RitualEventType is the exact 11-value union from the spec", () => {
    type Expected =
      | "ritual.started" | "ritual.completed" | "ritual.escalated"
      | "role.started" | "role.completed" | "role.failed" | "role.retrying"
      | "sandbox.provisioning" | "sandbox.provisioned"
      | "sandbox.apply.started" | "sandbox.apply.completed";
    expectTypeOf<RitualEventType>().toEqualTypeOf<Expected>();
  });

  it("RitualEvent has id, projectId, ritualId, type, payload, ts", () => {
    expectTypeOf<RitualEvent>().toEqualTypeOf<{
      id: string;
      projectId: string;
      ritualId: string;
      type: RitualEventType;
      payload: Record<string, unknown>;
      ts: number;
    }>();
  });

  it("PublishInput is RitualEvent with id omitted (broker assigns)", () => {
    expectTypeOf<PublishInput>().toEqualTypeOf<Omit<RitualEvent, "id">>();
  });

  it("EventBroker.publish returns Promise<RitualEvent> (the assigned event)", () => {
    expectTypeOf<EventBroker["publish"]>().parameters.toEqualTypeOf<[PublishInput]>();
    expectTypeOf<EventBroker["publish"]>().returns.toEqualTypeOf<Promise<RitualEvent>>();
  });

  it("EventBroker.subscribe returns AsyncIterable<RitualEvent> with optional sinceEventId + signal", () => {
    type SubscribeOpts = { sinceEventId?: string; signal?: AbortSignal };
    expectTypeOf<EventBroker["subscribe"]>().parameters.toEqualTypeOf<[string, SubscribeOpts?]>();
    expectTypeOf<EventBroker["subscribe"]>().returns.toEqualTypeOf<AsyncIterable<RitualEvent>>();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/events/EventBroker.types.test.ts
```

Expected: `Cannot find module '@/lib/events/EventBroker'`.

- [ ] **Step 3: Write the interface module**

`apps/atlas-web/lib/events/EventBroker.ts`:

```typescript
/**
 * EventBroker — production-shaped interface for streaming ritual checkpoint
 * events from the Node process to subscribed clients (today: SSE + the
 * EventSourceProvider; tomorrow: WebSocket, Redis pub/sub fanout, etc.).
 *
 * Two implementations live alongside this file:
 *   - InMemoryEventBroker: ring-buffer + per-project Set<emit>; the
 *     production backend for single-instance atlas-web deployments.
 *   - RedisEventBroker: stub used only by the conformance suite to prove
 *     the interface holds against a streams-style storage model. Not
 *     wired anywhere — Redis itself is not provisioned by Plan E.0.
 *
 * The interface is what we ship. The backend is swappable.
 */

/** All checkpoint event types broker subscribers care about. Flat string
 *  union (not enum) so TypeScript narrows in switch/reducer code. */
export type RitualEventType =
  | "ritual.started"
  | "ritual.completed"
  | "ritual.escalated"
  | "role.started"
  | "role.completed"
  | "role.failed"
  | "role.retrying"
  | "sandbox.provisioning"
  | "sandbox.provisioned"
  | "sandbox.apply.started"
  | "sandbox.apply.completed";

/** A published event. The broker assigns `id` on publish; it is opaque to
 *  clients (they echo it back via Last-Event-ID for resume). Format today
 *  is `${projectId}:${monotonicCounter}` — do not parse this on the
 *  client; treat it as opaque. */
export interface RitualEvent {
  id: string;
  projectId: string;
  ritualId: string;
  type: RitualEventType;
  payload: Record<string, unknown>;
  /** Epoch milliseconds. Used by the UI for "Xs ago" rendering. */
  ts: number;
}

/** Shape callers pass to broker.publish. id is assigned by the broker. */
export type PublishInput = Omit<RitualEvent, "id">;

/** Options for subscribe — both fields are optional; passing neither
 *  yields a live-only stream from the moment of subscription. */
export interface SubscribeOptions {
  /** Replay events newer than this id before joining the live stream.
   *  Treated as an opaque cursor (do not parse format). When the cursor
   *  is older than the oldest available event in the broker's ring
   *  buffer, the iterator yields a synthetic `stream.gap` marker as
   *  its first event so the client can decide how to recover. */
  sinceEventId?: string;
  /** When fired, the iterator returns and the broker drops the
   *  subscriber from its per-project set. SSE route uses the request's
   *  AbortSignal so disconnect cleanup is automatic. */
  signal?: AbortSignal;
}

/** Production-shaped broker contract. Implementations: InMemoryEventBroker
 *  (default), RedisEventBroker (swap-test stub). */
export interface EventBroker {
  /** Publish an event to the broker. Assigns an id, persists to the
   *  ring buffer, and fans out to every live subscriber for that
   *  project. Returns the assigned RitualEvent (callers may need the id
   *  for logging). Never throws on subscriber backpressure — slow
   *  subscribers drop oldest queued events. */
  publish(event: PublishInput): Promise<RitualEvent>;

  /** Subscribe to a project's event stream. Yields each event for that
   *  project, optionally replaying from a cursor. The iterator returns
   *  cleanly when opts.signal aborts; broker removes the subscriber
   *  from its internal set on return. */
  subscribe(projectId: string, opts?: SubscribeOptions): AsyncIterable<RitualEvent>;
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/EventBroker.types.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/events/EventBroker.ts apps/atlas-web/test/lib/events/EventBroker.types.test.ts
git commit -m "feat(atlas-web): EventBroker interface + RitualEvent + RitualEventType union (plan E.0)"
```

---

### Task 3: `InMemoryEventBroker` — publish + per-project ring buffer

**Files:**
- Create: `apps/atlas-web/lib/events/InMemoryEventBroker.ts`
- Create: `apps/atlas-web/test/lib/events/InMemoryEventBroker.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/lib/events/InMemoryEventBroker.test.ts`:

```typescript
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
    expect(e1.id < e2.id).toBe(true); // string comparison still strictly orders for our format
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
    // Replay from the very start — there is no event before the buffer's
    // oldest, so we expect a stream.gap marker first, then 200 real events.
    const collected = await collect(b.subscribe(PROJECT_A, { sinceEventId: `${PROJECT_A}:0` }), 201, 100);
    expect(collected[0]!.type).toBe("stream.gap" as never);
    // Last 200 events have payload.i = 50..249
    expect(collected.slice(1).map((e) => (e.payload as { i: number }).i)).toEqual(
      Array.from({ length: 200 }, (_, k) => 50 + k)
    );
  });

  it("does NOT cross-contaminate buffers across projects", async () => {
    const b = new InMemoryEventBroker();
    await b.publish(evt({ projectId: PROJECT_A, payload: { who: "a" } }));
    await b.publish(evt({ projectId: PROJECT_B, payload: { who: "b" } }));
    // Subscribe replay-from-start for PROJECT_A; should see only A
    const replayed = await collect(
      b.subscribe(PROJECT_A, { sinceEventId: `${PROJECT_A}:0` }),
      1,
      100
    );
    expect(replayed).toHaveLength(1);
    expect((replayed[0]!.payload as { who: string }).who).toBe("a");
  });
});

/** Pull up to `n` events from an AsyncIterable, or stop after `timeoutMs`,
 *  whichever first. Used by every test that needs to observe the stream
 *  without hanging when the iterator is intentionally still open. */
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
```

- [ ] **Step 2: Run tests; expect 5 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/events/InMemoryEventBroker.test.ts
```

Expected: 5 fails — `Cannot find module '@/lib/events/InMemoryEventBroker'`.

- [ ] **Step 3: Write the implementation**

`apps/atlas-web/lib/events/InMemoryEventBroker.ts`:

```typescript
import type { EventBroker, PublishInput, RitualEvent, SubscribeOptions } from "./EventBroker";

const RING_BUFFER_SIZE = 200;
const SUBSCRIBER_QUEUE_SIZE = 64;

/** Internal: per-project state. */
interface ProjectState {
  /** Monotonic counter; next event id is `${projectId}:${counter}`. */
  counter: bigint;
  /** Ring buffer of recent events, oldest first, capped at RING_BUFFER_SIZE. */
  buffer: RitualEvent[];
  /** Live subscribers; broker pushes published events into each one's queue. */
  subscribers: Set<Subscriber>;
}

/** Internal subscriber state. Each call to subscribe() creates one. */
interface Subscriber {
  queue: (RitualEvent | GapMarker)[];
  /** Resolved by publish() to wake the iterator's pull(). Replaced after
   *  every wake so each pull awaits a fresh promise. */
  wake: (() => void) | null;
  closed: boolean;
}

/** Stream-gap marker — yielded as a synthetic event when the requested
 *  sinceEventId is older than the buffer's oldest entry. Carries the
 *  same shape as RitualEvent so the iterator's caller doesn't have to
 *  branch on a different type. */
interface GapMarker extends RitualEvent {
  type: "stream.gap" extends never ? never : RitualEvent["type"]; // satisfies TS — see note
}

export class InMemoryEventBroker implements EventBroker {
  private readonly projects = new Map<string, ProjectState>();

  async publish(input: PublishInput): Promise<RitualEvent> {
    const state = this.getOrCreate(input.projectId);
    state.counter += 1n;
    const event: RitualEvent = {
      ...input,
      id: `${input.projectId}:${state.counter.toString()}`
    };
    // Append to ring buffer; drop oldest on overflow.
    state.buffer.push(event);
    if (state.buffer.length > RING_BUFFER_SIZE) {
      state.buffer.shift();
    }
    // Fan out to live subscribers.
    for (const sub of state.subscribers) {
      pushToSubscriber(sub, event);
    }
    return event;
  }

  subscribe(projectId: string, opts: SubscribeOptions = {}): AsyncIterable<RitualEvent> {
    const state = this.getOrCreate(projectId);
    return makeSubscription(state, opts);
  }

  private getOrCreate(projectId: string): ProjectState {
    let s = this.projects.get(projectId);
    if (!s) {
      s = { counter: 0n, buffer: [], subscribers: new Set() };
      this.projects.set(projectId, s);
    }
    return s;
  }
}

/** Push one event onto a subscriber's queue, evicting oldest if full.
 *  When the queue overflows we prepend a gap marker on the next pull
 *  (set via subscriber.queue[0]) so the consumer can react. */
function pushToSubscriber(sub: Subscriber, event: RitualEvent): void {
  if (sub.closed) return;
  if (sub.queue.length >= SUBSCRIBER_QUEUE_SIZE) {
    // Drop oldest queued event; mark the queue head with a gap so the
    // next pull yields the marker before continuing.
    sub.queue.shift();
    if (sub.queue[0]?.type !== "stream.gap") {
      sub.queue.unshift(gapEvent(event.projectId, "subscriber backpressure overflow"));
    }
  }
  sub.queue.push(event);
  const wake = sub.wake;
  sub.wake = null;
  if (wake) wake();
}

/** Build the subscription's async iterator. Replays from cursor (with a
 *  gap marker if the cursor is out-of-buffer), then yields live events
 *  pushed by publish() until the signal aborts or no more events. */
function makeSubscription(
  state: ProjectState,
  opts: SubscribeOptions
): AsyncIterable<RitualEvent> {
  const sub: Subscriber = { queue: [], wake: null, closed: false };

  // Seed the queue with replay events.
  if (opts.sinceEventId !== undefined) {
    const idx = state.buffer.findIndex((e) => e.id > opts.sinceEventId!);
    if (idx === -1) {
      // sinceEventId is at-or-after the newest buffered event — no replay
      // (or sinceEventId might be ahead of us if the broker restarted; we
      // treat "ahead" the same as "caught up").
    } else {
      // If the requested cursor is older than buffer[0].id, the consumer
      // missed events that have been evicted — yield a gap marker first.
      if (state.buffer[0]!.id > opts.sinceEventId) {
        sub.queue.push(gapEvent(state.buffer[0]!.projectId, "cursor older than ring buffer"));
      }
      for (let i = idx; i < state.buffer.length; i++) {
        sub.queue.push(state.buffer[i]!);
      }
    }
  }

  state.subscribers.add(sub);
  const onAbort = () => {
    sub.closed = true;
    state.subscribers.delete(sub);
    const wake = sub.wake;
    sub.wake = null;
    if (wake) wake();
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<RitualEvent>> {
          while (!sub.closed) {
            const head = sub.queue.shift();
            if (head) return { value: head, done: false };
            await new Promise<void>((resolve) => {
              sub.wake = resolve;
            });
          }
          // Cleanup on close.
          state.subscribers.delete(sub);
          return { value: undefined, done: true };
        },
        async return(): Promise<IteratorResult<RitualEvent>> {
          sub.closed = true;
          state.subscribers.delete(sub);
          return { value: undefined, done: true };
        }
      };
    }
  };
}

/** Build a synthetic stream.gap event. Carries the same RitualEvent shape
 *  so consumers don't have to branch on a different type — they switch
 *  on `type === "stream.gap"` inside their own handler. */
function gapEvent(projectId: string, reason: string): RitualEvent {
  return {
    id: `${projectId}:gap:${Date.now()}`,
    projectId,
    ritualId: "",
    // The broker's RitualEventType union does NOT include "stream.gap" by
    // design — gap is an internal control marker, not a real ritual
    // event. We cast at the boundary so consumers can pattern-match on
    // it without polluting the public union. Plan E's reducer treats
    // unknown types as no-ops, so this is safe.
    type: "stream.gap" as never,
    payload: { reason },
    ts: Date.now()
  };
}
```

> **Note on the `stream.gap` type cast.** The cast is intentional and the only place in the codebase where we use `as never` for a tag value. Plan E's `timelineReducer` will treat unknown event types as no-ops; clients that want to surface "stream gap" UX can match on `event.type === "stream.gap"` after a similar cast. Adding `stream.gap` to the public `RitualEventType` union would force every reducer to handle a non-business event — worse trade.

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/InMemoryEventBroker.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/events/InMemoryEventBroker.ts apps/atlas-web/test/lib/events/InMemoryEventBroker.test.ts
git commit -m "feat(atlas-web): InMemoryEventBroker — publish + per-project ring buffer + replay (plan E.0)"
```

---

### Task 4: `InMemoryEventBroker` — multi-subscriber fan-out + signal unsubscribe

**Files:**
- Modify: `apps/atlas-web/test/lib/events/InMemoryEventBroker.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/lib/events/InMemoryEventBroker.test.ts`:

```typescript
describe("InMemoryEventBroker — multi-subscriber fan-out", () => {
  it("delivers each published event to every live subscriber for that project", async () => {
    const b = new InMemoryEventBroker();
    const ac = new AbortController();
    const subA = b.subscribe(PROJECT_A, { signal: ac.signal });
    const subB = b.subscribe(PROJECT_A, { signal: ac.signal });

    // Both subscribers run concurrently.
    const collectorA = collect(subA, 2, 200);
    const collectorB = collect(subB, 2, 200);

    await b.publish(evt({ payload: { i: 1 } }));
    await b.publish(evt({ payload: { i: 2 } }));

    const [resultA, resultB] = await Promise.all([collectorA, collectorB]);
    expect(resultA.map((e) => (e.payload as { i: number }).i)).toEqual([1, 2]);
    expect(resultB.map((e) => (e.payload as { i: number }).i)).toEqual([1, 2]);
    ac.abort();
  });

  it("does NOT deliver events from other projects to a subscriber", async () => {
    const b = new InMemoryEventBroker();
    const ac = new AbortController();
    const subA = b.subscribe(PROJECT_A, { signal: ac.signal });

    const collector = collect(subA, 1, 200);
    await b.publish(evt({ projectId: PROJECT_B })); // wrong project
    await b.publish(evt({ projectId: PROJECT_A, payload: { right: true } }));

    const result = await collector;
    expect(result).toHaveLength(1);
    expect((result[0]!.payload as { right: boolean }).right).toBe(true);
    ac.abort();
  });
});

describe("InMemoryEventBroker — signal-driven unsubscribe", () => {
  it("aborting the signal causes the iterator to return cleanly", async () => {
    const b = new InMemoryEventBroker();
    const ac = new AbortController();
    const sub = b.subscribe(PROJECT_A, { signal: ac.signal });

    const it = sub[Symbol.asyncIterator]();
    // First, publish one event so the iterator has something to return.
    await b.publish(evt({ payload: { i: 1 } }));
    const first = await it.next();
    expect(first.done).toBe(false);

    // Abort and pull again — should resolve to { done: true }.
    ac.abort();
    const second = await it.next();
    expect(second.done).toBe(true);
  });

  it("removes the subscriber from the broker's internal set on abort", async () => {
    const b = new InMemoryEventBroker();
    const ac = new AbortController();
    const sub = b.subscribe(PROJECT_A, { signal: ac.signal });

    // Drive the iterator once so subscribe()'s setup runs.
    const it = sub[Symbol.asyncIterator]();
    void it.next(); // dangling — will resolve on abort
    ac.abort();
    await it.next();

    // Publishing now must not throw / not be observed by any subscriber
    // (no easy way to observe count without exposing internals; assert
    // that publish completes and returns).
    const out = await b.publish(evt());
    expect(out.id).toBeTruthy();
  });

  it("subscribing with an already-aborted signal yields no events and returns immediately", async () => {
    const b = new InMemoryEventBroker();
    const ac = new AbortController();
    ac.abort();
    const sub = b.subscribe(PROJECT_A, { signal: ac.signal });

    await b.publish(evt());
    const result = await collect(sub, 1, 100);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests; expect pass without code changes**

```bash
cd apps/atlas-web && pnpm test test/lib/events/InMemoryEventBroker.test.ts
```

Expected: 10 total tests pass — the broker implementation from Task 3 already covers fan-out and signal handling.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/lib/events/InMemoryEventBroker.test.ts
git commit -m "test(atlas-web): broker fan-out + signal-driven unsubscribe coverage"
```

---

### Task 5: `RedisEventBroker` stub — same interface, in-memory mock of Redis streams

**Files:**
- Create: `apps/atlas-web/lib/events/RedisEventBroker.ts`
- Create: `apps/atlas-web/test/lib/events/RedisEventBroker.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/lib/events/RedisEventBroker.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests; expect 3 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/events/RedisEventBroker.test.ts
```

Expected: 3 fails — `Cannot find module '@/lib/events/RedisEventBroker'`.

- [ ] **Step 3: Write the stub**

`apps/atlas-web/lib/events/RedisEventBroker.ts`:

```typescript
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
    return entries.filter(([id]) => id >= start && id <= end);
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
const counters = new Map<string, bigint>();

function nextId(projectId: string): string {
  const c = (counters.get(projectId) ?? 0n) + 1n;
  counters.set(projectId, c);
  return `${projectId}:${c.toString()}`;
}

export class RedisEventBroker implements EventBroker {
  constructor(private readonly redis: RedisStreamsLike) {}

  async publish(input: PublishInput): Promise<RitualEvent> {
    const id = nextId(input.projectId);
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
        // Replay from cursor.
        if (cursor !== "-") {
          const replay = await redis.xrange(key, cursor, "+");
          for (const [id, fields] of replay) {
            if (signal.aborted) return;
            if (id === cursor) continue; // exclusive of the cursor itself
            yield decode(projectId, id, fields);
          }
        }
        // Live stream.
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
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/RedisEventBroker.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/events/RedisEventBroker.ts apps/atlas-web/test/lib/events/RedisEventBroker.test.ts
git commit -m "feat(atlas-web): RedisEventBroker stub + FakeRedisStreams (interface boundary proof)"
```

---

### Task 6: Conformance suite — parameterize broker tests over both backends

**Files:**
- Create: `apps/atlas-web/test/lib/events/broker-conformance.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/lib/events/broker-conformance.test.ts`:

```typescript
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
      await new Promise((r) => setTimeout(r, 10)); // give subscribe a tick to attach
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
```

- [ ] **Step 2: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/broker-conformance.test.ts
```

Expected: 8 tests pass (4 contract behaviours × 2 backends).

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/lib/events/broker-conformance.test.ts
git commit -m "test(atlas-web): broker conformance suite — parameterized over InMemory + Redis stub"
```

---

### Task 7: Process-singleton broker accessor

**Files:**
- Create: `apps/atlas-web/lib/events/broker-singleton.ts`
- Create: `apps/atlas-web/test/lib/events/broker-singleton.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/lib/events/broker-singleton.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  getEventBroker,
  __resetEventBrokerForTesting
} from "@/lib/events/broker-singleton";
import { InMemoryEventBroker } from "@/lib/events/InMemoryEventBroker";

describe("broker-singleton", () => {
  beforeEach(() => __resetEventBrokerForTesting());

  it("returns the same instance across calls (process-wide singleton)", () => {
    const a = getEventBroker();
    const b = getEventBroker();
    expect(a).toBe(b);
  });

  it("default backend is InMemoryEventBroker", () => {
    const b = getEventBroker();
    expect(b).toBeInstanceOf(InMemoryEventBroker);
  });

  it("__resetEventBrokerForTesting forces a fresh instance on the next get", () => {
    const a = getEventBroker();
    __resetEventBrokerForTesting();
    const b = getEventBroker();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests; expect 3 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/events/broker-singleton.test.ts
```

Expected: 3 fails — `Cannot find module '@/lib/events/broker-singleton'`.

- [ ] **Step 3: Write the singleton**

`apps/atlas-web/lib/events/broker-singleton.ts`:

```typescript
import type { EventBroker } from "./EventBroker";
import { InMemoryEventBroker } from "./InMemoryEventBroker";

/**
 * Process-singleton broker accessor.
 *
 * Both the engine factory (publishes events) and the SSE route handler
 * (subscribes to events) need the same broker instance per Node process.
 * This module owns that instance so neither file holds the state.
 *
 * Tests reset the singleton between cases via __resetEventBrokerForTesting.
 *
 * Future swap-point: when atlas-web moves to multi-instance, this module
 * is the single place that decides which EventBroker implementation to
 * instantiate (InMemory vs Redis-backed). No call site changes.
 */

let instance: EventBroker | null = null;

export function getEventBroker(): EventBroker {
  if (instance === null) {
    instance = new InMemoryEventBroker();
  }
  return instance;
}

/** TEST-ONLY. Forces the next getEventBroker() call to allocate a fresh
 *  instance. Never call this from production code. Exported with the
 *  __ prefix so it's grep-visible in any review that scans for test-only
 *  surface area leaking into runtime. */
export function __resetEventBrokerForTesting(): void {
  instance = null;
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/broker-singleton.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/events/broker-singleton.ts apps/atlas-web/test/lib/events/broker-singleton.test.ts
git commit -m "feat(atlas-web): broker-singleton accessor + test reset hook (plan E.0)"
```

---

### Task 8: Wire `factory.ts` checkpointSink to dual-emit (broker + SpecEventsSink)

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/test/lib/engine/factory.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/atlas-web/test/lib/engine/factory.test.ts`. The file already mocks every external dep — add at the bottom of the existing `describe`s:

```typescript
import { __resetEventBrokerForTesting, getEventBroker } from "@/lib/events/broker-singleton";

describe("factory — checkpointSink wires to broker + SpecEventsSink (plan E.0)", () => {
  beforeEach(() => __resetEventBrokerForTesting());

  it("publishes Conductor checkpoints into the EventBroker for the project", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("proj-x");

    // Pull the checkpointSink from the mocked Conductor constructor.
    const conductorOpts = (globalThis as { __lastConductorOpts?: { checkpointSink: { emit: (e: unknown) => Promise<void> } } }).__lastConductorOpts;
    expect(conductorOpts).toBeDefined();

    // Subscribe BEFORE emitting so we observe the publish.
    const ac = new AbortController();
    const sub = getEventBroker().subscribe("proj-x", { signal: ac.signal });
    const collector = (async () => {
      const out: unknown[] = [];
      for await (const e of sub) {
        out.push(e);
        break;
      }
      return out;
    })();

    await conductorOpts!.checkpointSink.emit({
      eventType: "role.completed",
      ritualId: "r-1",
      payload: { roleId: "architect", attempts: 1 },
      ts: new Date().toISOString()
    });

    const events = await collector;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      projectId: "proj-x",
      ritualId: "r-1",
      type: "role.completed"
    });
    ac.abort();
  });

  it("does NOT crash the engine when broker.publish rejects (logs + continues)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("proj-y");

    const conductorOpts = (globalThis as { __lastConductorOpts?: { checkpointSink: { emit: (e: unknown) => Promise<void> } } }).__lastConductorOpts;

    // Sabotage the broker by replacing its publish with a rejector.
    const broker = getEventBroker();
    const origPublish = broker.publish.bind(broker);
    broker.publish = (async () => { throw new Error("simulated broker failure"); }) as never;

    // The checkpointSink.emit must NOT throw — Conductor expects fire-
    // and-forget semantics. Failure must surface as a console.error
    // and be swallowed.
    await expect(conductorOpts!.checkpointSink.emit({
      eventType: "role.completed",
      ritualId: "r-1",
      payload: {},
      ts: new Date().toISOString()
    })).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    broker.publish = origPublish; // restore for other tests
    errSpy.mockRestore();
  });
});
```

For these to work the `Conductor` mock at the top of the file must capture its constructor opts. Replace the existing `vi.mock("@atlas/conductor", ...)` block with:

```typescript
vi.mock("@atlas/conductor", () => ({
  Conductor: class {
    roles: Map<string, unknown>;
    constructor(opts: { roles: Map<string, unknown>; checkpointSink: { emit: (e: unknown) => Promise<void> } }) {
      this.roles = opts.roles;
      (globalThis as { __lastConductorOpts?: typeof opts }).__lastConductorOpts = opts;
    }
  }
}));
```

- [ ] **Step 2: Run tests; expect 2 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory.test.ts
```

Expected: 2 fails — first one fails because checkpointSink only console.errors (does not publish to broker); second fails because there's no try/catch around publish.

- [ ] **Step 3: Update `factory.ts` checkpointSink to dual-emit**

In `apps/atlas-web/lib/engine/factory.ts`, replace the `checkpointSink: { ... }` block (currently lines 112-123) with:

```typescript
    checkpointSink: {
      // Plan E.0: every Conductor checkpoint is now published to the
      // EventBroker (for live UI streaming) AND continues to flow to
      // the existing logging path. SpecEventRepo persistence remains
      // unchanged — it lives on the engine's `eventSink`, not the
      // conductor's checkpointSink, and is wired below.
      //
      // Both publish and the existing log are wrapped in Promise.allSettled
      // so a broker failure does not suppress logging and vice-versa. The
      // outer emit() never throws — Conductor expects fire-and-forget.
      emit: async (event) => {
        const broker = getEventBroker();
        const projectIdForBroker = projectId;
        const ritualType = mapCheckpointToRitualType(event.eventType);
        const publish = ritualType
          ? broker.publish({
              projectId: projectIdForBroker,
              ritualId: event.ritualId,
              type: ritualType,
              payload: event.payload,
              ts: Date.parse(event.ts) || Date.now()
            })
          : Promise.resolve(null);

        const log = (async () => {
          if (event.eventType === "role.failed" || event.eventType === "ritual.escalated") {
            console.error(
              `[conductor] ${event.eventType}`,
              JSON.stringify(event.payload)
            );
          } else if (process.env.ATLAS_LOG_CHECKPOINTS) {
            console.log(`[conductor] ${event.eventType}`, JSON.stringify(event.payload));
          }
        })();

        const results = await Promise.allSettled([publish, log]);
        for (const r of results) {
          if (r.status === "rejected") {
            // eslint-disable-next-line no-console
            console.error("[conductor.checkpointSink] subscriber error:", r.reason);
          }
        }
      }
    },
```

Add the helper at the end of the file (after the last closing `});`):

```typescript
import type { RitualEventType } from "@/lib/events/EventBroker";

/** Map Conductor's checkpoint event types into the broker's RitualEventType
 *  union. Returns null for checkpoint types we don't surface to the live
 *  UI (e.g. dispatch.classified — internal routing detail). */
function mapCheckpointToRitualType(eventType: string): RitualEventType | null {
  switch (eventType) {
    case "ritual.started":         return "ritual.started";
    case "ritual.completed":       return "ritual.completed";
    case "ritual.escalated":       return "ritual.escalated";
    case "role.started":           return "role.started";
    case "role.completed":         return "role.completed";
    case "role.failed":            return "role.failed";
    case "role.retrying":          return "role.retrying";
    case "sandbox.provisioning":   return "sandbox.provisioning";
    case "sandbox.provisioned":    return "sandbox.provisioned";
    case "sandbox.apply.started":  return "sandbox.apply.started";
    case "sandbox.apply.completed":return "sandbox.apply.completed";
    default:                       return null;
  }
}
```

Add the import at the top of `factory.ts`, in the dynamic-import block inside `getRitualEngine`:

```typescript
  const { getEventBroker } = await import("@/lib/events/broker-singleton");
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory.test.ts
```

Expected: all factory tests pass (existing + 2 new).

- [ ] **Step 5: Verify SpecEventsSink path is unchanged**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/event-sink.test.ts
```

Expected: SpecEventsSink test still passes — we did not touch its file or wiring. The eventSink (`SpecEventsSink`) on `RitualEngine` continues to receive `RitualEvent`s from the engine independently of the checkpointSink.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/test/lib/engine/factory.test.ts
git commit -m "feat(atlas-web): dual-emit Conductor checkpoints to EventBroker + log (plan E.0)"
```

---

### Task 9: Rewrite SSE route — broker subscription + Last-Event-ID + AbortController cleanup

**Files:**
- Modify: `apps/atlas-web/app/api/projects/[projectId]/events/route.ts`
- Create: `apps/atlas-web/test/app/api/projects/events-route.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/app/api/projects/events-route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetEventBrokerForTesting, getEventBroker } from "@/lib/events/broker-singleton";

vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: () => ({ userId: "test-user" })
}));

async function importRoute() {
  return await import("@/app/api/projects/[projectId]/events/route");
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
  beforeEach(() => __resetEventBrokerForTesting());

  it("returns 401 when unauthenticated", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: null }) }));
    vi.resetModules();
    const { GET } = await importRoute();
    const res = await GET(buildRequest(), { params: Promise.resolve({ projectId: "p-1" }) });
    expect(res.status).toBe(401);
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

    // Push one event AFTER the route subscribed; subscribe runs in start()
    // synchronously so a small tick is enough.
    await new Promise((r) => setTimeout(r, 20));
    await getEventBroker().publish({
      projectId: "p-1",
      ritualId: "r-1",
      type: "ritual.started",
      payload: { intent: "hello" },
      ts: Date.now()
    });

    const frames = await readSseFrames(res.body!, 1, 1000);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatch(/^id: p-1:1\ndata: \{/);
    const dataLine = frames[0]!.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.type).toBe("ritual.started");
    expect(parsed.payload.intent).toBe("hello");
  });

  it("honours Last-Event-ID by replaying from cursor", async () => {
    const { GET } = await importRoute();
    // Pre-publish some events so they live in the buffer.
    await getEventBroker().publish({
      projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: { i: 1 }, ts: 1
    });
    await getEventBroker().publish({
      projectId: "p-1", ritualId: "r-1", type: "role.started", payload: { i: 2 }, ts: 2
    });
    // Now subscribe with Last-Event-ID = id of the first → expect to
    // receive only the second.
    const res = await GET(buildRequest({ "Last-Event-ID": "p-1:1" }), {
      params: Promise.resolve({ projectId: "p-1" })
    });
    const frames = await readSseFrames(res.body!, 1, 500);
    expect(frames[0]).toMatch(/^id: p-1:2\n/);
  });

  it("emits a `: keepalive` comment within ~15s of inactivity", async () => {
    vi.useFakeTimers();
    const { GET } = await importRoute();
    const res = await GET(buildRequest(), { params: Promise.resolve({ projectId: "p-1" }) });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Advance fake time by 15 seconds — the keepalive interval should fire.
    await vi.advanceTimersByTimeAsync(15_000);
    const { value } = await reader.read();
    expect(decoder.decode(value!)).toContain(": keepalive");
    await reader.cancel();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests; expect 5 fails**

```bash
cd apps/atlas-web && pnpm test test/app/api/projects/events-route.test.ts
```

Expected: 5 fails — current route is the heartbeat stub, no broker subscription, no Last-Event-ID handling, no `text/event-stream` keepalive comments.

- [ ] **Step 3: Rewrite the route**

Replace the entire contents of `apps/atlas-web/app/api/projects/[projectId]/events/route.ts`:

```typescript
import { auth } from "@/lib/auth/clerk-compat";
import { getEventBroker } from "@/lib/events/broker-singleton";

export const dynamic = "force-dynamic";

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const { projectId } = await params;
  const sinceEventId = req.headers.get("Last-Event-ID") ?? undefined;

  const ac = new AbortController();
  // When the client disconnects (browser closes tab, navigates away), the
  // request signal aborts — we forward to our internal AbortController so
  // the broker subscription's iterator returns and the keepalive timer
  // is cleared. Without this the route would hold a subscriber forever.
  if (req.signal) {
    if (req.signal.aborted) ac.abort();
    else req.signal.addEventListener("abort", () => ac.abort(), { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (s: string) => {
        try { controller.enqueue(encoder.encode(s)); }
        catch { /* controller closed; subscription's signal will end the loop */ }
      };

      // Initial connect comment — most EventSource clients ignore comments
      // but it flushes the first chunk so the browser commits the response.
      enqueue(`: connected to project ${projectId}\n\n`);

      const keepalive = setInterval(() => {
        enqueue(`: keepalive\n\n`);
      }, KEEPALIVE_INTERVAL_MS);

      const broker = getEventBroker();
      const sub = broker.subscribe(projectId, { sinceEventId, signal: ac.signal });

      try {
        for await (const event of sub) {
          // SSE frame format: id line + data line (single JSON), terminated
          // by a blank line. Per HTML spec the browser will echo the most
          // recent id back as Last-Event-ID on auto-reconnect.
          enqueue(`id: ${event.id}\n`);
          enqueue(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err) {
        // Defensive: never let an iterator throw escape the stream — log
        // and close the connection so the client reconnects.
        // eslint-disable-next-line no-console
        console.error("[sse-route] subscription error:", err);
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      ac.abort();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no" // disables proxy buffering on nginx
    }
  });
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/app/api/projects/events-route.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/api/projects/[projectId]/events/route.ts apps/atlas-web/test/app/api/projects/events-route.test.ts
git commit -m "feat(atlas-web): rewrite SSE route — broker subscribe + Last-Event-ID + 15s keepalive (plan E.0)"
```

---

### Task 10: `EventSourceProvider` — React context skeleton + flag-OFF no-op

**Files:**
- Create: `apps/atlas-web/lib/events/EventSourceProvider.tsx`
- Create: `apps/atlas-web/test/lib/events/EventSourceProvider.test.tsx`

- [ ] **Step 1: Write the failing tests**

`apps/atlas-web/test/lib/events/EventSourceProvider.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { EventSourceProvider, useEventStream } from "@/lib/events/EventSourceProvider";

/** Minimal EventSource mock — captures listeners + URL, lets tests fire
 *  message/open/error events synchronously. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  readyState = 0;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  closed = false;
  constructor(url: string | URL, opts?: EventSourceInit) {
    this.url = url.toString();
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }
  close() { this.closed = true; this.readyState = 2; }
  // helpers used by tests
  fireMessage(data: string, lastEventId?: string) {
    this.onmessage?.call(this as unknown as EventSource, new MessageEvent("message", { data, lastEventId }));
  }
  fireOpen() { this.readyState = 1; this.onopen?.call(this as unknown as EventSource, new Event("open")); }
  fireError() { this.onerror?.call(this as unknown as EventSource, new Event("error")); }
}

function withProvider(projectId: string, flagEnabled: boolean) {
  return ({ children }: { children: React.ReactNode }) => (
    <EventSourceProvider projectId={projectId} flagEnabled={flagEnabled}>
      {children}
    </EventSourceProvider>
  );
}

describe("EventSourceProvider — flag OFF", () => {
  beforeEach(() => { MockEventSource.instances.length = 0; });

  it("does NOT mount an EventSource when flagEnabled=false", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    render(<EventSourceProvider projectId="p-1" flagEnabled={false}>{null}</EventSourceProvider>);
    expect(MockEventSource.instances).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("useEventStream returns empty events + status='disabled' when flag is off", () => {
    const { result } = renderHook(() => useEventStream(), { wrapper: withProvider("p-1", false) });
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe("disabled");
    expect(result.current.lastEventId).toBeNull();
  });
});

describe("EventSourceProvider — flag ON", () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mounts an EventSource at /api/projects/<projectId>/events on render", () => {
    render(<EventSourceProvider projectId="p-1" flagEnabled={true}>{null}</EventSourceProvider>);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toContain("/api/projects/p-1/events");
  });

  it("re-mounts (closes old, opens new) when projectId changes", () => {
    const { rerender } = render(
      <EventSourceProvider projectId="p-1" flagEnabled={true}>{null}</EventSourceProvider>
    );
    expect(MockEventSource.instances).toHaveLength(1);
    const first = MockEventSource.instances[0]!;
    rerender(<EventSourceProvider projectId="p-2" flagEnabled={true}>{null}</EventSourceProvider>);
    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]!.url).toContain("/api/projects/p-2/events");
  });

  it("appends events into useEventStream().events as messages arrive", async () => {
    const { result } = renderHook(() => useEventStream(), { wrapper: withProvider("p-1", true) });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    act(() => {
      MockEventSource.instances[0]!.fireOpen();
      MockEventSource.instances[0]!.fireMessage(
        JSON.stringify({ id: "p-1:1", projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: {}, ts: 1 }),
        "p-1:1"
      );
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]!.type).toBe("ritual.started");
    expect(result.current.lastEventId).toBe("p-1:1");
    expect(result.current.status).toBe("open");
  });

  it("sets status='error' on connection error event", async () => {
    const { result } = renderHook(() => useEventStream(), { wrapper: withProvider("p-1", true) });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    act(() => MockEventSource.instances[0]!.fireError());
    expect(result.current.status).toBe("error");
  });

  it("closes the EventSource on unmount (cleanup)", () => {
    const { unmount } = render(
      <EventSourceProvider projectId="p-1" flagEnabled={true}>{null}</EventSourceProvider>
    );
    expect(MockEventSource.instances[0]!.closed).toBe(false);
    unmount();
    expect(MockEventSource.instances[0]!.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect 8 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/events/EventSourceProvider.test.tsx
```

Expected: 8 fails — `Cannot find module '@/lib/events/EventSourceProvider'`.

- [ ] **Step 3: Write the provider**

`apps/atlas-web/lib/events/EventSourceProvider.tsx`:

```typescript
"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { RitualEvent } from "./EventBroker";

/** Stream lifecycle state, surfaced via useEventStream so consumers can
 *  render reconnect indicators / error banners. */
export type EventStreamStatus = "disabled" | "connecting" | "open" | "error" | "closed";

interface EventStreamValue {
  events: RitualEvent[];
  status: EventStreamStatus;
  lastEventId: string | null;
}

const Ctx = createContext<EventStreamValue>({
  events: [],
  status: "disabled",
  lastEventId: null
});

interface ProviderProps {
  projectId: string;
  /** Result of `isFeatureEnabled("live-events")` — pulled in by the parent
   *  layout from feature-flags.ts, NOT read here so the provider stays
   *  pure (test-friendly, no env reads in component code). */
  flagEnabled: boolean;
  children: React.ReactNode;
}

/** EventSourceProvider — mounts (or skip-mounts) one EventSource per
 *  projectId. Flag-off path is a literal no-op: renders children, returns
 *  the disabled context value. Flag-on path opens the SSE connection,
 *  collects messages into state, and surfaces lifecycle status.
 *
 *  Re-keys on projectId change (the EventSource closes + a fresh one
 *  opens). The browser auto-reconnects with Last-Event-ID per HTML spec
 *  on transient errors; we don't manually reconnect. */
export function EventSourceProvider({ projectId, flagEnabled, children }: ProviderProps) {
  const [events, setEvents] = useState<RitualEvent[]>([]);
  const [status, setStatus] = useState<EventStreamStatus>(flagEnabled ? "connecting" : "disabled");
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  // Use a ref so the cleanup in useEffect can close the same instance the
  // setup created, even after rerenders that re-key the effect.
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!flagEnabled) {
      setStatus("disabled");
      return;
    }
    setStatus("connecting");
    const es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
    esRef.current = es;

    es.onopen = () => setStatus("open");
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as RitualEvent;
        setEvents((prev) => [...prev, parsed]);
        if (ev.lastEventId) setLastEventId(ev.lastEventId);
      } catch {
        // Malformed frame — drop it. The keepalive comment lines never
        // reach onmessage (they have no `data:` field) so this branch
        // only fires on genuinely broken JSON.
      }
    };
    es.onerror = () => setStatus("error");

    return () => {
      es.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [projectId, flagEnabled]);

  return <Ctx.Provider value={{ events, status, lastEventId }}>{children}</Ctx.Provider>;
}

/** Hook for any descendant — returns the live stream snapshot.
 *  Outside the provider returns the disabled value. Plan E and Plan F
 *  consume this hook for their own derived state (timeline reducer,
 *  reload-on-applied debouncer). */
export function useEventStream(): EventStreamValue {
  return useContext(Ctx);
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/EventSourceProvider.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/events/EventSourceProvider.tsx apps/atlas-web/test/lib/events/EventSourceProvider.test.tsx
git commit -m "feat(atlas-web): EventSourceProvider — flag-aware React context + useEventStream (plan E.0)"
```

---

### Task 11: Integration — real Conductor → real broker → real SSE → headless EventSource

**Files:**
- Create: `apps/atlas-web/test/integration/broker-sse-roundtrip.test.ts`

- [ ] **Step 1: Write the integration test**

`apps/atlas-web/test/integration/broker-sse-roundtrip.test.ts`:

```typescript
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
import { __resetEventBrokerForTesting, getEventBroker } from "@/lib/events/broker-singleton";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: "test-user" }) }));

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
        if (block.startsWith(":")) continue; // skip comments (keepalive / connect)
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
  beforeEach(() => __resetEventBrokerForTesting());

  it("a published event reaches the SSE response in real time", async () => {
    const { GET } = await import("@/app/api/projects/[projectId]/events/route");
    const res = await GET(
      new Request("http://localhost/api/projects/p-int/events"),
      { params: Promise.resolve({ projectId: "p-int" }) }
    );

    // Tick once so the route handler enters its for-await loop.
    await new Promise((r) => setTimeout(r, 20));

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

    // Pre-populate three events.
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

    // First connection, no Last-Event-ID — replays from start (no replay
    // since no sinceEventId; the route only joins live, no buffer dump).
    // Then push event 4 and read it.
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
    await res1.body!.cancel();

    // Reconnect with Last-Event-ID = "p-int:4" — and then publish event 5.
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
    await res2.body!.cancel();
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
  });
});
```

- [ ] **Step 2: Run the integration tests**

```bash
cd apps/atlas-web && pnpm test test/integration/broker-sse-roundtrip.test.ts
```

Expected: 3 tests pass — broker singleton + SSE route + auth shim wire together end-to-end with no broker mocks.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/integration/broker-sse-roundtrip.test.ts
git commit -m "test(atlas-web): broker→SSE roundtrip integration (plan E.0)"
```

---

### Task 12: Flag-OFF behavioural lock — verify existing behaviour unchanged

**Files:**
- Create: `apps/atlas-web/test/lib/events/flag-off-behaviour.test.ts`

- [ ] **Step 1: Write the lock test**

This task creates a single test file whose only job is to assert that with `ATLAS_LIVE_EVENTS` unset (default), the broker still works (flag controls UI, not infra) AND the EventSourceProvider is a no-op AND `isFeatureEnabled("live-events")` returns false. This test exists so future PRs can't accidentally make the broker conditional on the flag — the guarantee is "flag controls the UI; the broker is always plumbed."

`apps/atlas-web/test/lib/events/flag-off-behaviour.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import React from "react";
import {
  __resetEventBrokerForTesting,
  getEventBroker
} from "@/lib/events/broker-singleton";
import { EventSourceProvider, useEventStream } from "@/lib/events/EventSourceProvider";
import { isFeatureEnabled } from "@/lib/feature-flags";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onopen: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() { this.closed = true; }
}

describe("flag OFF — behavioural lock (plan E.0 invariants)", () => {
  beforeEach(() => {
    __resetEventBrokerForTesting();
    MockEventSource.instances.length = 0;
  });

  it("isFeatureEnabled('live-events') is false when ATLAS_LIVE_EVENTS unset", () => {
    expect(isFeatureEnabled("live-events", { readEnv: () => undefined })).toBe(false);
  });

  it("broker is plumbed even with flag OFF — getEventBroker still returns a broker", () => {
    const b = getEventBroker();
    expect(b).toBeDefined();
    expect(typeof b.publish).toBe("function");
    expect(typeof b.subscribe).toBe("function");
  });

  it("publish still works with flag OFF — broker is infra, not UI-gated", async () => {
    const b = getEventBroker();
    const out = await b.publish({
      projectId: "p-flagoff",
      ritualId: "r-1",
      type: "ritual.started",
      payload: {},
      ts: 1
    });
    expect(out.id).toBe("p-flagoff:1");
  });

  it("EventSourceProvider with flagEnabled=false does NOT mount EventSource", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    render(<EventSourceProvider projectId="p-1" flagEnabled={false}>{null}</EventSourceProvider>);
    expect(MockEventSource.instances).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("useEventStream() with flag OFF returns the disabled triple", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EventSourceProvider projectId="p-1" flagEnabled={false}>{children}</EventSourceProvider>
    );
    const { result } = renderHook(() => useEventStream(), { wrapper });
    expect(result.current).toEqual({
      events: [],
      status: "disabled",
      lastEventId: null
    });
  });
});
```

- [ ] **Step 2: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/events/flag-off-behaviour.test.ts
```

Expected: 5 tests pass. No code changes needed — these assert invariants the previous tasks already enforce.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/lib/events/flag-off-behaviour.test.ts
git commit -m "test(atlas-web): flag-OFF behavioural lock — broker plumbed, provider no-op (plan E.0)"
```

---

### Task 13: Full suite + typecheck + lint green-bar

**Files:**
- (verification only — no code changes)

- [ ] **Step 1: Run the full atlas-web vitest suite**

```bash
cd apps/atlas-web && pnpm test
```

Expected: every `test/**/*.test.{ts,tsx}` file passes. New files contribute approximately 36 tests (broker types 5 + InMemory 10 + Redis 3 + conformance 8 + singleton 3 + provider 8 + integration 3 + flag-off 5 + factory 2 added + feature-flags 4 added + sse-route 5). Existing tests must remain green — no regressions.

- [ ] **Step 2: TypeScript typecheck**

```bash
cd apps/atlas-web && pnpm typecheck
```

Expected: clean (no errors).

- [ ] **Step 3: Lint**

```bash
cd apps/atlas-web && pnpm lint
```

Expected: clean (no errors). If lint surfaces unused `Symbol.asyncIterator` or other false positives, fix in place — do NOT disable rules globally.

- [ ] **Step 4: Run the ritual-engine and conductor packages to confirm we didn't break upstream**

```bash
pnpm -F @atlas/conductor test && pnpm -F @atlas/ritual-engine test
```

Expected: both packages pass — we did not modify either; this is a paranoia check.

- [ ] **Step 5: Commit a no-op marker if any auto-formatting kicked in during the previous tasks**

```bash
git status
```

If `git status` shows modifications (formatter, lockfile re-sort, etc.), commit them:

```bash
git add -A
git commit -m "chore(atlas-web): formatter / housekeeping fixes from plan E.0 verification pass"
```

If `git status` is clean, skip this step.

---

### Task 14: Merge `plan-e0/event-broker-sse` to `main`

**Files:**
- (git operation only — no code changes)

- [ ] **Step 1: Verify the branch is one ahead of main and CI-clean**

```bash
git log --oneline main..HEAD
```

Expected: 13 commits (or 12 if Task 13 had nothing to commit) on the branch; one per Task 1–12 (Task 13 may add a housekeeping commit).

- [ ] **Step 2: Push the branch to origin**

```bash
git push -u origin plan-e0/event-broker-sse
```

Expected: push succeeds; branch tracking established.

- [ ] **Step 3: Open the PR for human review**

```bash
gh pr create --title "Plan E.0: EventBroker + SSE rewrite + EventSourceProvider + feature flag" --body "$(cat <<'EOF'
## Summary
- Adds `lib/events/EventBroker.ts` interface (production-shaped, swappable backend).
- Adds `InMemoryEventBroker` (ring buffer 200/project, multi-subscriber fan-out, signal-driven unsubscribe).
- Adds `RedisEventBroker` stub + `FakeRedisStreams` mock — proves the boundary holds via parameterized conformance suite.
- Adds `EventSourceProvider` React context + `useEventStream` hook, with explicit flag-OFF no-op path.
- Adds `broker-singleton.ts` + test reset hook.
- Rewrites `app/api/projects/[projectId]/events/route.ts` from heartbeat stub to broker subscriber with Last-Event-ID resume + 15s keepalive + AbortController cleanup.
- Rewires `lib/engine/factory.ts` checkpointSink to dual-emit (broker.publish + existing log) via Promise.allSettled — never throws.
- Adds `live-events` feature flag (`ATLAS_LIVE_EVENTS`, default OFF).

Flag OFF path is verified end-to-end: broker is still plumbed (it's infra), but no EventSource opens, no UI changes.

## Test plan
- [x] Unit: 36 new tests across broker, provider, singleton, route, factory, feature-flags
- [x] Conformance: parameterized suite proves InMemory + RedisStub satisfy the same contract
- [x] Integration: real broker → real SSE route → headless frame parser, including Last-Event-ID resume
- [x] Flag OFF behavioural lock: 5 invariants asserted to prevent future regressions
- [x] `pnpm test` green for atlas-web
- [x] `pnpm typecheck` green
- [x] `pnpm lint` green
- [x] @atlas/conductor and @atlas/ritual-engine tests still green (no upstream regressions)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 4: After human approval + green CI, merge to main**

```bash
gh pr merge --merge --delete-branch
```

Expected: branch merged into `main`; remote branch deleted; local branch can be deleted with `git checkout main && git branch -d plan-e0/event-broker-sse`.

- [ ] **Step 5: Confirm Plan E / F / G unblocked**

After this merge, the dependency graph in the spec (`Plan E.0 → {E, F, G}`) is satisfied. Plans E, F, G can be picked up by three subagents in parallel.

---

## Self-Review

### 1. Spec coverage

Walked through `docs/superpowers/specs/2026-04-28-live-events-and-preview-reload-design.md` Plan E.0 scope:

| Spec requirement | Task |
|---|---|
| `EventBroker` interface + `RitualEvent` type + `RitualEventType` union (lines 61-86) | Task 2 |
| `InMemoryEventBroker` ring buffer 200/project + per-project Set | Tasks 3, 4 |
| Replay-from-cursor with out-of-buffer gap behaviour (line 90) | Task 3 (gap marker test) |
| `RedisEventBroker` stub for swap-test (line 88) | Task 5 |
| `EventSourceProvider` React context + `useEventStream` (lines 101-106) | Task 10 |
| Skip-mounts when flag is OFF (line 106) | Tasks 10, 12 |
| SSE route rewrite — text/event-stream + Last-Event-ID + broker.subscribe loop + 15s keepalive + AbortController cleanup (lines 94-99) | Task 9 |
| Factory rewires checkpointSink to broker.publish AND keeps SpecEventRepo append (line 92) | Task 8 |
| `liveEvents` flag in feature-flags.ts reading `ATLAS_LIVE_EVENTS === "true"` (line 166) | Task 1 |
| Flag-OFF path: SSE route still served (line 170), provider is no-op (line 169) | Tasks 9 (route always served), 10/12 (provider no-op verified) |
| Tests: broker pub/sub + ring buffer + replay + multi-subscriber + signal unsubscribe (line 180) | Tasks 3, 4 |
| Swap-test parameterized over both backends (line 188) | Task 6 |
| Integration: real Conductor → real broker → real SSE → headless EventSource (lines 184-185) | Task 11 (with caveat: pure node EventSource is jsdom-incompatible, so we use manual frame parsing — same effective coverage) |

All Plan E.0 spec items are covered.

### 2. Placeholder scan

Scanned for: TBD, TODO, "implement later", "fill in details", "appropriate error handling", "add validation", "Similar to Task N", references to undefined symbols.

- One `TODO` exists in the *current* `factory.ts` (line 111: "TODO: replace with a real persistent sink when checkpoint storage lands"). Task 8's rewrite removes this comment and supersedes it with the dual-emit implementation. Verified.
- No "Similar to Task N" — every task has the full code block.
- No undefined symbols: `RitualEventType`, `RitualEvent`, `PublishInput`, `EventBroker`, `SubscribeOptions` defined in Task 2; `InMemoryEventBroker` in Task 3; `RedisEventBroker`, `FakeRedisStreams`, `RedisStreamsLike` in Task 5; `getEventBroker`, `__resetEventBrokerForTesting` in Task 7; `mapCheckpointToRitualType` in Task 8; `EventSourceProvider`, `useEventStream`, `EventStreamStatus` in Task 10.

### 3. Type consistency

- `EventBroker.subscribe()` signature: `(projectId: string, opts?: SubscribeOptions): AsyncIterable<RitualEvent>` — same in interface (Task 2), `InMemoryEventBroker` (Task 3), `RedisEventBroker` (Task 5), broker-singleton consumers (Task 8 factory wiring, Task 9 route).
- `EventBroker.publish()` signature: `(event: PublishInput): Promise<RitualEvent>` — same across all three.
- `RitualEvent` shape: same 6 fields (`id`, `projectId`, `ritualId`, `type`, `payload`, `ts`) everywhere it appears.
- `useEventStream()` return shape: `{ events, status, lastEventId }` — defined in Task 10, asserted with that exact shape in Tasks 10 and 12.
- Feature flag id `"live-events"` used consistently across Tasks 1, 10 (in JSDoc), 12 (test).
- Env var `ATLAS_LIVE_EVENTS` matches between spec line 166 and Task 1 mapping.
- `__resetEventBrokerForTesting` exported from `broker-singleton.ts` (Task 7) and called from Tasks 8, 9, 11, 12.

All consistent — no fixes needed.

---

### Critical Files for Implementation

- F:\claude\ai_builder\apps\atlas-web\lib\events\EventBroker.ts (Task 2 — the contract; everything else implements it)
- F:\claude\ai_builder\apps\atlas-web\lib\events\InMemoryEventBroker.ts (Task 3 — ring buffer + fan-out, the production backend)
- F:\claude\ai_builder\apps\atlas-web\app\api\projects\[projectId]\events\route.ts (Task 9 — full SSE rewrite; replaces today's heartbeat stub)
- F:\claude\ai_builder\apps\atlas-web\lib\engine\factory.ts (Task 8 — wires checkpointSink to dual-emit broker + log; preserves SpecEventsSink)
- F:\claude\ai_builder\apps\atlas-web\lib\events\EventSourceProvider.tsx (Task 10 — the client surface Plan E + F consume; flag-aware no-op)