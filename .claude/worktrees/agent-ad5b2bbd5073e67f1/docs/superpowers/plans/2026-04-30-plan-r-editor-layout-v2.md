# Plan R — Two-Zone Editor Shell + Always-On Status Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the project editor's fixed-ratio rail-plus-canvas grid with a two-zone resizable shell (chat zone + preview zone, drag-resizable, both collapsible), add a 32px always-on `<RitualStatusStrip>` so visibility-of-system-status survives panel collapse, and apply Vercel/Geist visual language (Geist Sans + Mono, status-only color palette, strict 8px grid). Ship behind a single new feature flag `ATLAS_EDITOR_LAYOUT_V2` whose flag-off path is byte-for-byte today's behaviour.

**Architecture:** Two new client components — `<RitualStatusStrip>` (subscribes to `useEventStream()` and renders a one-line phase + duration banner) and `<EditorShell>` (wraps `<RailShell>` and the page's children with `react-resizable-panels` + a `useEditorLayoutPersistence` hook backed by `localStorage`). One existing component edit — `<RitualTimeline>` gets a `<details>` collapsible wrapper that auto-collapses on first `sandbox.apply.completed`. One existing component edit — `<CanvasPreviewClient>`'s toolbar swaps to a Geist-styled segmented control plus reload + open-in-new-tab buttons. `<ProjectLayout>` branches on `isFeatureEnabled("editor-layout-v2")`: flag-on, it mounts the strip + shell; flag-off, today's exact tree renders unchanged. The `geist` npm package supplies Sans + Mono fonts via the existing root layout.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Next.js 15 app router · React 19 · Tailwind CSS · `react-resizable-panels` 2.x (Vercel-maintained, ~10kb gz) · `geist` 1.x (Vercel-published font package) · Vitest 2.x + `@testing-library/react`.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan E.0 + Plan G + Plan F merged on `main` — specifically: `apps/atlas-web/lib/events/EventSourceProvider.tsx` exports `useEventStream()`, `apps/atlas-web/components/shell/RailShell.tsx` exists, `apps/atlas-web/components/ritual/RitualTimeline.tsx` exists. (All shipped in this codebase as of 2026-04-30.)
- Recent commit `89d2fe4` ("broker maps architect/developer events so rail rows light up") — the timeline must actually transition to keep the spec's guarantee that the strip + collapsed-timeline combo conveys real state.
- `apps/atlas-web/.env.local` populated with `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_*` so the dev server boots; the new flag is added in this plan.
- `pnpm` 9 installed at the repo root; this plan adds two npm dependencies via `pnpm -F atlas-web add`.

**Branch:** `plan-r/editor-layout-v2` cut from `main`. Final task in this plan merges back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
apps/atlas-web/
  package.json                                              # MODIFIED: add `react-resizable-panels` + `geist` deps
  lib/
    feature-flags.ts                                        # MODIFIED: add "editor-layout-v2" to FeatureFlag union + ATLAS_EDITOR_LAYOUT_V2 env
    editor-layout/
      use-editor-layout-persistence.ts                      # NEW: localStorage hook for {leftWidthPct, leftCollapsed, rightCollapsed}
  components/
    ritual/
      RitualStatusStrip.tsx                                 # NEW: 32px always-on Geist Mono strip
      RitualTimeline.tsx                                    # MODIFIED: wrap rows in <details> that auto-collapses on sandbox.apply.completed
    shell/
      EditorShell.tsx                                       # NEW: react-resizable-panels wrapper around RailShell + page children
  app/
    layout.tsx                                              # MODIFIED: import GeistSans + GeistMono, attach as className
    projects/
      [projectId]/
        layout.tsx                                          # MODIFIED: branch on editor-layout-v2 — mount strip + shell when on
        canvas/
          _components/
            CanvasPreviewClient.tsx                         # MODIFIED: refresh toolbar — segmented control + ↻ + ⤢, drop "Share" button position
            CanvasPreviewToolbar.tsx                        # NEW: extracted toolbar component (test-friendly)
            EmptyPreviewBackdrop.tsx                        # NEW: dotted-grid backdrop for "no sandbox URL yet" state
  test/
    components/
      ritual/
        RitualStatusStrip.test.tsx                          # NEW: ~6 cases (idle, active, auto-fix, escalated, disconnected, failed)
        RitualTimeline-collapse.test.tsx                    # NEW: 3 cases (default open; auto-close on sandbox.apply.completed; user-toggle persists in session)
      shell/
        EditorShell.test.tsx                                # NEW: ~5 cases (default split, drag persists, collapse, restore, SSR-safe defaults)
      canvas/
        CanvasPreviewToolbar.test.tsx                       # NEW: 3 cases (segmented control, reload click, open-in-new-tab)
        EmptyPreviewBackdrop.test.tsx                       # NEW: 1 case (renders dotted grid + status text)
    lib/
      editor-layout/
        use-editor-layout-persistence.test.ts              # NEW: ~4 cases (defaults, write+read roundtrip, clamp out-of-range, missing localStorage)
    app/
      projects/
        layout-flag-r-branch.test.tsx                       # NEW: 3 cases (flag off → today's DOM byte-for-byte; flag on → strip + shell mounted)
```

**Why this shape.** `lib/editor-layout/` is a new namespace because the persistence hook + future expansion (per-tab state, named layouts) belong together; isolating it from `lib/events/` keeps the SSR-safety reasoning local. `RitualStatusStrip.tsx` lives in `components/ritual/` next to `RitualTimeline.tsx` because they share the same data source (`useEventStream`) and a future maintainer should see them as a pair. `EditorShell.tsx` joins `RailShell.tsx` in `components/shell/` because both are layout-shell concerns. `CanvasPreviewToolbar.tsx` extraction lets the toolbar be unit-tested without the iframe; `EmptyPreviewBackdrop.tsx` is similarly extracted so the empty state is testable independently. The flag-OFF behavioural lock (`layout-flag-r-branch.test.tsx`) is the FIRST test to land per the Plan E.0 pattern — establishes a red-line that catches accidental scope creep into the flag-OFF path.

---

## Design Decisions

These resolve the implementation-level questions left implicit in the spec.

1. **Library: `react-resizable-panels` v2.x.** Vercel-maintained, ~10kb gz, used by v0 and shadcn. Headless / unstyled (we own the chrome). Exports `<PanelGroup direction="horizontal">`, `<Panel>`, `<PanelResizeHandle>`. Persistence is handled OUTSIDE the library by our own hook (the library's built-in `autoSaveId` cookie path is incompatible with Next.js SSR and would fight our localStorage scheme).

2. **Persistence key shape: `atlas:editorLayout:<projectId>`.** One JSON blob per project: `{ leftWidthPct: number, leftCollapsed: boolean, rightCollapsed: boolean }`. Per-project so each project remembers its own layout. SSR: server renders defaults (35% / 65%, neither collapsed); the hook hydrates client-side via `useEffect` and re-renders. No flash of wrong layout because the hydrated render is identical when the persisted value equals defaults; for non-default values, a brief layout shift on first paint is acceptable (no blocking work).

3. **Geist font integration via the official `geist` npm package.** Two named exports: `GeistSans` and `GeistMono`. Each carries a `.variable` CSS var name we attach to `<html>` via `className`. We then expose them as Tailwind utility families (`font-sans`, `font-mono`) by extending `tailwind.config.ts` (already present in atlas-web). The strip + ritual ID rows + segmented control labels use `font-mono`; everything else is `font-sans`.

4. **`<RitualStatusStrip>` event derivation.** Subscribes to `useEventStream()` (returns `{ events, status, lastEventId }`). Folds the events array into the latest active phase using a small reducer that mirrors the timelineReducer's transitions. If `status === "error"`, render `Disconnected · retrying` in amber (no animation). If no `ritual.started` has fired, render `Idle · ready` in slate. If a `ritual.escalation_requested` is the most recent terminal event, render `Escalated · <gateName> · click to expand` in red. Otherwise render `<phase> · <duration>s` where `<phase>` is the active row from the reducer.

5. **`<RitualTimeline>` collapsible behavior.** Wrap the existing `<section data-testid="ritual-timeline">` body in a `<details>` element. `open` is controlled by a new piece of state managed by `useTimelineCollapse(projectId)` (sessionStorage-backed; defaults to `true`). The hook flips `open` to `false` on first observed `sandbox.apply.completed` event for a given session. User toggles persist in sessionStorage so a manual expand sticks until the next session.

6. **Empty preview backdrop.** When `previewUrl` is undefined OR the iframe has not yet emitted `onLoad`, render `<EmptyPreviewBackdrop status={...} />`. Background is `bg-[radial-gradient(circle,_var(--tw-gradient-stops))] from-slate-200 to-transparent bg-[length:16px_16px]` — a dotted-grid pattern that matches Vercel dashboards. Foreground is a single Geist Mono line: `provisioning sandbox · ~5s` or `sandbox ready · waiting for first diff` etc. Status text comes from `previewError ?? "provisioning sandbox · ~5s"`.

7. **Flag-OFF behavioural lock.** First test that lands. Renders `<ProjectLayout>` with `editor-layout-v2` flag mocked to `false`, then asserts the rendered DOM matches today's Plan G shape exactly (no `<RitualStatusStrip>`, no `<EditorShell>`, no `react-resizable-panels` markers). Uses `aria-hidden="true"` selectors to verify NEW chrome is absent, plus a snapshot of the top-level child structure to catch accidental added wrappers.

8. **No client-side flag flip mid-session.** Same convention as `live-events`: read at SSR time, requires server restart to flip. Tests mock the flag via `vi.mock("@/lib/feature-flags")`.

9. **No new server state.** The persistence hook touches `localStorage` and `sessionStorage` only. Server actions, SSE, broker, all unchanged.

10. **Spec-graph canvas relocation.** This plan does NOT delete `<CanvasClient>` (the spec-graph editor) — it remains rendered inside `app/projects/[projectId]/canvas/page.tsx`. Behind the new flag, `<EditorShell>` slots `{children}` into the right panel as a whole, so the canvas page's existing layout (preview + canvas + zoom controls) ends up inside the right zone unchanged. A follow-up plan will move the spec-graph to its own route; this plan keeps it where it is to limit blast radius.

---

## Task List (12 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit. Each task is independently committable and reviewable.

---

### Task 1: Cut branch, add deps, add `editor-layout-v2` flag

**Files:**
- Create: `(branch)`
- Modify: `apps/atlas-web/package.json`
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Test: `apps/atlas-web/test/lib/feature-flags-editor-layout.test.ts` (NEW)

- [ ] **Step 1: Cut the branch from main**

```bash
cd /f/claude/ai_builder
git checkout main
git pull
git checkout -b plan-r/editor-layout-v2
```

- [ ] **Step 2: Add the npm deps**

Run from repo root:

```bash
pnpm -F atlas-web add react-resizable-panels@^2.1.7 geist@^1.3.1
```

Expected: `package.json` gains the two entries under `dependencies`; `pnpm-lock.yaml` updates. No code wired yet.

- [ ] **Step 3: Write the failing flag test**

Create `apps/atlas-web/test/lib/feature-flags-editor-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isFeatureEnabled } from "@/lib/feature-flags";

describe("editor-layout-v2 feature flag", () => {
  const src = (env: Record<string, string | undefined>) => ({
    readEnv: (n: string) => env[n]
  });

  it("defaults to OFF when ATLAS_EDITOR_LAYOUT_V2 is unset", () => {
    expect(isFeatureEnabled("editor-layout-v2", src({}))).toBe(false);
  });

  it("returns true for truthy env values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isFeatureEnabled("editor-layout-v2", src({ ATLAS_EDITOR_LAYOUT_V2: v }))).toBe(true);
    }
  });

  it("returns false for falsy env values", () => {
    for (const v of ["0", "false", "no", "off", ""]) {
      expect(isFeatureEnabled("editor-layout-v2", src({ ATLAS_EDITOR_LAYOUT_V2: v }))).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd /f/claude/ai_builder/apps/atlas-web
pnpm vitest run test/lib/feature-flags-editor-layout.test.ts
```

Expected: TypeScript error — `"editor-layout-v2"` is not in the `FeatureFlag` union.

- [ ] **Step 5: Add the flag to the union + env map**

Modify `apps/atlas-web/lib/feature-flags.ts`:

Add to the `FeatureFlag` union (right after `"demo-mode"`):

```ts
  | "editor-layout-v2";
```

Add to the `FLAG_TO_ENV` map (right after the `"demo-mode"` entry):

```ts
  // Plan R — editor layout v2 (two-zone resizable shell + status strip).
  "editor-layout-v2": "ATLAS_EDITOR_LAYOUT_V2"
```

Add to the `listFlagStates` return object (right after `"demo-mode"`):

```ts
    "editor-layout-v2": isFeatureEnabled("editor-layout-v2", source)
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm vitest run test/lib/feature-flags-editor-layout.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/package.json apps/atlas-web/pnpm-lock.yaml apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags-editor-layout.test.ts
git commit -m "chore(atlas-web): add editor-layout-v2 flag + react-resizable-panels + geist deps (plan R)"
```

---

### Task 2: Land the flag-OFF behavioural lock test (RED-FIRST DISCIPLINE)

This task lands the safety net before any new component exists. It must pass green against today's `<ProjectLayout>` (which doesn't know about the flag yet) — proving today's DOM is what we want to preserve.

**Files:**
- Test: `apps/atlas-web/test/app/projects/layout-flag-r-branch.test.tsx` (NEW)

- [ ] **Step 1: Write the lock test**

Create `apps/atlas-web/test/app/projects/layout-flag-r-branch.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Mock heavy server-only deps so the layout can render in jsdom.
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
  currentUser: vi.fn().mockResolvedValue({ publicMetadata: {} })
}));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: class { async getOverride() { return undefined; } }
}));
vi.mock("pg", () => ({ Pool: class {} }));
vi.mock("@/lib/events/EventSourceProvider", () => ({
  EventSourceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));
vi.mock("@/components/shell/RailShell", () => ({
  RailShell: () => <aside data-testid="rail-shell">RailShell stub</aside>
}));

const flagState = { "editor-layout-v2": false, "live-events": true, "multi-turn": false };
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (name: string) => flagState[name as keyof typeof flagState] ?? false
}));

import ProjectLayout from "@/app/projects/[projectId]/layout";

async function renderLayout() {
  const tree = await ProjectLayout({
    children: <div data-testid="page-children">page</div>,
    params: Promise.resolve({ projectId: "p-1" })
  });
  return render(tree as React.ReactElement);
}

describe("ProjectLayout — Plan R flag-OFF behavioural lock", () => {
  beforeEach(() => { cleanup(); flagState["editor-layout-v2"] = false; });

  it("renders today's exact tree when editor-layout-v2 is OFF", async () => {
    await renderLayout();
    // Today's Plan G shape: top nav + RailShell + main with children
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByTestId("rail-shell")).toBeInTheDocument();
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
    // Plan R additions MUST NOT be present
    expect(screen.queryByTestId("ritual-status-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-shell-handle")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it — should pass green against today's layout**

```bash
cd /f/claude/ai_builder/apps/atlas-web
pnpm vitest run test/app/projects/layout-flag-r-branch.test.tsx
```

Expected: 1 test passes. (The lock works: today's DOM matches the assertions, and the not-yet-built strip/shell test-ids are correctly absent.)

- [ ] **Step 3: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/test/app/projects/layout-flag-r-branch.test.tsx
git commit -m "test(atlas-web): flag-OFF behavioural lock for plan R (preserves today's DOM)"
```

---

### Task 3: Geist font integration in root layout

**Files:**
- Modify: `apps/atlas-web/app/layout.tsx`
- Modify: `apps/atlas-web/tailwind.config.ts`
- Test: (manual — visual)

- [ ] **Step 1: Read current root layout to understand its shape**

Run:

```bash
cat /f/claude/ai_builder/apps/atlas-web/app/layout.tsx
```

Note the `<html>` and `<body>` tags and any existing className.

- [ ] **Step 2: Add Geist imports + className**

Modify `apps/atlas-web/app/layout.tsx`. At the top, add:

```ts
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
```

On the root `<html>` element (or `<body>`, whichever today carries `className`), add the variable classes. If today's tag is e.g. `<html lang="en">`, change it to:

```tsx
<html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
```

- [ ] **Step 3: Tell Tailwind about the variables**

Modify `apps/atlas-web/tailwind.config.ts`. In the `theme.extend` block, add:

```ts
fontFamily: {
  sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
  mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"]
},
```

- [ ] **Step 4: Verify no regressions in existing tests**

```bash
cd /f/claude/ai_builder/apps/atlas-web
pnpm vitest run
```

Expected: all existing tests still pass (the font change is build-time only).

- [ ] **Step 5: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/app/layout.tsx apps/atlas-web/tailwind.config.ts
git commit -m "feat(atlas-web): integrate geist font (sans + mono) at root layout (plan R)"
```

---

### Task 4: `useEditorLayoutPersistence` hook

**Files:**
- Create: `apps/atlas-web/lib/editor-layout/use-editor-layout-persistence.ts`
- Test: `apps/atlas-web/test/lib/editor-layout/use-editor-layout-persistence.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/editor-layout/use-editor-layout-persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorLayoutPersistence, DEFAULT_LAYOUT } from "@/lib/editor-layout/use-editor-layout-persistence";

describe("useEditorLayoutPersistence", () => {
  beforeEach(() => { localStorage.clear(); });

  it("returns DEFAULT_LAYOUT when nothing persisted", () => {
    const { result } = renderHook(() => useEditorLayoutPersistence("p-1"));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("write + read roundtrip per projectId", () => {
    const { result } = renderHook(() => useEditorLayoutPersistence("p-1"));
    act(() => {
      result.current.setLayout({ leftWidthPct: 40, leftCollapsed: false, rightCollapsed: false });
    });
    const { result: r2 } = renderHook(() => useEditorLayoutPersistence("p-1"));
    expect(r2.current.layout.leftWidthPct).toBe(40);
  });

  it("clamps leftWidthPct to [15, 85]", () => {
    localStorage.setItem("atlas:editorLayout:p-2", JSON.stringify({ leftWidthPct: 5, leftCollapsed: false, rightCollapsed: false }));
    const { result } = renderHook(() => useEditorLayoutPersistence("p-2"));
    expect(result.current.layout.leftWidthPct).toBe(15);

    localStorage.setItem("atlas:editorLayout:p-3", JSON.stringify({ leftWidthPct: 99, leftCollapsed: false, rightCollapsed: false }));
    const { result: r3 } = renderHook(() => useEditorLayoutPersistence("p-3"));
    expect(r3.current.layout.leftWidthPct).toBe(85);
  });

  it("returns defaults when localStorage value is malformed JSON", () => {
    localStorage.setItem("atlas:editorLayout:p-4", "{not json}");
    const { result } = renderHook(() => useEditorLayoutPersistence("p-4"));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /f/claude/ai_builder/apps/atlas-web
pnpm vitest run test/lib/editor-layout/use-editor-layout-persistence.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the hook**

Create `apps/atlas-web/lib/editor-layout/use-editor-layout-persistence.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

export interface EditorLayout {
  /** 15..85, percentage of horizontal space taken by the chat zone. */
  leftWidthPct: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const DEFAULT_LAYOUT: EditorLayout = Object.freeze({
  leftWidthPct: 35,
  leftCollapsed: false,
  rightCollapsed: false
});

const KEY_PREFIX = "atlas:editorLayout:";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function readPersisted(projectId: string): EditorLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + projectId);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<EditorLayout>;
    return {
      leftWidthPct: clamp(Number(parsed.leftWidthPct ?? DEFAULT_LAYOUT.leftWidthPct), 15, 85),
      leftCollapsed: Boolean(parsed.leftCollapsed ?? false),
      rightCollapsed: Boolean(parsed.rightCollapsed ?? false)
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useEditorLayoutPersistence(projectId: string) {
  // SSR-safe initial state — server renders defaults, client hydrates real value.
  const [layout, setLayoutState] = useState<EditorLayout>(DEFAULT_LAYOUT);

  // Hydrate from localStorage after mount.
  useEffect(() => {
    setLayoutState(readPersisted(projectId));
  }, [projectId]);

  const setLayout = useCallback(
    (next: EditorLayout) => {
      const sanitized: EditorLayout = {
        leftWidthPct: clamp(next.leftWidthPct, 15, 85),
        leftCollapsed: Boolean(next.leftCollapsed),
        rightCollapsed: Boolean(next.rightCollapsed)
      };
      setLayoutState(sanitized);
      try {
        window.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(sanitized));
      } catch {
        /* localStorage full / disabled — drop persistence; runtime state still valid */
      }
    },
    [projectId]
  );

  return { layout, setLayout };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run test/lib/editor-layout/use-editor-layout-persistence.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/lib/editor-layout/ apps/atlas-web/test/lib/editor-layout/
git commit -m "feat(atlas-web): useEditorLayoutPersistence hook for plan R (localStorage backed)"
```

---

### Task 5: `<RitualStatusStrip>` component

**Files:**
- Create: `apps/atlas-web/components/ritual/RitualStatusStrip.tsx`
- Test: `apps/atlas-web/test/components/ritual/RitualStatusStrip.test.tsx` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/ritual/RitualStatusStrip.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Drive the strip via a programmable mock of useEventStream.
const streamState = {
  events: [] as Array<{ id: string; type: string; payload: Record<string, unknown>; ts: number; projectId: string; ritualId: string }>,
  status: "open" as "open" | "error" | "disabled" | "connecting" | "closed",
  lastEventId: null as string | null
};
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => streamState
}));

import { RitualStatusStrip } from "@/components/ritual/RitualStatusStrip";

beforeEach(() => {
  cleanup();
  streamState.events = [];
  streamState.status = "open";
});

const evt = (type: string, payload: Record<string, unknown> = {}, ts = 1_000) => ({
  id: `e-${ts}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("RitualStatusStrip", () => {
  it("renders 'Idle · ready' when no ritual events have arrived", () => {
    render(<RitualStatusStrip />);
    expect(screen.getByTestId("ritual-status-strip").textContent).toMatch(/idle/i);
  });

  it("renders the active phase + duration when a role is in flight", () => {
    streamState.events = [
      evt("ritual.started", {}, 1_000),
      evt("role.started", { role: "developer" }, 2_000)
    ];
    render(<RitualStatusStrip nowMs={() => 5_000} />);
    const text = screen.getByTestId("ritual-status-strip").textContent ?? "";
    expect(text.toLowerCase()).toContain("developer");
    expect(text).toMatch(/3s|3\s*s/);
  });

  it("prefixes 'Auto-fix #N · ' when an auto_fix.attempted event has fired", () => {
    streamState.events = [
      evt("ritual.started", {}, 1_000),
      evt("auto_fix.attempted", {}, 1_500),
      evt("role.started", { role: "developer" }, 2_000)
    ];
    render(<RitualStatusStrip nowMs={() => 5_000} />);
    expect(screen.getByTestId("ritual-status-strip").textContent).toMatch(/auto-fix #1/i);
  });

  it("renders 'Escalated · …' in red on ritual.escalation_requested", () => {
    streamState.events = [
      evt("ritual.started", {}, 1_000),
      evt("ritual.escalation_requested", { reason: "accessibility" }, 3_000)
    ];
    render(<RitualStatusStrip nowMs={() => 4_000} />);
    const strip = screen.getByTestId("ritual-status-strip");
    expect(strip.textContent).toMatch(/escalated/i);
    expect(strip.className).toMatch(/red/);
  });

  it("renders 'Disconnected · retrying' when SSE status is error", () => {
    streamState.status = "error";
    render(<RitualStatusStrip />);
    expect(screen.getByTestId("ritual-status-strip").textContent).toMatch(/disconnected/i);
  });

  it("uses font-mono on the strip text container", () => {
    render(<RitualStatusStrip />);
    expect(screen.getByTestId("ritual-status-strip").className).toMatch(/font-mono/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /f/claude/ai_builder/apps/atlas-web
pnpm vitest run test/components/ritual/RitualStatusStrip.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the component**

Create `apps/atlas-web/components/ritual/RitualStatusStrip.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

interface Props {
  /** Injected for tests so duration is deterministic. Real usage uses Date.now. */
  nowMs?: () => number;
}

interface Derived {
  text: string;
  tone: "slate" | "amber" | "emerald" | "red";
  pulse: boolean;
}

function deriveStripState(
  events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>,
  status: string,
  nowMs: number
): Derived {
  if (status === "error") {
    return { text: "Disconnected · retrying", tone: "amber", pulse: false };
  }
  if (events.length === 0) {
    return { text: "Idle · ready", tone: "slate", pulse: false };
  }

  let activeRole: string | null = null;
  let activeStartedAt: number | null = null;
  let autoFixCount = 0;
  let escalated: { reason?: string } | null = null;
  let lastTs = events[0]!.ts;

  for (const e of events) {
    lastTs = e.ts;
    switch (e.type) {
      case "ritual.started":
        activeRole = null; activeStartedAt = null; autoFixCount = 0; escalated = null;
        break;
      case "auto_fix.attempted":
        autoFixCount++;
        break;
      case "role.started": {
        const role = (e.payload.roleId ?? e.payload.role) as string | undefined;
        if (role) { activeRole = role; activeStartedAt = e.ts; }
        break;
      }
      case "role.completed":
      case "role.failed":
        activeRole = null; activeStartedAt = null;
        break;
      case "ritual.escalation_requested":
      case "ritual.escalated":
        escalated = { reason: e.payload.reason as string | undefined };
        activeRole = null;
        break;
      case "ritual.completed":
        activeRole = null; activeStartedAt = null;
        break;
    }
  }

  if (escalated) {
    const reason = escalated.reason ?? "ritual";
    return { text: `Escalated · ${reason} · click to expand`, tone: "red", pulse: false };
  }
  if (activeRole && activeStartedAt !== null) {
    const seconds = Math.max(0, Math.round((nowMs - activeStartedAt) / 1000));
    const prefix = autoFixCount > 0 ? `Auto-fix #${autoFixCount} · ` : "";
    return { text: `${prefix}${activeRole} · ${seconds}s`, tone: "amber", pulse: true };
  }
  // Last event was terminal (completed/failed), no active phase.
  const sinceMs = Math.max(0, Math.round((nowMs - lastTs) / 1000));
  return { text: `Idle · last activity ${sinceMs}s ago`, tone: "slate", pulse: false };
}

const TONE_CLASS: Record<Derived["tone"], string> = {
  slate: "text-slate-500 border-slate-200 bg-slate-50",
  amber: "text-amber-700 border-amber-200 bg-amber-50",
  emerald: "text-emerald-700 border-emerald-200 bg-emerald-50",
  red: "text-red-700 border-red-300 bg-red-50"
};

export function RitualStatusStrip({ nowMs }: Props = {}) {
  const { events, status } = useEventStream();
  const derived = useMemo(
    () => deriveStripState(events, status, (nowMs ?? Date.now)()),
    [events, status, nowMs]
  );
  return (
    <div
      data-testid="ritual-status-strip"
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 border-b px-4 h-8 text-xs font-mono ${TONE_CLASS[derived.tone]}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${derived.pulse ? "animate-pulse" : ""}`}
      />
      <span className="truncate">{derived.text}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run test/components/ritual/RitualStatusStrip.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/components/ritual/RitualStatusStrip.tsx apps/atlas-web/test/components/ritual/RitualStatusStrip.test.tsx
git commit -m "feat(atlas-web): RitualStatusStrip — always-on phase+duration banner (plan R)"
```

---

### Task 6: `<EditorShell>` component (resizable two-zone wrapper)

**Files:**
- Create: `apps/atlas-web/components/shell/EditorShell.tsx`
- Test: `apps/atlas-web/test/components/shell/EditorShell.test.tsx` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/shell/EditorShell.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";
import { EditorShell } from "@/components/shell/EditorShell";

beforeEach(() => { cleanup(); localStorage.clear(); });

describe("EditorShell", () => {
  it("renders left + right children inside named test panels", () => {
    render(
      <EditorShell projectId="p-1" left={<div data-testid="L">left</div>} right={<div data-testid="R">right</div>} />
    );
    expect(screen.getByTestId("editor-shell")).toBeInTheDocument();
    expect(screen.getByTestId("editor-shell-handle")).toBeInTheDocument();
    expect(screen.getByTestId("L")).toBeInTheDocument();
    expect(screen.getByTestId("R")).toBeInTheDocument();
  });

  it("uses defaults when nothing persisted (35% / 65%)", () => {
    render(
      <EditorShell projectId="p-1" left={<div>L</div>} right={<div>R</div>} />
    );
    const root = screen.getByTestId("editor-shell");
    expect(root.getAttribute("data-default-left-pct")).toBe("35");
  });

  it("hydrates persisted leftWidthPct on mount", () => {
    localStorage.setItem("atlas:editorLayout:p-1", JSON.stringify({ leftWidthPct: 50, leftCollapsed: false, rightCollapsed: false }));
    render(
      <EditorShell projectId="p-1" left={<div>L</div>} right={<div>R</div>} />
    );
    const root = screen.getByTestId("editor-shell");
    expect(root.getAttribute("data-current-left-pct")).toBe("50");
  });

  it("clicking the left collapse button hides the left panel", () => {
    render(
      <EditorShell projectId="p-1" left={<div data-testid="L">left</div>} right={<div>R</div>} />
    );
    const btn = screen.getByTestId("editor-shell-collapse-left");
    act(() => { btn.click(); });
    expect(screen.getByTestId("editor-shell").getAttribute("data-left-collapsed")).toBe("true");
  });

  it("renders without crashing during SSR (no window access at first render)", () => {
    // Strip window so any SSR-unsafe code throws synchronously.
    const orig = global.window;
    // @ts-expect-error — intentional delete to simulate SSR
    delete global.window;
    try {
      // The component is "use client" — it can't truly SSR — but its
      // INITIAL state must not call window.* during the synchronous
      // render. We assert no throw during construction of the element tree.
      expect(() => React.createElement(EditorShell as never, { projectId: "p-1", left: null, right: null })).not.toThrow();
    } finally {
      global.window = orig;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run test/components/shell/EditorShell.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the component**

Create `apps/atlas-web/components/shell/EditorShell.tsx`:

```tsx
"use client";

import React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEditorLayoutPersistence, DEFAULT_LAYOUT } from "@/lib/editor-layout/use-editor-layout-persistence";

interface Props {
  projectId: string;
  left: React.ReactNode;
  right: React.ReactNode;
}

const COLLAPSED_PX = 48;

export function EditorShell({ projectId, left, right }: Props) {
  const { layout, setLayout } = useEditorLayoutPersistence(projectId);

  const onLayout = (sizes: number[]) => {
    if (sizes.length !== 2) return;
    const newLeft = Math.round(sizes[0]!);
    if (newLeft !== layout.leftWidthPct && !layout.leftCollapsed && !layout.rightCollapsed) {
      setLayout({ ...layout, leftWidthPct: newLeft });
    }
  };

  return (
    <div
      data-testid="editor-shell"
      data-default-left-pct={String(DEFAULT_LAYOUT.leftWidthPct)}
      data-current-left-pct={String(layout.leftWidthPct)}
      data-left-collapsed={String(layout.leftCollapsed)}
      data-right-collapsed={String(layout.rightCollapsed)}
      className="flex h-full w-full"
    >
      {/* Left collapse-toggle rail (always visible, 24px) */}
      <button
        type="button"
        data-testid="editor-shell-collapse-left"
        aria-label={layout.leftCollapsed ? "Expand chat panel" : "Collapse chat panel"}
        onClick={() => setLayout({ ...layout, leftCollapsed: !layout.leftCollapsed })}
        className="flex w-6 items-center justify-center border-r border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-900"
      >
        {layout.leftCollapsed ? "›" : "‹"}
      </button>

      {layout.leftCollapsed ? (
        <main className="flex-1 min-w-0 overflow-auto">{right}</main>
      ) : layout.rightCollapsed ? (
        <aside className="flex-1 min-w-0 overflow-auto">{left}</aside>
      ) : (
        <PanelGroup direction="horizontal" onLayout={onLayout} className="flex flex-1 min-w-0">
          <Panel defaultSize={layout.leftWidthPct} minSize={15} maxSize={85} className="flex flex-col min-w-0">
            {left}
          </Panel>
          <PanelResizeHandle
            data-testid="editor-shell-handle"
            className="w-px bg-slate-200 hover:bg-slate-400 active:bg-slate-500 transition-colors cursor-col-resize"
          />
          <Panel defaultSize={100 - layout.leftWidthPct} minSize={15} maxSize={85} className="flex flex-col min-w-0">
            {right}
          </Panel>
        </PanelGroup>
      )}

      {/* Right collapse-toggle rail (always visible, 24px) */}
      <button
        type="button"
        data-testid="editor-shell-collapse-right"
        aria-label={layout.rightCollapsed ? "Expand preview panel" : "Collapse preview panel"}
        onClick={() => setLayout({ ...layout, rightCollapsed: !layout.rightCollapsed })}
        className="flex w-6 items-center justify-center border-l border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-900"
      >
        {layout.rightCollapsed ? "‹" : "›"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run test/components/shell/EditorShell.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/components/shell/EditorShell.tsx apps/atlas-web/test/components/shell/EditorShell.test.tsx
git commit -m "feat(atlas-web): EditorShell — two-zone resizable wrapper (plan R)"
```

---

### Task 7: `<RitualTimeline>` collapsible — auto-close on first sandbox.apply.completed

**Files:**
- Create: `apps/atlas-web/lib/ritual/use-timeline-collapse.ts`
- Modify: `apps/atlas-web/components/ritual/RitualTimeline.tsx`
- Test: `apps/atlas-web/test/components/ritual/RitualTimeline-collapse.test.tsx` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/ritual/RitualTimeline-collapse.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";

const streamState = {
  events: [] as Array<{ id: string; type: string; payload: Record<string, unknown>; ts: number; projectId: string; ritualId: string }>,
  status: "open" as const,
  lastEventId: null as string | null
};
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => streamState
}));

import { RitualTimeline } from "@/components/ritual/RitualTimeline";

beforeEach(() => { cleanup(); streamState.events = []; sessionStorage.clear(); });

const evt = (type: string, payload: Record<string, unknown> = {}, ts = 1_000) => ({
  id: `e-${ts}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("RitualTimeline — Plan R collapsible wrapper", () => {
  it("renders open by default (no sandbox.apply.completed yet)", () => {
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(true);
  });

  it("auto-collapses after first sandbox.apply.completed", () => {
    streamState.events = [
      evt("sandbox.apply.completed", { ok: true, filesWritten: 1 }, 5_000)
    ];
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(false);
  });

  it("user can manually re-open after auto-collapse and the open state persists in session", () => {
    streamState.events = [evt("sandbox.apply.completed", { ok: true, filesWritten: 1 }, 5_000)];
    const { unmount } = render(<RitualTimeline projectId="p-1" />);
    const summary = screen.getByTestId("ritual-timeline-summary");
    act(() => { summary.click(); });
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(true);
    unmount();
    cleanup();
    // Re-mount: sessionStorage retains the user's open choice
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run test/components/ritual/RitualTimeline-collapse.test.tsx
```

Expected: FAIL — `RitualTimeline` doesn't accept a `projectId` prop today, and the new test-ids don't exist.

- [ ] **Step 3: Create the collapse hook**

Create `apps/atlas-web/lib/ritual/use-timeline-collapse.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

const KEY = (projectId: string) => `atlas:timelineOpen:${projectId}`;

function readPersisted(projectId: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY(projectId));
    if (raw === null) return null;
    return raw === "true";
  } catch {
    return null;
  }
}

/** Manages the open/closed state of <RitualTimeline>'s <details> wrapper.
 *  Default: open. Auto-flips to closed on the first sandbox.apply.completed
 *  event we observe (the strip now carries the trust load). User toggles
 *  persist in sessionStorage so a manual expand sticks until the tab is
 *  closed; reload on a fresh tab returns to the default+auto-close logic. */
export function useTimelineCollapse(projectId: string) {
  const { events } = useEventStream();
  const [userChoice, setUserChoice] = useState<boolean | null>(null);

  useEffect(() => {
    setUserChoice(readPersisted(projectId));
  }, [projectId]);

  const setOpen = useCallback(
    (next: boolean) => {
      setUserChoice(next);
      try {
        window.sessionStorage.setItem(KEY(projectId), String(next));
      } catch {
        /* sessionStorage disabled — drop persistence */
      }
    },
    [projectId]
  );

  const sawApply = events.some((e) => e.type === "sandbox.apply.completed");
  const open = userChoice !== null ? userChoice : !sawApply;

  return { open, setOpen };
}
```

- [ ] **Step 4: Modify `<RitualTimeline>` to use the hook**

Modify `apps/atlas-web/components/ritual/RitualTimeline.tsx`. Add the `projectId` prop and wrap the `<section>` body in a `<details>` element.

Add at the top:

```ts
import { useTimelineCollapse } from "@/lib/ritual/use-timeline-collapse";
```

Change the component signature from `export function RitualTimeline()` to:

```ts
export function RitualTimeline({ projectId }: { projectId: string })
```

Wrap the existing `<section>` body in:

```tsx
<details
  data-testid="ritual-timeline-details"
  open={open}
  onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
>
  <summary
    data-testid="ritual-timeline-summary"
    className="cursor-pointer select-none px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500"
  >
    Live progress
  </summary>
  {/* existing rows + auto-fix indicator + escalation panel here */}
</details>
```

Pull `{ open, setOpen }` from `useTimelineCollapse(projectId)` at the top of the component body.

- [ ] **Step 5: Update `<RitualTimelineSlot>` to forward projectId**

Modify `apps/atlas-web/components/shell/ritual-timeline-slot.tsx`. The `<RitualTimeline />` call must pass `projectId={_props.projectId}` (already in scope as `_props`):

```tsx
return (
  <div data-testid="ritual-timeline-host">
    <RitualTimeline projectId={_props.projectId} />
  </div>
);
```

- [ ] **Step 6: Run the new test plus the existing ones**

```bash
pnpm vitest run test/components/ritual/RitualTimeline-collapse.test.tsx test/components/ritual/RitualTimeline.test.tsx test/components/shell/ritual-timeline-slot.test.tsx
```

Expected: new test passes; existing tests still pass (the `projectId` prop addition is backward-compatible since the existing test fixtures all render the component via the slot which now forwards the id).

- [ ] **Step 7: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/lib/ritual/use-timeline-collapse.ts apps/atlas-web/components/ritual/RitualTimeline.tsx apps/atlas-web/components/shell/ritual-timeline-slot.tsx apps/atlas-web/test/components/ritual/RitualTimeline-collapse.test.tsx
git commit -m "feat(atlas-web): RitualTimeline auto-collapses on first sandbox.apply.completed (plan R)"
```

---

### Task 8: Extract `<CanvasPreviewToolbar>` + refresh visual language

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewToolbar.tsx`
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx`
- Test: `apps/atlas-web/test/components/canvas/CanvasPreviewToolbar.test.tsx` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/canvas/CanvasPreviewToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { CanvasPreviewToolbar } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewToolbar";

beforeEach(() => { cleanup(); });

describe("CanvasPreviewToolbar — Plan R", () => {
  it("renders 3 segmented control options for viewport (Desktop/Tablet/Mobile)", () => {
    render(<CanvasPreviewToolbar viewport="desktop" onViewportChange={() => {}} previewUrl="https://x" onReload={() => {}} />);
    expect(screen.getByRole("radio", { name: /desktop/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /tablet/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /mobile/i })).toBeInTheDocument();
  });

  it("calls onReload when the reload button is clicked", () => {
    const onReload = vi.fn();
    render(<CanvasPreviewToolbar viewport="desktop" onViewportChange={() => {}} previewUrl="https://x" onReload={onReload} />);
    fireEvent.click(screen.getByTestId("preview-toolbar-reload"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("renders an open-in-new-tab link with the preview URL", () => {
    render(<CanvasPreviewToolbar viewport="desktop" onViewportChange={() => {}} previewUrl="https://example.e2b.app" onReload={() => {}} />);
    const link = screen.getByTestId("preview-toolbar-open-tab") as HTMLAnchorElement;
    expect(link.href).toBe("https://example.e2b.app/");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run test/components/canvas/CanvasPreviewToolbar.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the toolbar**

Create `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewToolbar.tsx`:

```tsx
"use client";

import React from "react";

export type ViewportId = "desktop" | "tablet" | "mobile";

interface Props {
  viewport: ViewportId;
  onViewportChange: (v: ViewportId) => void;
  previewUrl: string | undefined;
  onReload: () => void;
}

const OPTIONS: ReadonlyArray<{ id: ViewportId; label: string }> = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" }
];

export function CanvasPreviewToolbar({ viewport, onViewportChange, previewUrl, onReload }: Props) {
  return (
    <div
      data-testid="canvas-preview-toolbar"
      className="flex items-center justify-between border-b border-slate-200 px-4 h-10 text-xs font-mono"
    >
      <div role="radiogroup" aria-label="Preview viewport" className="inline-flex rounded-md border border-slate-200 overflow-hidden">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={viewport === opt.id}
            aria-label={opt.label}
            onClick={() => onViewportChange(opt.id)}
            className={`px-3 h-8 ${viewport === opt.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="preview-toolbar-reload"
          onClick={onReload}
          aria-label="Reload preview"
          className="rounded border border-slate-200 px-3 h-8 hover:bg-slate-50"
        >
          ↻ Reload
        </button>
        <a
          data-testid="preview-toolbar-open-tab"
          href={previewUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open preview in new tab"
          aria-disabled={!previewUrl}
          className={`rounded border border-slate-200 px-3 h-8 inline-flex items-center hover:bg-slate-50 ${!previewUrl ? "pointer-events-none opacity-50" : ""}`}
        >
          ⤢ Open
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the toolbar into `<CanvasPreviewClient>`**

Modify `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx`. Replace the existing top-of-file toolbar `<div>` (the one with `<ViewportToggle>` + Share button) with `<CanvasPreviewToolbar>`.

Add import:

```ts
import { CanvasPreviewToolbar } from "./CanvasPreviewToolbar";
```

The reload action wires to a new local state slot — when the user clicks reload, force the iframe to remount by changing a key:

```tsx
const [reloadKey, setReloadKey] = useState(0);
```

Then change the toolbar block from:

```tsx
<div className="flex items-center justify-between border-b px-4 py-2">
  <ViewportToggle viewport={viewport} onViewportChange={setViewport} />
  <button onClick={() => setShareOpen(true)} ...>Share</button>
</div>
```

to:

```tsx
<CanvasPreviewToolbar
  viewport={viewport}
  onViewportChange={setViewport}
  previewUrl={previewUrl}
  onReload={() => setReloadKey((k) => k + 1)}
/>
```

Pass `reloadKey` as a `key` prop to `<HmrIframe>`:

```tsx
<HmrIframe key={reloadKey} src={previewUrl} title="Live preview" projectId={projectId} />
```

NOTE: do NOT remove the `<ShareableUrlModal>` — keep it mounted; it's fired by a different button now living elsewhere. To preserve a way to open the share modal, add a third toolbar button "↗ Share" using the same CSS pattern (extend `CanvasPreviewToolbar` with an optional `onShare` prop and pass `() => setShareOpen(true)` from `CanvasPreviewClient`). For this task, the Share button extension is part of the toolbar component:

Add to the toolbar's `Props`:

```ts
  onShare?: () => void;
```

Add inside the right-side button cluster (between `↻ Reload` and `⤢ Open`):

```tsx
{onShare && (
  <button
    type="button"
    data-testid="preview-toolbar-share"
    onClick={onShare}
    aria-label="Share preview"
    className="rounded border border-slate-200 px-3 h-8 hover:bg-slate-50"
  >
    ↗ Share
  </button>
)}
```

And wire it from the client:

```tsx
<CanvasPreviewToolbar
  viewport={viewport}
  onViewportChange={setViewport}
  previewUrl={previewUrl}
  onReload={() => setReloadKey((k) => k + 1)}
  onShare={() => setShareOpen(true)}
/>
```

- [ ] **Step 5: Run all relevant tests**

```bash
pnpm vitest run test/components/canvas/ test/components/CanvasPreviewClient.test.tsx
```

Expected: new toolbar tests pass; existing CanvasPreviewClient test still passes (it asserts presence of the iframe + error panel, both untouched).

- [ ] **Step 6: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewToolbar.tsx apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx apps/atlas-web/test/components/canvas/CanvasPreviewToolbar.test.tsx
git commit -m "feat(atlas-web): refresh CanvasPreviewToolbar — segmented control + reload + open-tab + share (plan R)"
```

---

### Task 9: `<EmptyPreviewBackdrop>` for the no-iframe-yet state

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/canvas/_components/EmptyPreviewBackdrop.tsx`
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx`
- Test: `apps/atlas-web/test/components/canvas/EmptyPreviewBackdrop.test.tsx` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/canvas/EmptyPreviewBackdrop.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyPreviewBackdrop } from "@/app/projects/[projectId]/canvas/_components/EmptyPreviewBackdrop";

describe("EmptyPreviewBackdrop", () => {
  it("renders the dotted backdrop + provided status text in font-mono", () => {
    render(<EmptyPreviewBackdrop status="provisioning sandbox · ~5s" />);
    const root = screen.getByTestId("empty-preview-backdrop");
    expect(root).toBeInTheDocument();
    expect(root.className).toMatch(/font-mono/);
    expect(root.textContent).toContain("provisioning sandbox · ~5s");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run test/components/canvas/EmptyPreviewBackdrop.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the component**

Create `apps/atlas-web/app/projects/[projectId]/canvas/_components/EmptyPreviewBackdrop.tsx`:

```tsx
"use client";

import React from "react";

interface Props {
  status: string;
}

/** Vercel-style dotted-grid backdrop for the preview zone before the iframe
 *  has anything to render. Kept simple — a CSS background-image of a tiny
 *  radial gradient repeated on a 16px grid. */
export function EmptyPreviewBackdrop({ status }: Props) {
  return (
    <div
      data-testid="empty-preview-backdrop"
      role="status"
      aria-live="polite"
      className="flex h-full w-full items-center justify-center text-xs font-mono text-slate-500"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(15,23,42,0.12) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
        backgroundColor: "#fafafa"
      }}
    >
      <span className="rounded-md border border-slate-200 bg-white/70 px-3 py-1 backdrop-blur-sm">
        {status}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `<HmrIframe>`'s no-src branch**

Modify `apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx`. Replace the existing skeleton block (the `if (!src) return ( ... animate-pulse ... )` branch) with:

```tsx
import { EmptyPreviewBackdrop } from "./EmptyPreviewBackdrop";

// ... inside the component:
if (!src) {
  return <EmptyPreviewBackdrop status="provisioning sandbox · ~5s" />;
}
```

- [ ] **Step 5: Run the test + the existing iframe test**

```bash
pnpm vitest run test/components/canvas/EmptyPreviewBackdrop.test.tsx test/HmrIframe.test.tsx
```

Expected: new test passes. The existing HmrIframe test currently asserts `data-testid="hmr-iframe-skeleton"` — that test now needs an update. Edit `apps/atlas-web/test/HmrIframe.test.tsx` and rename any `getByTestId("hmr-iframe-skeleton")` to `getByTestId("empty-preview-backdrop")`. Re-run; both should now pass.

- [ ] **Step 6: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/app/projects/[projectId]/canvas/_components/EmptyPreviewBackdrop.tsx apps/atlas-web/app/projects/[projectId]/canvas/_components/HmrIframe.tsx apps/atlas-web/test/components/canvas/EmptyPreviewBackdrop.test.tsx apps/atlas-web/test/HmrIframe.test.tsx
git commit -m "feat(atlas-web): EmptyPreviewBackdrop — Vercel-style dotted grid for preview empty state (plan R)"
```

---

### Task 10: Mount `<RitualStatusStrip>` + `<EditorShell>` in `<ProjectLayout>` behind the flag

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/layout.tsx`
- Test: extend `apps/atlas-web/test/app/projects/layout-flag-r-branch.test.tsx`

- [ ] **Step 1: Extend the lock test with a flag-ON case**

Modify the existing `layout-flag-r-branch.test.tsx`. Add a second `it` block to the existing `describe`:

```tsx
  it("renders Plan R chrome when editor-layout-v2 is ON", async () => {
    flagState["editor-layout-v2"] = true;
    await renderLayout();
    expect(screen.getByTestId("ritual-status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("editor-shell")).toBeInTheDocument();
    // RailShell stub still mounts as the LEFT panel content
    expect(screen.getByTestId("rail-shell")).toBeInTheDocument();
    // Page children mount as the RIGHT panel content
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
  });
```

You'll also need to mock the new components inside the same test file's `vi.mock` block at the top:

```ts
vi.mock("@/components/ritual/RitualStatusStrip", () => ({
  RitualStatusStrip: () => <div data-testid="ritual-status-strip">strip stub</div>
}));
vi.mock("@/components/shell/EditorShell", () => ({
  EditorShell: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="editor-shell">{left}{right}</div>
  )
}));
```

- [ ] **Step 2: Run — the new case should fail**

```bash
pnpm vitest run test/app/projects/layout-flag-r-branch.test.tsx
```

Expected: the OFF case still passes; the ON case FAILS (`ritual-status-strip` not in DOM because layout doesn't mount it yet).

- [ ] **Step 3: Modify the layout to branch on the flag**

Edit `apps/atlas-web/app/projects/[projectId]/layout.tsx`. Add at the top:

```ts
import { RitualStatusStrip } from "@/components/ritual/RitualStatusStrip";
import { EditorShell } from "@/components/shell/EditorShell";
```

Inside the function body (after the existing `liveEventsOn` / `multiTurnOn` reads), add:

```ts
  const editorLayoutV2On = isFeatureEnabled("editor-layout-v2");
```

After the existing `if (!liveEventsOn)` early return, add a new branch (BEFORE the existing flag-on `return`):

```tsx
  if (editorLayoutV2On) {
    return (
      <EventSourceProvider projectId={projectId} flagEnabled={true}>
        <div className="flex h-screen flex-col">
          {topNav}
          <RitualStatusStrip />
          <div className="flex flex-1 min-h-0">
            <EditorShell
              projectId={projectId}
              left={<RailShell projectId={projectId} multiTurnFlagEnabled={multiTurnOn} />}
              right={<main className="flex-1 min-w-0 overflow-auto">{children}</main>}
            />
          </div>
        </div>
      </EventSourceProvider>
    );
  }
```

The existing `return (...)` (today's Plan G layout) stays as the final fallthrough.

- [ ] **Step 4: Run the lock tests — both cases must pass**

```bash
pnpm vitest run test/app/projects/layout-flag-r-branch.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /f/claude/ai_builder
git add apps/atlas-web/app/projects/[projectId]/layout.tsx apps/atlas-web/test/app/projects/layout-flag-r-branch.test.tsx
git commit -m "feat(atlas-web): mount RitualStatusStrip + EditorShell behind editor-layout-v2 flag (plan R)"
```

---

### Task 11: Manual end-to-end smoke (no automated test — sandbox-bound)

**Files:** none modified; this task is verification-only.

- [ ] **Step 1: Flip the flag in `.env.local`**

Add to `apps/atlas-web/.env.local`:

```
ATLAS_EDITOR_LAYOUT_V2=true
```

- [ ] **Step 2: Restart the dev server**

```bash
cd /f/claude/ai_builder
PID=$(netstat -ano 2>/dev/null | grep ':3000 ' | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //PID $PID //F
cd apps/atlas-web && CI=1 ATLAS_LOG_CHECKPOINTS=1 pnpm dev > /tmp/atlas-dev.log 2>&1 &
sleep 8 && tail -10 /tmp/atlas-dev.log
```

Expected: dev server boots, no compile errors in the log.

- [ ] **Step 3: Open a project page in the browser and verify**

Navigate to any `http://localhost:3000/projects/<projectId>/canvas` page. Verify:

- [ ] 32px Geist Mono status strip is visible directly under the top nav
- [ ] Two-zone layout: chat left (~35%), preview right (~65%)
- [ ] Drag the divider — width adjusts smoothly
- [ ] Refresh the page — drag width persists
- [ ] Click `‹` on the left rail — chat collapses to a 24px strip; preview expands
- [ ] Click `›` on the right rail — preview collapses; chat expands
- [ ] Trigger a ritual — strip text updates; timeline rows light up
- [ ] After `sandbox.apply.completed` fires — timeline auto-collapses; strip stays informative
- [ ] Preview toolbar shows segmented control + ↻ Reload + ↗ Share + ⤢ Open
- [ ] Click ⤢ — opens preview URL in a new tab
- [ ] If sandbox is provisioning — empty state shows dotted grid + "provisioning sandbox · ~5s"

- [ ] **Step 4: Flip flag off and verify nothing broke**

Comment out `ATLAS_EDITOR_LAYOUT_V2=true` in `.env.local`. Restart dev server. Verify the project page renders today's Plan G layout: rail at left, no status strip, no resize handle.

- [ ] **Step 5: Re-flip on for the rest of the demo + commit env change**

Re-enable `ATLAS_EDITOR_LAYOUT_V2=true` in `.env.local`. (Local-only change — `.env.local` is gitignored, no commit.)

---

### Task 12: Run full suite + finish branch

**Files:** none modified.

- [ ] **Step 1: Run the full atlas-web vitest suite**

```bash
cd /f/claude/ai_builder/apps/atlas-web
pnpm vitest run
```

Expected: all tests green. If any pre-existing test breaks because of font-family changes, fix it inline (typically a snapshot needs updating).

- [ ] **Step 2: Run the typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Use the finishing-a-development-branch skill**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."

REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` — that skill verifies tests, presents the four merge options (merge locally / push & PR / keep / discard), executes the chosen path, and cleans up.

---

## Self-Review

Spec coverage map (every spec section → task that implements it):

| Spec section | Task |
|---|---|
| Goal 1 — preview as canvas, expandable | Task 6 (collapse-left button hides chat → preview expands) + Task 10 (wired in layout) |
| Goal 2 — drag-resizable + persist | Task 4 (hook) + Task 6 (shell) |
| Goal 3 — visibility survives panel collapse | Task 5 (strip) + Task 10 (always above shell, never inside collapsible) |
| Goal 4 — live progress prominent in chat zone | Task 7 (collapsible default-open until first sandbox.apply.completed) |
| Goal 5 — Geist visual language | Task 3 (font integration) + tasks 5/6/7/8/9 (`font-mono`, status palette) |
| Goal 6 — additive, flag-gated | Task 1 (flag) + Task 2 (lock test) + Task 10 (branch in layout) |
| Non-goal: spec-graph relocation | Decision 10 — kept inside `{children}` for this plan |
| Non-goal: dark mode | Not implemented |
| Architecture component tree | Tasks 5+6+10 |
| Resizable behavior (defaults, range, collapse, persist) | Tasks 4+6 |
| `<RitualStatusStrip>` rules table | Task 5 (each rule has a test case) |
| Live progress moved inside chat zone | Task 7 |
| Preview zone toolbar | Task 8 |
| Removed/relocated surfaces | Task 8 (toolbar replaces Share-only header) |
| Visual language (type, spacing, color, borders) | Tasks 3 + 5 + 6 + 8 + 9 |
| Data flow & state | Task 4 (layout state) + Task 7 (timeline-collapse state) |
| Feature flag | Tasks 1 + 2 + 10 |
| Failure modes | Task 4 step 3 (clamp + JSON catch); Task 5 (error tone); Task 6 (PanelGroup error fallback handled by react-resizable-panels itself) |
| Testing strategy | Tasks 1 (flag) + 2 (lock) + 4 (hook) + 5 (strip) + 6 (shell) + 7 (collapse) + 8 (toolbar) + 9 (backdrop) + 10 (integration) + 11 (manual smoke) |
| Migration / rollout | Task order matches the spec's 1–7 sequence |

Placeholder scan: no TBDs, no "implement later", no "similar to Task N", no "add appropriate error handling" — every step shows code or commands.

Type consistency check:
- `EditorLayout` shape (`{ leftWidthPct, leftCollapsed, rightCollapsed }`) matches across Tasks 4 + 6.
- `ViewportId` (`"desktop" | "tablet" | "mobile"`) defined in Task 8; existing `ViewportToggle.tsx` uses the same union — verified before plan finalization.
- `useEventStream()` return shape (`{ events, status, lastEventId }`) matches the actual export in `apps/atlas-web/lib/events/EventSourceProvider.tsx`.
- `useTimelineCollapse(projectId)` returns `{ open, setOpen }` — used consistently in Task 7.
- `RitualStatusStrip` accepts a `nowMs` prop (test injection) — consistent across the test file and the component file.

No issues found.

---

## Sources

- Approved spec: `docs/superpowers/specs/2026-04-30-editor-layout-redesign.md`
- `react-resizable-panels` docs: https://github.com/bvaughn/react-resizable-panels
- Geist npm package: https://www.npmjs.com/package/geist
- Vercel Geist Design System: https://vercel.com/geist/introduction
