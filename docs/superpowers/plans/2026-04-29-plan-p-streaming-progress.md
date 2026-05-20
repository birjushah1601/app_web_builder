# Plan P — Streaming Live Progress (Auto-Fix + Per-Role Phase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today, when a user clicks Send, the rail's `<RitualTimeline />` (Plan E) shows three rows (Architect, Developer, Sandbox) that flip from `pending → active → done`. But it can't surface Plan I's gate runs (security/a11y) and it can't surface Plan L's auto-fix attempts — those events exist in Postgres (`spec_events`) but aren't published to Plan E.0's broker because `apps/atlas-web/lib/engine/factory.ts → mapCheckpointToRitualType()` returns `null` for any event type outside the original 11. Plan P does three things:
1. Extends `RitualEventType` with `security.*`, `accessibility.*`, and `auto_fix.*` events.
2. Updates the factory's checkpoint-to-broker mapper to forward them.
3. Extends `timelineReducer` + `<RitualTimeline />` to render two new rows (Security gate, Accessibility gate) + an inline auto-fix attempt counter ("Auto-fixing #1 of 2…") under whichever gate triggered the loop.

**Why this matters:** the existing 60s wait is silent for everything except the three core phases. With Plan I + Plan L both shipped, real rituals can run 5+ phases (architect → developer → sandbox apply → security → a11y) and re-loop on gate failure. Without Plan P the user sees the architect row turn green and then nothing — even though the engine is grinding through gates and auto-fix attempts. This is THE biggest demo polish item.

**Tech Stack:** TypeScript 5.6 · Vitest 2.x · existing Plan E.0 broker + Plan E reducer + Plan I/L event emissions on `main`.

**Prerequisites:**
- Plan E.0 merged on `main` (broker + SSE + EventSourceProvider).
- Plan E (Tasks 1-8) merged on `main` (`timelineReducer` + `<RitualTimeline />` + `<RitualTimelineRow />`).
- Plan I merged on `main` (postDeveloperChain + security/a11y dispatch).
- Plan L merged on `main` (`auto_fix.attempted` / `.budget_exhausted` / `.failed` events emitted from engine).

**Branch:** `plan-p/streaming-progress` cut from `main`. Final task merges back.

---

## File Structure

```
apps/atlas-web/lib/events/
  EventBroker.ts                                              # MODIFIED: + security.*, accessibility.*, auto_fix.* in RitualEventType union

apps/atlas-web/lib/engine/
  factory.ts                                                  # MODIFIED: mapCheckpointToRitualType forwards the new event types

apps/atlas-web/lib/ritual/
  timelineReducer.ts                                          # MODIFIED: + Phase "security" | "accessibility" rows; + autoFixAttempts counter

apps/atlas-web/test/lib/ritual/
  timelineReducer-gates-and-autofix.test.ts                   # NEW: 8 cases (gate started/completed/failed; auto_fix attempted increments counter; budget_exhausted; failed)

apps/atlas-web/components/ritual/
  RitualTimeline.tsx                                          # MODIFIED: render security + accessibility rows + auto-fix indicator badge

apps/atlas-web/test/components/ritual/
  RitualTimeline-gates-and-autofix.test.tsx                   # NEW: 4 cases (gate rows render; auto-fix badge shows when attempts > 0; gate-failed status; both gates pass)
```

---

## Design Decisions

1. **Two new phases: `security` + `accessibility`.** Reducer's `Phase` union becomes `"architect" | "developer" | "sandbox" | "security" | "accessibility"`. The `initialTimelineState` adds two more pending rows. Phases that didn't run (flag-OFF) stay pending forever in the rendered timeline — UI hides "always pending" rows so users only see what actually ran.
2. **Auto-fix as a per-state counter, not a phase.** `TimelineState.autoFixAttempts: number` (default 0). Increments on `auto_fix.attempted`. Renders inline as a small "(auto-fix #N)" badge next to whichever gate triggered the loop, not as a new row. Why: auto-fix re-runs the WHOLE chain (architect → developer → gates again), so it's a meta-state, not a step.
3. **Event-type-to-phase mapping is in the reducer, not the broker.** Broker just forwards typed events; reducer maps `security.started` → `rows.security.status = "active"`, etc. Same pattern as today's role events.
4. **`auto_fix.budget_exhausted` flips a `state.autoFixExhausted = true` flag.** UI renders "Auto-fix budget reached (2/2 attempts)" inline. `auto_fix.failed` sets `state.autoFixFailed = "<error>"` for diagnostic display.
5. **Hidden-row policy: render rows whose `status !== "pending"`, OR a row whose phase ran in any prior turn.** Means the first user gets architect+developer+sandbox; flipping on Security flag adds the security row when it first runs. No flicker on flag toggles.
6. **No new `RitualEventType` for `architect.pass2.completed` etc.** The reducer keeps using the broker's role.* events (which carry role ID in payload) — adding architect-specific event types would balloon the broker and require deeper refactor. v2 can split if granular pass1/pass2 visualization is wanted.

---

## Task List (6 tasks)

---

### Task 1: Extend `RitualEventType` union

**Files:**
- Modify: `apps/atlas-web/lib/events/EventBroker.ts`

- [ ] **Step 1: Cut the branch**

```bash
git checkout main && git pull && git checkout -b plan-p/streaming-progress
```

- [ ] **Step 2: Add new event types**

In `apps/atlas-web/lib/events/EventBroker.ts`, extend `RitualEventType`:

```typescript
export type RitualEventType =
  | "ritual.started"
  | "ritual.completed"
  | "ritual.escalated"
  | "ritual.escalation_requested"  // Plan I — emitted on gate failure
  | "role.started"
  | "role.completed"
  | "role.failed"
  | "role.retrying"
  | "sandbox.provisioning"
  | "sandbox.provisioned"
  | "sandbox.apply.started"
  | "sandbox.apply.completed"
  // Plan I gate events — surface on the rail timeline as their own rows.
  | "security.started"
  | "security.completed"
  | "security.failed"
  | "accessibility.started"
  | "accessibility.completed"
  | "accessibility.failed"
  // Plan L auto-fix events — increment a meta-state counter on the timeline.
  | "auto_fix.attempted"
  | "auto_fix.budget_exhausted"
  | "auto_fix.failed";
```

- [ ] **Step 3: Verify nothing broke**

```bash
cd apps/atlas-web && pnpm typecheck
```

Expected: clean. The reducer's existing `default` arm will catch any new types until Task 3 wires them.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/lib/events/EventBroker.ts
git commit -m "feat(atlas-web/events): extend RitualEventType with security/a11y/auto_fix events (plan P)"
```

---

### Task 2: Wire the factory mapper to forward the new events

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`

- [ ] **Step 1: Extend `mapCheckpointToRitualType`**

Find the function (near bottom of factory.ts) and add the new cases:

```typescript
function mapCheckpointToRitualType(eventType: string): RitualEventType | null {
  switch (eventType) {
    case "ritual.started":          return "ritual.started";
    case "ritual.completed":        return "ritual.completed";
    case "ritual.escalated":        return "ritual.escalated";
    case "ritual.escalation_requested": return "ritual.escalation_requested";
    case "role.started":            return "role.started";
    case "role.completed":          return "role.completed";
    case "role.failed":             return "role.failed";
    case "role.retrying":           return "role.retrying";
    case "sandbox.provisioning":    return "sandbox.provisioning";
    case "sandbox.provisioned":     return "sandbox.provisioned";
    case "sandbox.apply.started":   return "sandbox.apply.started";
    case "sandbox.apply.completed": return "sandbox.apply.completed";
    // Plan P: forward gate + auto-fix events to the broker so the live UI shows them.
    case "security.started":        return "security.started";
    case "security.completed":      return "security.completed";
    case "security.failed":         return "security.failed";
    case "accessibility.started":   return "accessibility.started";
    case "accessibility.completed": return "accessibility.completed";
    case "accessibility.failed":    return "accessibility.failed";
    case "auto_fix.attempted":      return "auto_fix.attempted";
    case "auto_fix.budget_exhausted": return "auto_fix.budget_exhausted";
    case "auto_fix.failed":         return "auto_fix.failed";
    default:                        return null;
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/atlas-web && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web/factory): mapCheckpointToRitualType forwards security/a11y/auto_fix events to broker (plan P)"
```

---

### Task 3: Extend `timelineReducer` with security/accessibility phases + autoFix state

**Files:**
- Modify: `apps/atlas-web/lib/ritual/timelineReducer.ts`
- Create: `apps/atlas-web/test/lib/ritual/timelineReducer-gates-and-autofix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/ritual/timelineReducer-gates-and-autofix.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { timelineReducer, initialTimelineState } from "@/lib/ritual/timelineReducer";
import type { RitualEvent } from "@/lib/events/EventBroker";

function evt(type: RitualEvent["type"], payload: Record<string, unknown> = {}): RitualEvent {
  return { id: "x:1", projectId: "p", ritualId: "r", type, payload, ts: 1000 };
}

describe("timelineReducer — gates + auto-fix (Plan P Task 3)", () => {
  it("security.started flips security row to active", () => {
    const out = timelineReducer(initialTimelineState, evt("security.started"));
    expect(out.rows.security.status).toBe("active");
  });

  it("security.completed (passed=true) flips security row to done", () => {
    const after = timelineReducer(initialTimelineState, evt("security.started"));
    const out = timelineReducer(after, evt("security.completed", { passed: true }));
    expect(out.rows.security.status).toBe("done");
  });

  it("security.failed flips security row to failed", () => {
    const after = timelineReducer(initialTimelineState, evt("security.started"));
    const out = timelineReducer(after, evt("security.failed", { error: "timeout" }));
    expect(out.rows.security.status).toBe("failed");
    expect(out.rows.security.lastError).toBe("timeout");
  });

  it("accessibility.* mirrors security.* on its own row", () => {
    let s = timelineReducer(initialTimelineState, evt("accessibility.started"));
    expect(s.rows.accessibility.status).toBe("active");
    s = timelineReducer(s, evt("accessibility.completed", { passed: false }));
    expect(s.rows.accessibility.status).toBe("done");
  });

  it("auto_fix.attempted increments autoFixAttempts", () => {
    let s = timelineReducer(initialTimelineState, evt("auto_fix.attempted", { gate: "L4-security", attemptNumber: 1, parentRitualId: "r" }));
    expect(s.autoFixAttempts).toBe(1);
    s = timelineReducer(s, evt("auto_fix.attempted", { gate: "L4-security", attemptNumber: 2, parentRitualId: "r" }));
    expect(s.autoFixAttempts).toBe(2);
  });

  it("auto_fix.budget_exhausted flips autoFixExhausted", () => {
    const s = timelineReducer(initialTimelineState, evt("auto_fix.budget_exhausted", { gate: "L4-security", attempts: 2 }));
    expect(s.autoFixExhausted).toBe(true);
  });

  it("auto_fix.failed captures the error", () => {
    const s = timelineReducer(initialTimelineState, evt("auto_fix.failed", { gate: "L4-security", error: "LLM 503" }));
    expect(s.autoFixFailed).toContain("LLM 503");
  });

  it("ritual.started resets autoFixAttempts AND row states", () => {
    let s = timelineReducer(initialTimelineState, evt("auto_fix.attempted", { gate: "L4-security", attemptNumber: 1, parentRitualId: "r" }));
    expect(s.autoFixAttempts).toBe(1);
    s = timelineReducer(s, evt("ritual.started"));
    expect(s.autoFixAttempts).toBe(0);
    expect(s.rows.security.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer-gates-and-autofix.test.ts
```

Expected: 8 fails — `Phase` union doesn't include "security" / "accessibility"; `autoFix*` fields don't exist.

- [ ] **Step 3: Extend the reducer**

In `apps/atlas-web/lib/ritual/timelineReducer.ts`:

```typescript
export type Phase = "architect" | "developer" | "sandbox" | "security" | "accessibility";

export interface TimelineState {
  rows: Record<Phase, RowState>;
  escalated: boolean;
  /** Plan P: counter incremented on auto_fix.attempted; rendered as a
   *  "(auto-fix #N)" badge next to whichever gate row triggered the loop. */
  autoFixAttempts: number;
  /** Plan P: true after auto_fix.budget_exhausted. UI shows "budget reached". */
  autoFixExhausted: boolean;
  /** Plan P: error string from auto_fix.failed (LLM/conductor failure during fix). */
  autoFixFailed?: string;
}

export const initialTimelineState: TimelineState = Object.freeze({
  escalated: false,
  autoFixAttempts: 0,
  autoFixExhausted: false,
  rows: Object.freeze({
    architect:     Object.freeze({ phase: "architect"     as const, status: "pending" as const, retries: 0 }),
    developer:     Object.freeze({ phase: "developer"     as const, status: "pending" as const, retries: 0 }),
    sandbox:       Object.freeze({ phase: "sandbox"       as const, status: "pending" as const, retries: 0 }),
    security:      Object.freeze({ phase: "security"      as const, status: "pending" as const, retries: 0 }),
    accessibility: Object.freeze({ phase: "accessibility" as const, status: "pending" as const, retries: 0 })
  })
}) as TimelineState;
```

In the `timelineReducer` switch, add cases for the new event types:

```typescript
case "security.started":
case "accessibility.started": {
  const phase = event.type.split(".")[0] as Phase;
  const next = { ...state.rows, [phase]: { ...state.rows[phase], status: "active" as const, startedAt: event.ts } };
  return { ...state, rows: next };
}

case "security.completed":
case "accessibility.completed": {
  const phase = event.type.split(".")[0] as Phase;
  const row = state.rows[phase];
  const durationMs = row.startedAt ? event.ts - row.startedAt : undefined;
  const next = { ...state.rows, [phase]: { ...row, status: "done" as const, durationMs } };
  return { ...state, rows: next };
}

case "security.failed":
case "accessibility.failed": {
  const phase = event.type.split(".")[0] as Phase;
  const lastError = (event.payload as { error?: string }).error;
  const next = { ...state.rows, [phase]: { ...state.rows[phase], status: "failed" as const, lastError } };
  return { ...state, rows: next };
}

case "auto_fix.attempted":
  return { ...state, autoFixAttempts: state.autoFixAttempts + 1 };

case "auto_fix.budget_exhausted":
  return { ...state, autoFixExhausted: true };

case "auto_fix.failed": {
  const error = (event.payload as { error?: string }).error ?? "unknown";
  return { ...state, autoFixFailed: error };
}
```

Also update `ritual.started` to reset the new fields:

```typescript
case "ritual.started":
  return initialTimelineState;
```

(initialTimelineState already has the new fields zeroed; the existing reset is sufficient.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer-gates-and-autofix.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Run existing reducer tests to catch regressions**

```bash
cd apps/atlas-web && pnpm test test/lib/ritual/timelineReducer.test.ts
```

Expected: all green (the new fields default to 0/false in initialTimelineState; existing tests don't reference them).

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/ritual/timelineReducer.ts apps/atlas-web/test/lib/ritual/timelineReducer-gates-and-autofix.test.ts
git commit -m "feat(atlas-web/ritual): timelineReducer handles security/a11y rows + auto_fix counter (plan P)"
```

---

### Task 4: Render security/accessibility rows + auto-fix badge in `<RitualTimeline />`

**Files:**
- Modify: `apps/atlas-web/components/ritual/RitualTimeline.tsx`
- Create: `apps/atlas-web/test/components/ritual/RitualTimeline-gates-and-autofix.test.tsx`

- [ ] **Step 1: Inspect the current orchestrator**

```bash
cat apps/atlas-web/components/ritual/RitualTimeline.tsx
```

Today it renders three rows: architect, developer, sandbox. Plan P extends ROW_ORDER to 5 phases and adds an inline auto-fix badge.

- [ ] **Step 2: Write the failing test**

Create `apps/atlas-web/test/components/ritual/RitualTimeline-gates-and-autofix.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const useTimelineStateMock = vi.fn();
vi.mock("@/lib/ritual/useTimelineState", () => ({
  useTimelineState: () => useTimelineStateMock()
}));
// Mock the row to a simple div so we can target it without re-testing row internals.
vi.mock("@/components/ritual/RitualTimelineRow", () => ({
  RitualTimelineRow: ({ row, title }: { row: { status: string; phase: string }; title: string }) => (
    <div data-testid={`row-${row.phase}`} data-status={row.status}>{title}</div>
  )
}));
vi.mock("@/components/EscalationCallout", () => ({
  EscalationCallout: () => <div data-testid="escalation-callout" />
}));

import { RitualTimeline } from "@/components/ritual/RitualTimeline";

describe("RitualTimeline — gates + auto-fix (Plan P Task 4)", () => {
  it("renders security + accessibility rows when they're active or done (not just architect/developer/sandbox)", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect:     { phase: "architect",     status: "done",    retries: 0 },
        developer:     { phase: "developer",     status: "done",    retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",    retries: 0 },
        security:      { phase: "security",      status: "active",  retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline />);
    expect(screen.getByTestId("row-security")).toBeInTheDocument();
    // Pending accessibility row hidden when nothing's progressed it AND no other gate is active — but here security is active, so a11y can show.
    // For v1: accessibility row is hidden when its status is "pending" AND security is also pending (i.e. no chain ran). Test the "any-gate-active" rule:
    expect(screen.queryByTestId("row-accessibility")).toBeInTheDocument();
  });

  it("hides security + accessibility rows when both are pending (no chain ran)", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect:     { phase: "architect",     status: "done",    retries: 0 },
        developer:     { phase: "developer",     status: "done",    retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",    retries: 0 },
        security:      { phase: "security",      status: "pending", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline />);
    expect(screen.queryByTestId("row-security")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-accessibility")).not.toBeInTheDocument();
  });

  it("renders '(auto-fix #N)' badge when autoFixAttempts > 0", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: true,
      autoFixAttempts: 1,
      autoFixExhausted: false,
      rows: {
        architect:     { phase: "architect",     status: "done",   retries: 0 },
        developer:     { phase: "developer",     status: "done",   retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",   retries: 0 },
        security:      { phase: "security",      status: "failed", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline />);
    expect(screen.getByTestId("auto-fix-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("auto-fix-indicator").textContent).toMatch(/auto-fix #1/);
  });

  it("renders 'budget reached' message when autoFixExhausted is true", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: true,
      autoFixAttempts: 2,
      autoFixExhausted: true,
      rows: {
        architect:     { phase: "architect",     status: "done",   retries: 0 },
        developer:     { phase: "developer",     status: "done",   retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",   retries: 0 },
        security:      { phase: "security",      status: "failed", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline />);
    expect(screen.getByTestId("auto-fix-indicator").textContent).toMatch(/budget reached/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimeline-gates-and-autofix.test.tsx
```

Expected: 4 fails.

- [ ] **Step 4: Modify `RitualTimeline.tsx`**

```typescript
"use client";

import { useTimelineState, type Phase } from "@/lib/ritual/useTimelineState";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import { EscalationCallout } from "@/components/EscalationCallout";

const ROW_TITLE: Record<Phase, string> = {
  architect:     "Architect planning",
  developer:     "Developer writing",
  sandbox:       "Applying to sandbox",
  security:      "Security gate",
  accessibility: "Accessibility gate"
};

const ROW_ORDER: Phase[] = ["architect", "developer", "sandbox", "security", "accessibility"];

export function RitualTimeline() {
  const state = useTimelineState();

  // Plan P: only render gate rows when SOMETHING progressed them. Pending
  // gates are hidden so flag-OFF rituals look the same as before
  // (architect → developer → sandbox).
  const visibleRows = ROW_ORDER.filter((phase) => {
    if (phase !== "security" && phase !== "accessibility") return true;
    return state.rows[phase].status !== "pending";
  });

  return (
    <section data-testid="ritual-timeline" className="rounded-md border border-slate-200 bg-white">
      {visibleRows.map((phase) => (
        <RitualTimelineRow key={phase} row={state.rows[phase]} title={ROW_TITLE[phase]} />
      ))}

      {(state.autoFixAttempts > 0 || state.autoFixExhausted || state.autoFixFailed) && (
        <div data-testid="auto-fix-indicator" className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {state.autoFixExhausted
            ? `Auto-fix budget reached (${state.autoFixAttempts} attempts)`
            : state.autoFixFailed
              ? `Auto-fix failed: ${state.autoFixFailed}`
              : `Auto-fix #${state.autoFixAttempts} in progress…`}
        </div>
      )}

      {state.escalated && (
        <div className="border-t border-slate-200 p-2">
          <EscalationCallout gate="ritual" onAskReviewer={() => { /* plan-G v2 */ }} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimeline-gates-and-autofix.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 6: Run existing RitualTimeline tests**

```bash
cd apps/atlas-web && pnpm test test/components/ritual/RitualTimeline.test.tsx
```

Expected: all green (existing tests use the legacy 3-row state shape; the new fields default to 0/false so existing assertions pass).

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/components/ritual/RitualTimeline.tsx apps/atlas-web/test/components/ritual/RitualTimeline-gates-and-autofix.test.tsx
git commit -m "feat(atlas-web/ritual): RitualTimeline renders gate rows + auto-fix indicator (plan P)"
```

---

### Task 5: Hydrator extension — fold auto_fix.* events into snapshot

**Files:**
- Modify: `packages/ritual-engine/src/hydrator.ts`
- Modify: `packages/ritual-engine/test/hydrator.test.ts`

- [ ] **Step 1: Add reducer cases to `applyOne`**

In `packages/ritual-engine/src/hydrator.ts`, extend `applyOne` to capture `auto_fix.*` events into `snap.fixAttempts`:

```typescript
function applyOne(snap: RitualSnapshot, r: SpecEventRowLike): void {
  // ... existing cases ...
  } else if (t === "auto_fix.attempted" && p) {
    // Plan L follow-up: increment fixAttempts on each auto-fix replay.
    // The engine sets fixAttempts on the CHILD ritual when triggering
    // the loop, so a single ritual's spec_events stream will see ONE
    // auto_fix.attempted at most (the next attempt creates a new ritualId).
    // But we still increment defensively in case of future multi-attempt
    // rituals.
    snap.fixAttempts = (snap.fixAttempts ?? 0) + 1;
  }
  // ... rest unchanged ...
}
```

Also accumulate `security.*`, `accessibility.*`, and `auto_fix.*` events into `roleEvents` (extend the `if` clause at the bottom):

```typescript
if (
  t.startsWith("role.") ||
  t.startsWith("architect.") ||
  t.startsWith("developer.") ||
  t.startsWith("security.") ||
  t.startsWith("accessibility.") ||
  t.startsWith("auto_fix.")
) {
  const rec: RoleEventRecord = { eventType: t, payload: r.payload };
  snap.roleEvents.push(rec);
}
```

- [ ] **Step 2: Add tests for the new fold**

Append to `packages/ritual-engine/test/hydrator.test.ts`:

```typescript
describe("replayEventsToSnapshot — auto_fix events (Plan P Task 5)", () => {
  function row(id: bigint, eventType: string, payload: object) {
    return { id, eventType, payload, actor: null };
  }

  it("auto_fix.attempted increments fixAttempts on the snapshot", () => {
    const rows = [
      row(1n, "ritual.started",     { ritualId: "r", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "auto_fix.attempted", { ritualId: "r", ts: 2, gate: "L4-security", attemptNumber: 1, parentRitualId: "r-prev" })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap?.fixAttempts).toBe(1);
  });

  it("auto_fix.* events accumulate into roleEvents", () => {
    const rows = [
      row(1n, "ritual.started",         { ritualId: "r", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "auto_fix.attempted",     { ritualId: "r", ts: 2, gate: "L4-security", attemptNumber: 1 }),
      row(3n, "auto_fix.budget_exhausted", { ritualId: "r", ts: 3, gate: "L4-security", attempts: 2 })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap?.roleEvents.some((e) => e.eventType === "auto_fix.attempted")).toBe(true);
    expect(snap?.roleEvents.some((e) => e.eventType === "auto_fix.budget_exhausted")).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: green (15+ existing + 2 new = 17 cases).

- [ ] **Step 4: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/test/hydrator.test.ts
git commit -m "feat(ritual-engine/hydrator): fold auto_fix.* events into fixAttempts + roleEvents (plan P)"
```

---

### Task 6: Final verification + docs + merge

**Files:**
- Modify: `docs/superpowers/local-dev-status.md`
- Modify: this plan file

- [ ] **Step 1: Cross-package typecheck + tests**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/ritual-engine test
```

Expected: green.

- [ ] **Step 2: Update local-dev-status**

Append a Plan P bullet to "What's wired":

```markdown
- **Plan P: streaming live progress.** When `ATLAS_LIVE_EVENTS=true`, the rail's `<RitualTimeline />` now renders five phase rows (Architect, Developer, Sandbox, Security gate, Accessibility gate) instead of three. Gate rows hide when their phase didn't run (flag-OFF for security/a11y looks the same as before). Plan L's auto-fix events surface as a dedicated indicator: "Auto-fix #1 in progress…" → "Auto-fix budget reached (2 attempts)" or "Auto-fix failed: <error>". Backed by an extended `RitualEventType` union, factory mapper forwarding security/a11y/auto_fix events to the broker, and a hydrator extension folding `auto_fix.*` into `fixAttempts` so process-restart still recovers the badge.
```

Also add a row to the "How to enable each plan locally" table noting Plan P piggybacks on `ATLAS_LIVE_EVENTS` (no new flag needed).

- [ ] **Step 3: Mark shipped**

Append Shipped section to this plan file.

- [ ] **Step 4: Commit + merge**

```bash
git add docs/superpowers/local-dev-status.md docs/superpowers/plans/2026-04-29-plan-p-streaming-progress.md
git commit -m "docs(plan-p): mark shipped — streaming live progress for gates + auto-fix"
git checkout main
git pull
git merge --no-ff plan-p/streaming-progress -m "Merge branch 'plan-p/streaming-progress'

Plan P — streaming live progress (gates + auto-fix in RitualTimeline).
- RitualEventType extended with security/a11y/auto_fix events
- Factory's mapCheckpointToRitualType forwards them to the broker
- timelineReducer adds security + accessibility phase rows + autoFix counter
- RitualTimeline renders 5 rows (gates hidden when pending) + auto-fix indicator
- Hydrator folds auto_fix.* into snapshot.fixAttempts
- No new flag — piggybacks on ATLAS_LIVE_EVENTS
"
git branch -d plan-p/streaming-progress
```

---

## Completion Checklist

- [ ] `pnpm typecheck` — clean across atlas-web + ritual-engine
- [ ] `pnpm test` — full atlas-web suite green; +12 new cases (8 reducer + 4 timeline)
- [ ] ritual-engine — +2 hydrator cases for auto_fix
- [ ] Manual smoke (with ATLAS_LIVE_EVENTS + security flag + auto-fix-loop on, real LLM): inject a hardcoded secret in a developer diff → watch RitualTimeline progress through 5 rows → see "Auto-fix #1 in progress…" → either pass (clean) or "budget reached"
- [ ] `docs/superpowers/local-dev-status.md` — Plan P bullet added
- [ ] Plan file marked Shipped
- [ ] `plan-p/streaming-progress` merged to `main` (`--no-ff`); branch deleted

## Follow-ups

1. **Sub-phase visualization** — split architect into "triage" + "deep-plan" sub-rows once `architect.pass1.*` / `architect.pass2.*` event types are added to the broker.
2. **Token-stream progress** — surface `role.token` events when LLM streaming lands (Plan E.0's broker is event-shape-agnostic; a future plan can add token events).
3. **Per-attempt timeline replay** — when `fixAttempts > 1`, render a small history of the prior failed gate reports so users can see what each attempt addressed.

---

## Shipped

All 6 tasks executed inline + merged to `plan-p/streaming-progress` and then to `main`. `pnpm typecheck` clean across atlas-web + @atlas/ritual-engine. Atlas-web added 9 reducer cases (8 spec + 1 escalation_requested) + 4 RitualTimeline cases = 13 new tests. Ritual-engine added 2 hydrator-fold cases (auto_fix.attempted increments fixAttempts; auto_fix.* events accumulate into roleEvents). EventBroker.types test updated with the extended union; Phase + TimelineState type-tests updated with the 5-phase + autoFix fields.

Deviations from plan:
- **Tasks 1-2 combined** into one commit (RitualEventType union + factory mapper are interlocked).
- **Tasks 5-6 split into hydrator commit + docs+merge commit** (matches the per-package commit boundary).
- **Existing `ritual.completed` reducer behavior preserved** for the 3 core phases (pending → done) but the new gate phases skip auto-flip when pending. Means flag-OFF rituals look pixel-identical to pre-Plan-P.
- **Existing reducer fixture-state literals updated** in 4 places to include the new `security` + `accessibility` rows + `autoFixAttempts: 0, autoFixExhausted: false`. The TS strict shape check in the type-test file caught this immediately.
