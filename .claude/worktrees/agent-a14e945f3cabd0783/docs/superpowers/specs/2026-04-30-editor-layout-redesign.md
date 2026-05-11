# Editor Layout Redesign — Design

**Date:** 2026-04-30
**Status:** Awaiting user review
**Plans this spec produces:** one (working title: Plan R — Two-zone editor shell with always-on status strip)

---

## Problem

Today the project canvas page packs five competing surfaces into one fixed-ratio grid:

1. Top nav (Canvas | Code | persona)
2. Left rail (~360px, fixed): live progress + chat history + chat input
3. Center column: viewport pills (Desktop / Tablet / Mobile) + a small live-preview iframe
4. Right column: "Click a node to inspect" — empty 99% of the time
5. Bottom-left: canvas zoom controls

Real-user pain points (from this session's transcript, treated as interview data):

- "Preview iframe is small/cramped — not full-screen-able" — preview is the artifact but gets the smallest pixel share after the inspector and rail
- "Panels are fixed-width — no resize handles" — user has no spatial control
- "Doesn't update the leftnav for updates" / "couldn't look at the preview" (twice in the same session) — visibility of system status fails when the rail is the *only* place feedback lives
- "I want to see AI site builder in action" — the emotional gain ("watching the AI work") isn't designed for; today's timeline is flat text

The combination produces a screen that does each of the four real jobs (chat, watch progress, evaluate the result, switch viewports) mediocrely. The AI-builder mental model the user references is v0 / Lovable / bolt.new — uniformly two- or three-zone resizable layouts with the preview as the canvas.

## Goals

1. **Preview is the canvas.** Default the preview to the largest pixel share; make it expandable to near-fullscreen.
2. **User owns the layout.** Resizable horizontal divider between the chat zone and the preview zone, with persistence across reloads.
3. **Visibility of system status survives panel collapse.** A thin always-on status strip (Geist Mono) shows the current ritual phase + duration, even when the chat zone is collapsed to its 48px icon-strip state.
4. **Live progress stays prominent inside the chat zone.** Architect → Developer → Sandbox → Security → Accessibility rows remain the most recognizable signal of work-in-flight.
5. **Vercel/Geist visual language.** Geist Sans for prose, Geist Mono for ritual IDs / log lines / durations; minimal palette with status-only color (emerald/amber/slate/red); generous whitespace on a strict 8px grid.
6. **Implementation is additive.** No flag-off regressions; existing `<RailShell>`, `<ChatPanel>`, `<RitualTimeline>`, `<CanvasPreviewClient>` components are reused; the redesign is a new layout shell that mounts them, not a rewrite of any of them.

## Non-Goals

- Three-pane (chat + Monaco + preview) IDE layout (bolt.new shape) — defer; the `Code` top-nav route already gives a fullscreen Monaco view.
- Visual-edits (click on the preview to edit a class, à la Lovable) — defer; requires a content-script bridge into the iframe.
- Multi-tab chat (multiple concurrent rituals visible) — defer.
- Spec-graph canvas + node inspector inside the editor view — moves to the existing `Canvas` top-nav route only (decision (a) from the brainstorm).
- Dark mode — design supports it but light mode is the only theme shipped in this plan.
- Mobile / small-viewport layouts — defer; the editor is desktop-first.

## Architecture

### Component tree

```
<ProjectLayout>                                    (existing — apps/atlas-web/app/projects/[projectId]/layout.tsx)
  ├─ <TopNav>                                      (existing inline)
  ├─ <RitualStatusStrip projectId={...} />         (NEW — 32px, always rendered when ATLAS_LIVE_EVENTS on)
  └─ <EditorShell>                                 (NEW)
        ├─ <ResizablePanel side="left">            (NEW — wraps RailShell)
        │     <RailShell projectId multiTurnFlag /> (existing — internals unchanged)
        │
        ├─ <ResizableHandle />                     (NEW)
        │
        └─ <ResizablePanel side="right">           (NEW — wraps the page's children)
              {children}                           (today: <CanvasPage>, <CodePage>, etc.)
```

### Resizable behavior

Library: **`react-resizable-panels`** (~10kb gzip, MIT, Vercel-maintained, used by v0 and shadcn). Headless / unstyled — we wrap with our own classNames so Geist styling stays in our control.

Behavior:
- Default split: chat 35% / preview 65%.
- Drag range: chat 15% – 85%.
- Both panels collapse to a 48px icon strip (chevron click); restoring re-expands to last drag width.
- Persist `{leftWidthPct, leftCollapsed, rightCollapsed}` to `localStorage` keyed by `projectId` so each project remembers its layout. SSR-safe: server renders defaults; client hydrates and overrides.

### `<RitualStatusStrip>` (the new always-on strip)

A 32px-tall horizontal bar mounted just under the top nav, above `<EditorShell>`. Subscribes to the same `useEventStream()` hook the timeline uses, but folds events into a single line:

```
●  Auto-fix #2 · Accessibility · 32s         ↻ Reload preview   ⤢ Open in new tab
```

Rules:
- **Idle (no ritual in flight):** strip renders `Idle · ready` in slate.
- **Active phase:** strip pulses; phase name + elapsed seconds in Geist Mono.
- **Auto-fix mode:** prefix with `Auto-fix #N · ` (uses Plan L's `autoFixAttempts`).
- **Failure / escalation:** strip turns red; collapses to `Escalated · <gate> · click to expand`.
- Color is the ONLY visual change; no animation beyond a subtle 1.5s pulse on the leading dot during active state.

The strip is the **safety net for the visibility-of-system-status heuristic**: collapsing the chat zone (and therefore the timeline) is now a safe action.

### Live progress moved inside the chat zone

`<RitualTimeline>` (today mounted in the rail header via `<RitualTimelineSlot>`) gets one structural change: a collapsible `<details>` wrapper labeled "Live progress" with a chevron. Default state:

- **Expanded** while no preview content has been generated yet (first ritual hasn't completed sandbox apply).
- **Collapsed** automatically once `sandbox.apply.completed` fires for any ritual on this project (the strip now carries the trust load; users can expand the timeline if they want detail).

This is a small reducer change; the timeline's row rendering is unchanged.

### Preview zone toolbar

Refactor `<CanvasPreviewClient>`'s top toolbar to a Geist-style segmented control + actions row:

```
┌──────────────────────────────────────────────────┐
│ [Desktop] [Tablet] [Mobile]   ↻ Reload   ⤢ Open │
└──────────────────────────────────────────────────┘
```

- Segmented control (32px tall, Geist Mono labels).
- `↻ Reload preview` — manual override of the auto-reload-on-apply behavior from Plan F.
- `⤢ Open in new tab` — opens the sandbox preview URL in a new tab so the user can full-screen the website itself.

The "Reload preview" link in the previous design (visible in the screenshot, top of preview) becomes the iconified `↻` button.

### Removed / relocated surfaces

| Surface | Today | After |
|---|---|---|
| "Click a node to inspect" panel | Always rendered, ~25% of width | Removed from this view entirely. Returns inside the `Canvas` page only when a spec-graph node is selected. |
| Spec-graph canvas (`<CanvasClient>`) | Always rendered below preview | Reachable via `Canvas` top-nav link only. The editor view is preview-first. |
| Bottom-left zoom controls | Always rendered | Move to the `Canvas` page (where they belong contextually). |
| Code editor | `Code` top-nav link | Unchanged — fullscreen Monaco at `/projects/[id]/code`. |

## Visual language (Vercel/Geist)

- **Type:** Geist Sans 14px for chat / nav / titles; Geist Mono 12–13px for ritual IDs, durations, log lines, the status strip text, and segmented-control labels. (Today the project uses system-ui everywhere; this plan adds the `geist` package to atlas-web.)
- **Spacing:** strict 8px grid (`p-1`, `p-2`, `p-3`, `p-4` only — drop `p-1.5`, `p-2.5` etc.).
- **Color (status-only):**
  - emerald-600 — done / passed
  - amber-500 — active (with the dot's 1.5s pulse)
  - slate-400 — pending / idle
  - red-600 — failed / escalated
  - All chrome (borders, dividers, backgrounds) stays in slate-50…slate-900 with no other accents.
- **Borders:** 1px slate-200 dividers; 1px slate-300 on focused inputs; never use shadow elevation for layout (kept for cards inside the chat history only).
- **Resize handles:** 4px wide invisible hit area; visible 1px slate-200 bar that brightens to slate-400 on hover; cursor `col-resize`.
- **Empty states:** when the iframe has no URL yet (sandbox provisioning), show a Vercel-style dotted-grid backdrop with a single Geist Mono line: `provisioning sandbox · ~5s`.

## Data flow & state

No new server state. All new state is client-side:

| State | Owner | Persistence |
|---|---|---|
| `leftWidthPct: number` (15–85, default 35) | `<EditorShell>` | localStorage `atlas:editorLayout:<projectId>` |
| `leftCollapsed: boolean` (default false) | `<EditorShell>` | localStorage same key |
| `rightCollapsed: boolean` (default false) | `<EditorShell>` | localStorage same key |
| `timelineOpen: boolean` (default true; auto-flips to false on first `sandbox.apply.completed`) | `<RitualTimeline>` | sessionStorage `atlas:timelineOpen:<projectId>` |

`<RitualStatusStrip>` derives entirely from `useEventStream()` — no own state.

## Feature flag

Wraps in a single new flag: **`ATLAS_EDITOR_LAYOUT_V2`**.

- **Off (default in code):** today's `<ProjectLayout>` body — `<TopNav>` + `<RailShell>` + `{children}` in the existing flex row. No new components mount, no `react-resizable-panels` import in the bundle (dynamic-import gated).
- **On:** new `<RitualStatusStrip>` + `<EditorShell>` mount; `<RailShell>` and the `{children}` page become panels inside the resizable shell.

Cross-flag interaction: the editor-layout-v2 flag does NOT depend on `ATLAS_LIVE_EVENTS`. With live-events off, the status strip renders `Idle · ready` permanently and the timeline section in the chat zone hides itself (same as today's behaviour).

## Failure modes & error handling

- **localStorage corrupt / missing:** fall back to defaults; never crash.
- **Width persisted out of range** (e.g., user manually edited storage): clamp to 15–85.
- **`react-resizable-panels` errors:** caught in an error boundary that falls back to a non-resizable two-column grid (chat 35% / preview 65%) so the user is never stuck on a blank screen.
- **Status strip without a SSE connection:** renders `Disconnected · retrying` in amber, no animation.

## Testing strategy

- **Unit tests** (vitest):
  - `<RitualStatusStrip>` derives the correct line for each event sequence (idle, active, auto-fix #2, escalated, failed)
  - `<EditorShell>` reads + writes localStorage; clamps out-of-range widths; SSR-safe (no `window` access at render time)
  - Persisted state survives full unmount/remount
- **Integration test** (vitest + @testing-library/react):
  - mount `<ProjectLayout>` with a fixed event sequence; assert strip text + timeline state at each step
- **Visual regression** (deferred; not required by this plan):
  - the existing `RailShell.test.tsx` continues to assert presence + projectId pass-through; new structural tests added for the editor shell
- **Flag-off behavioural lock** (mandatory; established pattern from Plan E.0):
  - one test that flips the flag off and asserts the layout matches today's exact DOM (`<TopNav>` + `<RailShell>` siblings, no status strip, no resize handle).

## Migration / rollout

1. Land the flag-off behavioural lock test FIRST (red → green only when flag is off).
2. Add `react-resizable-panels` and `geist` to `apps/atlas-web/package.json`.
3. Build `<RitualStatusStrip>` in isolation (own tests).
4. Build `<EditorShell>` in isolation (own tests + integration test).
5. Wire both into `<ProjectLayout>` behind the new flag.
6. Flip `ATLAS_EDITOR_LAYOUT_V2=true` in `.env.local` for local testing only; default-off in code.
7. After visual confirmation, flip default-on in code and remove the off branch.

## Open questions

None at design time. Implementation will surface answers; if any are unanswerable inline, the plan will pause and ask.

## Sources

- [Vercel Geist Design System](https://vercel.com/geist/introduction)
- [Vercel aesthetic: complete guide to Blueprint Grid design (Setproduct)](https://www.setproduct.com/blog/complete-guide-to-blueprint-grid-design)
- [Lovable vs Bolt vs V0 (Lovable, 2026)](https://lovable.dev/guides/lovable-vs-bolt-vs-v0)
- [Bolt vs Lovable vs V0 in 2026 (UI Bakery)](https://uibakery.io/blog/bolt-vs-lovable-vs-v0)
- [Choosing your AI prototyping stack (Anna Arteeva, Medium)](https://annaarteeva.medium.com/choosing-your-ai-prototyping-stack-lovable-v0-bolt-replit-cursor-magic-patterns-compared-9a5194f163e9)
- `react-resizable-panels` — https://github.com/bvaughn/react-resizable-panels
