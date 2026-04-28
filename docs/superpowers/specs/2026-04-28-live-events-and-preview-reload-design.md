# Live Events + Preview Reload — Design

**Date:** 2026-04-28
**Status:** Approved (brainstorm complete; user-reviewed)
**Plans this spec produces:** Plan E.0 (broker + SSE + provider), Plan E (RitualTimeline), Plan F (preview auto-reload), Plan G (persistent left-rail shell)

---

## Problem

Today the architect → developer → sandbox-apply chain runs server-side as one opaque server action. The user submits a prompt, sees a spinner, then sees the complete result land in `ChatPanel`. The preview iframe loads once with the E2B sandbox URL and then stays static — when the developer agent writes 6 files into the sandbox, the iframe does not update.

Both gaps make Atlas feel dead during the most important moment — when the AI is actually working. The first surfaces as "I have no idea if anything is happening"; the second surfaces as "the AI says it shipped a feature but I don't see it."

## Goals

1. Stream conductor checkpoint events to the UI in real time, surfaced as a coarse three-state ritual timeline (Architect → Developer → Sandbox).
2. Auto-reload the preview iframe whenever a developer diff is successfully applied to the sandbox; expose a manual reload button as escape hatch.
3. Move chat to a persistent left-rail shell that survives navigation between `/canvas`, `/code`, `/run`.
4. All of the above behind a single feature flag (`ATLAS_LIVE_EVENTS`); flag-off path = today's behavior, untouched.

## Non-Goals

- Token-by-token streaming of LLM output (token-stream option was offered and declined as out of scope).
- Multi-instance broker (Redis pub/sub) — interface designed to swap, not implemented.
- Resizable / collapsible left rail (v2; v1 is fixed-width).
- HMR-magic via Next Fast Refresh — chose force-reload for predictability.

## Architecture

### Shared infra (Plan E.0)

```
┌─────────────────────────────────────────────────────────────┐
│            atlas-web Node process                            │
│                                                              │
│   Conductor.checkpointSink ─emit─▶ EventBroker (broker.ts)  │
│        (already firing today)         │                      │
│                                       ├──▶ SpecEventRepo     │
│                                       │       (existing)     │
│                                       │                      │
│                                       ▼                      │
│                              ringBuffer<RitualEvent>         │
│                              Map<projectId, Set<emit fn>>    │
│                                       │                      │
│                                       ▼                      │
│              /api/projects/[id]/events  (SSE — rewritten)    │
│                                       │                      │
└───────────────────────────────────────┼──────────────────────┘
                                        │
                                        ▼
                       Browser EventSource (single per project)
                                        │
                            EventSourceProvider context
                                  ┌─────┴─────┐
                                  ▼           ▼
                            useTimelineState  useReloadOnApplied
                            (Plan E)          (Plan F)
```

**`EventBroker` interface** (lives in `apps/atlas-web/lib/events/EventBroker.ts`):

```typescript
export type RitualEventType =
  | "ritual.started" | "ritual.completed" | "ritual.escalated"
  | "role.started" | "role.completed" | "role.failed" | "role.retrying"
  | "sandbox.provisioning" | "sandbox.provisioned"
  | "sandbox.apply.started" | "sandbox.apply.completed";

export type RitualEvent = {
  id: string;                  // monotonic per project, stringified bigint
  projectId: string;
  ritualId: string;
  type: RitualEventType;
  payload: Record<string, unknown>;
  ts: number;                  // epoch ms
};

export interface EventBroker {
  publish(event: Omit<RitualEvent, "id">): Promise<RitualEvent>;
  subscribe(
    projectId: string,
    opts?: { sinceEventId?: string; signal?: AbortSignal }
  ): AsyncIterable<RitualEvent>;
}
```

The interface is what we ship; the in-memory implementation is what backs it. `RedisEventBroker` is a stub class the swap-test parameterizes over to prove the boundary holds — Redis itself is not provisioned in this spec.

**Ring buffer:** `InMemoryEventBroker` keeps the last 200 events per project (~60s of activity at peak emission). On `subscribe(..., { sinceEventId })`, replays from cursor before joining the live stream. Beyond 200 events, replay returns from oldest available; client treats this as "stream gap" and resyncs from current state.

**Conductor wiring:** `apps/atlas-web/lib/engine/factory.ts` — replace the existing `checkpointSink.emit` (which only console.errors) with a sink that calls both `broker.publish()` and the existing `SpecEventRepo` persistence.

**SSE route** at `apps/atlas-web/app/api/projects/[projectId]/events/route.ts`:
- Replaces today's heartbeat-only stub.
- GET returns `text/event-stream`. Reads `Last-Event-ID` request header.
- `for await (const event of broker.subscribe(projectId, { sinceEventId, signal }))`, writes `id: <eventId>\ndata: <json>\n\n`.
- Heartbeat every 15s as `: keepalive`.
- Cleans up subscriber on connection close (AbortController).

**`EventSourceProvider`** at `apps/atlas-web/lib/events/EventSourceProvider.tsx`:
- React context. `useEventStream({ projectId })` returns `{ events, status, lastEventId }`.
- Opens one `EventSource` per `projectId`; survives navigation between routes inside `[projectId]/`.
- Re-keys on `projectId` change (project switch).
- Auto-reconnects with `Last-Event-ID` header on disconnect.
- Skip-mounts when `featureFlags.liveEvents === false`.

### Plan E — `RitualTimeline`

```
┌─ RitualTimeline ──────────────────────────────────┐
│ ✓ Architect planning           1.2s    ▾          │
│ ● Developer writing 6 files    8.4s    ▾          │
│   ├─ retried 1× (provider timeout 300s)           │
│   └─ winner: anthropic                            │
│ ○ Applying to sandbox                             │
└───────────────────────────────────────────────────┘
```

- New file `apps/atlas-web/components/ritual/RitualTimeline.tsx` (orchestrator).
- New file `apps/atlas-web/components/ritual/RitualTimelineRow.tsx` (single row + chevron).
- Reducer in `apps/atlas-web/lib/ritual/timelineReducer.ts`:

```typescript
type Phase = "architect" | "developer" | "sandbox";
type RowState = {
  phase: Phase;
  status: "pending" | "active" | "done" | "failed";
  retries: number;
  lastError?: string;
  durationMs?: number;
  meta?: { winner?: string; filesWritten?: number };
};
type TimelineState = { rows: Record<Phase, RowState>; escalated: boolean };
```

Reducer cases mapped from event types — see Plan E for the full table. Hook `useTimelineState(projectId)` consumes `EventSourceProvider` events through the reducer.

`EscalationCallout.tsx` (existing) renders below the timeline when `state.escalated` flips true.

### Plan F — preview auto-reload

- `apps/atlas-web/components/canvas/HmrIframe.tsx` (existing, modified).
- New hook `apps/atlas-web/lib/canvas/useReloadOnApplied.ts`:
  - Reads `EventSourceProvider` context.
  - On `sandbox.apply.completed` event with `payload.ok === true`: debounce 500ms, then `iframe.src = base + (base.includes("?") ? "&" : "?") + "atlas-reload=" + eventId`.
  - On `payload.ok === false`: surfaces a small red toast `"Last apply failed: <parseError or first-failed-file>"` above the iframe. **No reload** — avoids showing user a broken page.
- "Reload preview" button next to the existing viewport toggle in `HmrIframe`. Same cache-bust path; uses `Date.now()` as the event id since manual reloads have no SSE event.
- Debounce coalesces a burst of apply-completed events within 500ms into one reload.

### Plan G — persistent left-rail shell

- `apps/atlas-web/app/projects/[projectId]/layout.tsx` — currently renders `{children}`; rewritten to mount `EventSourceProvider` + flex layout with left rail.
- New file `apps/atlas-web/components/shell/RailShell.tsx`:
  - Fixed 360px wide (v1).
  - Header: project switcher (link) + project name.
  - Body: `<ChatPanel projectId={projectId} />` (moved from `/canvas` page).
  - Footer: `<RitualTimeline projectId={projectId} />` + `<EscalationCallout />`.
  - State boundary designed so v2 (resize + collapse) is additive — owns its own width state in props/context, not a global.
- `/canvas`, `/code`, `/run` pages render ChatPanel **only when `featureFlags.liveEvents === false`**. Flag-on, the layout owns the chat and pages render bare; flag-off, the layout passes through and pages mount their own ChatPanel as today.
- Decision is made via a single import (`featureFlags.liveEvents`) inside each page; no runtime context needed for the choice.

### Feature flag

- New flag `liveEvents` in `apps/atlas-web/lib/feature-flags.ts`.
- Resolves from `process.env.ATLAS_LIVE_EVENTS === "true"`. Default false.
- Flag OFF path:
  - `EventSourceProvider` is a no-op (renders children, returns empty events).
  - SSE route is still served (always-on, harmless).
  - `RailShell` does not mount; `/canvas` `/code` `/run` render bare with their own ChatPanel.
  - HmrIframe does not subscribe; manual "Reload preview" button still works.
- Flag ON path: rail mounts, timeline renders, iframe auto-reloads.

The flag-off path must remain usable, not stubbed — never ship a half-broken state hidden behind a flag.

## Testing

### Unit
- `InMemoryEventBroker`: pub/sub correctness, ring-buffer eviction, replay-from-cursor including out-of-buffer cursor case, multi-subscriber fan-out, signal-driven unsubscribe.
- `timelineReducer`: each event type → expected state transition; retry counting; escalation flip.
- `useReloadOnApplied`: debounce window, cache-buster format, no-reload on failure, toast text.

### Integration (no mocks)
- Real `Conductor` → real `InMemoryEventBroker` → real SSE route → headless `EventSource` client. Assert event ordering and that disconnect-then-reconnect with `Last-Event-ID` resumes from cursor.
- Run on the trivial `/hello` prompt that Plan D Spec 4 already proved completes in 240s against the live Anthropic proxy. Reuse Plan D's real-stack test scaffolding.

### Swap-test
- `RedisEventBroker` stub (in-memory mock of Redis client, not a live Redis). Same broker test suite parameterized over both backends. Proves the interface holds before we need it.

### E2E
- Two new specs in `apps/atlas-web/e2e/tests/plan-efg-live-events.spec.ts`:
  1. **Live progress:** submit prompt; assert RitualTimeline rows transition Architect→Developer→Sandbox in real time (poll DOM with timeout).
  2. **Preview auto-reload:** assert iframe `src` contains an `atlas-reload=` query param after a developer diff applies; assert the manual "Reload preview" button cache-busts on click.

## File structure

```
apps/atlas-web/lib/events/
  EventBroker.ts                 # interface + RitualEvent type + RitualEventType union
  InMemoryEventBroker.ts         # ring buffer + Map<projectId, Set<emit>>
  RedisEventBroker.ts            # stub for swap-test (no live Redis)
  EventSourceProvider.tsx        # React context + useEventStream

apps/atlas-web/app/api/projects/[projectId]/events/route.ts
  # rewritten from heartbeat stub

apps/atlas-web/lib/ritual/
  timelineReducer.ts             # event → TimelineState

apps/atlas-web/components/ritual/
  RitualTimeline.tsx
  RitualTimelineRow.tsx

apps/atlas-web/components/shell/
  RailShell.tsx                  # left rail container

apps/atlas-web/app/projects/[projectId]/layout.tsx
  # turned into EventSourceProvider + RailShell wrapper (flag-on)
  # bare {children} pass-through (flag-off)

apps/atlas-web/components/canvas/HmrIframe.tsx
  # add useReloadOnApplied + Reload button

apps/atlas-web/lib/canvas/useReloadOnApplied.ts
  # new hook

apps/atlas-web/lib/feature-flags.ts
  # add `liveEvents`

apps/atlas-web/lib/engine/factory.ts
  # rewire checkpointSink.emit to broker.publish()
```

## Rollout

1. Land Plan E.0 (broker + SSE + provider + flag) behind flag default OFF. Zero UI change.
2. Land Plan E + F + G in parallel — all three depend only on E.0, not on each other. Each ships behind the same flag.
3. Operator sets `ATLAS_LIVE_EVENTS=true` in `.env.local`, runs Plan D-style real-stack E2E.
4. Once green and bedded in: a future cleanup PR flips the flag default and removes the fallback paths.

## Dependency graph for parallel execution

```
                 Plan E.0
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     Plan E      Plan F      Plan G
     (timeline)  (reload)    (rail shell)
```

E.0 must ship first. The other three have zero shared files (E touches `components/ritual/*`, F touches `components/canvas/HmrIframe.tsx` + `lib/canvas/`, G touches `app/projects/[projectId]/layout.tsx` + `components/shell/`). They can be implemented by three separate subagents in parallel without merge conflicts.

The only ordering nuance: G ships the `RailShell` that mounts `<RitualTimeline />`. If G ships before E, `RailShell` mounts a placeholder `<RitualTimeline />` and E lands the real implementation. If E ships before G, the timeline renders inside `/canvas` page as a temporary host (deleted when G lands). Both orderings are merge-safe; the spec leaves the choice to the executor.
