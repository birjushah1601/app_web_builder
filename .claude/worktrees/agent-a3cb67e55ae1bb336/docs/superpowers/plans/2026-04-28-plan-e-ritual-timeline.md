# Plan E — RitualTimeline (ChatPanel timeline UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a live three-row ritual timeline (Architect → Developer → Sandbox) inside the canvas page, driven by the SSE stream Plan E.0 already publishes — so the user sees rows transition pending → active → done in real time as the Conductor runs, with retry counts, last-error previews, and an escalation banner mounted on `ritual.escalated`.

**Architecture:** A pure reducer (`timelineReducer.ts`) folds the broker's `RitualEvent` union into a `TimelineState` of three `RowState` cells keyed by phase. A thin React hook (`useTimelineState`) subscribes to Plan E.0's `EventSourceProvider` context via `useEventStream()` and replays each newly-arrived event through the reducer with `useReducer`. Two presentational components consume the state: `RitualTimelineRow` renders one row (status icon, title, duration badge, expand panel) and `RitualTimeline` orchestrates three of them plus the existing `EscalationCallout`. The canvas page mounts `<RitualTimeline />` (gated on `isFeatureEnabled("live-events")`) below `CanvasPreviewClient` as a temporary host; Plan G later moves it into `RailShell`. The reducer is the only file with business logic — components are dumb, the hook is a 10-line adapter.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Next.js 15 app router · React 19 (`useReducer`, function components) · Vitest 2.x · `@testing-library/react@16` · `@testing-library/user-event@14` · Playwright 1.x · zero new npm dependencies.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan E.0 merged on `main` — see `docs/superpowers/plans/2026-04-28-plan-e0-event-broker-sse.md`. Specifically: `apps/atlas-web/lib/events/EventBroker.ts` exports `RitualEvent` and `RitualEventType`; `apps/atlas-web/lib/events/EventSourceProvider.tsx` exports `EventSourceProvider` and `useEventStream` (no-args; returns `{ events, status, lastEventId }`); `lib/feature-flags.ts` registers the `"live-events"` flag mapped to `ATLAS_LIVE_EVENTS`; the SSE route at `/api/projects/[projectId]/events` streams real broker frames.
- Plans A/B/C/D merged on `main` — `EscalationCallout.tsx`, `ChatPanel.tsx`, `CanvasPreviewClient`, the `/canvas` page, `startRitual` server action, and the Plan D real-stack E2E scaffold (`apps/atlas-web/e2e/tests/plan-d-real-stack.spec.ts`) all already exist.
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` workspace packages keep their `.js` suffix as before; this rule applies only to atlas-web internal imports.
- `pnpm install` clean — Plan E adds no new deps, but tests rely on the existing `@testing-library/react` + `vitest` jsdom environment configured in `apps/atlas-web/vitest.config.ts`.

**Branch:** `plan-e/ritual-timeline` cut from `main`. Final task in this plan merges the branch back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
apps/atlas-web/
  lib/
    ritual/
      timelineReducer.ts                                    # NEW: pure (state, RitualEvent) => TimelineState
      useTimelineState.ts                                   # NEW: React hook adapter over useEventStream
  components/
    ritual/
      RitualTimelineRow.tsx                                 # NEW: one row + expandable detail panel
      RitualTimeline.tsx                                    # NEW: orchestrator (3 rows + EscalationCallout)
  app/
    projects/[projectId]/canvas/
      page.tsx                                              # MODIFIED: mount <RitualTimeline /> when flag ON
  test/
    lib/
      ritual/
        timelineReducer.test.ts                             # NEW: ~14 cases (table-driven)
        useTimelineState.test.tsx                           # NEW: ~4 cases (hook over mock provider)
    components/
      ritual/
        RitualTimelineRow.test.tsx                          # NEW: ~6 cases (each status state + expand)
        RitualTimeline.test.tsx                             # NEW: ~4 cases (event sequences + escalation)
  e2e/
    tests/
      plan-e-ritual-timeline.spec.ts                        # NEW: real-stack timeline progression
```

**Why this shape.** The reducer lives in its own file because it is the only piece with business logic — every event-type → state-transition rule is in one place, trivially unit-testable, and free of React. The hook lives in a separate `.ts` (not `.tsx`, no JSX) so the reducer's purity is enforced by file-extension convention: any code that needs JSX cannot live in `lib/ritual/`. The two components are split so `RitualTimelineRow` can be tested in isolation against every status state without spinning up the orchestrator. `EscalationCallout` is reused as-is — Plan E does not modify it. The `/canvas/page.tsx` change is the smallest possible flag-gated mount; Plan G later moves the same `<RitualTimeline />` element into `RailShell` with no API change required here.

---

## Design Decisions

These resolve the implementation-level questions left implicit in the spec.

1. **Reducer signature is `(state, event) => state` — fold-style, not patch-style.** The hook calls `dispatch(event)` for each new `RitualEvent` arriving from `useEventStream().events`. We do not pass the cumulative event array to the reducer; we pass one event at a time. This keeps the reducer pure and testable without React, and matches React's `useReducer` contract.
2. **Phase derivation: by event type, not by payload.** The reducer maps `role.started` / `role.completed` / `role.failed` / `role.retrying` to a `Phase` based on `event.payload.role` if present (`"architect"` or `"developer"`), falling back to the most-recently-active non-sandbox row when payload is bare. `sandbox.*` events always map to the `"sandbox"` phase. `ritual.*` events do not advance any single row — `ritual.started` resets state, `ritual.completed` marks all non-failed rows done, `ritual.escalated` flips `state.escalated`.
3. **Duration: computed at completion, not live-ticking.** When a row transitions from `active` → `done` or `failed`, we set `durationMs = event.ts - row.startedAt`. The row carries an internal `startedAt: number | undefined` that the reducer stamps on `role.started` / `sandbox.provisioning` / `sandbox.apply.started`. The UI does NOT show a live tick (out of scope; would force a setInterval in the row component); a future PR can add `Date.now() - startedAt` interpolation for `active` rows.
4. **Retry counter: bumped only on `role.retrying`.** Each `role.retrying` event increments `row.retries` by 1 and stores `event.payload.error` (if string) into `row.lastError`. Going from `active` to `done` does NOT reset retries — the user wants to see "✓ done after 2 retries" persisted.
5. **Unknown event types are no-ops.** The reducer's switch has a `default` arm that returns state unchanged. This covers `stream.gap` from Plan E.0's broker (an internal control marker) and any future event type we add to the union before updating the reducer. The default branch is covered by a dedicated test.
6. **Empty / pre-ritual state: all rows pending, no escalation.** The reducer's `initialTimelineState` is exported so tests and the hook share one source of truth. Three `RowState`s with `status: "pending"`, `retries: 0`, no `meta`, no `durationMs`. The hook seeds the reducer with this on first render and on `projectId` change.
7. **Hook re-folds the entire `events` array on every change.** `useEventStream().events` is the cumulative array Plan E.0 maintains. Rather than tracking a cursor, the hook recomputes `state = events.reduce(timelineReducer, initialTimelineState)` inside `useMemo([events])`. This is O(events) per render but events is bounded (the broker's ring buffer caps at 200 per project) and React batches; cheaper than the bookkeeping needed to compute the delta. Documented in the hook header.
8. **Status icons are inline characters, not an icon library.** `○ ● ✓ ✗` (HALFWIDTH WHITE/BLACK CIRCLE, CHECK MARK, BALLOT X) — Tailwind for color, no `lucide-react` dep. Keeps the bundle smaller and the test selectors trivial (`getByText("✓")`).
9. **Escalation gate id passed to `EscalationCallout`: `"ritual"` literal.** `EscalationCallout` requires a `gate` prop; the spec doesn't surface a real gate id from `ritual.escalated` payload, and the existing component string says "the {gate} gate". We pass `"ritual"` and document it can become `event.payload.gate` once the conductor emits one. The `onAskReviewer` handler is a no-op `() => {}` for v1 — the spec marks ask-reviewer routing as out of scope.
10. **Flag gate at the page level, not the component.** The temporary host (`/canvas/page.tsx`) reads `isFeatureEnabled("live-events")` server-side and renders `<RitualTimeline />` only if true. The component itself does NOT read the flag, so the same component drops into `RailShell` later (Plan G) without a behavioural diff. The flag-OFF path is "the timeline simply isn't mounted" — not "the timeline is mounted but invisible."

---

## Task List (12 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit.

---

### Task 1: Cut the branch + scaffold the lib/ritual + components/ritual directories

**Files:**
- Create: `apps/atlas-web/lib/ritual/.gitkeep`
- Create: `apps/atlas-web/components/ritual/.gitkeep`
- Create: `apps/atlas-web/test/lib/ritual/.gitkeep`
- Create: `apps/atlas-web/test/components/ritual/.gitkeep`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-e/ritual-timeline
```

Expected: `Switched to a new branch 'plan-e/ritual-timeline'`.

- [ ] **Step 2: Verify Plan E.0 is on main**

```bash
git log --oneline main -- apps/atlas-web/lib/events/EventSourceProvider.tsx | head -3
ls apps/atlas-web/lib/events/EventBroker.ts apps/atlas-web/lib/events/EventSourceProvider.tsx
```

Expected: at least one commit referencing `EventSourceProvider`, and both files listed without error. If either is missing, STOP — Plan E.0 has not yet shipped and this plan cannot proceed.

- [ ] **Step 3: Create the four empty directories with `.gitkeep`**

```bash
mkdir -p apps/atlas-web/lib/ritual apps/atlas-web/components/ritual apps/atlas-web/test/lib/ritual apps/atlas-web/test/components/ritual
touch apps/atlas-web/lib/ritual/.gitkeep apps/atlas-web/components/ritual/.gitkeep apps/atlas-web/test/lib/ritual/.gitkeep apps/atlas-web/test/components/ritual/.gitkeep
```

- [ ] **Step 4: Commit the scaffolding**

```bash
git add apps/atlas-web/lib/ritual/.gitkeep apps/atlas-web/components/ritual/.gitkeep apps/atlas-web/test/lib/ritual/.gitkeep apps/atlas-web/test/components/ritual/.gitkeep
git commit -m "chore(atlas-web): scaffold lib/ritual + components/ritual for plan E"
```

---

### Task 2: Define `TimelineState`, `RowState`, `Phase` + `initialTimelineState` (types + tests)

**Files:**
- Create: `apps/atlas-web/lib/ritual/timelineReducer.ts`
- Create: `apps/atlas-web/test/lib/ritual/timelineReducer.test.ts`

- [ ] **Step 1: Write the failing test (types + initial state only)**

`apps/atlas-web/test/lib/ritual/timelineReducer.test.ts`:

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  initialTimelineState,
  timelineReducer,
  type Phase,
  type RowState,
  type TimelineState
} from "@/lib/ritual/timelineReducer";

describe("TimelineState — types and initial value", () => {
  it("Phase is exactly the 3-value union architect | developer | sandbox", () => {
    expectTypeOf<Phase>().toEqualTypeOf<"architect" | "developer" | "sandbox">();
  });

  it("RowState has the expected shape", () => {
    expectTypeOf<RowState>().toEqualTypeOf<{
      phase: Phase;
      status: "pending" | "active" | "done" | "failed";
      retries: number;
      lastError?: string;
      durationMs?: number;
      startedAt?: number;
      meta?: { winner?: string; filesWritten?: number };
    }>();
  });

  it("TimelineState has rows keyed by phase + escalated boolean", () => {
    expectTypeOf<TimelineState>().toEqualTypeOf<{
      rows: Record<Phase, RowState>;
      escalated: boolean;
    }>();
  });

  it("initialTimelineState has all 3 rows pending, escalated=false", () => {
    expect(initialTimelineState.escalated).toBe(false);
    expect(initialTimelineState.rows.architect.status).toBe("pending");
    expect(initialTimelineState.rows.developer.status).toBe("pending");
    expect(initialTimelineState.rows.sandbox.status).toBe("pending");
    expect(initialTimelineState.rows.architect.retries).toBe(0);
    expect(initialTimelineState.rows.architect.phase).toBe("architect");
    expect(initialTimelineState.rows.sandbox.phase).toBe("sandbox");
  });

  it("initialTimelineState is frozen (cannot be mutated by careless code)", () => {
    expect(() => {
      // @ts-expect-error — runtime mutation must throw under Object.freeze
      initialTimelineState.escalated = true;
    }).toThrow();
  });

  it("timelineReducer is callable with the initial state and an unknown event (no-op)", () => {
    const out = timelineReducer(initialTimelineState, {
      id: "x:1",
      projectId: "p-1",
      ritualId: "r-1",
      type: "stream.gap" as never,
      payload: {},
      ts: 1
    });
    expect(out).toBe(initialTimelineState); // unchanged reference for unknown type
  });
});
```

- [ ] **Step 2: Run the test; expect 6 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: 6 fails — `Cannot find module '@/lib/ritual/timelineReducer'`.

- [ ] **Step 3: Create the module skeleton with types + initial state**

`apps/atlas-web/lib/ritual/timelineReducer.ts`:

```typescript
/**
 * timelineReducer — pure fold of one RitualEvent into TimelineState.
 *
 * Plan E owns this reducer. The hook (useTimelineState.ts) is a thin
 * React adapter over Plan E.0's useEventStream(); the components in
 * components/ritual/ render TimelineState. ALL business logic lives in
 * this file. No React imports here, no Date.now(), no fetch — only the
 * RitualEvent type from Plan E.0.
 *
 * Design: see Plan E header §Design Decisions.
 *   - Pure (state, event) => state, not (state, events[]) => state.
 *   - Unknown event types return state unchanged (default arm).
 *   - durationMs is computed at completion using event.ts - row.startedAt.
 *   - retries bumped only on role.retrying.
 */

import type { RitualEvent } from "@/lib/events/EventBroker";

export type Phase = "architect" | "developer" | "sandbox";

export interface RowState {
  phase: Phase;
  status: "pending" | "active" | "done" | "failed";
  retries: number;
  lastError?: string;
  durationMs?: number;
  /** Wall-clock ms when the row entered "active". Used to compute
   *  durationMs at completion. Not surfaced in the rendered UI. */
  startedAt?: number;
  meta?: { winner?: string; filesWritten?: number };
}

export interface TimelineState {
  rows: Record<Phase, RowState>;
  escalated: boolean;
}

/** Frozen so React's strict-mode double-render and accidental mutations in
 *  tests both surface as TypeErrors instead of silent state corruption. */
export const initialTimelineState: TimelineState = Object.freeze({
  escalated: false,
  rows: Object.freeze({
    architect: Object.freeze({ phase: "architect" as const, status: "pending" as const, retries: 0 }),
    developer: Object.freeze({ phase: "developer" as const, status: "pending" as const, retries: 0 }),
    sandbox:   Object.freeze({ phase: "sandbox"   as const, status: "pending" as const, retries: 0 })
  })
}) as TimelineState;

/** Pure reducer. Returns the same reference when no transition applies so
 *  React's `useReducer` skips a re-render. Real transitions land in
 *  Tasks 3 + 4; this stub handles only unknown event types. */
export function timelineReducer(state: TimelineState, event: RitualEvent): TimelineState {
  switch (event.type) {
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/ritual/timelineReducer.ts apps/atlas-web/test/lib/ritual/timelineReducer.test.ts
git commit -m "feat(atlas-web): TimelineState + RowState types + initialTimelineState (plan E)"
```

---

### Task 3: Reducer — `ritual.*` and `role.*` event handlers (architect/developer rows)

**Files:**
- Modify: `apps/atlas-web/lib/ritual/timelineReducer.ts`
- Modify: `apps/atlas-web/test/lib/ritual/timelineReducer.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/lib/ritual/timelineReducer.test.ts`:

```typescript
import type { RitualEvent, RitualEventType } from "@/lib/events/EventBroker";

/** Build a RitualEvent for table-driven tests with sane defaults. */
function evt(type: RitualEventType, payload: Record<string, unknown> = {}, ts = 1_000): RitualEvent {
  return { id: `p-1:${ts}`, projectId: "p-1", ritualId: "r-1", type, payload, ts };
}

describe("timelineReducer — ritual.* events", () => {
  it("ritual.started returns initialTimelineState (resets prior runs)", () => {
    const polluted: TimelineState = {
      escalated: true,
      rows: {
        architect: { phase: "architect", status: "done", retries: 5 },
        developer: { phase: "developer", status: "failed", retries: 1 },
        sandbox:   { phase: "sandbox",   status: "active", retries: 0 }
      }
    };
    const out = timelineReducer(polluted, evt("ritual.started"));
    expect(out).toEqual(initialTimelineState);
  });

  it("ritual.escalated flips state.escalated to true (rows untouched)", () => {
    const before: TimelineState = {
      escalated: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 0, durationMs: 1200 },
        developer: { phase: "developer", status: "active", retries: 1 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.escalated", { gate: "ritual" }));
    expect(after.escalated).toBe(true);
    expect(after.rows).toEqual(before.rows); // rows unchanged
  });

  it("ritual.completed marks all non-failed pending|active rows as done", () => {
    const before: TimelineState = {
      escalated: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 0, durationMs: 1200 },
        developer: { phase: "developer", status: "active", retries: 0, startedAt: 500 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.completed", {}, 2_000));
    expect(after.rows.architect.status).toBe("done");
    expect(after.rows.developer.status).toBe("done");
    expect(after.rows.sandbox.status).toBe("done");
    expect(after.rows.developer.durationMs).toBe(1_500); // 2000 - 500
  });

  it("ritual.completed leaves a failed row failed", () => {
    const before: TimelineState = {
      escalated: false,
      rows: {
        architect: { phase: "architect", status: "failed", retries: 2, lastError: "oops" },
        developer: { phase: "developer", status: "pending", retries: 0 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.completed"));
    expect(after.rows.architect.status).toBe("failed");
    expect(after.rows.architect.lastError).toBe("oops");
  });
});

describe("timelineReducer — role.* events for architect", () => {
  it("role.started with payload.role='architect' marks architect active + stamps startedAt", () => {
    const out = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_500));
    expect(out.rows.architect.status).toBe("active");
    expect(out.rows.architect.startedAt).toBe(1_500);
    expect(out.rows.developer.status).toBe("pending");
  });

  it("role.completed with payload.role='architect' marks architect done + computes durationMs", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_000));
    const after2 = timelineReducer(after1, evt("role.completed", { role: "architect" }, 2_200));
    expect(after2.rows.architect.status).toBe("done");
    expect(after2.rows.architect.durationMs).toBe(1_200);
  });

  it("role.failed with payload.role='architect' marks architect failed + stores error string", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_000));
    const after2 = timelineReducer(after1, evt("role.failed", { role: "architect", error: "schema mismatch" }, 1_500));
    expect(after2.rows.architect.status).toBe("failed");
    expect(after2.rows.architect.lastError).toBe("schema mismatch");
    expect(after2.rows.architect.durationMs).toBe(500);
  });

  it("role.retrying with payload.role='architect' increments retries + stores last error", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_000));
    const after2 = timelineReducer(after1, evt("role.retrying", { role: "architect", error: "timeout 300s" }, 1_400));
    expect(after2.rows.architect.retries).toBe(1);
    expect(after2.rows.architect.lastError).toBe("timeout 300s");
    expect(after2.rows.architect.status).toBe("active"); // still in flight
  });
});

describe("timelineReducer — role.* events for developer", () => {
  it("role.started with payload.role='developer' marks developer active", () => {
    const after = timelineReducer(initialTimelineState, evt("role.started", { role: "developer" }, 3_000));
    expect(after.rows.developer.status).toBe("active");
    expect(after.rows.developer.startedAt).toBe(3_000);
    expect(after.rows.architect.status).toBe("pending"); // untouched
  });

  it("role.completed with payload.role='developer' surfaces meta.winner + meta.filesWritten", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "developer" }, 3_000));
    const after2 = timelineReducer(
      after1,
      evt("role.completed", { role: "developer", winner: "anthropic", filesWritten: 6 }, 11_400)
    );
    expect(after2.rows.developer.status).toBe("done");
    expect(after2.rows.developer.meta).toEqual({ winner: "anthropic", filesWritten: 6 });
    expect(after2.rows.developer.durationMs).toBe(8_400);
  });

  it("role.retrying with payload.role='developer' increments developer retries (architect untouched)", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "developer" }, 3_000));
    const after2 = timelineReducer(after1, evt("role.retrying", { role: "developer", error: "rate limit" }, 3_200));
    expect(after2.rows.developer.retries).toBe(1);
    expect(after2.rows.architect.retries).toBe(0);
  });

  it("role events with no payload.role and no prior active row are no-ops", () => {
    const after = timelineReducer(initialTimelineState, evt("role.started", {}, 1_000));
    expect(after).toBe(initialTimelineState);
  });
});
```

- [ ] **Step 2: Run tests; expect 12 fails (the 6 from Task 2 still pass)**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: the 6 Task-2 tests pass; the 12 new tests fail because every event currently hits the `default` arm.

- [ ] **Step 3: Implement the ritual.* and role.* arms**

Replace the `timelineReducer` function in `apps/atlas-web/lib/ritual/timelineReducer.ts` with:

```typescript
export function timelineReducer(state: TimelineState, event: RitualEvent): TimelineState {
  switch (event.type) {
    case "ritual.started":
      return initialTimelineState;

    case "ritual.escalated":
      if (state.escalated) return state;
      return { ...state, escalated: true };

    case "ritual.completed": {
      const newRows = { ...state.rows };
      let mutated = false;
      for (const phase of ["architect", "developer", "sandbox"] as Phase[]) {
        const row = newRows[phase];
        if (row.status === "failed" || row.status === "done") continue;
        const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
        newRows[phase] = { ...row, status: "done", durationMs };
        mutated = true;
      }
      return mutated ? { ...state, rows: newRows } : state;
    }

    case "role.started": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const next: RowState = { ...row, status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "role.completed": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const meta = extractMeta(event.payload);
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      const next: RowState = {
        ...row,
        status: "done",
        durationMs,
        ...(meta ? { meta } : {})
      };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "role.failed": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const errorVal = event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      const next: RowState = { ...row, status: "failed", lastError, durationMs };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "role.retrying": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const errorVal = event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const next: RowState = { ...row, retries: row.retries + 1, lastError };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    default:
      return state;
  }
}

/** Read payload.role and narrow it to "architect" | "developer". Sandbox
 *  events come in via the sandbox.* type prefixes, never as role.* with
 *  role=sandbox, so this returns null for "sandbox" or any other value. */
function phaseFromPayload(payload: Record<string, unknown>): "architect" | "developer" | null {
  const r = payload.role;
  if (r === "architect" || r === "developer") return r;
  return null;
}

/** Pluck the spec-listed meta fields (winner, filesWritten) out of the
 *  event payload. Returns undefined when neither is present so the
 *  reducer can skip writing a meta key. */
function extractMeta(payload: Record<string, unknown>): RowState["meta"] | undefined {
  const winner = typeof payload.winner === "string" ? payload.winner : undefined;
  const filesWritten = typeof payload.filesWritten === "number" ? payload.filesWritten : undefined;
  if (winner === undefined && filesWritten === undefined) return undefined;
  return { ...(winner !== undefined ? { winner } : {}), ...(filesWritten !== undefined ? { filesWritten } : {}) };
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: 18 tests pass (6 from Task 2 + 12 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/ritual/timelineReducer.ts apps/atlas-web/test/lib/ritual/timelineReducer.test.ts
git commit -m "feat(atlas-web): timelineReducer handles ritual.* + role.* events (plan E)"
```

---

### Task 4: Reducer — `sandbox.*` event handlers (provisioning + apply.started/completed)

**Files:**
- Modify: `apps/atlas-web/lib/ritual/timelineReducer.ts`
- Modify: `apps/atlas-web/test/lib/ritual/timelineReducer.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/lib/ritual/timelineReducer.test.ts`:

```typescript
describe("timelineReducer — sandbox.* events", () => {
  it("sandbox.provisioning marks sandbox active + stamps startedAt", () => {
    const after = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    expect(after.rows.sandbox.status).toBe("active");
    expect(after.rows.sandbox.startedAt).toBe(4_000);
  });

  it("sandbox.provisioned marks sandbox active (still working — apply not yet started)", () => {
    const after1 = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const after2 = timelineReducer(after1, evt("sandbox.provisioned", { sandboxId: "sbx-1" }, 4_500));
    // We treat provisioned as "still active" — the row only completes on
    // sandbox.apply.completed. provisioned is a checkpoint, not a finish line.
    expect(after2.rows.sandbox.status).toBe("active");
    expect(after2.rows.sandbox.startedAt).toBe(4_000); // unchanged
  });

  it("sandbox.apply.started keeps sandbox active (or activates it if pending) + bumps startedAt only when pending", () => {
    // Case 1: row already active from provisioning — startedAt sticks
    const provisioning = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const applyStarted1 = timelineReducer(provisioning, evt("sandbox.apply.started", {}, 5_000));
    expect(applyStarted1.rows.sandbox.status).toBe("active");
    expect(applyStarted1.rows.sandbox.startedAt).toBe(4_000); // sticks

    // Case 2: never provisioned (rare — manual apply) — activate now
    const applyStarted2 = timelineReducer(initialTimelineState, evt("sandbox.apply.started", {}, 5_000));
    expect(applyStarted2.rows.sandbox.status).toBe("active");
    expect(applyStarted2.rows.sandbox.startedAt).toBe(5_000);
  });

  it("sandbox.apply.completed with payload.ok=true marks sandbox done + records filesWritten in meta", () => {
    const after1 = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const after2 = timelineReducer(after1, evt("sandbox.apply.completed", { ok: true, filesWritten: 6 }, 6_500));
    expect(after2.rows.sandbox.status).toBe("done");
    expect(after2.rows.sandbox.durationMs).toBe(2_500);
    expect(after2.rows.sandbox.meta).toEqual({ filesWritten: 6 });
  });

  it("sandbox.apply.completed with payload.ok=false marks sandbox failed + stores error", () => {
    const after1 = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const after2 = timelineReducer(
      after1,
      evt("sandbox.apply.completed", { ok: false, parseError: "hunk mismatch in /code/src/page.tsx" }, 6_500)
    );
    expect(after2.rows.sandbox.status).toBe("failed");
    expect(after2.rows.sandbox.lastError).toBe("hunk mismatch in /code/src/page.tsx");
    expect(after2.rows.sandbox.durationMs).toBe(2_500);
  });
});

describe("timelineReducer — full happy-path event sequence", () => {
  it("Architect → Developer → Sandbox produces 3 done rows, no escalation", () => {
    const events: RitualEvent[] = [
      evt("ritual.started", {}, 100),
      evt("role.started", { role: "architect" }, 200),
      evt("role.completed", { role: "architect" }, 1_400),
      evt("role.started", { role: "developer" }, 1_500),
      evt("role.completed", { role: "developer", winner: "anthropic", filesWritten: 6 }, 9_900),
      evt("sandbox.provisioning", {}, 10_000),
      evt("sandbox.provisioned", { sandboxId: "sbx-1" }, 10_500),
      evt("sandbox.apply.started", {}, 10_600),
      evt("sandbox.apply.completed", { ok: true, filesWritten: 6 }, 11_100),
      evt("ritual.completed", {}, 11_200)
    ];
    const final = events.reduce(timelineReducer, initialTimelineState);
    expect(final.escalated).toBe(false);
    expect(final.rows.architect.status).toBe("done");
    expect(final.rows.architect.durationMs).toBe(1_200);
    expect(final.rows.developer.status).toBe("done");
    expect(final.rows.developer.meta).toEqual({ winner: "anthropic", filesWritten: 6 });
    expect(final.rows.sandbox.status).toBe("done");
    expect(final.rows.sandbox.meta).toEqual({ filesWritten: 6 });
  });
});
```

- [ ] **Step 2: Run tests; expect 6 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: the 18 prior tests pass; the 6 new sandbox + happy-path tests fail.

- [ ] **Step 3: Add the sandbox.* arms to the reducer**

In `apps/atlas-web/lib/ritual/timelineReducer.ts`, insert these `case` blocks INSIDE the `switch (event.type)` statement, immediately before the `default` arm:

```typescript
    case "sandbox.provisioning": {
      const row = state.rows.sandbox;
      const next: RowState = { ...row, status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "sandbox.provisioned": {
      // Provisioned is a milestone, not a finish — the row stays active until
      // sandbox.apply.completed. We keep startedAt sticky so duration covers
      // the full provision-to-apply window.
      const row = state.rows.sandbox;
      if (row.status === "active") return state; // no transition; preserve reference
      const next: RowState = { ...row, status: "active" };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "sandbox.apply.started": {
      const row = state.rows.sandbox;
      // Activate only if not already active. If active (e.g. from provisioning)
      // keep the original startedAt so duration covers the entire window.
      if (row.status === "active") return state;
      const next: RowState = { ...row, status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "sandbox.apply.completed": {
      const row = state.rows.sandbox;
      const ok = event.payload.ok === true;
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      if (ok) {
        const filesWrittenVal = event.payload.filesWritten;
        const meta = typeof filesWrittenVal === "number" ? { filesWritten: filesWrittenVal } : row.meta;
        const next: RowState = {
          ...row,
          status: "done",
          durationMs,
          ...(meta ? { meta } : {})
        };
        return { ...state, rows: { ...state.rows, sandbox: next } };
      }
      const errorVal = event.payload.parseError ?? event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const next: RowState = { ...row, status: "failed", lastError, durationMs };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: 24 tests pass (18 from prior tasks + 6 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/ritual/timelineReducer.ts apps/atlas-web/test/lib/ritual/timelineReducer.test.ts
git commit -m "feat(atlas-web): timelineReducer handles sandbox.* events + happy-path coverage (plan E)"
```

---

### Task 5: `useTimelineState` hook — adapter over `useEventStream`

**Files:**
- Create: `apps/atlas-web/lib/ritual/useTimelineState.ts`
- Create: `apps/atlas-web/test/lib/ritual/useTimelineState.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/lib/ritual/useTimelineState.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RitualEvent } from "@/lib/events/EventBroker";

// Mock the EventSourceProvider's useEventStream so we can drive the hook
// without spinning up a real EventSource. The hook MUST be the only
// consumer of useEventStream — no direct EventSource access.
const mockUseEventStream = vi.fn<() => { events: RitualEvent[]; status: string; lastEventId: string | null }>();

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => mockUseEventStream()
}));

import { useTimelineState } from "@/lib/ritual/useTimelineState";

const evt = (type: RitualEvent["type"], payload: Record<string, unknown>, ts: number, n = 1): RitualEvent => ({
  id: `p-1:${n}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("useTimelineState", () => {
  beforeEach(() => {
    mockUseEventStream.mockReset();
  });

  it("returns initialTimelineState when no events have arrived", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.escalated).toBe(false);
    expect(result.current.rows.architect.status).toBe("pending");
    expect(result.current.rows.developer.status).toBe("pending");
    expect(result.current.rows.sandbox.status).toBe("pending");
  });

  it("folds the events array through the reducer (architect active)", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("role.started", { role: "architect" }, 200, 2)
      ],
      status: "open",
      lastEventId: "p-1:2"
    });
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.rows.architect.status).toBe("active");
    expect(result.current.rows.architect.startedAt).toBe(200);
  });

  it("re-folds when the events array changes (architect → developer)", () => {
    mockUseEventStream.mockReturnValue({
      events: [evt("role.started", { role: "architect" }, 200, 1)],
      status: "open", lastEventId: "p-1:1"
    });
    const { result, rerender } = renderHook(() => useTimelineState());
    expect(result.current.rows.architect.status).toBe("active");

    mockUseEventStream.mockReturnValue({
      events: [
        evt("role.started", { role: "architect" }, 200, 1),
        evt("role.completed", { role: "architect" }, 1_400, 2),
        evt("role.started", { role: "developer" }, 1_500, 3)
      ],
      status: "open", lastEventId: "p-1:3"
    });
    rerender();
    expect(result.current.rows.architect.status).toBe("done");
    expect(result.current.rows.developer.status).toBe("active");
  });

  it("flips escalated to true when ritual.escalated arrives", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("role.started", { role: "architect" }, 200, 2),
        evt("ritual.escalated", { gate: "ritual" }, 300, 3)
      ],
      status: "open", lastEventId: "p-1:3"
    });
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.escalated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/useTimelineState.test.tsx
```

Expected: 4 fails — `Cannot find module '@/lib/ritual/useTimelineState'`.

- [ ] **Step 3: Write the hook**

`apps/atlas-web/lib/ritual/useTimelineState.ts`:

```typescript
"use client";

/**
 * useTimelineState — React adapter that subscribes to Plan E.0's
 * EventSourceProvider via useEventStream() and folds the cumulative event
 * array through timelineReducer with useMemo.
 *
 * Why fold-from-scratch (not delta dispatch): useEventStream() owns the
 * event array; tracking a cursor here would duplicate that bookkeeping
 * and risk drift. Re-folding is O(events) per render and events is
 * bounded by the broker's 200-event ring buffer (Plan E.0). React batches
 * the renders. Cheaper than the alternative.
 *
 * The hook reads no props — the projectId is encoded in which provider
 * instance is in scope. Mount the right EventSourceProvider above this
 * hook (the canvas page does so when the live-events flag is on).
 */

import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { initialTimelineState, timelineReducer, type TimelineState } from "@/lib/ritual/timelineReducer";

export function useTimelineState(): TimelineState {
  const { events } = useEventStream();
  return useMemo(() => events.reduce(timelineReducer, initialTimelineState), [events]);
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/useTimelineState.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/ritual/useTimelineState.ts apps/atlas-web/test/lib/ritual/useTimelineState.test.tsx
git commit -m "feat(atlas-web): useTimelineState hook folds useEventStream events through reducer (plan E)"
```

---

### Task 6: `RitualTimelineRow` — render one row + status icon + duration badge (no expand panel yet)

**Files:**
- Create: `apps/atlas-web/components/ritual/RitualTimelineRow.tsx`
- Create: `apps/atlas-web/test/components/ritual/RitualTimelineRow.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/components/ritual/RitualTimelineRow.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import type { RowState } from "@/lib/ritual/timelineReducer";

const baseRow = (overrides: Partial<RowState> = {}): RowState => ({
  phase: "architect", status: "pending", retries: 0, ...overrides
});

describe("RitualTimelineRow — status icon + title", () => {
  it("pending status renders ○ glyph + the row's title", () => {
    render(<RitualTimelineRow row={baseRow()} title="Architect planning" />);
    expect(screen.getByText("○")).toBeInTheDocument();
    expect(screen.getByText("Architect planning")).toBeInTheDocument();
  });

  it("active status renders ● glyph (filled circle)", () => {
    render(<RitualTimelineRow row={baseRow({ status: "active" })} title="Developer writing" />);
    expect(screen.getByText("●")).toBeInTheDocument();
  });

  it("done status renders ✓ glyph (check mark)", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done" })} title="Architect planning" />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("failed status renders ✗ glyph (ballot x)", () => {
    render(<RitualTimelineRow row={baseRow({ status: "failed" })} title="Developer writing" />);
    expect(screen.getByText("✗")).toBeInTheDocument();
  });
});

describe("RitualTimelineRow — duration badge", () => {
  it("renders durationMs as seconds with one decimal when present", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", durationMs: 1_240 })} title="Architect" />);
    expect(screen.getByText("1.2s")).toBeInTheDocument();
  });

  it("renders no duration badge when durationMs is undefined", () => {
    render(<RitualTimelineRow row={baseRow({ status: "active" })} title="Architect" />);
    expect(screen.queryByTestId("ritual-row-duration")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests; expect 6 fails**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimelineRow.test.tsx
```

Expected: 6 fails — `Cannot find module '@/components/ritual/RitualTimelineRow'`.

- [ ] **Step 3: Write the component (no expand panel yet — Task 7 adds it)**

`apps/atlas-web/components/ritual/RitualTimelineRow.tsx`:

```typescript
"use client";

/**
 * RitualTimelineRow — single row of the RitualTimeline. Pure presentational:
 * takes a RowState (from the reducer) and a human-readable title, renders
 * status glyph + title + optional duration badge, and (Task 7) a chevron
 * that toggles a detail panel showing retries / lastError / meta.
 *
 * No business logic here — every transition lives in timelineReducer.
 */

import type { RowState } from "@/lib/ritual/timelineReducer";

const STATUS_GLYPH: Record<RowState["status"], string> = {
  pending: "○",
  active:  "●",
  done:    "✓",
  failed:  "✗"
};

const STATUS_COLOR: Record<RowState["status"], string> = {
  pending: "text-slate-400",
  active:  "text-indigo-600",
  done:    "text-emerald-600",
  failed:  "text-red-600"
};

export interface RitualTimelineRowProps {
  row: RowState;
  /** Human-readable label for the row, e.g. "Architect planning". The
   *  orchestrator (RitualTimeline) supplies these so the row component
   *  stays free of phase-name → english-string mappings. */
  title: string;
}

export function RitualTimelineRow({ row, title }: RitualTimelineRowProps) {
  return (
    <div data-testid={`ritual-row-${row.phase}`} className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className={STATUS_COLOR[row.status]} aria-label={`status ${row.status}`}>
        {STATUS_GLYPH[row.status]}
      </span>
      <span className="flex-1 text-slate-800">{title}</span>
      {row.durationMs !== undefined && (
        <span data-testid="ritual-row-duration" className="text-slate-500">
          {(row.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimelineRow.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/ritual/RitualTimelineRow.tsx apps/atlas-web/test/components/ritual/RitualTimelineRow.test.tsx
git commit -m "feat(atlas-web): RitualTimelineRow renders status glyph + title + duration (plan E)"
```

---

### Task 7: `RitualTimelineRow` — chevron expand/collapse + detail panel (retries, error, meta)

**Files:**
- Modify: `apps/atlas-web/components/ritual/RitualTimelineRow.tsx`
- Modify: `apps/atlas-web/test/components/ritual/RitualTimelineRow.test.tsx`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/components/ritual/RitualTimelineRow.test.tsx`:

```typescript
import userEvent from "@testing-library/user-event";

describe("RitualTimelineRow — chevron expand/collapse", () => {
  it("renders a chevron toggle button", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", retries: 1, lastError: "timeout" })} title="Architect" />);
    expect(screen.getByRole("button", { name: /expand details|collapse details/i })).toBeInTheDocument();
  });

  it("detail panel is hidden by default", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", retries: 2, lastError: "timeout 300s" })} title="Architect" />);
    expect(screen.queryByTestId("ritual-row-detail")).not.toBeInTheDocument();
  });

  it("clicking the chevron expands the detail panel and shows retry count + last error", async () => {
    render(
      <RitualTimelineRow
        row={baseRow({ status: "done", retries: 2, lastError: "provider timeout 300s" })}
        title="Architect planning"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /expand details/i }));
    const detail = screen.getByTestId("ritual-row-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent("retried 2×");
    expect(detail).toHaveTextContent("provider timeout 300s");
  });

  it("clicking again collapses the panel", async () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", retries: 1 })} title="Architect" />);
    const btn = screen.getByRole("button", { name: /expand details/i });
    await userEvent.click(btn);
    expect(screen.getByTestId("ritual-row-detail")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /collapse details/i }));
    expect(screen.queryByTestId("ritual-row-detail")).not.toBeInTheDocument();
  });

  it("detail panel shows meta.winner and meta.filesWritten when present", async () => {
    render(
      <RitualTimelineRow
        row={baseRow({
          phase: "developer",
          status: "done",
          retries: 0,
          meta: { winner: "anthropic", filesWritten: 6 }
        })}
        title="Developer writing"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /expand details/i }));
    const detail = screen.getByTestId("ritual-row-detail");
    expect(detail).toHaveTextContent("winner: anthropic");
    expect(detail).toHaveTextContent("files: 6");
  });

  it("detail panel renders nothing-of-substance when row has no retries / error / meta", async () => {
    render(<RitualTimelineRow row={baseRow({ status: "active" })} title="Architect" />);
    await userEvent.click(screen.getByRole("button", { name: /expand details/i }));
    const detail = screen.getByTestId("ritual-row-detail");
    expect(detail).toHaveTextContent("No additional detail.");
  });
});
```

- [ ] **Step 2: Run tests; expect 6 fails**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimelineRow.test.tsx
```

Expected: 6 fails — chevron button is missing.

- [ ] **Step 3: Replace the component with the expandable version**

Replace the entire contents of `apps/atlas-web/components/ritual/RitualTimelineRow.tsx`:

```typescript
"use client";

/**
 * RitualTimelineRow — single row of the RitualTimeline. Pure presentational.
 * Owns one piece of local state: whether the detail panel is expanded.
 *
 * Layout (collapsed):  [glyph] [title]                [duration] [▸]
 * Layout (expanded):   [glyph] [title]                [duration] [▾]
 *                      [─── detail panel ───]
 *
 * No business logic here — every state transition lives in timelineReducer.
 */

import { useState } from "react";
import type { RowState } from "@/lib/ritual/timelineReducer";

const STATUS_GLYPH: Record<RowState["status"], string> = {
  pending: "○",
  active:  "●",
  done:    "✓",
  failed:  "✗"
};

const STATUS_COLOR: Record<RowState["status"], string> = {
  pending: "text-slate-400",
  active:  "text-indigo-600",
  done:    "text-emerald-600",
  failed:  "text-red-600"
};

export interface RitualTimelineRowProps {
  row: RowState;
  /** Human-readable label for the row, e.g. "Architect planning". The
   *  orchestrator (RitualTimeline) supplies these so the row component
   *  stays free of phase-name → english-string mappings. */
  title: string;
}

export function RitualTimelineRow({ row, title }: RitualTimelineRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`ritual-row-${row.phase}`} className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        <span className={STATUS_COLOR[row.status]} aria-label={`status ${row.status}`}>
          {STATUS_GLYPH[row.status]}
        </span>
        <span className="flex-1 text-slate-800">{title}</span>
        {row.durationMs !== undefined && (
          <span data-testid="ritual-row-duration" className="text-slate-500">
            {(row.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "collapse details" : "expand details"}
          className="text-slate-500 hover:text-slate-800"
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && (
        <div data-testid="ritual-row-detail" className="bg-slate-50 px-6 py-1 text-[11px] text-slate-700">
          {renderDetailLines(row)}
        </div>
      )}
    </div>
  );
}

/** Render the detail panel body. Returns one or more lines describing
 *  retries, lastError, and meta. When none of these are present we render
 *  a single "No additional detail." line so the panel is never empty. */
function renderDetailLines(row: RowState): React.ReactNode {
  const lines: string[] = [];
  if (row.retries > 0) lines.push(`retried ${row.retries}×`);
  if (row.lastError) lines.push(row.lastError);
  if (row.meta?.winner) lines.push(`winner: ${row.meta.winner}`);
  if (row.meta?.filesWritten !== undefined) lines.push(`files: ${row.meta.filesWritten}`);
  if (lines.length === 0) return <span>No additional detail.</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {lines.map((line, i) => (<li key={i}>{line}</li>))}
    </ul>
  );
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimelineRow.test.tsx
```

Expected: 12 tests pass (6 from Task 6 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/ritual/RitualTimelineRow.tsx apps/atlas-web/test/components/ritual/RitualTimelineRow.test.tsx
git commit -m "feat(atlas-web): RitualTimelineRow chevron expand/collapse + detail panel (plan E)"
```

---

### Task 8: `RitualTimeline` orchestrator — 3 rows + EscalationCallout

**Files:**
- Create: `apps/atlas-web/components/ritual/RitualTimeline.tsx`
- Create: `apps/atlas-web/test/components/ritual/RitualTimeline.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/components/ritual/RitualTimeline.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RitualEvent } from "@/lib/events/EventBroker";

const mockUseEventStream = vi.fn<() => { events: RitualEvent[]; status: string; lastEventId: string | null }>();

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => mockUseEventStream()
}));

import { RitualTimeline } from "@/components/ritual/RitualTimeline";

const evt = (type: RitualEvent["type"], payload: Record<string, unknown>, ts: number, n = 1): RitualEvent => ({
  id: `p-1:${n}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("RitualTimeline", () => {
  beforeEach(() => mockUseEventStream.mockReset());

  it("renders all three rows on first mount (all pending)", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    render(<RitualTimeline />);
    expect(screen.getByTestId("ritual-row-architect")).toBeInTheDocument();
    expect(screen.getByTestId("ritual-row-developer")).toBeInTheDocument();
    expect(screen.getByTestId("ritual-row-sandbox")).toBeInTheDocument();
    // Three pending glyphs
    expect(screen.getAllByText("○")).toHaveLength(3);
  });

  it("after architect.completed + developer.started, architect=✓ + developer=●", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("role.started", { role: "architect" }, 200, 2),
        evt("role.completed", { role: "architect" }, 1_400, 3),
        evt("role.started", { role: "developer" }, 1_500, 4)
      ],
      status: "open", lastEventId: "p-1:4"
    });
    render(<RitualTimeline />);
    const architect = screen.getByTestId("ritual-row-architect");
    const developer = screen.getByTestId("ritual-row-developer");
    expect(architect).toHaveTextContent("✓");
    expect(developer).toHaveTextContent("●");
  });

  it("renders the standard human-readable titles in row order", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    render(<RitualTimeline />);
    expect(screen.getByText("Architect planning")).toBeInTheDocument();
    expect(screen.getByText("Developer writing")).toBeInTheDocument();
    expect(screen.getByText("Applying to sandbox")).toBeInTheDocument();
  });

  it("mounts EscalationCallout when ritual.escalated arrives", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("ritual.escalated", { gate: "ritual" }, 200, 2)
      ],
      status: "open", lastEventId: "p-1:2"
    });
    render(<RitualTimeline />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/not authorised/i)).toBeInTheDocument();
  });

  it("does NOT mount EscalationCallout when escalated is false", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    render(<RitualTimeline />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests; expect 5 fails**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimeline.test.tsx
```

Expected: 5 fails — `Cannot find module '@/components/ritual/RitualTimeline'`.

- [ ] **Step 3: Write the orchestrator**

`apps/atlas-web/components/ritual/RitualTimeline.tsx`:

```typescript
"use client";

/**
 * RitualTimeline — orchestrator that renders the three RitualTimelineRows
 * (Architect / Developer / Sandbox) plus the existing EscalationCallout
 * when state.escalated flips true.
 *
 * Reads no props; subscribes to the ambient EventSourceProvider via the
 * useTimelineState hook. Mount this component below ANY EventSourceProvider
 * — today the canvas page mounts both (gated on the live-events flag);
 * Plan G later moves the mount up into RailShell with no API change.
 */

import { useTimelineState, type Phase } from "@/lib/ritual/useTimelineState";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import { EscalationCallout } from "@/components/EscalationCallout";

const ROW_TITLE: Record<Phase, string> = {
  architect: "Architect planning",
  developer: "Developer writing",
  sandbox:   "Applying to sandbox"
};

const ROW_ORDER: Phase[] = ["architect", "developer", "sandbox"];

export function RitualTimeline() {
  const state = useTimelineState();
  return (
    <section data-testid="ritual-timeline" className="rounded-md border border-slate-200 bg-white">
      {ROW_ORDER.map((phase) => (
        <RitualTimelineRow key={phase} row={state.rows[phase]} title={ROW_TITLE[phase]} />
      ))}
      {state.escalated && (
        <div className="border-t border-slate-200 p-2">
          {/* EscalationCallout requires gate + onAskReviewer; we pass the
              literal "ritual" gate id (the conductor doesn't surface a
              specific gate today) and a no-op handler — ask-reviewer
              routing is out of scope for plan E (spec §Non-Goals). */}
          <EscalationCallout gate="ritual" onAskReviewer={() => { /* plan-G v2 */ }} />
        </div>
      )}
    </section>
  );
}
```

Then add the `Phase` re-export to `useTimelineState.ts` so the orchestrator's import resolves. Edit `apps/atlas-web/lib/ritual/useTimelineState.ts` and replace its existing `import` line with:

```typescript
import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { initialTimelineState, timelineReducer, type TimelineState, type Phase } from "@/lib/ritual/timelineReducer";

export type { Phase };
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimeline.test.tsx test/lib/ritual/useTimelineState.test.tsx
```

Expected: 9 tests pass (5 RitualTimeline + 4 useTimelineState).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/ritual/RitualTimeline.tsx apps/atlas-web/lib/ritual/useTimelineState.ts apps/atlas-web/test/components/ritual/RitualTimeline.test.tsx
git commit -m "feat(atlas-web): RitualTimeline orchestrator + EscalationCallout integration (plan E)"
```

---

### Task 9: Wire `<RitualTimeline />` into `/canvas/page.tsx` behind the `live-events` flag

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`
- Create: `apps/atlas-web/test/app/projects/canvas-page-timeline.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/atlas-web/test/app/projects/canvas-page-timeline.test.tsx`:

```typescript
/**
 * Plan E flag-gating test: the canvas page must mount RitualTimeline
 * (wrapped in EventSourceProvider) ONLY when live-events flag is on.
 *
 * We import the page component directly and inspect the JSX output. The
 * server-action + sandbox-factory boundaries are mocked because the
 * page is an async server component with side-effecting imports.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: async () => ({
      previewUrl: "https://sbx-1.e2b.app",
      record: { sandboxId: "sbx-1" }
    })
  })
}));

vi.mock("@/lib/actions/startRitual", () => ({ startRitual: async () => ({ ritualId: "r-1", roleEvents: [] }) }));

vi.mock("@/components/CanvasClient", () => ({ CanvasClient: () => <div data-testid="canvas-client" /> }));

vi.mock("@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient", () => ({
  CanvasPreviewClient: () => <div data-testid="canvas-preview-client" />
}));

vi.mock("@/components/ritual/RitualTimeline", () => ({
  RitualTimeline: () => <div data-testid="ritual-timeline-mounted" />
}));

vi.mock("@/lib/events/EventSourceProvider", () => ({
  EventSourceProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="event-source-provider">{children}</div>
  )
}));

import { isFeatureEnabled, type FeatureFlagSource } from "@/lib/feature-flags";

vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags");
  return {
    ...actual,
    isFeatureEnabled: vi.fn((flag: string, source?: FeatureFlagSource) => actual.isFeatureEnabled(flag as never, source))
  };
});

describe("/canvas/page mount gating for RitualTimeline", () => {
  it("does NOT mount RitualTimeline when live-events flag is OFF (default)", async () => {
    delete process.env.ATLAS_LIVE_EVENTS;
    const { default: CanvasPage } = await import("@/app/projects/[projectId]/canvas/page");
    const tree = await CanvasPage({ params: Promise.resolve({ projectId: "p-1" }) });
    const html = renderToString(tree as React.ReactElement);
    expect(html).not.toContain("ritual-timeline-mounted");
    expect(html).not.toContain("event-source-provider");
  });

  it("mounts RitualTimeline inside EventSourceProvider when ATLAS_LIVE_EVENTS=true", async () => {
    process.env.ATLAS_LIVE_EVENTS = "true";
    vi.resetModules();
    const { default: CanvasPage } = await import("@/app/projects/[projectId]/canvas/page");
    const tree = await CanvasPage({ params: Promise.resolve({ projectId: "p-1" }) });
    const html = renderToString(tree as React.ReactElement);
    expect(html).toContain("ritual-timeline-mounted");
    expect(html).toContain("event-source-provider");
    delete process.env.ATLAS_LIVE_EVENTS;
  });
});
```

- [ ] **Step 2: Run tests; expect 2 fails**

```bash
cd apps/atlas-web && pnpm test test/app/projects/canvas-page-timeline.test.tsx
```

Expected: 2 fails — the page does not import or mount `RitualTimeline` or `EventSourceProvider` yet.

- [ ] **Step 3: Modify the canvas page**

Replace the entire contents of `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`:

```typescript
import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { EventSourceProvider } from "@/lib/events/EventSourceProvider";
import { RitualTimeline } from "@/components/ritual/RitualTimeline";
import { CanvasPreviewClient } from "./_components/CanvasPreviewClient";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // E.2 ships an empty-graph fallback. A future task wires SpecGraphRepo.read(projectId).
  const graph = { nodes: {}, edges: [] };

  // E.4: Lazy-provision sandbox and get preview URL for the HMR iframe.
  let previewUrl: string | undefined;
  let sandboxId = "";
  let previewError: string | undefined;
  try {
    const session = await getSandboxFactory().getOrProvision(projectId);
    previewUrl = session.previewUrl;
    sandboxId = session.record.sandboxId;
  } catch (err) {
    // Sandbox provision failed (spend cap, missing API key, etc.) — degrade
    // gracefully and surface the reason to the client so users don't stare
    // at a forever-loading skeleton.
    previewUrl = undefined;
    previewError = err instanceof Error ? err.message : String(err);
  }

  // Plan E: when ATLAS_LIVE_EVENTS=true, mount EventSourceProvider above
  // the canvas + a RitualTimeline below the preview. Plan G later moves
  // the timeline into RailShell; both orderings are merge-safe per spec.
  // When the flag is off, the page renders byte-for-byte as before.
  const liveEventsOn = isFeatureEnabled("live-events");

  const body = (
    <main className="flex h-full">
      <section className="flex-1 flex flex-col">
        <CanvasPreviewClient
          projectId={projectId}
          sandboxId={sandboxId}
          previewUrl={previewUrl}
          previewError={previewError}
        />
        <CanvasClient graph={graph} projectId={projectId} />
        {liveEventsOn && (
          <div className="border-t border-slate-200 p-2">
            <RitualTimeline />
          </div>
        )}
      </section>
      <ChatPanel projectId={projectId} action={startRitual} />
    </main>
  );

  if (!liveEventsOn) return body;

  return (
    <EventSourceProvider projectId={projectId} flagEnabled={true}>
      {body}
    </EventSourceProvider>
  );
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/app/projects/canvas-page-timeline.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Verify the existing canvas-page test still passes**

```bash
cd apps/atlas-web && pnpm test --run
```

Expected: full suite green. The existing `/canvas` rendering test (if any) continues to pass because the flag-OFF branch returns the original JSX subtree unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/canvas/page.tsx apps/atlas-web/test/app/projects/canvas-page-timeline.test.tsx
git commit -m "feat(atlas-web): mount RitualTimeline + EventSourceProvider on /canvas behind live-events flag (plan E)"
```

---

### Task 10: E2E real-stack — timeline rows transition Architect → Developer → Sandbox

**Files:**
- Create: `apps/atlas-web/e2e/tests/plan-e-ritual-timeline.spec.ts`

- [ ] **Step 1: Write the E2E spec**

`apps/atlas-web/e2e/tests/plan-e-ritual-timeline.spec.ts`:

```typescript
// Plan E real-stack timeline progression. NO MOCKS for any layer.
//
// Stack: live atlas-web (port 3000) with ATLAS_LIVE_EVENTS=true → real
// Postgres (port 5440) → real Claude proxy (port 3456) → real
// InMemoryEventBroker → real SSE route → browser EventSource → mounted
// RitualTimeline + useTimelineState reducer.
//
// Run:
//   pnpm --filter atlas-web dev    # in another terminal, with ATLAS_LIVE_EVENTS=true in .env.local
//   pnpm --filter atlas-web test:e2e plan-e-ritual-timeline.spec.ts
//
// Required env (loaded from apps/atlas-web/.env.local automatically):
//   - ATLAS_LIVE_EVENTS=true        (Plan E feature flag — must be on)
//   - CLERK_SECRET_KEY              (provisions test users via Clerk admin)
//   - ATLAS_TEST_PASSWORD           (password for test users)
//   - ATLAS_LLM_BASE_URL            (Claude proxy at :3456)
//   - E2B_API_KEY                   (sandbox provisioning)
//
// Wall time: ~3-4 minutes (uses the same trivial /hello prompt that Plan D
// Spec 4 proved completes in 240s against the live Anthropic proxy).

import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TEST_PERSONA_FILE = resolve(__dirname, "..", "auth", "diego.json");

function requireAuthState() {
  if (!existsSync(TEST_PERSONA_FILE)) {
    throw new Error(
      `Auth state missing at ${TEST_PERSONA_FILE}. Run globalSetup once (set ATLAS_TEST_PASSWORD + CLERK_SECRET_KEY in .env.local, then run pnpm test:e2e — it auto-provisions).`
    );
  }
}

function requireFlagOn() {
  if (process.env.ATLAS_LIVE_EVENTS !== "true") {
    throw new Error(
      "ATLAS_LIVE_EVENTS must be set to 'true' in apps/atlas-web/.env.local AND the dev server must have been started with that env. Restart `pnpm dev` after setting."
    );
  }
}

async function openCanvasOnFreshProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: /new project/i }).click();
  await page.waitForURL("**/projects/new");
  const projectName = `e2e-plan-e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.getByLabel(/name|project/i).first().fill(projectName);
  await page.getByRole("button", { name: /create|continue|start/i }).first().click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
}

test.describe("plan-e real stack: ritual timeline progression", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("timeline rows transition Architect→Developer→Sandbox in real time", async ({ page }, testInfo) => {
    test.setTimeout(360_000); // 6min — generous; Plan D proved 240s for the same prompt
    requireAuthState();
    requireFlagOn();
    await openCanvasOnFreshProject(page);

    // Sanity: the timeline must be mounted (flag is on)
    const timeline = page.getByTestId("ritual-timeline");
    await expect(timeline).toBeVisible();
    const architectRow  = page.getByTestId("ritual-row-architect");
    const developerRow  = page.getByTestId("ritual-row-developer");
    const sandboxRow    = page.getByTestId("ritual-row-sandbox");

    // All three start pending (○ glyph)
    await expect(architectRow).toContainText("○");
    await expect(developerRow).toContainText("○");
    await expect(sandboxRow).toContainText("○");

    // Submit the trivial /hello prompt (proven fast in Plan D Spec 4)
    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page at /hello returning the text 'Hello'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    // Architect should activate (● or finish ✓) within 30s of send
    await expect(architectRow).toContainText(/[●✓]/, { timeout: 30_000 });

    // Architect should reach done within 90s
    await expect(architectRow).toContainText("✓", { timeout: 90_000 });

    // Developer should activate within 30s after architect done
    await expect(developerRow).toContainText(/[●✓]/, { timeout: 30_000 });

    // Sandbox should reach a terminal state (✓ or ✗) within 240s of send
    // Either ✓ (success) or ✗ (apply failed) is an acceptable signal of
    // the row having transitioned — both prove the live event arrived.
    await expect(sandboxRow).toContainText(/[✓✗]/, { timeout: 240_000 });

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach("plan-e-final-timeline.png", { body: screenshot, contentType: "image/png" });
  });
});

test.describe("plan-e real stack: timeline detail panel", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("clicking a row's chevron expands the detail panel", async ({ page }) => {
    test.setTimeout(180_000);
    requireAuthState();
    requireFlagOn();
    await openCanvasOnFreshProject(page);

    // Pre-prompt the chain so we have at least one done row
    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page at /hello returning the text 'Hello'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    const architectRow = page.getByTestId("ritual-row-architect");
    await expect(architectRow).toContainText("✓", { timeout: 150_000 });

    // Click the architect row's expand button — detail panel must appear
    await architectRow.getByRole("button", { name: /expand details/i }).click();
    const detail = page.getByTestId("ritual-row-detail").first();
    await expect(detail).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify Playwright can compile the spec**

```bash
cd apps/atlas-web && pnpm exec playwright test --list e2e/tests/plan-e-ritual-timeline.spec.ts
```

Expected: lists 2 tests. No TypeScript errors.

- [ ] **Step 3: Document run instructions in the spec header (already done in Step 1)**

The spec's top comment block tells the operator how to run it. No additional file changes required.

- [ ] **Step 4: Run the spec opportunistically (only if the operator has the live stack up)**

Manual run; not part of CI:

```bash
cd apps/atlas-web && ATLAS_LIVE_EVENTS=true pnpm dev   # in terminal 1
cd apps/atlas-web && ATLAS_LIVE_EVENTS=true pnpm test:e2e plan-e-ritual-timeline.spec.ts   # in terminal 2
```

Expected: 2 specs pass within 6 minutes total. If the chain hangs at architect for >90s, the proxy is the bottleneck, not Plan E — see Plan D's troubleshooting notes.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/e2e/tests/plan-e-ritual-timeline.spec.ts
git commit -m "test(atlas-web): plan-e real-stack E2E — timeline rows transition with live events (plan E)"
```

---

### Task 11: Full-suite regression sweep — confirm flag-OFF byte-equivalence + flag-ON happy path

**Files:** none (verification only — no code changes)

- [ ] **Step 1: Full atlas-web vitest run with the flag UNSET**

```bash
cd apps/atlas-web && unset ATLAS_LIVE_EVENTS && pnpm test --run
```

Expected: every existing suite passes (Plan A/B/C/D/E.0 untouched), plus the 4 new Plan E suites:
- `test/lib/ritual/timelineReducer.test.ts` (24 tests)
- `test/lib/ritual/useTimelineState.test.tsx` (4 tests)
- `test/components/ritual/RitualTimelineRow.test.tsx` (12 tests)
- `test/components/ritual/RitualTimeline.test.tsx` (5 tests)
- `test/app/projects/canvas-page-timeline.test.tsx` (2 tests)

If any prior test fails, STOP — Plan E has regressed something it should not have touched. The likely suspects are:
- The `/canvas/page.tsx` flag-OFF branch (Task 9) — must return the original JSX subtree unchanged.
- A stray import of `EventSourceProvider` that runs even when the flag is off — it shouldn't, because the import is server-side and the JSX branch decides whether to mount it.

- [ ] **Step 2: Typecheck**

```bash
cd apps/atlas-web && pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Lint**

```bash
cd apps/atlas-web && pnpm lint
```

Expected: 0 errors / 0 warnings on Plan E files. Pre-existing lint warnings (if any) outside `lib/ritual/` or `components/ritual/` are not our problem.

- [ ] **Step 4: Manual smoke — flag OFF**

```bash
cd apps/atlas-web && unset ATLAS_LIVE_EVENTS && pnpm dev
```

Open `http://localhost:3000/` in a browser, sign in, create a project. The `/canvas` page must look identical to pre-Plan-E: no timeline visible, ChatPanel on the right as today.

- [ ] **Step 5: Manual smoke — flag ON**

```bash
cd apps/atlas-web && ATLAS_LIVE_EVENTS=true pnpm dev
```

Open the same canvas page. Below the canvas you should see a `RitualTimeline` panel with three pending (○) rows. Submit a small prompt (e.g. "add a /hello page") and watch the rows transition.

- [ ] **Step 6: No commit**

This task is verification only. Move to Task 12.

---

### Task 12: Open PR and merge `plan-e/ritual-timeline` to `main`

**Files:** none (git workflow only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin plan-e/ritual-timeline
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Plan E: RitualTimeline (ChatPanel timeline UI)" --body "$(cat <<'EOF'
## Summary

Implements Plan E from `docs/superpowers/specs/2026-04-28-live-events-and-preview-reload-design.md`. Renders a live three-row ritual timeline (Architect → Developer → Sandbox) inside `/canvas`, driven by Plan E.0's SSE stream, gated on `ATLAS_LIVE_EVENTS`.

- Pure reducer (`lib/ritual/timelineReducer.ts`) folds `RitualEvent` → `TimelineState`. 24 unit tests covering every event type + happy path.
- Thin React hook (`lib/ritual/useTimelineState.ts`) wraps `useEventStream()` with `useMemo`-folded reducer state. 4 hook tests.
- `RitualTimelineRow` + `RitualTimeline` components — pure presentational, status glyphs (○●✓✗), expand/collapse, EscalationCallout integration. 17 component tests.
- `/canvas/page.tsx` mounts `<RitualTimeline />` inside `EventSourceProvider` only when the flag is on. Flag-OFF branch returns the original JSX byte-for-byte.
- E2E spec extends Plan D's real-stack pattern; uses the trivial /hello prompt.

Plan G later moves `<RitualTimeline />` into `RailShell` — no API change required here.

## Test plan

- [ ] `pnpm --filter atlas-web test --run` — all suites green
- [ ] `pnpm --filter atlas-web exec tsc --noEmit` — 0 errors
- [ ] Manual smoke flag OFF — `/canvas` looks identical to pre-Plan-E
- [ ] Manual smoke flag ON — three-row timeline visible, transitions live on prompt
- [ ] (Optional) `ATLAS_LIVE_EVENTS=true pnpm test:e2e plan-e-ritual-timeline.spec.ts` — both specs pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI**

```bash
gh pr checks --watch
```

Expected: all checks green (typecheck, vitest, lint).

- [ ] **Step 4: Merge to main**

```bash
gh pr merge --merge --delete-branch
```

Expected: PR merged, `plan-e/ritual-timeline` branch deleted on remote and locally.

- [ ] **Step 5: Pull main locally**

```bash
git checkout main && git pull
```

Expected: local main is now at the merge commit; Plan E is shipped.

---

## Spec Coverage Map

| Spec requirement (from §Plan E and §Testing) | Task |
| --- | --- |
| New file `apps/atlas-web/components/ritual/RitualTimeline.tsx` (orchestrator) | Task 8 |
| New file `apps/atlas-web/components/ritual/RitualTimelineRow.tsx` (row + chevron) | Tasks 6, 7 |
| Reducer `apps/atlas-web/lib/ritual/timelineReducer.ts` mapping every event type | Tasks 2, 3, 4 |
| `Phase`, `RowState`, `TimelineState` shapes per spec | Task 2 |
| Hook `useTimelineState` consuming `EventSourceProvider` events | Task 5 |
| `EscalationCallout` mounts when `state.escalated` flips true | Task 8 |
| Unit: `timelineReducer` — every event type, retry counting, escalation flip | Tasks 2, 3, 4 |
| Unit: hook over a mock provider | Task 5 |
| Unit: row component for each status state + chevron toggle | Tasks 6, 7 |
| E2E real-stack timeline progression (extends Plan D pattern) | Task 10 |
| Flag-OFF path remains usable: timeline simply not mounted | Task 9 (gate at page level) |
| Branch `plan-e/ritual-timeline`; final task merges to main | Tasks 1, 12 |
| `.js`-suffix-free imports per commit `26faa85` | All tasks (every import) |
| Plan E does NOT touch ChatPanel.tsx or HmrIframe.tsx | All tasks (no edit listed) |
| Both orderings safe (E ships before G; G ships before E) | Task 9 (mount is page-local; component is portable) |
