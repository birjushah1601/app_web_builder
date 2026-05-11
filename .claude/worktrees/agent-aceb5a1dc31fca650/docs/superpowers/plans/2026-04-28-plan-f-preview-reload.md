# Plan F — Preview Auto-Reload + Manual Reload Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the developer agent successfully applies a diff to the live E2B sandbox, the canvas preview iframe must reload itself within ~500ms (debounced to coalesce bursts) by mutating its `src` with an `atlas-reload=<eventId>` cache-buster — and a "Reload preview" button next to the viewport toggle must always work as a manual escape hatch, including when `ATLAS_LIVE_EVENTS` is OFF or the SSE connection is down. Failed applies must NOT reload (we don't want to render a broken page); they show a small red toast above the iframe with the parse error / first-failed-file string.

**Architecture:** A single new pure-React hook (`apps/atlas-web/lib/canvas/useReloadOnApplied.ts`) reads Plan E.0's `useEventStream()` context, watches for `sandbox.apply.completed` events, and folds them into three pieces of derived state: a `cacheBuster: string` (incremented on debounced success), a `toast: string | null` (set immediately on failure), and a `manualReload: () => void` callback that bypasses the debounce and updates `cacheBuster` directly with `String(Date.now())`. The existing `HmrIframe` component (`apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx`) consumes the hook, computes `iframe.src = base + (base.includes("?") ? "&" : "?") + "atlas-reload=" + cacheBuster`, renders the toast above the iframe when present, and renders the "Reload preview" button styled to match the existing `ViewportToggle`. The hook is the entire unit of testability — the component just renders the iframe with the computed src and wires the button onClick to `manualReload`.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Next.js 15 app router · React 19 (`useEffect`, `useState`, `useCallback`, `useRef`) · Vitest 2.x + `@testing-library/react@16` + `@testing-library/user-event@14` · Playwright 1.x (existing real-stack scaffold from Plan D) · zero new npm dependencies.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan E.0 merged on `main` — see `docs/superpowers/plans/2026-04-28-plan-e0-event-broker-sse.md`. Specifically: `apps/atlas-web/lib/events/EventBroker.ts` exports `RitualEvent` and the `RitualEventType` union (which includes the literal `"sandbox.apply.completed"`); `apps/atlas-web/lib/events/EventSourceProvider.tsx` exports `EventSourceProvider` and a no-args `useEventStream()` returning `{ events, status, lastEventId }`; `apps/atlas-web/lib/feature-flags.ts` exports `isFeatureEnabled` and registers `"live-events"` mapped to `ATLAS_LIVE_EVENTS`.
- Plans A/B/C/D merged on `main` — `HmrIframe.tsx`, `ViewportToggle.tsx`, `CanvasPreviewClient.tsx`, the `/canvas` page, `startRitual` server action, and the Plan D real-stack E2E scaffold (`apps/atlas-web/e2e/tests/plan-d-real-stack.spec.ts`) all already exist. `RitualSnapshot.sandboxApplyResult` is populated with `{ ok, parseError?, files: [{ path, status, reason? }] }` after a successful Plan C apply.
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` workspace packages keep their `.js` suffix as before; this rule applies only to atlas-web internal imports.
- `pnpm install` clean — Plan F adds no new deps; tests reuse the existing `@testing-library/react` + `vitest` jsdom environment configured in `apps/atlas-web/vitest.config.ts` (already mocks `iframe-resizer` from Plan C).

**Branch:** `plan-f/preview-reload` cut from `main`. Final task in this plan merges the branch back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
apps/atlas-web/
  lib/
    canvas/
      useReloadOnApplied.ts                                  # NEW: hook reading useEventStream → { cacheBuster, toast, manualReload }
  app/
    projects/
      [projectId]/
        canvas/
          _components/
            HmrIframe.tsx                                    # MODIFIED: consume hook, append atlas-reload=, render toast + Reload button
  test/
    lib/
      canvas/
        useReloadOnApplied.test.tsx                          # NEW: ~7 cases (debounce, coalesce, failure toast, manual, flag-off)
    HmrIframe.test.tsx                                       # MODIFIED: extend with 3 new cases (cacheBuster src, manual click, failure toast)
  e2e/
    tests/
      plan-f-preview-reload.spec.ts                          # NEW: 2 specs (auto-reload after apply; manual reload button cache-busts)
```

**Why this shape.** The hook lives in `lib/canvas/` (not `lib/events/` or `lib/ritual/`) because it is canvas-specific — its single consumer is `HmrIframe`, and naming the directory after the consumer makes the dependency obvious to future readers. The file is `.ts`, not `.tsx`, because it has zero JSX — every visual decision belongs to the component. The `HmrIframe.tsx` change keeps the file under 100 lines: a small block of new state-and-derived-src logic at the top, an unchanged iframe-resizer effect, an unchanged skeleton branch, and a single new wrapping `<div>` that hosts the iframe + the toast + the button. We extend the existing `HmrIframe.test.tsx` rather than creating a new one because the test surface is "the same component, with new props/behaviour" — splitting into two files would force readers to grep for related cases. The e2e spec lives in its own file (not appended to `plan-d-real-stack.spec.ts`) so it can be skipped independently when only the unit suite is being run.

---

## Design Decisions

These resolve the implementation-level questions left implicit in the spec.

1. **Hook return shape: `{ cacheBuster: string, toast: string | null, manualReload: () => void }`.** Three fields, no extras. `cacheBuster` starts as `""` (the empty string — falsy but valid for string concatenation) so the iframe's first paint uses the bare `previewUrl` with no `atlas-reload` query param at all. After the first successful apply, the field becomes the event id (a non-empty string from Plan E.0's `${projectId}:${counter}` format), and the iframe is forced to reload because `src` has changed. `toast` is `null` until a failure event arrives, then becomes the failure string, and resets to `null` on the next *successful* apply (so a user who sees a failure, fixes the prompt, and re-runs sees the toast clear automatically). `manualReload` is a `useCallback` whose identity is stable across renders (so passing it to `onClick` does not trigger child re-renders).
2. **Debounce window: 500ms, single trailing edge.** The hook keeps a `setTimeout` ref. Each `sandbox.apply.completed` event with `payload.ok === true` cancels the pending timer and reschedules it for 500ms in the future; the timer's callback is what writes the new `cacheBuster`. Three events in 200ms → only one cacheBuster update. Documented with a JSDoc comment on the `DEBOUNCE_MS` constant inside the hook file.
3. **Failure handling is *not* debounced.** Failures matter immediately — the user wants to see the toast the instant the apply failed. The hook updates `toast` synchronously inside its effect for any `payload.ok === false` event. The toast text is `payload.parseError` if a string, else `"Last apply failed: <first-failed-file-path>"` derived from `payload.files.find(f => f.status === "failed")?.path`, else the literal `"Last apply failed."` as a final fallback. Documented with a comment block above the toast-derivation helper.
4. **Manual reload bypasses the debounce *and* the SSE path entirely.** `manualReload` calls `setCacheBuster(String(Date.now()))` directly — no timer, no event read. This is what makes the button work when the flag is OFF (the hook's effect never fires; `setCacheBuster` is just React state). It also ensures the button is a true escape hatch when SSE is down or stalled — the user can always force a reload.
5. **Event detection: scan the entire `events` array on each change, but only fire on the newly-arrived tail.** The hook keeps a `processedCountRef` (number of events already processed). On every render, if `events.length > processedCountRef.current`, slice the new events, fold them through the success/failure logic, then advance the ref. This handles both the initial events backlog (replayed from broker on subscribe) and the live-streaming case with one code path. A test asserts that re-renders without new events do not re-trigger the toast or schedule a debounce timer.
6. **`cacheBuster` query param key is `atlas-reload`.** A namespaced key avoids colliding with any param the user's preview app cares about. Spec line 147 mandates this exact key. Documented as a constant `RELOAD_PARAM = "atlas-reload"` at the top of the hook file (re-imported by the test for assertion-string stability).
7. **`HmrIframe` src derivation lives in the component, not the hook.** The hook does not know the `previewUrl`. The component computes `src = previewUrl ? previewUrl + (previewUrl.includes("?") ? "&" : "?") + "atlas-reload=" + cacheBuster : undefined` only when `cacheBuster !== ""`. When `cacheBuster === ""` (no reload yet triggered), the iframe uses `previewUrl` verbatim. This keeps the hook reusable in any context (Plan G's RailShell could subscribe to it for telemetry) and keeps the URL-mutation behaviour close to the iframe element.
8. **Toast styling: small, red, above the iframe, with `role="alert"`.** Reuse the existing `bg-red-50 / text-red-700 / border-red-200` palette from `CanvasPreviewClient.tsx`'s preview-error panel for visual consistency. The toast is a plain `<div role="alert" data-testid="preview-reload-toast">` — no auto-dismiss timer (it clears on the next successful apply, or on the user clicking manual reload).
9. **"Reload preview" button: a plain `<button type="button">` next to the iframe (rendered inside `HmrIframe`'s wrapper).** It does NOT live in `ViewportToggle.tsx`. Reasoning: `ViewportToggle` is rendered by `CanvasPreviewClient`, not `HmrIframe`, and the button's behaviour is tightly coupled to the iframe instance. Putting the button in `HmrIframe` keeps the cache-bust logic and the trigger-element in one file. The button is styled to *match* `ViewportToggle`'s button styling (`rounded px-3 py-1 text-sm`) so the two read as a coherent toolbar even though they live in separate components. A `data-testid="preview-reload-button"` makes it easy for unit + e2e tests to target it.
10. **Failure toast does NOT change the iframe `src`.** When `toast` becomes non-null, `cacheBuster` stays at its previous value. The iframe is still showing whatever the last successful apply produced (or the initial `previewUrl`). This is the single most important behavioural guarantee in the plan — never paint over a working preview with a broken page. A dedicated test asserts this invariant.
11. **Flag-OFF behaviour is implicit, not a special-case branch.** When `ATLAS_LIVE_EVENTS` is OFF, Plan E.0's `EventSourceProvider` returns the disabled context value (`{ events: [], status: "disabled", lastEventId: null }`). The hook reads `events` and finds an empty array, so its effect runs, processes zero events, and does nothing. `cacheBuster` stays `""`, `toast` stays `null`, `manualReload` is exactly the same `setState`-bound callback as the flag-on path. No `if (flagEnabled)` branch is needed inside the hook — the empty `events` array IS the no-op. A test asserts this end-to-end against a mock provider returning the disabled context value.

---

## Task List (10 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit.

---

### Task 1: Cut the branch + scaffold the lib/canvas + test/lib/canvas directories

**Files:**
- Create: `apps/atlas-web/lib/canvas/.gitkeep`
- Create: `apps/atlas-web/test/lib/canvas/.gitkeep`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-f/preview-reload
```

Expected: `Switched to a new branch 'plan-f/preview-reload'`.

- [ ] **Step 2: Verify Plan E.0 is on main**

```bash
ls apps/atlas-web/lib/events/EventBroker.ts apps/atlas-web/lib/events/EventSourceProvider.tsx
git log --oneline main -- apps/atlas-web/lib/events/EventSourceProvider.tsx | head -3
```

Expected: both files listed without error AND at least one commit referencing `EventSourceProvider`. If either file is missing, STOP — Plan E.0 has not yet shipped and this plan cannot proceed.

- [ ] **Step 3: Create the two empty directories with `.gitkeep`**

```bash
mkdir -p apps/atlas-web/lib/canvas apps/atlas-web/test/lib/canvas
touch apps/atlas-web/lib/canvas/.gitkeep apps/atlas-web/test/lib/canvas/.gitkeep
```

Expected: `apps/atlas-web/lib/canvas/.gitkeep` and `apps/atlas-web/test/lib/canvas/.gitkeep` exist.

- [ ] **Step 4: Commit the scaffolding**

```bash
git add apps/atlas-web/lib/canvas/.gitkeep apps/atlas-web/test/lib/canvas/.gitkeep
git commit -m "chore(atlas-web): scaffold lib/canvas + test/lib/canvas for plan F"
```

---

### Task 2: `useReloadOnApplied` — return shape + initial state (no event handling yet)

**Files:**
- Create: `apps/atlas-web/lib/canvas/useReloadOnApplied.ts`
- Create: `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`

- [ ] **Step 1: Write the failing test (return shape + initial values)**

`apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Plan F's hook reads useEventStream() — mock it for unit tests.
// Each test sets the return value before calling renderHook.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: vi.fn(() => ({ events: [], status: "disabled", lastEventId: null }))
}));

import { useReloadOnApplied, RELOAD_PARAM } from "@/lib/canvas/useReloadOnApplied";
import { useEventStream } from "@/lib/events/EventSourceProvider";

describe("useReloadOnApplied — return shape and initial values", () => {
  it("RELOAD_PARAM is the literal 'atlas-reload' (per spec line 147)", () => {
    expect(RELOAD_PARAM).toBe("atlas-reload");
  });

  it("returns { cacheBuster: '', toast: null, manualReload: function } on first render with no events", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    expect(result.current.cacheBuster).toBe("");
    expect(result.current.toast).toBeNull();
    expect(typeof result.current.manualReload).toBe("function");
  });

  it("manualReload identity is stable across re-renders (useCallback)", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));
    const first = result.current.manualReload;
    rerender();
    expect(result.current.manualReload).toBe(first);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: 3 fails — `Cannot find module '@/lib/canvas/useReloadOnApplied'`.

- [ ] **Step 3: Write the minimal hook**

`apps/atlas-web/lib/canvas/useReloadOnApplied.ts`:

```typescript
"use client";

import { useCallback, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

/** Query-string key used to bust the iframe's HTTP cache. Namespaced so it
 *  cannot collide with a query param the user's preview app cares about.
 *  Mandated by spec line 147 of 2026-04-28-live-events-and-preview-reload-design.md. */
export const RELOAD_PARAM = "atlas-reload";

export interface ReloadOnAppliedValue {
  /** Empty string before the first reload trigger; non-empty after a
   *  successful apply (debounced) or a manualReload() call. The component
   *  decides whether to append `?atlas-reload=<value>` based on whether
   *  this is empty. */
  cacheBuster: string;
  /** Non-null only when the most recent apply failed. Cleared on the
   *  next successful apply. Component renders this as a small red toast
   *  above the iframe. */
  toast: string | null;
  /** Stable callback (useCallback). Updates cacheBuster immediately to
   *  String(Date.now()) — bypasses the debounce path AND works when
   *  ATLAS_LIVE_EVENTS is OFF (the hook never reads events to fire it). */
  manualReload: () => void;
}

/** useReloadOnApplied — folds Plan E.0's broker stream into the three
 *  pieces of state HmrIframe needs to auto-reload on successful apply
 *  and surface a toast on failure.
 *
 *  See the plan's Design Decisions section for the rationale behind
 *  every behavioural choice (debounce window, failure not debounced,
 *  manual bypassing SSE entirely, etc.).
 */
export function useReloadOnApplied(_projectId: string): ReloadOnAppliedValue {
  // Subscribe to the SSE context. When the flag is OFF, this returns
  // { events: [], status: "disabled", ... } so the hook is a literal no-op.
  useEventStream();

  const [cacheBuster, setCacheBuster] = useState<string>("");
  const [toast] = useState<string | null>(null);

  const manualReload = useCallback(() => {
    setCacheBuster(String(Date.now()));
  }, []);

  return { cacheBuster, toast, manualReload };
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/canvas/useReloadOnApplied.ts apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx
git commit -m "feat(atlas-web): useReloadOnApplied hook — return shape + manualReload (plan F)"
```

---

### Task 3: `useReloadOnApplied` — debounce 500ms on successful apply

**Files:**
- Modify: `apps/atlas-web/lib/canvas/useReloadOnApplied.ts`
- Modify: `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`:

```typescript
import type { RitualEvent } from "@/lib/events/EventBroker";

function applyCompleted(id: string, ok: boolean, extra: Record<string, unknown> = {}): RitualEvent {
  return {
    id,
    projectId: "proj-1",
    ritualId: "r-1",
    type: "sandbox.apply.completed",
    payload: { ok, ...extra },
    ts: Date.now()
  };
}

describe("useReloadOnApplied — debounced success", () => {
  it("ok:true event updates cacheBuster after 500ms debounce", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: evts.at(-1)?.id ?? null
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));
      expect(result.current.cacheBuster).toBe("");

      // Push one ok:true event into the mock stream + rerender so the hook sees it.
      evts.push(applyCompleted("proj-1:1", true));
      rerender();

      // Before the debounce fires, cacheBuster has NOT yet updated.
      expect(result.current.cacheBuster).toBe("");

      // Advance to just before the threshold — still empty.
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(result.current.cacheBuster).toBe("");

      // Cross the threshold — cacheBuster now equals the event id.
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.cacheBuster).toBe("proj-1:1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("3 ok:true events within 500ms coalesce into ONE cacheBuster update (debounce)", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: evts.at(-1)?.id ?? null
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

      // Three rapid events — each one resets the debounce timer.
      evts.push(applyCompleted("proj-1:1", true)); rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      evts.push(applyCompleted("proj-1:2", true)); rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      evts.push(applyCompleted("proj-1:3", true)); rerender();

      // Only 200ms have elapsed since the last event — still no update.
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(result.current.cacheBuster).toBe("");

      // Cross the 500ms threshold from the LAST event — single update with the
      // newest event id (the coalesced one).
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.cacheBuster).toBe("proj-1:3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-rendering with the SAME events array does NOT re-trigger the debounce timer", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [applyCompleted("proj-1:1", true)];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: "proj-1:1"
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

      // Fire the initial debounce.
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(result.current.cacheBuster).toBe("proj-1:1");

      // Re-render multiple times with no new events. cacheBuster must not change.
      rerender(); rerender(); rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.cacheBuster).toBe("proj-1:1");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run tests; expect 3 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: the 3 new tests fail (assertions on `cacheBuster` after debounce — currently nothing ever updates it from events).

- [ ] **Step 3: Add the event-folding effect to the hook**

Replace the body of `apps/atlas-web/lib/canvas/useReloadOnApplied.ts` with:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { RitualEvent } from "@/lib/events/EventBroker";

/** Query-string key used to bust the iframe's HTTP cache. Namespaced so it
 *  cannot collide with a query param the user's preview app cares about.
 *  Mandated by spec line 147 of 2026-04-28-live-events-and-preview-reload-design.md. */
export const RELOAD_PARAM = "atlas-reload";

/** Debounce window for successful applies. A burst of N apply.completed
 *  events within this window coalesces into ONE iframe reload — chosen
 *  empirically: under 500ms the iframe sees too many redundant reloads;
 *  over 500ms the user starts to feel the lag. */
const DEBOUNCE_MS = 500;

export interface ReloadOnAppliedValue {
  cacheBuster: string;
  toast: string | null;
  manualReload: () => void;
}

export function useReloadOnApplied(_projectId: string): ReloadOnAppliedValue {
  const { events } = useEventStream();

  const [cacheBuster, setCacheBuster] = useState<string>("");
  const [toast, _setToast] = useState<string | null>(null);

  // Tracks how many events from the cumulative `events` array we have
  // already folded into our state. Re-renders without new events are
  // a no-op (start === events.length means the slice is empty).
  const processedCountRef = useRef<number>(0);
  // The pending debounce timer. We cancel-and-reschedule on every new
  // success event so a burst coalesces into one trailing reload.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The id of the most recent ok:true event in the current debounce
  // window. The timer's callback writes this into cacheBuster.
  const pendingEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (events.length <= processedCountRef.current) return;

    const newEvents = events.slice(processedCountRef.current);
    processedCountRef.current = events.length;

    for (const ev of newEvents) {
      if (!isApplyCompleted(ev)) continue;
      const ok = (ev.payload as { ok?: unknown }).ok === true;
      if (ok) {
        // Schedule (or reschedule) the debounced cacheBuster update.
        pendingEventIdRef.current = ev.id;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          const id = pendingEventIdRef.current;
          if (id !== null) setCacheBuster(id);
          debounceTimerRef.current = null;
          pendingEventIdRef.current = null;
        }, DEBOUNCE_MS);
      }
    }
  }, [events]);

  // Unmount cleanup — clear any pending debounce so it does not fire after
  // the consumer has gone away.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const manualReload = useCallback(() => {
    setCacheBuster(String(Date.now()));
  }, []);

  return { cacheBuster, toast, manualReload };
}

function isApplyCompleted(ev: RitualEvent): boolean {
  return ev.type === "sandbox.apply.completed";
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: 6 tests pass (3 from Task 2 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/canvas/useReloadOnApplied.ts apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx
git commit -m "feat(atlas-web): useReloadOnApplied debounces ok:true sandbox.apply.completed (plan F)"
```

---

### Task 4: `useReloadOnApplied` — failure events surface toast, do NOT reload

**Files:**
- Modify: `apps/atlas-web/lib/canvas/useReloadOnApplied.ts`
- Modify: `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`:

```typescript
describe("useReloadOnApplied — failure surfaces toast, never reloads", () => {
  it("ok:false with a parseError string sets toast to that string", async () => {
    const evts: RitualEvent[] = [];
    (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      events: [...evts],
      status: "open",
      lastEventId: evts.at(-1)?.id ?? null
    }));

    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

    evts.push(applyCompleted("proj-1:1", false, { parseError: "Could not parse diff at line 4" }));
    rerender();

    expect(result.current.toast).toBe("Could not parse diff at line 4");
    expect(result.current.cacheBuster).toBe(""); // never updated on failure
  });

  it("ok:false with no parseError but a failed file falls back to 'Last apply failed: <path>'", async () => {
    const evts: RitualEvent[] = [];
    (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      events: [...evts],
      status: "open",
      lastEventId: evts.at(-1)?.id ?? null
    }));

    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

    evts.push(applyCompleted("proj-1:1", false, {
      files: [
        { path: "src/ok.ts", status: "written" },
        { path: "src/broken.ts", status: "failed", reason: "hunk did not apply" }
      ]
    }));
    rerender();

    expect(result.current.toast).toBe("Last apply failed: src/broken.ts");
    expect(result.current.cacheBuster).toBe("");
  });

  it("ok:false with neither parseError nor failed files falls back to literal 'Last apply failed.'", async () => {
    const evts: RitualEvent[] = [];
    (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      events: [...evts],
      status: "open",
      lastEventId: evts.at(-1)?.id ?? null
    }));

    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

    evts.push(applyCompleted("proj-1:1", false, {}));
    rerender();

    expect(result.current.toast).toBe("Last apply failed.");
    expect(result.current.cacheBuster).toBe("");
  });

  it("a successful apply AFTER a failure clears the toast", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: evts.at(-1)?.id ?? null
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

      evts.push(applyCompleted("proj-1:1", false, { parseError: "boom" }));
      rerender();
      expect(result.current.toast).toBe("boom");

      evts.push(applyCompleted("proj-1:2", true));
      rerender();
      // Toast clears synchronously (the success arrival is the trigger);
      // cacheBuster updates after the debounce.
      expect(result.current.toast).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(result.current.cacheBuster).toBe("proj-1:2");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run tests; expect 4 fails**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: 4 new tests fail (the hook does not yet derive `toast` from events).

- [ ] **Step 3: Extend the hook with toast derivation**

Edit `apps/atlas-web/lib/canvas/useReloadOnApplied.ts`. Replace the `const [toast, _setToast] = useState<string | null>(null);` line with the active state (rename `_setToast` to `setToast`) and replace the body of the `useEffect(() => { ... }, [events])` with the version below that handles both success and failure branches. The full file becomes:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { RitualEvent } from "@/lib/events/EventBroker";

/** Query-string key used to bust the iframe's HTTP cache. Namespaced so it
 *  cannot collide with a query param the user's preview app cares about.
 *  Mandated by spec line 147 of 2026-04-28-live-events-and-preview-reload-design.md. */
export const RELOAD_PARAM = "atlas-reload";

/** Debounce window for successful applies. A burst of N apply.completed
 *  events within this window coalesces into ONE iframe reload — chosen
 *  empirically: under 500ms the iframe sees too many redundant reloads;
 *  over 500ms the user starts to feel the lag. */
const DEBOUNCE_MS = 500;

export interface ReloadOnAppliedValue {
  cacheBuster: string;
  toast: string | null;
  manualReload: () => void;
}

export function useReloadOnApplied(_projectId: string): ReloadOnAppliedValue {
  const { events } = useEventStream();

  const [cacheBuster, setCacheBuster] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  const processedCountRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (events.length <= processedCountRef.current) return;

    const newEvents = events.slice(processedCountRef.current);
    processedCountRef.current = events.length;

    for (const ev of newEvents) {
      if (!isApplyCompleted(ev)) continue;
      const ok = (ev.payload as { ok?: unknown }).ok === true;
      if (ok) {
        // Success: clear any prior failure toast immediately + schedule a
        // debounced cacheBuster update. Burst-coalescing comes from
        // cancel-and-reschedule.
        setToast(null);
        pendingEventIdRef.current = ev.id;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          const id = pendingEventIdRef.current;
          if (id !== null) setCacheBuster(id);
          debounceTimerRef.current = null;
          pendingEventIdRef.current = null;
        }, DEBOUNCE_MS);
      } else {
        // Failure: surface the toast NOW (no debounce — the user wants to
        // see the failure immediately) and CRUCIALLY do not touch
        // cacheBuster, so the iframe keeps showing the last working page.
        setToast(deriveToastText(ev.payload));
      }
    }
  }, [events]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const manualReload = useCallback(() => {
    setCacheBuster(String(Date.now()));
  }, []);

  return { cacheBuster, toast, manualReload };
}

function isApplyCompleted(ev: RitualEvent): boolean {
  return ev.type === "sandbox.apply.completed";
}

/** Pick the most-informative human-readable string from an ok:false
 *  apply payload. Order: parseError (set when the diff itself was
 *  malformed), then "Last apply failed: <first-failed-file-path>" (set
 *  when one or more file ops failed during apply), then a flat
 *  "Last apply failed." fallback so the toast is never an empty string. */
function deriveToastText(payload: Record<string, unknown>): string {
  const parseError = payload.parseError;
  if (typeof parseError === "string" && parseError.length > 0) return parseError;
  const files = payload.files;
  if (Array.isArray(files)) {
    const failed = files.find(
      (f): f is { path: string; status: string } =>
        typeof f === "object" && f !== null &&
        typeof (f as { path?: unknown }).path === "string" &&
        (f as { status?: unknown }).status === "failed"
    );
    if (failed) return `Last apply failed: ${failed.path}`;
  }
  return "Last apply failed.";
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: 10 tests pass (6 from Tasks 2-3 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/canvas/useReloadOnApplied.ts apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx
git commit -m "feat(atlas-web): useReloadOnApplied surfaces failure toast without reloading (plan F)"
```

---

### Task 5: `useReloadOnApplied` — manual reload bypasses debounce; flag-OFF still works

**Files:**
- Modify: `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx`:

```typescript
describe("useReloadOnApplied — manualReload (bypasses debounce, works with flag OFF)", () => {
  it("manualReload() updates cacheBuster immediately to a Date.now() string (no debounce)", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });

    const beforeNow = Date.now();
    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    expect(result.current.cacheBuster).toBe("");

    act(() => { result.current.manualReload(); });

    const afterNow = Date.now();
    expect(result.current.cacheBuster).not.toBe("");
    const parsed = Number(result.current.cacheBuster);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(beforeNow);
    expect(parsed).toBeLessThanOrEqual(afterNow);
  });

  it("calling manualReload twice produces two distinct cacheBuster values (each click re-busts)", async () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });

    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    act(() => { result.current.manualReload(); });
    const first = result.current.cacheBuster;
    // Real clock advances even on a fast machine; await one macrotask so Date.now() ticks.
    await new Promise((r) => setTimeout(r, 5));
    act(() => { result.current.manualReload(); });
    expect(result.current.cacheBuster).not.toBe(first);
  });

  it("flag OFF (events array empty, status='disabled'): hook is a no-op for SSE; manualReload still updates cacheBuster", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [],            // disabled provider returns empty
      status: "disabled",
      lastEventId: null
    });

    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    expect(result.current.cacheBuster).toBe("");
    expect(result.current.toast).toBeNull();

    act(() => { result.current.manualReload(); });
    expect(result.current.cacheBuster).not.toBe("");
  });
});
```

- [ ] **Step 2: Run tests; expect pass without code changes**

```bash
cd apps/atlas-web && pnpm test test/lib/canvas/useReloadOnApplied.test.tsx
```

Expected: 13 tests pass — the hook implementation from Tasks 2-4 already covers manual reload + flag-OFF (the empty `events` array IS the no-op).

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/lib/canvas/useReloadOnApplied.test.tsx
git commit -m "test(atlas-web): useReloadOnApplied manualReload + flag-OFF behavioural lock (plan F)"
```

---

### Task 6: Modify `HmrIframe.tsx` — consume hook + append `atlas-reload=` to src

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx`
- Modify: `apps/atlas-web/test/HmrIframe.test.tsx`

- [ ] **Step 1: Append the failing test**

First, update the imports + module mocks at the top of `apps/atlas-web/test/HmrIframe.test.tsx`. The current top of the file is:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HmrIframe } from "../app/projects/[projectId]/canvas/_components/HmrIframe";

// iframe-resizer is a DOM-side library; mock it in the test environment
vi.mock("iframe-resizer", () => ({
  iframeResize: vi.fn(),
}));
```

Replace ONLY the import lines and append a second `vi.mock` for the EventSourceProvider — the existing `iframe-resizer` mock stays exactly as-is. (`userEvent` is added now too because Task 7 will need it; importing it now keeps the top of the file tidy.) The result must be:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HmrIframe } from "../app/projects/[projectId]/canvas/_components/HmrIframe";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { RitualEvent } from "@/lib/events/EventBroker";

// iframe-resizer is a DOM-side library; mock it in the test environment
vi.mock("iframe-resizer", () => ({
  iframeResize: vi.fn(),
}));

// Plan F: HmrIframe consumes useReloadOnApplied which reads useEventStream.
// Each test sets the return value via mockReturnValue / mockImplementation.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: vi.fn(() => ({ events: [], status: "disabled", lastEventId: null }))
}));
```

Then append the new tests below the existing 3 cases:

```typescript

function applyOk(id: string): RitualEvent {
  return {
    id,
    projectId: "proj-1",
    ritualId: "r-1",
    type: "sandbox.apply.completed",
    payload: { ok: true },
    ts: Date.now()
  };
}

describe("HmrIframe — projectId prop + cache-buster src wiring", () => {
  it("renders with no atlas-reload query param when cacheBuster is empty (no reload triggered yet)", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.src).not.toContain("atlas-reload=");
  });

  it("after an ok:true event + 500ms debounce, iframe.src contains atlas-reload=<eventId>", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts], status: "open", lastEventId: evts.at(-1)?.id ?? null
      }));

      const { rerender } = render(
        <HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />
      );

      evts.push(applyOk("proj-1:42"));
      rerender(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });

      const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
      expect(iframe.src).toContain("atlas-reload=proj-1%3A42"); // ":" is URL-encoded by the browser
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends with '&' when previewUrl already contains a '?'", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts], status: "open", lastEventId: evts.at(-1)?.id ?? null
      }));

      const { rerender } = render(
        <HmrIframe src="https://3000-sbx.e2b.app/?foo=bar" title="Live preview" projectId="proj-1" />
      );

      evts.push(applyOk("proj-1:1"));
      rerender(<HmrIframe src="https://3000-sbx.e2b.app/?foo=bar" title="Live preview" projectId="proj-1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });

      const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
      expect(iframe.src).toContain("foo=bar&atlas-reload=");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run tests; expect 3 fails**

```bash
cd apps/atlas-web && pnpm test test/HmrIframe.test.tsx
```

Expected: 3 new tests fail. The first existing-test still passes (no projectId prop yet, so TypeScript will complain — the new test's call sites pass `projectId="proj-1"` which the component does not yet accept; also, the iframe `src` does not yet append the cache-buster). Some failures may show as TypeScript errors in the test output — that is expected.

- [ ] **Step 3: Modify `HmrIframe.tsx`**

Replace `apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx` with:

```typescript
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useReloadOnApplied, RELOAD_PARAM } from "@/lib/canvas/useReloadOnApplied";

interface HmrIframeProps {
  src: string | undefined;
  title: string;
  /** Project id used to scope the SSE subscription via Plan E.0's
   *  EventSourceProvider context. The provider itself is mounted by a
   *  parent (Plan G's RailShell, or a temporary host until Plan G ships);
   *  this component just consumes the context. */
  projectId: string;
  onLoad?: () => void;
  className?: string;
}

export function HmrIframe({ src, title, projectId, onLoad, className }: HmrIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { cacheBuster, toast, manualReload } = useReloadOnApplied(projectId);

  // Compute the effective src — append `?atlas-reload=<value>` (or `&...`
  // when the URL already has a query string) once cacheBuster is non-empty.
  // While cacheBuster === "" (no reload has been triggered yet), the iframe
  // uses the bare previewUrl so the first paint is identical to today's
  // pre-Plan-F behaviour.
  const effectiveSrc = useMemo(() => {
    if (!src) return undefined;
    if (cacheBuster === "") return src;
    const sep = src.includes("?") ? "&" : "?";
    return `${src}${sep}${RELOAD_PARAM}=${encodeURIComponent(cacheBuster)}`;
  }, [src, cacheBuster]);

  useEffect(() => {
    if (!iframeRef.current || !effectiveSrc) return;
    // Dynamically import iframe-resizer to avoid SSR issues
    import("iframe-resizer").then(({ iframeResize }) => {
      if (iframeRef.current) {
        iframeResize({ log: false, checkOrigin: false }, iframeRef.current);
      }
    });
  }, [effectiveSrc]);

  if (!src) {
    return (
      <div
        data-testid="hmr-iframe-skeleton"
        className="animate-pulse bg-muted rounded-lg w-full h-full min-h-[400px]"
        aria-label="Sandbox preview loading"
      />
    );
  }

  return (
    <div className="relative flex flex-col h-full">
      {toast !== null && (
        <div
          role="alert"
          data-testid="preview-reload-toast"
          className="m-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {toast}
        </div>
      )}
      <div className="flex justify-end px-2 py-1">
        <button
          type="button"
          data-testid="preview-reload-button"
          onClick={manualReload}
          className="rounded px-3 py-1 text-sm font-medium border text-muted-foreground hover:bg-muted"
        >
          Reload preview
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={effectiveSrc}
        title={title}
        onLoad={onLoad}
        className={className ?? "w-full h-full border-0 rounded-lg flex-1"}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
```

- [ ] **Step 4: Update the existing tests in `HmrIframe.test.tsx` to pass `projectId`**

The three existing tests (from Plan C) call `<HmrIframe src=... title=... />` without `projectId`. With the new required prop, they will fail TypeScript. Edit each one to add `projectId="proj-1"`. The existing tests are at lines 12-37 of the file; change:

```typescript
// Test 1: "renders an iframe with the provided src"
<HmrIframe src="https://3000-sbx_abc.e2b.app" title="Live preview" projectId="proj-1" />

// Test 2: "renders a skeleton placeholder when src is undefined"
<HmrIframe src={undefined} title="Live preview" projectId="proj-1" />

// Test 3: "calls onLoad callback when iframe fires load event"
<HmrIframe src="https://3000-sbx_abc.e2b.app" title="Live preview" onLoad={onLoad} projectId="proj-1" />
```

- [ ] **Step 5: Run tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/HmrIframe.test.tsx
```

Expected: 6 tests pass (3 original updated + 3 new).

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx apps/atlas-web/test/HmrIframe.test.tsx
git commit -m "feat(atlas-web): HmrIframe wires useReloadOnApplied + atlas-reload= cache-buster (plan F)"
```

---

### Task 7: `HmrIframe.tsx` — manual reload button cache-busts; failure toast renders without reloading

**Files:**
- Modify: `apps/atlas-web/test/HmrIframe.test.tsx`

- [ ] **Step 1: Append the failing tests**

Append to `apps/atlas-web/test/HmrIframe.test.tsx` (the `userEvent` import was already added in Task 6 Step 1; do not import it again):

```typescript
describe("HmrIframe — manual Reload preview button", () => {
  it("renders a 'Reload preview' button with data-testid='preview-reload-button'", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
    const button = screen.getByTestId("preview-reload-button");
    expect(button).toBeTruthy();
    expect(button.textContent).toBe("Reload preview");
  });

  it("clicking 'Reload preview' immediately mutates iframe.src to include atlas-reload=", async () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    const user = userEvent.setup();
    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
    const iframeBefore = screen.getByTitle("Live preview") as HTMLIFrameElement;
    const srcBefore = iframeBefore.src;
    expect(srcBefore).not.toContain("atlas-reload=");

    await user.click(screen.getByTestId("preview-reload-button"));

    const iframeAfter = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframeAfter.src).toContain("atlas-reload=");
    expect(iframeAfter.src).not.toBe(srcBefore);
  });

  it("manual button works when flag is OFF (events empty + status='disabled')", async () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    const user = userEvent.setup();
    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
    await user.click(screen.getByTestId("preview-reload-button"));
    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.src).toContain("atlas-reload=");
  });
});

describe("HmrIframe — failure toast renders, iframe src does NOT change", () => {
  it("ok:false event with parseError renders a toast above the iframe AND leaves iframe.src untouched", () => {
    const failure: RitualEvent = {
      id: "proj-1:9",
      projectId: "proj-1",
      ritualId: "r-1",
      type: "sandbox.apply.completed",
      payload: { ok: false, parseError: "Could not parse diff at line 4" },
      ts: Date.now()
    };
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [failure], status: "open", lastEventId: failure.id
    });

    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);

    const toast = screen.getByTestId("preview-reload-toast");
    expect(toast.textContent).toBe("Could not parse diff at line 4");
    expect(toast.getAttribute("role")).toBe("alert");

    const iframe = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(iframe.src).not.toContain("atlas-reload=");
  });

  it("toast is NOT rendered when there is no failure event", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    render(<HmrIframe src="https://3000-sbx.e2b.app" title="Live preview" projectId="proj-1" />);
    expect(screen.queryByTestId("preview-reload-toast")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests; expect pass without code changes**

```bash
cd apps/atlas-web && pnpm test test/HmrIframe.test.tsx
```

Expected: 11 tests pass (6 from Task 6 + 5 new). The component changes from Task 6 already cover the button click + toast rendering — these tests lock the contract in.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/HmrIframe.test.tsx
git commit -m "test(atlas-web): HmrIframe manual-button + failure-toast invariants (plan F)"
```

---

### Task 8: Update `CanvasPreviewClient.tsx` — pass `projectId` down to `HmrIframe`

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx`
- Modify: `apps/atlas-web/test/components/CanvasPreviewClient.test.tsx`

- [ ] **Step 1: Write the failing test**

The existing `CanvasPreviewClient.test.tsx` already passes `projectId` as a prop (it's required by `CanvasPreviewClientProps`). Append a new test that asserts the prop is forwarded into `HmrIframe`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: vi.fn(() => ({ events: [], status: "disabled", lastEventId: null }))
}));
vi.mock("iframe-resizer", () => ({ iframeResize: vi.fn() }));

import { CanvasPreviewClient } from "../../app/projects/[projectId]/canvas/_components/CanvasPreviewClient";

describe("CanvasPreviewClient — forwards projectId to HmrIframe (plan F wiring)", () => {
  it("passes projectId so HmrIframe can subscribe to the SSE stream", () => {
    render(
      <CanvasPreviewClient
        projectId="proj-from-parent"
        sandboxId="sbx-1"
        previewUrl="https://3000-sbx.e2b.app"
      />
    );
    // The Reload button is rendered by HmrIframe — its presence confirms
    // HmrIframe mounted, and HmrIframe requires projectId to mount (TS-checked).
    expect(screen.getByTestId("preview-reload-button")).toBeTruthy();
  });
});
```

If a `CanvasPreviewClient.test.tsx` already exists with similar setup, append the new `describe` block to that file instead of creating a new one. Check first:

```bash
ls apps/atlas-web/test/components/CanvasPreviewClient.test.tsx 2>/dev/null && echo "EXISTS — append the new describe block"
```

- [ ] **Step 2: Run the test; expect a fail (HmrIframe not yet receiving projectId)**

```bash
cd apps/atlas-web && pnpm test test/components/CanvasPreviewClient.test.tsx
```

Expected: the new test fails with a TypeScript error — `HmrIframe` requires `projectId` and `CanvasPreviewClient` does not currently pass it.

- [ ] **Step 3: Modify `CanvasPreviewClient.tsx`**

Edit `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx` — change the single `<HmrIframe ... />` element on line 49 to pass `projectId`:

```typescript
<HmrIframe src={previewUrl} title="Live preview" projectId={projectId} />
```

The full file context is unchanged elsewhere — only that one prop is added.

- [ ] **Step 4: Run the CanvasPreviewClient tests; expect pass**

```bash
cd apps/atlas-web && pnpm test test/components/CanvasPreviewClient.test.tsx
```

Expected: every test in the file passes (existing tests + the new "forwards projectId" assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx apps/atlas-web/test/components/CanvasPreviewClient.test.tsx
git commit -m "feat(atlas-web): CanvasPreviewClient forwards projectId to HmrIframe (plan F)"
```

---

### Task 9: E2E spec — auto-reload after apply + manual reload button cache-busts

**Files:**
- Create: `apps/atlas-web/e2e/tests/plan-f-preview-reload.spec.ts`

- [ ] **Step 1: Write the e2e spec**

`apps/atlas-web/e2e/tests/plan-f-preview-reload.spec.ts`:

```typescript
// Plan F real-stack E2E. Extends the Plan D real-stack pattern.
//
// Stack: live atlas-web (port 3000, started with ATLAS_LIVE_EVENTS=true)
//        → real Postgres (port 5440) → real Claude proxy (port 3456)
//        → real E2B sandbox → real Clerk dev tenant.
//
// Run:
//   ATLAS_LIVE_EVENTS=true pnpm --filter atlas-web dev   # in another terminal
//   pnpm --filter atlas-web test:e2e plan-f-preview-reload.spec.ts
//
// Required env (loaded from apps/atlas-web/.env.local automatically):
//   - CLERK_SECRET_KEY              (provisions test users via Clerk admin)
//   - ATLAS_TEST_PASSWORD           (password for test users)
//   - ATLAS_LLM_BASE_URL            (Claude proxy at :3456)
//   - E2B_API_KEY                   (sandbox provisioning)
//   - ATLAS_DEFAULT_SANDBOX_TEMPLATE (the operator's E2B template)
//   - ATLAS_LIVE_EVENTS=true         (the dev server MUST be started with this)
//
// Wall time: ~4-6 minutes (architect+developer chain is the long pole).

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

// =====================================================================
// Spec 1: iframe auto-reloads after a developer diff applies
// =====================================================================
test.describe("plan-f real stack: preview auto-reload after apply", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("iframe src acquires atlas-reload=<id> after the sandbox apply succeeds", async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    requireAuthState();
    if (process.env.ATLAS_LIVE_EVENTS !== "true") {
      test.skip(true, "ATLAS_LIVE_EVENTS must be true on the dev server for this spec");
    }
    await openCanvasOnFreshProject(page);

    // Capture the iframe src BEFORE submitting the prompt.
    const iframe = page.locator("iframe[title='Live preview']");
    await expect(iframe).toBeVisible({ timeout: 60_000 });
    const srcBefore = await iframe.getAttribute("src");
    expect(srcBefore).toBeTruthy();
    expect(srcBefore!).not.toContain("atlas-reload=");

    // Drive the same prompt the Plan D specs use — proven to apply within ~240s.
    await page.getByPlaceholder(/Describe your change/i).fill(
      "add a /hello page that returns plain text 'Hello from Atlas'"
    );
    await page.getByRole("button", { name: /Send/i }).click();

    // Wait for the apply to land. The sandbox-apply-status panel proves the
    // backend wrote files; the iframe reload follows within ~500ms (debounce).
    const apply = page.getByTestId("sandbox-apply-status");
    await expect(apply).toBeVisible({ timeout: 300_000 });

    // Poll the iframe src for up to 5s after the apply panel renders. The
    // SSE event publishes within ~50ms of apply completion + a 500ms debounce
    // = ~600ms upper bound; 5s is generous.
    await expect.poll(
      async () => (await iframe.getAttribute("src")) ?? "",
      { timeout: 5_000, message: "iframe src never acquired atlas-reload= after apply" }
    ).toContain("atlas-reload=");

    const srcAfter = await iframe.getAttribute("src");
    expect(srcAfter).not.toBe(srcBefore);

    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach("after-auto-reload.png", { body: screenshot, contentType: "image/png" });
  });
});

// =====================================================================
// Spec 2: manual "Reload preview" button cache-busts immediately
// =====================================================================
test.describe("plan-f real stack: manual reload button", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("clicking 'Reload preview' mutates iframe.src to a new atlas-reload value", async ({ page }) => {
    test.setTimeout(120_000);
    requireAuthState();
    await openCanvasOnFreshProject(page);

    const iframe = page.locator("iframe[title='Live preview']");
    await expect(iframe).toBeVisible({ timeout: 60_000 });

    // Click manual reload — works regardless of whether ATLAS_LIVE_EVENTS is on.
    const button = page.getByTestId("preview-reload-button");
    await expect(button).toBeVisible();
    await button.click();

    await expect.poll(
      async () => (await iframe.getAttribute("src")) ?? "",
      { timeout: 5_000, message: "iframe src never acquired atlas-reload= after manual click" }
    ).toContain("atlas-reload=");

    const srcFirst = await iframe.getAttribute("src");

    // Click again — the cache-buster value must change (Date.now() advances).
    await new Promise((r) => setTimeout(r, 50));
    await button.click();

    await expect.poll(
      async () => (await iframe.getAttribute("src")) ?? "",
      { timeout: 5_000, message: "iframe src did not change on second manual click" }
    ).not.toBe(srcFirst);
  });
});

// =====================================================================
// Helper: navigate to a fresh project's canvas. Copied verbatim from
// plan-d-real-stack.spec.ts — keeping spec files self-contained so they
// can run independently.
// =====================================================================
async function openCanvasOnFreshProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: /new project/i }).click();
  await page.waitForURL("**/projects/new");
  const projectName = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.getByLabel(/name|project/i).first().fill(projectName);
  await page.getByRole("button", { name: /create|continue|start/i }).first().click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
}
```

- [ ] **Step 2: Smoke-check the spec compiles (no run — needs full live stack)**

```bash
cd apps/atlas-web && pnpm typecheck 2>&1 | grep -E "plan-f-preview-reload" || echo "no errors in plan-f spec"
```

Expected output: `no errors in plan-f spec`. If any line referencing `plan-f-preview-reload.spec.ts` is printed, fix the type error before committing — do not skip.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/e2e/tests/plan-f-preview-reload.spec.ts
git commit -m "test(atlas-web): plan-f e2e — auto-reload after apply + manual button cache-bust"
```

---

### Task 10: Final verification + merge to main

**Files:**
- (no code changes — git operation + full-suite verification)

- [ ] **Step 1: Run the full atlas-web test suite**

```bash
cd apps/atlas-web && pnpm test
```

Expected: every test passes including the new ones from Tasks 2-7. If any test fails, FIX the underlying cause before merging — do not skip or ignore.

- [ ] **Step 2: Run typecheck and lint**

```bash
cd apps/atlas-web && pnpm typecheck && pnpm lint
```

Expected: both clean (zero errors). If either reports new errors traceable to this branch, fix them before merging.

- [ ] **Step 3: Verify the branch is N commits ahead of main and CI-clean**

```bash
git log --oneline main..HEAD
```

Expected: 9 commits on the branch (one per Tasks 1-9; Task 10 is the merge itself).

- [ ] **Step 4: Push the branch to origin**

```bash
git push -u origin plan-f/preview-reload
```

Expected: push succeeds; branch tracking established.

- [ ] **Step 5: Open the PR for human review**

```bash
gh pr create --title "Plan F: preview auto-reload + manual reload button" --body "$(cat <<'EOF'
## Summary
- Adds `lib/canvas/useReloadOnApplied.ts` — a pure-React hook that reads Plan E.0's `useEventStream()`, debounces successful `sandbox.apply.completed` events at 500ms, surfaces failure events as a toast string, and exposes a `manualReload()` callback that bypasses the debounce.
- Modifies `HmrIframe.tsx` to consume the hook, append `?atlas-reload=<eventId>` (or `&...`) to the iframe `src`, render a small red toast above the iframe on failure, and render a "Reload preview" button styled to match `ViewportToggle`.
- Adds 13 unit tests for the hook (debounce, coalesce, failure derivation, manual bypass, flag-OFF) + 8 new tests for `HmrIframe` (cacheBuster src wiring, manual click, toast rendering).
- Adds 2 Playwright real-stack specs (auto-reload after apply; manual button cache-busts) extending the Plan D pattern.

Flag-OFF behavioural lock: `useEventStream()` returns the disabled context value (`events: []`); the hook processes zero events; manual button still works (it never reads `events`). Verified by a dedicated test.

The iframe never reloads on a failed apply — the user keeps seeing whatever the last successful apply rendered, with the failure surfaced as a toast.

## Test plan
- [x] Unit: 13 new hook tests + 8 new HmrIframe tests
- [x] Existing HmrIframe tests updated to pass the new required `projectId` prop
- [x] CanvasPreviewClient updated to forward `projectId` into HmrIframe (1 new test asserts the wiring)
- [x] E2E: 2 new real-stack specs (auto-reload + manual button)
- [x] `pnpm test` green for atlas-web
- [x] `pnpm typecheck` green
- [x] `pnpm lint` green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 6: After human approval + green CI, merge to main**

```bash
gh pr merge --merge --delete-branch
```

Expected: branch merged into `main`; remote branch deleted; local branch can be deleted with `git checkout main && git branch -d plan-f/preview-reload`.

---

## Self-Review

### 1. Spec coverage

Walked through `docs/superpowers/specs/2026-04-28-live-events-and-preview-reload-design.md` Plan F scope (lines 141-150 + relevant file structure + relevant testing):

| Spec requirement | Task |
|---|---|
| New hook `apps/atlas-web/lib/canvas/useReloadOnApplied.ts` reading `EventSourceProvider` context (line 144-145) | Tasks 2, 3, 4 |
| Debounce 500ms on `sandbox.apply.completed` ok:true → cacheBuster update (line 146) | Task 3 |
| Cache-buster format `iframe.src = base + (base.includes("?") ? "&" : "?") + "atlas-reload=" + eventId` (line 146) | Task 6 |
| `payload.ok === false`: toast `"Last apply failed: <parseError or first-failed-file>"`, no reload (line 147) | Task 4 (hook), Task 7 (component) |
| "Reload preview" button next to viewport toggle, manual cache-bust path with `Date.now()` (line 148) | Tasks 5 (hook), 6 (component button), 7 (button tests) |
| Debounce coalesces a burst into one reload (line 149) | Task 3 (3-events-in-200ms test) |
| Modify `HmrIframe.tsx` to consume hook (line 142, scope statement) | Task 6 |
| Hook returns `{ cacheBuster, toast, manualReload }` (scope statement) | Task 2 (initial shape), 3-4 (full behaviour) |
| Manual reload always works even when `featureFlags.liveEvents === false` (scope statement) | Task 5 (flag-OFF test), Task 7 (button-works-flag-OFF test) |
| Don't reload on failed apply (scope statement, "robust day one") | Task 4 (hook never sets cacheBuster on failure), Task 7 (asserts iframe.src unchanged on failure) |
| `useReloadOnApplied.test.tsx` covers all 5 scenarios in the inputs | Tasks 2, 3, 4, 5 |
| `HmrIframe.test.tsx` extended: cacheBuster updates iframe src, manual button cache-busts, failure renders toast without changing src | Task 6 (3 tests) + Task 7 (5 tests) |
| E2E spec extending Plan D real-stack pattern: auto-reload after apply + manual button cache-busts | Task 9 |

All Plan F spec items are covered. Out-of-scope items NOT touched by this plan: `ChatPanel.tsx`, `RitualTimeline.tsx`, `app/projects/[projectId]/layout.tsx`, anything outside `apps/atlas-web/app/projects/[projectId]/canvas/_components/` or `apps/atlas-web/lib/canvas/` (verified — only `CanvasPreviewClient.tsx` is touched in Task 8 to forward the `projectId` prop, and that file IS inside `_components/`).

### 2. Placeholder scan

Scanned for: TBD, TODO, "implement later", "fill in details", "appropriate error handling", "add validation", "Similar to Task N", references to undefined symbols.

- No `TBD` / `TODO` / `implement later` strings introduced.
- No "Similar to Task N" — every task contains the full code block.
- No undefined symbols: `RELOAD_PARAM`, `useReloadOnApplied`, `ReloadOnAppliedValue` defined in Task 2; debounce-related refs and `DEBOUNCE_MS` defined in Task 3; `deriveToastText` defined in Task 4. The hook depends on `useEventStream` (Plan E.0 Task 10) and `RitualEvent` (Plan E.0 Task 2) — both verified to exist on `main` per the Step-2 guard in Task 1.
- The `HmrIframe.tsx` component depends on `useReloadOnApplied` from `@/lib/canvas/useReloadOnApplied` — defined in Tasks 2-4 of THIS plan (must be merged before Task 6 begins, which is the natural task order).
- `iframe-resizer` is a pre-existing dep (used in the un-modified iframe-resizer effect block); not a new symbol.
- `userEvent` import in Task 7 — `@testing-library/user-event` is already in the workspace devDependencies (the existing `ChatPanel.test.tsx` and `ApprovalPanel.test.tsx` import it).
- `vi.useFakeTimers` / `vi.advanceTimersByTimeAsync` — standard Vitest 2.x APIs, available in the existing test environment.

### 3. Type consistency

- `useReloadOnApplied(projectId: string): ReloadOnAppliedValue` — same signature in Tasks 2, 3, 4, 5 (hook file) and consumed identically in Task 6 (`HmrIframe`). The `_projectId` parameter prefix is intentional inside the hook body — it documents that the prop is required for future use (e.g., resubscription on project change once Plan E.0's provider is mounted higher in the tree) but is not currently read. The argument is *passed* by the caller.
- `ReloadOnAppliedValue` shape `{ cacheBuster: string; toast: string | null; manualReload: () => void }` — defined once in Task 2, consumed identically in Task 6 (component destructures all three).
- `RELOAD_PARAM` constant value `"atlas-reload"` — defined in Task 2, asserted in Task 2's first test, used by Task 6's component, used in Task 6's iframe-src tests, used in Task 7's tests (via the rendered iframe.src), referenced literally in Task 9's e2e spec (`atlas-reload=`).
- `DEBOUNCE_MS` constant value `500` — defined in Task 3, asserted via the `499` / `500` boundary test in Task 3, referenced in Task 6's iframe-src test (`vi.advanceTimersByTimeAsync(500)`).
- `RitualEvent` shape (`{ id, projectId, ritualId, type, payload, ts }`) — same 6 fields in every test helper (`applyCompleted` in Tasks 3-4, `applyOk` in Task 6, the failure literal in Task 7). Matches Plan E.0 Task 2's exported `RitualEvent` interface exactly.
- `useEventStream()` return shape `{ events: RitualEvent[]; status: EventStreamStatus; lastEventId: string | null }` — used identically across every test that mocks the provider. Matches Plan E.0 Task 10's exported `EventStreamValue`.
- `HmrIframe` props add `projectId: string` (required) — Task 6 introduces, Task 6 Step 4 updates the 3 existing tests to pass it, Task 8 updates the only other call site (`CanvasPreviewClient`) to pass it.
- The toast text strings in Task 4's `deriveToastText` (`"Last apply failed: <path>"`, `"Last apply failed."`) match exactly the strings asserted in Tasks 4 (hook tests) and 7 (component tests).

All consistent — no fixes needed.

---

### Critical Files for Implementation

- F:\claude\ai_builder\apps\atlas-web\lib\canvas\useReloadOnApplied.ts (Tasks 2-4 — the entire unit of testability; the component just renders)
- F:\claude\ai_builder\apps\atlas-web\app\projects\[projectId]\canvas\_components\HmrIframe.tsx (Task 6 — consumes the hook, computes the cache-busted src, renders toast + button)
- F:\claude\ai_builder\apps\atlas-web\app\projects\[projectId]\canvas\_components\CanvasPreviewClient.tsx (Task 8 — one-line change to forward `projectId`)
- F:\claude\ai_builder\apps\atlas-web\test\HmrIframe.test.tsx (Tasks 6-7 — extended; locks the iframe-src + button + toast contracts)
- F:\claude\ai_builder\apps\atlas-web\test\lib\canvas\useReloadOnApplied.test.tsx (Tasks 2-5 — 13 tests covering every behavioural decision in the Design Decisions section)
- F:\claude\ai_builder\apps\atlas-web\e2e\tests\plan-f-preview-reload.spec.ts (Task 9 — real-stack proof; auto-reload + manual button)
