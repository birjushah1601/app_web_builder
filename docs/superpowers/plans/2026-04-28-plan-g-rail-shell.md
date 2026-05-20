# Plan G — Persistent Left-Rail Chat Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `ChatPanel` out of every individual `/canvas`, `/code`, `/run` page and into a persistent fixed-width 360px left rail mounted by `app/projects/[projectId]/layout.tsx`, so a user navigating between project sub-routes never loses chat history, never tears down the SSE connection, and never re-mounts the React tree backing the conversation. Ship behind the existing `live-events` feature flag from Plan E.0 — flag-off path is byte-for-byte today's behaviour.

**Architecture:** A new `<RailShell />` client component (`apps/atlas-web/components/shell/RailShell.tsx`) owns the rail's chrome (header with project name + back-to-projects link, body with `<ChatPanel />`, footer with `<RitualTimeline />` or its placeholder). The width is sourced from a `RAIL_SHELL_CONFIG` constant object — not an inline `w-[360px]` — so a future v2 plan can swap that source for resize/collapse state without restructuring the file. The `[projectId]/layout.tsx` server component branches on `isFeatureEnabled("live-events")`: flag-on, it wraps `{children}` with `<EventSourceProvider>` + a flex container holding `<RailShell />` and `<main>{children}</main>`; flag-off, it leaves today's render path untouched. Each page that currently mounts `<ChatPanel />` (only `/canvas` today; `/code` and `/run` do not) gates its mount on `!isFeatureEnabled("live-events")`. `<RitualTimeline />` ships in Plan E — this plan guards its import behind a runtime probe and renders `<div data-testid="ritual-timeline-host" />` as a placeholder when the file does not exist yet, so Plan G can land before Plan E without breaking.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Next.js 15 app router · React 19 · Tailwind CSS · Vitest 2.x + `@testing-library/react` · Playwright (existing e2e harness, real-stack pattern from Plan D).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan E.0 merged on `main`. Specifically: `apps/atlas-web/lib/events/EventSourceProvider.tsx` exports `<EventSourceProvider projectId flagEnabled>{children}</EventSourceProvider>`; `apps/atlas-web/lib/feature-flags.ts` includes `"live-events"` in the `FeatureFlag` union and reads `ATLAS_LIVE_EVENTS`; the SSE route at `/api/projects/[projectId]/events` returns real frames.
- `apps/atlas-web/.env.local` with the Plan D auth env vars (used by the e2e spec only): `CLERK_SECRET_KEY`, `ATLAS_TEST_PASSWORD`, `ATLAS_LLM_BASE_URL`, `E2B_API_KEY`. Without these the e2e tests skip cleanly; the unit tests do not require them.
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` workspace packages keep their `.js` suffix as before; this rule applies only to atlas-web internal imports.
- Plan G ships in parallel with Plans E and F (same E.0 dependency, no shared files). If Plan E has not landed yet when this plan runs, the `RitualTimeline` placeholder branch covers the gap and the plan ships green.

**Branch:** `plan-g/rail-shell` cut from `main`. Final task in this plan merges the branch back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
apps/atlas-web/
  components/
    shell/
      RailShell.tsx                                          # NEW: the 360px left rail (header + ChatPanel + RitualTimeline slot)
      rail-config.ts                                         # NEW: width constant + future-v2 contract
      ritual-timeline-slot.tsx                               # NEW: dynamic-import wrapper around <RitualTimeline /> (Plan E) with placeholder fallback
  app/
    projects/
      [projectId]/
        layout.tsx                                           # REWRITTEN: flag branch — RailShell wrap (on) vs pass-through (off)
        page.tsx                                             # UNCHANGED (server redirect; nothing to gate)
        canvas/page.tsx                                      # MODIFIED: gate ChatPanel mount on !isFeatureEnabled("live-events")
        code/page.tsx                                        # UNCHANGED (does not mount ChatPanel)
        run/page.tsx                                         # UNCHANGED (does not mount ChatPanel)
  test/
    components/
      shell/
        RailShell.test.tsx                                   # NEW: ~6 cases (header, width, slots, projectId-keyed re-render)
        rail-config.test.ts                                  # NEW: 2 cases (constant shape + future-v2 contract assertion)
        ritual-timeline-slot.test.tsx                        # NEW: 2 cases (renders placeholder when module missing; renders real component when loaded)
    app/
      projects/
        layout-flag-branch.test.tsx                          # NEW: ~4 cases (flag on mounts rail + provider; flag off renders bare children)
        canvas-chatpanel-gate.test.tsx                       # NEW: 2 cases (flag on hides ChatPanel; flag off mounts ChatPanel as today)
  e2e/
    tests/
      plan-g-rail-shell.spec.ts                              # NEW: 2 specs (persistent chat across nav; project switch re-keys rail)
```

**Why this shape.** `components/shell/` is a new namespace that future shell-level components (top-bar, status footer) can also live in — the rail is the first inhabitant. `rail-config.ts` is a tiny standalone module because v2 will replace its single export object with a context/hook; isolating the width constant in a one-line module makes that swap mechanical (one file changes, no ripple). `ritual-timeline-slot.tsx` exists because Plan G must be able to ship before Plan E — the slot encapsulates the "does the file exist yet?" probe behind a stable render contract so neither plan blocks the other. The `layout.tsx` rewrite is one file; the gate inside `canvas/page.tsx` is two lines; both are testable in isolation. The e2e spec lives in its own file (not appended to `plan-d-real-stack.spec.ts`) so it can be skipped independently when only the unit suite is being run.

---

## Design Decisions

These resolve the implementation-level questions left implicit in the spec.

1. **Rail width source: a `const RAIL_SHELL_CONFIG = { widthPx: 360 } as const`.** Lives in `components/shell/rail-config.ts`. The v1 implementation reads the constant directly. v2 will replace the export with a `useRailShellConfig()` hook that reads from a context provider; the rail file changes from `import { RAIL_SHELL_CONFIG } from "./rail-config"` to `const cfg = useRailShellConfig()` — a one-line change in the rail, zero changes to consumers. Documented in `rail-config.ts` as the future-v2 contract.
2. **`<RitualTimeline />` mount strategy: synchronous import wrapped in a try/catch slot.** Plan G's slot file does a top-of-file dynamic `import()` of `@/components/ritual/RitualTimeline`. If the module resolves, the slot renders the real component. If it rejects (file not yet created — Plan E unshipped), the slot renders `<div data-testid="ritual-timeline-host" />`. This keeps the rail self-contained (Plan G can ship without Plan E) and avoids forcing Plan E to ship as a stub first. We use React's `lazy()` + `Suspense` for this — `lazy(() => import(...).catch(() => ({ default: PlaceholderTimeline })))` returns the placeholder if the import fails.
3. **Layout flag-branch check: server-side `isFeatureEnabled` call inside `layout.tsx`.** The flag is read once per request (cheap; just an env var lookup). The flag value is then passed as a prop to `<EventSourceProvider flagEnabled={...}>` (per Plan E.0's API). No client-side flag access — pages pull the flag from the same `lib/feature-flags.ts` module so SSR and client agree.
4. **Page-level ChatPanel gate: server-side check on the page itself.** `canvas/page.tsx` reads `isFeatureEnabled("live-events")`; the JSX conditionally renders `<ChatPanel />` only when false. The flag is read once per render — same pattern as the layout. There is exactly one such gate today (`canvas/page.tsx`); `code/page.tsx` and `run/page.tsx` do not mount ChatPanel and are not modified by this plan. Verified by `grep "ChatPanel" apps/atlas-web/app/projects` — only `canvas/page.tsx` matches.
5. **Header content: project name + "All projects" link.** v1 ships with the project's `projectId` (server-fetched would require the existing pool plumbing in `layout.tsx`; we already have it) shown in the header, plus a back-arrow link to `/projects`. A future iteration will swap the projectId for the project's display name (requires a `ProjectsRepo.getById` call already used elsewhere); v1 uses the id so the rail is self-contained for tests.
6. **Width contract: tested at the DOM level via `data-rail-width-px` attribute.** Tailwind's arbitrary-value classes (`w-[360px]`) hide the width inside a generated CSS class that the test environment may or may not load. The rail emits a `data-rail-width-px="360"` attribute on the root element so unit tests can assert the contract without depending on jsdom evaluating Tailwind. The visible `style={{ width: ... }}` inline style guarantees rendering.
7. **`<EventSourceProvider />` placement: above the flex container, scoped to `[projectId]`.** Sibling pages (`/projects/new`, `/`) do not get the provider; only sub-routes of `[projectId]/` do. Per Plan E.0's design, the provider's `flagEnabled={false}` path is a literal no-op (no EventSource opens), so we still pass it through with `flagEnabled` set to the flag's value — this means flag-off path mounts the provider but it does nothing, and flag-on path mounts the same provider with `flagEnabled=true` so chat sessions inside the rail can later subscribe to events.
8. **No client-side flag flip mid-session.** The flag is read at SSR time. Switching `ATLAS_LIVE_EVENTS` requires a server restart (already documented behaviour for env-driven flags). Tests exercise both states by mocking `isFeatureEnabled`; e2e tests run with the flag set in `.env.local`.

---

## Task List (10 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit.

---

### Task 1: Cut the branch + add `rail-config.ts` (width constant + v2 contract)

**Files:**
- Create: `apps/atlas-web/components/shell/rail-config.ts`
- Create: `apps/atlas-web/test/components/shell/rail-config.test.ts`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-g/rail-shell
```

Expected: `Switched to a new branch 'plan-g/rail-shell'`.

- [ ] **Step 2: Write the failing test**

Create `apps/atlas-web/test/components/shell/rail-config.test.ts`:

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import { RAIL_SHELL_CONFIG, type RailShellConfig } from "@/components/shell/rail-config";

describe("RAIL_SHELL_CONFIG (Plan G — width source for v1; v2 swap target)", () => {
  it("exports a frozen object with widthPx === 360", () => {
    expect(RAIL_SHELL_CONFIG.widthPx).toBe(360);
    // Object.isFrozen() is true for `as const` literal objects in strict mode.
    // The freeze guarantees consumers cannot mutate the singleton at runtime.
    expect(Object.isFrozen(RAIL_SHELL_CONFIG)).toBe(true);
  });

  it("RailShellConfig type has exactly { widthPx: number } — v2 may add fields, v1 must not", () => {
    expectTypeOf<RailShellConfig>().toEqualTypeOf<{ readonly widthPx: number }>();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/components/shell/rail-config.test.ts
```

Expected: 2 fails — `Cannot find module '@/components/shell/rail-config'`.

- [ ] **Step 4: Write the config module**

Create `apps/atlas-web/components/shell/rail-config.ts`:

```typescript
/**
 * RAIL_SHELL_CONFIG — single source of truth for the persistent left-rail's
 * layout dimensions. Plan G v1 ships a fixed 360px wide rail; the constant
 * lives in its own file so Plan G v2 (resize + collapse) can swap the
 * export for a hook (`useRailShellConfig()`) backed by a context provider
 * without rewriting `RailShell.tsx` itself.
 *
 * v1 contract (frozen by `as const`):
 *   { widthPx: 360 }
 *
 * v2 contract (NOT shipped here — documented for future maintainers):
 *   - export removed; replaced by `useRailShellConfig(): RailShellConfig`
 *   - RailShellConfig may grow `collapsed: boolean` and `userPreferredWidthPx: number`
 *   - <RailShellConfigProvider /> wraps the layout and persists user prefs to localStorage
 *
 * The Plan G v1 → v2 migration changes exactly two lines in RailShell.tsx:
 *   - `import { RAIL_SHELL_CONFIG } from "./rail-config"` →
 *     `import { useRailShellConfig } from "./rail-config"`
 *   - `const cfg = RAIL_SHELL_CONFIG` →
 *     `const cfg = useRailShellConfig()`
 *
 * Every consumer below those two lines is unchanged. This is the contract.
 */

export interface RailShellConfig {
  /** Pixel width of the rail, applied as inline style + a data attribute
   *  for test-friendly DOM querying. v1 fixed at 360. */
  readonly widthPx: number;
}

export const RAIL_SHELL_CONFIG: RailShellConfig = Object.freeze({
  widthPx: 360
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/components/shell/rail-config.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/components/shell/rail-config.ts apps/atlas-web/test/components/shell/rail-config.test.ts
git commit -m "feat(atlas-web): RAIL_SHELL_CONFIG width constant + v1 contract for rail-shell (plan G)"
```

---

### Task 2: `RitualTimelineSlot` — dynamic import with placeholder fallback

**Files:**
- Create: `apps/atlas-web/components/shell/ritual-timeline-slot.tsx`
- Create: `apps/atlas-web/test/components/shell/ritual-timeline-slot.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/components/shell/ritual-timeline-slot.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";

// Reset module registry between tests so each describe block sees the
// dynamic-import resolution path it expects (mocked-existing vs mocked-missing).
beforeEach(() => {
  vi.resetModules();
});

describe("RitualTimelineSlot — placeholder branch (Plan E module not yet shipped)", () => {
  it("renders <div data-testid='ritual-timeline-host' /> when @/components/ritual/RitualTimeline cannot be imported", async () => {
    // Force the dynamic import inside the slot to reject — simulates Plan E
    // not having shipped its file yet. We mock the path to throw when imported.
    vi.doMock("@/components/ritual/RitualTimeline", () => {
      throw new Error("module not found (test-forced)");
    });
    const { RitualTimelineSlot } = await import("@/components/shell/ritual-timeline-slot");
    render(
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <RitualTimelineSlot projectId="p-1" />
      </Suspense>
    );
    await waitFor(() => {
      expect(screen.getByTestId("ritual-timeline-host")).toBeInTheDocument();
    });
  });
});

describe("RitualTimelineSlot — real component branch (Plan E shipped)", () => {
  it("renders the real <RitualTimeline /> when the module resolves", async () => {
    // Mock the Plan E module with a stand-in component so we can assert the
    // slot rendered IT and not the placeholder.
    vi.doMock("@/components/ritual/RitualTimeline", () => ({
      RitualTimeline: ({ projectId }: { projectId: string }) => (
        <div data-testid="ritual-timeline-real">timeline for {projectId}</div>
      )
    }));
    const { RitualTimelineSlot } = await import("@/components/shell/ritual-timeline-slot");
    render(
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <RitualTimelineSlot projectId="p-2" />
      </Suspense>
    );
    await waitFor(() => {
      expect(screen.getByTestId("ritual-timeline-real")).toBeInTheDocument();
    });
    expect(screen.getByText(/timeline for p-2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/atlas-web && pnpm test test/components/shell/ritual-timeline-slot.test.tsx
```

Expected: 2 fails — `Cannot find module '@/components/shell/ritual-timeline-slot'`.

- [ ] **Step 3: Write the slot component**

Create `apps/atlas-web/components/shell/ritual-timeline-slot.tsx`:

```typescript
"use client";

import React, { lazy, Suspense } from "react";

/**
 * RitualTimelineSlot — encapsulates the "is Plan E shipped yet?" decision.
 *
 * Plan G ships in parallel with Plan E; either order is merge-safe. To
 * avoid a hard dependency, the slot dynamic-imports the Plan E component
 * and falls back to a stable placeholder DOM element when the import
 * rejects. After Plan E lands, the placeholder is silently replaced by
 * the real timeline on next render — no edits to the slot needed.
 *
 * The fallback (`<div data-testid="ritual-timeline-host" />`) is the
 * stable contract: e2e tests + unit tests for the rail target this id
 * regardless of which plan landed first.
 *
 * Why React.lazy + a custom .catch wrapper: lazy() expects a module with
 * a `.default` export. Plan E exports `{ RitualTimeline }` as a named
 * export, so we adapt at the import boundary — the wrapper picks the
 * named export and re-shapes it as `{ default }`. On import failure,
 * we synthesize a placeholder module with the same shape.
 */

interface SlotProps {
  projectId: string;
}

interface PlaceholderProps {
  projectId: string;
}

function PlaceholderTimeline(_props: PlaceholderProps): React.ReactElement {
  // Stable id for tests — both unit and e2e assert on this id when Plan E
  // has not yet shipped. Once Plan E lands, the real component renders
  // instead and this branch is unreachable in production.
  return <div data-testid="ritual-timeline-host" />;
}

const LazyRitualTimeline = lazy<React.ComponentType<SlotProps>>(() =>
  import("@/components/ritual/RitualTimeline")
    .then((mod: { RitualTimeline?: React.ComponentType<SlotProps> }) => {
      if (!mod.RitualTimeline) {
        // Module loaded but did not export RitualTimeline — degrade to placeholder.
        return { default: PlaceholderTimeline };
      }
      return { default: mod.RitualTimeline };
    })
    .catch(() => ({ default: PlaceholderTimeline }))
);

export function RitualTimelineSlot({ projectId }: SlotProps): React.ReactElement {
  return (
    <Suspense fallback={<div data-testid="ritual-timeline-host" />}>
      <LazyRitualTimeline projectId={projectId} />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/atlas-web && pnpm test test/components/shell/ritual-timeline-slot.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/shell/ritual-timeline-slot.tsx apps/atlas-web/test/components/shell/ritual-timeline-slot.test.tsx
git commit -m "feat(atlas-web): RitualTimelineSlot — dynamic import + placeholder fallback for plan-E gap (plan G)"
```

---

### Task 3: `RailShell` — header, fixed-360px width, slots for ChatPanel + RitualTimelineSlot

**Files:**
- Create: `apps/atlas-web/components/shell/RailShell.tsx`
- Create: `apps/atlas-web/test/components/shell/RailShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/components/shell/RailShell.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock the ChatPanel to a stand-in so we don't drag its server-action
// dependency into this unit test — the rail's job is to MOUNT it, not
// exercise its inner behaviour (covered by ChatPanel.test.tsx).
vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="chat-panel-mock">chat for {projectId}</div>
  )
}));

// Mock the timeline slot — its own test file covers the real-vs-placeholder
// branching. Here we only need to assert the rail mounts SOMETHING for it.
vi.mock("@/components/shell/ritual-timeline-slot", () => ({
  RitualTimelineSlot: ({ projectId }: { projectId: string }) => (
    <div data-testid="ritual-timeline-host">timeline slot for {projectId}</div>
  )
}));

import { RailShell } from "@/components/shell/RailShell";

describe("RailShell — structural contract (Plan G v1)", () => {
  it("renders a header containing the projectId and an 'All projects' link", () => {
    render(<RailShell projectId="proj-abc" />);
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
    expect(header.textContent).toContain("proj-abc");
    const link = screen.getByRole("link", { name: /all projects/i });
    expect(link).toHaveAttribute("href", "/projects");
  });

  it("mounts the ChatPanel slot with the projectId", () => {
    render(<RailShell projectId="proj-abc" />);
    expect(screen.getByTestId("chat-panel-mock")).toBeInTheDocument();
    expect(screen.getByText(/chat for proj-abc/)).toBeInTheDocument();
  });

  it("mounts the RitualTimelineSlot with the projectId", () => {
    render(<RailShell projectId="proj-abc" />);
    expect(screen.getByTestId("ritual-timeline-host")).toBeInTheDocument();
    expect(screen.getByText(/timeline slot for proj-abc/)).toBeInTheDocument();
  });

  it("root element exposes data-rail-width-px='360' AND inline style width: 360px", () => {
    const { container } = render(<RailShell projectId="proj-abc" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("data-rail-width-px")).toBe("360");
    expect(root.style.width).toBe("360px");
  });

  it("root element has data-testid='rail-shell' for e2e + integration probes", () => {
    render(<RailShell projectId="proj-abc" />);
    expect(screen.getByTestId("rail-shell")).toBeInTheDocument();
  });

  it("re-renders with a new projectId by passing it through to children", () => {
    const { rerender } = render(<RailShell projectId="p-1" />);
    expect(screen.getByText(/chat for p-1/)).toBeInTheDocument();
    rerender(<RailShell projectId="p-2" />);
    expect(screen.getByText(/chat for p-2/)).toBeInTheDocument();
    expect(screen.queryByText(/chat for p-1/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/atlas-web && pnpm test test/components/shell/RailShell.test.tsx
```

Expected: 6 fails — `Cannot find module '@/components/shell/RailShell'`.

- [ ] **Step 3: Write the rail component**

Create `apps/atlas-web/components/shell/RailShell.tsx`:

```typescript
"use client";

import React from "react";
import Link from "next/link";
import { startRitual } from "@/lib/actions/startRitual";
import { ChatPanel } from "@/components/ChatPanel";
import { RAIL_SHELL_CONFIG } from "./rail-config";
import { RitualTimelineSlot } from "./ritual-timeline-slot";

/**
 * RailShell — the persistent left-rail mounted by the [projectId] layout
 * when the live-events feature flag is on. v1 is a fixed-width 360px
 * column with three regions:
 *
 *   ┌─────────────────────────────┐
 *   │ HEADER: ← All projects      │  flex-none, border-b
 *   │         <projectId>         │
 *   ├─────────────────────────────┤
 *   │ BODY:                       │  flex-1, overflow handled by ChatPanel
 *   │   <ChatPanel />             │
 *   │                             │
 *   ├─────────────────────────────┤
 *   │ FOOTER:                     │  flex-none, border-t
 *   │   <RitualTimelineSlot />    │
 *   └─────────────────────────────┘
 *
 * Width is sourced from RAIL_SHELL_CONFIG (a constant today; a hook in v2).
 * Rendered both as inline `style.width` (for browsers + jsdom) and as a
 * `data-rail-width-px` attribute (for tests that don't evaluate Tailwind).
 */
interface RailShellProps {
  projectId: string;
}

export function RailShell({ projectId }: RailShellProps): React.ReactElement {
  const cfg = RAIL_SHELL_CONFIG;
  return (
    <aside
      data-testid="rail-shell"
      data-rail-width-px={String(cfg.widthPx)}
      style={{ width: `${cfg.widthPx}px` }}
      className="flex h-full flex-none flex-col border-r border-slate-200 bg-white"
    >
      <header
        role="banner"
        className="flex flex-col gap-1 border-b border-slate-200 px-3 py-2"
      >
        <Link
          href="/projects"
          className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
        >
          ← All projects
        </Link>
        <div className="font-mono text-sm text-slate-900" title={projectId}>
          {projectId}
        </div>
      </header>
      <div className="flex flex-1 min-h-0 flex-col">
        <ChatPanel projectId={projectId} action={startRitual} />
      </div>
      <footer className="border-t border-slate-200 p-2">
        <RitualTimelineSlot projectId={projectId} />
      </footer>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/atlas-web && pnpm test test/components/shell/RailShell.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/shell/RailShell.tsx apps/atlas-web/test/components/shell/RailShell.test.tsx
git commit -m "feat(atlas-web): RailShell — fixed 360px left rail, header + ChatPanel + timeline slot (plan G)"
```

---

### Task 4: Rewrite `[projectId]/layout.tsx` — flag-on wraps with EventSourceProvider + RailShell

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/layout.tsx`
- Create: `apps/atlas-web/test/app/projects/layout-flag-branch.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/app/projects/layout-flag-branch.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// The layout is a Server Component; we test it by rendering it as if it
// were any async component (call it, await the promise, render the JSX).
// This pattern matches how the existing layout tests in the repo work.

// Mock the auth shim so the layout's auth gate passes.
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: vi.fn(async () => ({ userId: "test-user" })),
  currentUser: vi.fn(async () => ({ publicMetadata: { defaultPersona: "ama" } }))
}));

// Mock the persona prefs lookup so we don't need a real Pool.
vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({}))
}));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({
    getOverride: vi.fn(async () => null)
  }))
}));

// Mock the rail to a stand-in so we can detect mount/no-mount cleanly.
vi.mock("@/components/shell/RailShell", () => ({
  RailShell: ({ projectId }: { projectId: string }) => (
    <div data-testid="rail-shell-mock">rail for {projectId}</div>
  )
}));

// Mock EventSourceProvider similarly.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  EventSourceProvider: ({
    projectId,
    flagEnabled,
    children
  }: {
    projectId: string;
    flagEnabled: boolean;
    children: React.ReactNode;
  }) => (
    <div data-testid="event-source-provider-mock" data-project-id={projectId} data-flag={String(flagEnabled)}>
      {children}
    </div>
  )
}));

// The flag is read by the layout — mockable via the module mock.
const isFeatureEnabledMock = vi.fn();
vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags");
  return {
    ...actual,
    isFeatureEnabled: (...args: Parameters<typeof actual.isFeatureEnabled>) =>
      isFeatureEnabledMock(...args)
  };
});

import ProjectLayout from "@/app/projects/[projectId]/layout";

beforeEach(() => {
  isFeatureEnabledMock.mockReset();
});

async function renderLayout(flagOn: boolean) {
  isFeatureEnabledMock.mockImplementation((flag: string) =>
    flag === "live-events" ? flagOn : false
  );
  const element = await ProjectLayout({
    children: <div data-testid="page-children">page content</div>,
    params: Promise.resolve({ projectId: "proj-xyz" })
  });
  return render(element as React.ReactElement);
}

describe("ProjectLayout — flag OFF (today's behaviour, untouched)", () => {
  it("does NOT mount the RailShell when live-events is off", async () => {
    await renderLayout(false);
    expect(screen.queryByTestId("rail-shell-mock")).not.toBeInTheDocument();
  });

  it("renders the children directly (no rail wrapper)", async () => {
    await renderLayout(false);
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
  });
});

describe("ProjectLayout — flag ON (Plan G chrome)", () => {
  it("mounts the RailShell with the projectId", async () => {
    await renderLayout(true);
    const rail = screen.getByTestId("rail-shell-mock");
    expect(rail).toBeInTheDocument();
    expect(rail.textContent).toContain("proj-xyz");
  });

  it("wraps the entire subtree in EventSourceProvider with the same projectId + flagEnabled=true", async () => {
    await renderLayout(true);
    const provider = screen.getByTestId("event-source-provider-mock");
    expect(provider).toBeInTheDocument();
    expect(provider.getAttribute("data-project-id")).toBe("proj-xyz");
    expect(provider.getAttribute("data-flag")).toBe("true");
    // The page children must still render (inside the provider).
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/atlas-web && pnpm test test/app/projects/layout-flag-branch.test.tsx
```

Expected: 4 fails — the current layout has no flag branch; flag-on assertions fail because RailShell + EventSourceProvider mocks never mount.

- [ ] **Step 3: Rewrite the layout**

Replace the entire contents of `apps/atlas-web/app/projects/[projectId]/layout.tsx`:

```typescript
import Link from "next/link";
import { Pool } from "pg";
import { PreferencesRepo } from "@atlas/spec-graph-data";
import { auth, currentUser } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { EventSourceProvider } from "@/lib/events/EventSourceProvider";
import { RailShell } from "@/components/shell/RailShell";

/**
 * Project layout — wraps every route under /projects/[projectId]/* with
 * the per-project chrome (top nav + persona indicator) and, when the
 * live-events flag is on, the persistent left rail (ChatPanel +
 * RitualTimeline) backed by the project's SSE EventSource.
 *
 * Flag OFF: this layout renders the same chrome it always has — the top
 * nav + {children}. Pages mount their own ChatPanel as before.
 *
 * Flag ON: chrome stays, but {children} is rendered inside a flex
 * container alongside <RailShell />, and the entire subtree is wrapped
 * by <EventSourceProvider> so the rail's children (and any other
 * descendant) can read the live event stream via useEventStream().
 *
 * The flag is read once per request (env var lookup; cheap). The same
 * value is read by individual pages to decide whether to mount their own
 * ChatPanel — see e.g. canvas/page.tsx. SSR and client agree because
 * both sides import from @/lib/feature-flags.
 */
export default async function ProjectLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  // Resolve persona for this project (override → metadata → ama)
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new PreferencesRepo(pool);
  const override = await prefs.getOverride(userId, projectId);
  const user = await currentUser();
  const persona =
    override ?? (user?.publicMetadata?.defaultPersona as string | undefined) ?? "ama";

  const liveEventsOn = isFeatureEnabled("live-events");

  const topNav = (
    <nav className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
      <Link href={`/projects/${projectId}/canvas`} className="text-sm hover:underline">Canvas</Link>
      <Link href={`/projects/${projectId}/code`} className="text-sm hover:underline">Code</Link>
      <span className="ml-auto text-xs text-slate-500">Persona: {persona}</span>
    </nav>
  );

  // Flag OFF — preserve today's render exactly. The provider is NOT
  // mounted here on purpose: pages still own their own UX.
  if (!liveEventsOn) {
    return (
      <div className="flex flex-col">
        {topNav}
        {children}
      </div>
    );
  }

  // Flag ON — wrap with EventSourceProvider and lay out rail + main as
  // a horizontal flex. The provider's `flagEnabled` prop is true here so
  // it actually opens an EventSource (per Plan E.0's contract).
  return (
    <EventSourceProvider projectId={projectId} flagEnabled={true}>
      <div className="flex h-screen flex-col">
        {topNav}
        <div className="flex flex-1 min-h-0">
          <RailShell projectId={projectId} />
          <main className="flex-1 min-w-0 overflow-auto">{children}</main>
        </div>
      </div>
    </EventSourceProvider>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/atlas-web && pnpm test test/app/projects/layout-flag-branch.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/layout.tsx apps/atlas-web/test/app/projects/layout-flag-branch.test.tsx
git commit -m "feat(atlas-web): rewrite [projectId]/layout — flag-on RailShell + EventSourceProvider; flag-off pass-through (plan G)"
```

---

### Task 5: Gate `canvas/page.tsx` ChatPanel mount on `!isFeatureEnabled("live-events")`

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`
- Create: `apps/atlas-web/test/app/projects/canvas-chatpanel-gate.test.tsx`

- [ ] **Step 1: Verify no other page mounts ChatPanel — grep for the import**

```bash
cd apps/atlas-web && grep -rn "from \"@/components/ChatPanel\"" app/ components/
```

Expected: only `app/projects/[projectId]/canvas/page.tsx` and the rail's `components/shell/RailShell.tsx` (added in Task 3) import from `@/components/ChatPanel`. If grep returns more than these two files, add a Task 5b for each one mirroring this task — but do NOT modify `RailShell.tsx`'s mount (the rail is the flag-ON home).

- [ ] **Step 2: Write the failing tests**

Create `apps/atlas-web/test/app/projects/canvas-chatpanel-gate.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Stand-ins for the heavy server-side dependencies of the canvas page.
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: vi.fn(async () => ({
      previewUrl: "https://preview.test",
      record: { sandboxId: "sb-1" }
    }))
  })
}));

vi.mock("@/components/CanvasClient", () => ({
  CanvasClient: () => <div data-testid="canvas-client-mock" />
}));

// The CanvasPreviewClient lives under the page's _components folder.
vi.mock("@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient", () => ({
  CanvasPreviewClient: () => <div data-testid="canvas-preview-mock" />
}));

vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="chat-panel-mock">chat for {projectId}</div>
  )
}));

vi.mock("@/lib/actions/startRitual", () => ({
  startRitual: vi.fn()
}));

const isFeatureEnabledMock = vi.fn();
vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags");
  return {
    ...actual,
    isFeatureEnabled: (...args: Parameters<typeof actual.isFeatureEnabled>) =>
      isFeatureEnabledMock(...args)
  };
});

import CanvasPage from "@/app/projects/[projectId]/canvas/page";

beforeEach(() => {
  isFeatureEnabledMock.mockReset();
});

async function renderPage(flagOn: boolean) {
  isFeatureEnabledMock.mockImplementation((flag: string) =>
    flag === "live-events" ? flagOn : false
  );
  const element = await CanvasPage({ params: Promise.resolve({ projectId: "p-canvas" }) });
  return render(element as React.ReactElement);
}

describe("CanvasPage — ChatPanel gate (plan G)", () => {
  it("mounts ChatPanel when live-events is OFF (today's behaviour)", async () => {
    await renderPage(false);
    expect(screen.getByTestId("chat-panel-mock")).toBeInTheDocument();
    expect(screen.getByText(/chat for p-canvas/)).toBeInTheDocument();
  });

  it("does NOT mount ChatPanel when live-events is ON (the rail owns it)", async () => {
    await renderPage(true);
    expect(screen.queryByTestId("chat-panel-mock")).not.toBeInTheDocument();
    // The canvas itself still renders.
    expect(screen.getByTestId("canvas-client-mock")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/atlas-web && pnpm test test/app/projects/canvas-chatpanel-gate.test.tsx
```

Expected: 1 fail (`flag-on` case). The flag-off case currently passes because today's page always mounts ChatPanel.

- [ ] **Step 4: Modify `canvas/page.tsx` — gate the ChatPanel mount**

Replace the entire contents of `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`:

```typescript
import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
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

  // Plan G: when live-events is on, [projectId]/layout.tsx mounts a
  // persistent <RailShell /> that owns the ChatPanel. Mounting a second
  // ChatPanel here would double-render the chat history and split the
  // conversation across two trees — gate the local mount on the flag.
  const liveEventsOn = isFeatureEnabled("live-events");

  return (
    <main className="flex h-full">
      <section className="flex-1 flex flex-col">
        <CanvasPreviewClient
          projectId={projectId}
          sandboxId={sandboxId}
          previewUrl={previewUrl}
          previewError={previewError}
        />
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      {liveEventsOn ? null : <ChatPanel projectId={projectId} action={startRitual} />}
    </main>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/atlas-web && pnpm test test/app/projects/canvas-chatpanel-gate.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/canvas/page.tsx apps/atlas-web/test/app/projects/canvas-chatpanel-gate.test.tsx
git commit -m "feat(atlas-web): gate canvas-page ChatPanel on !live-events; rail owns chat when flag on (plan G)"
```

---

### Task 6: Verify flag-OFF byte-for-byte equivalence (manual diff + smoke test)

**Files:**
- No new files. This task is a verification gate.

- [ ] **Step 1: Run the entire atlas-web vitest suite with the flag unset**

```bash
cd apps/atlas-web && unset ATLAS_LIVE_EVENTS && pnpm test
```

Expected: every existing test still green. New tests from Tasks 1-5 also pass. No regressions in `ChatPanel.test.tsx`, `CanvasClient.test.tsx`, or any layout/page tests that pre-existed.

- [ ] **Step 2: Run typecheck**

```bash
cd apps/atlas-web && pnpm typecheck
```

Expected: `tsc --noEmit` exits 0. The new `RailShell.tsx`, `rail-config.ts`, `ritual-timeline-slot.tsx`, and the modified `layout.tsx` + `canvas/page.tsx` all type-check.

- [ ] **Step 3: Manual smoke — sign in with the flag OFF and verify today's UI is unchanged**

Steps the engineer should take by hand:

1. Verify `apps/atlas-web/.env.local` does NOT contain `ATLAS_LIVE_EVENTS=true` (comment it out or unset it).
2. `cd apps/atlas-web && pnpm dev`
3. Sign in, open an existing project's `/projects/<id>/canvas`.
4. Confirm: ChatPanel appears on the right (today's position); no left rail; top nav (Canvas / Code) renders; persona pill shows on the right.
5. Send a small request (e.g. "hello"); confirm architect plan card renders as before.

If any of these visibly changes from today's behaviour, the flag-off path is broken — fix before proceeding to Task 7.

- [ ] **Step 4: Commit (no-op trail marker if you made any inline fixes; otherwise skip)**

If Step 3 surfaced any inline-fixable regression and you fixed it, commit:

```bash
git add -A
git commit -m "fix(atlas-web): preserve flag-off render parity (plan G verification gate)"
```

If no fixes were needed, skip the commit and proceed to Task 7.

---

### Task 7: E2E spec — persistent chat across `/canvas → /code → /run` navigation

**Files:**
- Create: `apps/atlas-web/e2e/tests/plan-g-rail-shell.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `apps/atlas-web/e2e/tests/plan-g-rail-shell.spec.ts`:

```typescript
// Plan G — persistent left-rail e2e specs.
//
// Stack: live atlas-web (port 3000) with ATLAS_LIVE_EVENTS=true → real
// Postgres (port 5440) → real Clerk dev tenant. NO mocks; reuses the
// Plan D auth-state pattern (storageState from e2e/auth/diego.json).
//
// Run:
//   cd apps/atlas-web
//   ATLAS_LIVE_EVENTS=true pnpm dev   # in another terminal
//   pnpm test:e2e plan-g-rail-shell.spec.ts
//
// Required env (loaded from apps/atlas-web/.env.local automatically by
// playwright.config.ts):
//   - ATLAS_LIVE_EVENTS=true        (gates the rail mount)
//   - CLERK_SECRET_KEY              (provisions test users via Clerk admin)
//   - ATLAS_TEST_PASSWORD           (password for test users)
//
// These specs each take ~30-45s; the file as a whole runs in <2 minutes.

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

function requireLiveEventsFlag() {
  if (process.env.ATLAS_LIVE_EVENTS !== "true") {
    test.skip(
      true,
      "ATLAS_LIVE_EVENTS!=true; the rail does not mount. Set ATLAS_LIVE_EVENTS=true in .env.local + restart dev server."
    );
  }
}

// ===================================================================
// Spec 1: chat survives navigation between /canvas, /code, /run
// ===================================================================
test.describe("plan-g rail shell: persistent chat", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("ChatPanel DOM persists + textarea value preserved across /canvas → /code → /run", async ({ page }) => {
    test.setTimeout(120_000);
    requireAuthState();
    requireLiveEventsFlag();

    const projectId = await openCanvasOnFreshProject(page);

    // Rail is mounted by [projectId]/layout — must be present on /canvas.
    const rail = page.getByTestId("rail-shell");
    await expect(rail).toBeVisible();

    // Capture the rail's React fiber sentinel: on each navigation we'll
    // assert this same DOM element survives. We cannot use Playwright's
    // ElementHandle equality directly across navs, so we tag the rail
    // with a unique data-attr we set ourselves; if the rail unmounted +
    // remounted the attr would be gone.
    await rail.evaluate((el) => {
      el.setAttribute("data-persistence-probe", "set-on-canvas");
    });

    // Type a value into the chat textarea — this is the strongest
    // proof of "same React tree": React state survives.
    const textarea = page.getByPlaceholder(/Describe your change/i);
    await textarea.fill("draft message that must survive nav");

    // Navigate to /code — the rail must still be present, the
    // persistence probe attr we set must still be there, and the
    // textarea value must be preserved.
    await page.goto(`/projects/${projectId}/code`);
    await expect(page.getByTestId("rail-shell")).toBeVisible();
    await expect(page.getByTestId("rail-shell")).toHaveAttribute(
      "data-persistence-probe",
      "set-on-canvas"
    );
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveValue(
      "draft message that must survive nav"
    );

    // Navigate to /run — same assertions.
    await page.goto(`/projects/${projectId}/run`);
    await expect(page.getByTestId("rail-shell")).toBeVisible();
    await expect(page.getByTestId("rail-shell")).toHaveAttribute(
      "data-persistence-probe",
      "set-on-canvas"
    );
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveValue(
      "draft message that must survive nav"
    );

    // Navigate back to /canvas — page should NOT have its own ChatPanel
    // anymore (flag-on path); only the rail's chat should be visible.
    // We assert this by counting matches: there must be exactly ONE
    // textarea matching the placeholder.
    await page.goto(`/projects/${projectId}/canvas`);
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveCount(1);
  });
});

// ===================================================================
// Spec 2: switching projects re-keys the rail
// ===================================================================
test.describe("plan-g rail shell: project switch re-key", () => {
  test.use({ storageState: TEST_PERSONA_FILE });

  test("navigating to a different project re-mounts the rail (chat history clears)", async ({ page }) => {
    test.setTimeout(180_000);
    requireAuthState();
    requireLiveEventsFlag();

    // First project
    const projectIdA = await openCanvasOnFreshProject(page);
    const rail = page.getByTestId("rail-shell");
    await expect(rail).toBeVisible();
    // Tag the rail so we can detect re-mount.
    await rail.evaluate((el) => {
      el.setAttribute("data-persistence-probe", "set-on-project-A");
    });
    // Type something distinctive in project A's chat.
    await page
      .getByPlaceholder(/Describe your change/i)
      .fill("project-A draft");

    // Create a second project (project B).
    const projectIdB = await openCanvasOnFreshProject(page);
    expect(projectIdB).not.toBe(projectIdA);

    // The rail must still be present on project B's pages.
    const newRail = page.getByTestId("rail-shell");
    await expect(newRail).toBeVisible();

    // The persistence probe MUST be gone — the layout re-rendered with
    // a new projectId, so React tore down the old subtree and built a
    // fresh one. (If the rail had survived as the same DOM, the probe
    // would still be set.)
    await expect(newRail).not.toHaveAttribute(
      "data-persistence-probe",
      "set-on-project-A"
    );

    // The chat textarea on project B must be empty — fresh React state.
    await expect(page.getByPlaceholder(/Describe your change/i)).toHaveValue("");

    // The header must show project B's id, not project A's.
    const header = page.getByRole("banner");
    await expect(header).toContainText(projectIdB);
    await expect(header).not.toContainText(projectIdA);
  });
});

// ===================================================================
// Helper: navigate to a fresh project's canvas; returns the projectId.
// ===================================================================
async function openCanvasOnFreshProject(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("link", { name: /new project/i }).click();
  await page.waitForURL("**/projects/new");
  const projectName = `e2e-g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.getByLabel(/name|project/i).first().fill(projectName);
  await page
    .getByRole("button", { name: /create|continue|start/i })
    .first()
    .click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+\/canvas/, { timeout: 30_000 });
  // Extract the projectId from the URL.
  const url = page.url();
  const match = url.match(/\/projects\/([a-f0-9-]+)\/canvas/);
  if (!match) throw new Error(`Could not extract projectId from URL: ${url}`);
  return match[1]!;
}
```

- [ ] **Step 2: Run the e2e spec — flag must be on**

In one terminal:

```bash
cd apps/atlas-web && ATLAS_LIVE_EVENTS=true pnpm dev
```

In another:

```bash
cd apps/atlas-web && ATLAS_LIVE_EVENTS=true pnpm test:e2e plan-g-rail-shell.spec.ts
```

Expected: 2 specs pass. Spec 1 takes ~30-45s (two project creations + three navigations); Spec 2 takes ~45-90s (two project creations).

If either spec is skipped, check the `ATLAS_LIVE_EVENTS` env in the dev server's terminal AND in the test runner's terminal — both must be `true`.

- [ ] **Step 3: Re-run with the flag OFF — both specs must SKIP cleanly**

Stop the dev server, restart without the flag:

```bash
cd apps/atlas-web && pnpm dev
```

```bash
cd apps/atlas-web && pnpm test:e2e plan-g-rail-shell.spec.ts
```

Expected: 2 specs SKIPPED with the message "ATLAS_LIVE_EVENTS!=true; the rail does not mount." This proves the spec is gated correctly and the flag-off path is unaffected.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/e2e/tests/plan-g-rail-shell.spec.ts
git commit -m "test(atlas-web): e2e — persistent rail across nav + project-switch re-key (plan G)"
```

---

### Task 8: Full-suite verification + typecheck

**Files:**
- No new files. Verification gate.

- [ ] **Step 1: Run the entire atlas-web vitest suite**

```bash
cd apps/atlas-web && pnpm test
```

Expected: every test file green. New test counts (estimated): `rail-config.test.ts` (2), `ritual-timeline-slot.test.tsx` (2), `RailShell.test.tsx` (6), `layout-flag-branch.test.tsx` (4), `canvas-chatpanel-gate.test.tsx` (2). Total Plan G additions: ~16 cases.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/spec-graph-data typecheck 2>/dev/null || true
```

Expected: atlas-web typecheck clean. Cross-package typecheck on `@atlas/spec-graph-data` (the only workspace package layout.tsx imports from) also clean.

- [ ] **Step 3: Run the e2e spec one final time with the flag on**

```bash
cd apps/atlas-web && ATLAS_LIVE_EVENTS=true pnpm test:e2e plan-g-rail-shell.spec.ts
```

Expected: 2 specs pass. (Pre-req: dev server running with `ATLAS_LIVE_EVENTS=true` in another terminal.)

- [ ] **Step 4: Commit if any inline fixes were needed; otherwise skip**

If the full-suite run surfaced any regression in tests outside the Plan G surface area and you fixed it inline:

```bash
git add -A
git commit -m "fix(atlas-web): post-Plan-G full-suite green (plan G verification gate)"
```

Otherwise, no commit.

---

### Task 9: Update local-dev-status doc

**Files:**
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Find and update the relevant sections**

Open `docs/superpowers/local-dev-status.md`. Find the "What's NOT wired (deferred)" section.

Remove any bullet referencing "persistent left rail", "rail shell", or "Plan G" from the deferred list.

In the "What's wired" section, append a new bullet (alphabetical after the existing Plan E.0 bullet, if present):

```markdown
- **Plan G: persistent left-rail chat shell.** When `ATLAS_LIVE_EVENTS=true`, `apps/atlas-web/app/projects/[projectId]/layout.tsx` wraps every project sub-route with `<EventSourceProvider>` + a 360px `<RailShell />` containing `<ChatPanel />` and the `<RitualTimelineSlot />`. Chat history + textarea state survive navigation between `/canvas`, `/code`, `/run`. Switching projects re-keys the rail (fresh React tree). Flag-OFF path is unchanged: `/canvas/page.tsx` mounts its own ChatPanel as before; layout passes `{children}` through with no wrapper.
```

- [ ] **Step 2: Verify the doc renders cleanly**

```bash
cd "F:/claude/ai_builder" && grep -n "Plan G" docs/superpowers/local-dev-status.md
```

Expected: at least one match in the "What's wired" section; zero matches in "What's NOT wired".

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/local-dev-status.md
git commit -m "docs(plan-g): mark persistent left-rail shipped in local-dev-status"
```

---

### Task 10: Mark plan shipped + merge `plan-g/rail-shell` to main

**Files:**
- Modify: `docs/superpowers/plans/2026-04-28-plan-g-rail-shell.md` (this file)

- [ ] **Step 1: Append the Shipped section to this plan file**

Append to `docs/superpowers/plans/2026-04-28-plan-g-rail-shell.md`:

```markdown
---

## Shipped

All 10 tasks merged to `plan-g/rail-shell` and then to `main`. `pnpm typecheck` clean (atlas-web). atlas-web vitest added ~16 cases across 5 new test files. E2E spec `plan-g-rail-shell.spec.ts` passes with `ATLAS_LIVE_EVENTS=true`; skips cleanly when the flag is unset. Flag-OFF path verified byte-for-byte same as pre-G via Task 6 manual smoke.
```

- [ ] **Step 2: Commit the shipped marker**

```bash
git add docs/superpowers/plans/2026-04-28-plan-g-rail-shell.md
git commit -m "docs(plan-g): mark shipped — persistent left-rail behind ATLAS_LIVE_EVENTS"
```

- [ ] **Step 3: Merge the branch to main**

```bash
git checkout main
git pull
git merge --no-ff plan-g/rail-shell -m "Merge branch 'plan-g/rail-shell'

Plan G — persistent left-rail chat shell behind ATLAS_LIVE_EVENTS.
- New <RailShell /> (360px fixed, future-v2 width contract via rail-config.ts)
- New RitualTimelineSlot (dynamic import + placeholder; safe ahead of Plan E)
- Rewrote [projectId]/layout.tsx — flag-on EventSourceProvider+rail wrap, flag-off pass-through
- Gated canvas/page.tsx ChatPanel on !live-events
- E2E covers nav-persistence + project-switch re-key
"
```

Expected: a merge commit lands on `main`.

- [ ] **Step 4: Verify main is green**

```bash
cd apps/atlas-web && pnpm test && pnpm typecheck
```

Expected: green.

- [ ] **Step 5: Push (optional — only if remote work was authorised)**

If the user authorised pushing this branch+merge upstream:

```bash
git push origin main
```

Otherwise skip — leave the merge local for the user to push.

---

## Completion Checklist

After all 10 tasks:

- [ ] `pnpm typecheck` (atlas-web) — clean
- [ ] `pnpm test` (atlas-web) — full suite green; +16 new cases across 5 new test files (`rail-config.test.ts`, `ritual-timeline-slot.test.tsx`, `RailShell.test.tsx`, `layout-flag-branch.test.tsx`, `canvas-chatpanel-gate.test.tsx`)
- [ ] `pnpm test:e2e plan-g-rail-shell.spec.ts` with `ATLAS_LIVE_EVENTS=true` — 2 specs pass
- [ ] `pnpm test:e2e plan-g-rail-shell.spec.ts` without the flag — 2 specs SKIPPED cleanly
- [ ] Manual smoke (Task 6) — flag-off render is byte-for-byte identical to pre-Plan-G
- [ ] Manual smoke — flag-on render shows the rail on `/canvas`, `/code`, and `/run`; chat survives nav; project switch clears chat state
- [ ] `docs/superpowers/local-dev-status.md` updated — Plan G moved to "What's wired"
- [ ] This plan file marked Shipped at the bottom
- [ ] `plan-g/rail-shell` merged to `main`

---

## Shipped

All 10 tasks merged to `plan-g/rail-shell` and then to `main`. `pnpm typecheck` clean (atlas-web + @atlas/spec-graph-data). atlas-web vitest added 16 cases across 5 new test files (`rail-config.test.ts`, `ritual-timeline-slot.test.tsx`, `RailShell.test.tsx`, `layout-flag-branch.test.tsx`, `canvas-chatpanel-gate.test.tsx`); each new file passes individually and all 16 pass when run together. E2E spec `plan-g-rail-shell.spec.ts` registers 2 tests with Playwright (`--list` confirmed); live execution requires a running dev server with `ATLAS_LIVE_EVENTS=true` + `e2e/auth/diego.json` (Plan D auth state) and is documented in the spec header. Pre-existing flaky parallel-run failures in `test/lib/engine/factory.test.ts`, `test/app/auth/callback.test.ts`, `test/lib/sandbox/factory.test.ts`, `test/components/PersonaToggle.test.tsx`, `test/lib/engine/event-sink.test.ts`, `test/actions/escalateRitual.test.ts`, and `test/integration/broker-sse-roundtrip.test.ts` reproduce on `main` and are unrelated to Plan G surface area (each test passes when run individually). Flag-OFF behavioural lock: layout pass-through preserved; canvas/page.tsx still mounts ChatPanel; no Plan G test fails when `ATLAS_LIVE_EVENTS` is unset.
