# Canvas in-place editing — design spec

**Date:** 2026-05-13
**Author:** brainstorming session (Atlas)
**Status:** draft — awaiting user review before writing-plans handoff

---

## Goal

Let users edit the rendered website *directly inside the preview iframe* — click any element, change its text, restyle it, replace its image, restructure its section, or describe a change in plain English — and have those edits flow back into the actual source files in the sandbox so the change persists across reloads, surfaces in the Code view, and is committable to git.

The bar: **non-developer founders (Atlas's "Ama" persona) should be able to make typo fixes, color tweaks, section additions, and image swaps without ever opening the Code view.** The professional-tier customer (Diego/Priya) can drop into the Code view at any time and see the same source.

## Non-goals

- Multi-user simultaneous editing (single-user assumption).
- Versioned drafts / branches — out of scope; lives at the spec-graph layer.
- Editing the underlying token/theme system (already shipped via `ElementInspector`).
- Real-time collaborative cursors.
- Mobile gesture support beyond what touch + click already give us.

## What's already in the codebase (reused)

- **`atlas-edit-bridge.ts`** (sandbox template): walks the DOM, posts a tree of `{selector, tag, text, rect, classes}` nodes to parent over `postMessage`. Listens for `atlas-apply-class` to mutate `el.className` at runtime.
- **`IframeOverlay`**: draws hit-zones, fires `onSelect(node)`.
- **`useElementSelection`**: keeps the latest DOM tree + selected node.
- **`ElementInspector`**: Haiku-proposed axes → token-backed style patches via `applyElementAxisChange`.
- **Left-rail `ChatPanel`** (already mounted in `RailShell`): the only chat surface; refine-by-default flows through `refineRitual`.

## UX

### Selection + floating action toolbar

When the user clicks any element in the preview iframe:

1. The existing `IframeOverlay` highlights the element (already shipped).
2. A small floating action toolbar appears anchored *above* the element (or below if near the viewport top).
3. The toolbar contains 3–5 quick-action buttons sized to the element type:
   - `<h1>…<p>`, text spans: **[Edit text] [Style] [Ask AI] [⋯]**
   - `<img>`: **[Replace image] [Alt text] [Ask AI] [⋯]**
   - `<section>`, `<div>`: **[Style] [Ask AI] [Delete] [⋯]**
   - Buttons inside cards/lists: **[Edit text] [Style] [Duplicate] [⋯]**
4. `⋯` opens a context menu with structural actions (Delete, Duplicate, Wrap in section, Move up/down).
5. Right-click on any element opens the same context menu directly.
6. Clicking outside the element (in the iframe) dismisses both the highlight and the toolbar.

### Edit-text (inline)

- Clicking **Edit text** (or double-clicking the element) makes the element `contenteditable`, focuses the cursor.
- User types changes; `blur` or `Enter` commits.
- Optimistic update is immediate (the contenteditable mutation IS the iframe state); a `text-replace` patch is sent to the server in parallel and writes the source.
- If the source write fails, the iframe DOM is reverted to its prior value and a small red toast surfaces.

### Style (inspector popover)

- Clicking **Style** opens the existing `ElementInspector` as a *popover anchored to the element* (not as a side rail). Width: ~280px.
- Haiku axes load as today; slider drags emit `style-token-patch` patches.
- Clicking outside the popover dismisses it.

### Ask AI (selection-scoped chat)

- Clicking **Ask AI** focuses the left-rail `ChatPanel` textarea and prepends a **selection chip**: `Editing: <h2>Welcome to…</h2>`.
- The chip is removable (click ✕ to deselect).
- The user types a natural-language instruction. On submit, the server action sends a *focused refine* dispatch with the selector + the element's source slice + the instruction, NOT a full ritual re-run.
- The developer returns a minimal diff scoped to the touched file. The patch engine applies it; iframe HMR reflects the change.
- If chat receives a turn with NO selection chip, it falls back to today's project-level refine behavior.

### Image edit

- Clicking on an `<img>` shows toolbar **[Replace image] [Alt text] [Ask AI] [⋯]**.
- **Replace image** opens a small popover with three actions:
  1. Drop a file — uploaded to `.next/cache/atlas-assets/<sha>.jpg` (reuses `uploadReference` flow), `src=` rewritten in source.
  2. Paste URL — `src=` rewritten in source.
  3. Regenerate with AI — single-image AssetGenerator pass with a prompt seeded from the existing alt + an optional user tweak. Lands in the same cache + source.
- **Alt text** — simple inline text input, writes `alt=` attribute.

### Context menu / structural

- **Delete** — `dom-mutation { op: "delete" }` — AST removes the JSX node + ancestor empty wrapper if any.
- **Duplicate** — `dom-mutation { op: "duplicate" }` — clones the JSX node, inserts adjacent.
- **Wrap in section** — `dom-mutation { op: "wrap", tag: "section" }` — wraps the node in a new JSXElement.
- **Move up / Move down** — `dom-mutation { op: "reorder" }` — swap with previous/next JSX sibling.

### Undo / redo

- Browser keyboard shortcuts (`Cmd+Z` / `Cmd+Shift+Z`) at the canvas level pop the most recent patch from the per-project undo stack, send its inverse to the patch engine.
- Each patch is reversible. The bridge knows how to invert optimistic actions; the source writer knows how to invert AST mutations using the captured pre-state.
- A small "↶ Undo" / "↷ Redo" pair sits in the canvas header.

### History sidebar (V2 — not in v1)

Out of scope for the first ship. Mention only so the architecture leaves room: every committed patch carries a UUID + summary; a future right-rail panel can list them.

---

## Architecture

```
┌─────────────────────── Selection (existing) ──────────────────────────┐
│ atlas-edit-bridge + IframeOverlay + useElementSelection                │
└───────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌─────────────────────── Input layers (multiple) ───────────────────────┐
│  Floating toolbar (NEW)                                                │
│   ├─ Inline contenteditable                  → text-replace patch     │
│   ├─ ElementInspector (existing, anchored)   → style-token-patch      │
│   ├─ Image popover (NEW)                     → asset-swap patch       │
│   ├─ Context menu (NEW)                      → dom-mutation patch     │
│   └─ Ask AI button (NEW)                     → focuses left-rail chat │
│  Left-rail ChatPanel (existing) + selection chip (NEW)                 │
│   └─ Selection-aware submit                  → ai-rewrite patch       │
└───────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────── Patch engine (NEW) ────────────────────────────┐
│ Patch types (discriminated union):                                      │
│   { kind: "text-replace",       atlasId, oldText, newText }             │
│   { kind: "style-token-patch",  tokenKey, value }                       │
│   { kind: "style-class-patch",  atlasId, classChanges }                 │
│   { kind: "asset-swap",         atlasId, newUrl, newAlt? }              │
│   { kind: "dom-mutation",       atlasId, op, payload? }                 │
│   { kind: "ai-rewrite",         atlasId, instruction }                  │
│                                                                          │
│ Each patch has:                                                          │
│   - applyOptimistic(bridge): instant iframe update via postMessage      │
│   - applySource(sandbox):    write to source files                      │
│   - invert(): produces the inverse patch for undo                        │
└──────────────────────┬────────────────────────────────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌─────────────────────┐   ┌─────────────────────────────────┐
│ Optimistic layer    │   │ Source writer (sandbox)         │
│ bridge postMessage  │   │  • text-replace, style-class,   │
│  atlas-apply-text   │   │    asset-swap, dom-mutation     │
│  atlas-apply-class  │   │      → AST traversal + write   │
│  atlas-replace-img  │   │  • style-token-patch            │
│  atlas-delete-node  │   │      → design-tokens.json write │
│  atlas-duplicate    │   │  • ai-rewrite                   │
│                     │   │      → focused-refine dispatch  │
│ Visible in <50ms    │   │                                 │
└─────────────────────┘   └────────────────┬────────────────┘
                                           ▼
                       ┌────────────────────────────────┐
                       │ Undo/redo stack (client)       │
                       │ + future: history sidebar      │
                       └────────────────────────────────┘
```

### The `data-atlas-id` identity scheme

The hardest problem in this design: **stable bi-directional identity** between a DOM element and the JSX node that produced it.

**Solution: a two-track approach**, choosing the simplest path that works for our build chain (Next.js 15 + SWC).

Next.js 15 compiles JSX with SWC by default. Writing a custom SWC plugin requires a Rust toolchain and ships a `.wasm` blob — too heavy for this feature. Babel is available but opting into it disables SWC's fast refresh and bumps cold-build times noticeably. So we use a **build-step post-processor** instead:

1. **Atlas-side: post-write annotator.** When the engine's `applyDiff` writes JSX files to the sandbox, a wrapping pass (`@atlas/edit-patch-engine`'s `annotateAtlasIds`) parses each modified `.tsx` file with `@babel/parser`, visits every `JSXOpeningElement` that lacks `data-atlas-id`, and inserts the attribute. The hash is `sha1(filePath + ":" + jsxNodeStart).slice(0,12)` — stable across whitespace edits, distinct across structural edits.
2. **Sandbox-side: no plugin needed.** Because the annotations are baked into the source files BEFORE they land in the sandbox, the sandbox just compiles JSX normally. No SWC plugin, no Babel opt-in, no template change beyond ensuring the developer doesn't strip `data-*` attributes (Next.js doesn't).

This means:
- `atlas-edit-bridge` reads `data-atlas-id` off each walked DOM node — straightforward.
- `IframeOverlay` surfaces it as the selection key.
- All patches reference elements by `atlasId`, not CSS selector — the selector is fragile (changes when sibling classes change); the ID is stable until the node itself is destructively edited.
- Source writer locates the JSX node by `data-atlas-id` value via AST traversal.
- **No sandbox template republish required** for the identity scheme itself — the annotator runs at `applyDiff` time in atlas-web.

Trade-off: a brand-new project with no prior ritual has un-annotated JSX (the base template). First user click on an unannotated element gracefully falls back to "select by CSS selector + dispatch focused-refine"; the developer's diff annotates as it goes, so subsequent edits work on the fast AST path.

### Optimistic vs source-of-truth ordering

For UX latency, the iframe must reflect the change in <50ms. For correctness, the source must be the eventual truth.

Sequence per patch:
1. **(0ms)** Client sends `atlas-apply-*` postMessage to bridge → DOM mutates → user sees the change.
2. **(0ms)** Client also sends `applyPatch(patch)` server action.
3. **(50–500ms)** Server runs `applySource()` — AST write OR developer refine.
4. **(50–500ms)** E2B HMR detects file change, browser hot-reloads the iframe with new source.
5. **(50–500ms)** Bridge re-walks the DOM, posts new tree (with updated `data-atlas-id`s if structurally edited).

If step 3 fails:
- Server action returns `{ ok: false, error }`.
- Client sends `atlas-revert` postMessage with the original value (captured before step 1).
- Iframe DOM reverts; a red toast appears with the error + a "Try AI" button that escalates to `ai-rewrite`.

### HMR + optimistic-update race

When the source write succeeds and HMR reloads the page, the user's optimistic class/text is wiped (HMR repaints from scratch with the new source). That's fine *because the new source has the same change baked in*. The bridge re-walks; user sees the same visual state.

Edge case: a fast follow-up edit lands while HMR is still rebuilding the previous edit. Per-project edit queue (monotonic order on the server) serializes these so the second edit applies *after* the first is committed.

### `ai-rewrite` — the focused-refine path

When the user types a chat instruction with a selection chip:

1. Client sends `{ projectId, atlasId, instruction }` to a new `editElementWithAI` Server Action.
2. Server reads the source file via E2B SDK, locates the JSX node by `atlasId`, extracts a slice (the JSX subtree + 20 lines of surrounding context).
3. Server dispatches the **developer role** with:
   - `userTurn` = the instruction
   - `priorArtifact` = `{ targetFile, targetAtlasId, sourceSlice, ... }`
   - A new system-prompt fragment in `@atlas/role-developer` that says: "You are editing ONE element. Return a minimal diff that touches ONLY this element. Do not regenerate the page."
4. Developer returns a unified diff scoped to the target file.
5. Engine applies the diff via the same `applyDiff` path used after a full ritual.
6. HMR reloads the iframe.

**Critical:** no full ritual chain runs. No architect, researcher, designer. Just the developer role with a tight prompt and a tight scope. Typical wall-time: ~10–30s. Cost depends on which model the developer slot is pointed at — with Sonnet 4.5 (current default), expect roughly **$0.02–$0.05 per chat edit** for a typical 1–3K input + 200–500 output tokens. Set `ATLAS_LLM_DEVELOPER_MODEL=anthropic/claude-haiku-4.5` to cut that to ~$0.002–$0.005 per edit for users who prefer cheaper-but-less-polished outputs.

## Components to build

### atlas-edit-bridge (sandbox-side)
- Extend `AtlasDomNode` type to include `atlasId: string`.
- Read `data-atlas-id` off each walked element; include in the tree.
- Add postMessage handlers:
  - `atlas-apply-text` — set `el.innerText` (preserving children when possible)
  - `atlas-apply-class` — already exists
  - `atlas-replace-img` — set `el.src` and `el.alt`
  - `atlas-delete-node` — `el.remove()`
  - `atlas-duplicate-node` — `el.cloneNode(true)` inserted after
  - `atlas-revert` — replay a captured pre-state value
- Add `atlas-make-editable` / `atlas-blur-editable` to toggle `contenteditable` on demand from the parent (so the parent's toolbar drives it).
- On user-completed inline edit (`blur` after editable mode), post `atlas-text-committed` back to parent with the new value.

### `@atlas/edit-patch-engine` — `annotateAtlasIds` helper
- Lives in the same new package as the patch engine.
- Parses a JSX file with `@babel/parser`, visits every `JSXOpeningElement` lacking `data-atlas-id`, inserts a stable hash attribute.
- Invoked at `applyDiff` time in `apps/atlas-web/lib/sandbox/apply-diff.ts` for every `.tsx` file the diff touches — annotations land in the sandbox alongside the developer's code.
- No sandbox template change required.

### atlas-web client
- **`FloatingToolbar`** (new) — small component that absolute-positions itself near the selected element, contains per-element-type action buttons.
- **`ElementContextMenu`** (new) — right-click / `⋯` menu with Delete / Duplicate / Wrap / Move.
- **`ImageReplacePopover`** (new) — drop / paste-URL / regenerate three-way.
- **`SelectionChip`** (new) — small chip rendered above the ChatPanel textarea showing "Editing: `<tag>preview-text</tag>` ✕".
- **`useEditPatchQueue`** (new) — client-side queue that holds pending patches + undo/redo stack. Serializes applyPatch calls per-project.
- **`atlas-edit-bridge-client.ts`** (new) — small wrapper around `iframe.contentWindow.postMessage` so React components don't reach into the iframe directly.
- **`ChatPanel`** (modified) — accepts a `selectionChip?: { atlasId, label }` prop; when present, the textarea is "Editing: …" mode and submits route through `editElementWithAI` instead of `refineRitual`.

### atlas-web server
- **`applyPatch` Server Action** — accepts a patch, routes to:
  - `text-replace` / `style-class-patch` / `asset-swap` / `dom-mutation` → AST writer (`@atlas/edit-patch-engine` package)
  - `style-token-patch` → existing `applyElementAxisChange` flow
  - `ai-rewrite` → `editElementWithAI` Server Action below
- **`editElementWithAI` Server Action** — focused-refine dispatch described above.
- **`uploadElementImage` Server Action** — wraps `uploadReference` (which already exists) for the image-replace path.

### New package: `@atlas/edit-patch-engine`
- Pure module (no Node/E2B deps).
- Exports `applyPatch(fileContent: string, patch: EditPatch): { newContent: string, invert: EditPatch }`.
- Uses `@babel/parser` + `@babel/traverse` + `@babel/generator` + `@babel/types`.
- Locates JSX nodes by `data-atlas-id` attribute value.
- One file ≈ 400 lines; unit-testable in isolation against fixture JSX strings.

### `@atlas/role-developer` (additive)
- New system-prompt fragment: `RENDER_FOCUSED_REFINE_SYSTEM` — "You are editing one JSX element. Return a minimal unified diff that touches ONLY the marked element. Do NOT regenerate the page or restructure surrounding sections."
- New `render-focused-refine.ts` — builds the focused user-turn from `{ targetFile, targetAtlasId, sourceSlice, instruction }`.
- Routing: when `priorArtifact` carries `{ atlasFocusedRefine: true, ... }`, the developer skips parallel passes + reviewer vote — single Sonnet call, faster.

## Patch type contracts

```ts
type EditPatch =
  | { kind: "text-replace";       atlasId: string; oldText: string; newText: string }
  | { kind: "style-token-patch";  tokenKey: string; oldValue: unknown; newValue: unknown }
  | { kind: "style-class-patch";  atlasId: string; add: string[]; remove: string[] }
  | { kind: "asset-swap";         atlasId: string; oldUrl: string; newUrl: string; oldAlt?: string; newAlt?: string }
  | { kind: "dom-mutation";       atlasId: string; op: "delete" | "duplicate" | "wrap" | "reorder"; payload?: unknown; capturedSubtree?: string }
  | { kind: "ai-rewrite";         atlasId: string; instruction: string; capturedSourceSlice: string };
```

`oldText` / `oldValue` / `oldUrl` / `capturedSubtree` / `capturedSourceSlice` exist so `invert()` can produce the reverse patch without needing to re-read source.

## Feature flags

- `ATLAS_FF_INLINE_EDIT_V1` — master flag for the whole feature. Defaults OFF. Gates the floating toolbar, contenteditable wiring, selection chip on ChatPanel, edit-patch-engine wiring in `applyDiff`.
- No sandbox template republish required — `annotateAtlasIds` runs in atlas-web's `applyDiff` path, not in the sandbox build.

## Risks + mitigations

1. **AST locate failures** — if `data-atlas-id` is missing (un-annotated element) or doesn't match (user edited the source manually), the patch engine returns `{ ok: false, fallback: "ai-rewrite" }` and the client transparently re-submits as an `ai-rewrite` patch. The user sees the iframe update on the optimistic path; the source-write upgrades from free-and-instant to ~$0.02-$0.05 and ~20s. A small "saving via AI…" indicator distinguishes the slow path so the user understands the delay.
2. **HMR thrash** — a fast user rapid-fire-editing 5 things in 3 seconds would trigger 5 HMR cycles. Mitigation: debounce source writes by 300ms; coalesce contiguous patches against the same atlasId into a single write.
3. **Optimistic-revert flicker** — if source write fails after the optimistic apply, the revert blink is visible. Mitigation: a 1-second "applying…" indicator on the element so the user knows it's not yet committed; revert only shows if the indicator was still visible.
4. **Babel/SWC plugin breaks template build** — keep the plugin pure-pass (no breaking changes to JSX semantics); ship behind a sandbox-template feature flag that defaults on after the next template rebuild.
5. **Undo across HMR reloads** — undo stack is in client memory; persists across the page session but not across full refreshes. V1 acceptable. V2 persists to project state.
6. **Cost of `ai-rewrite`** — small (~$0.005 per edit) but adds up if the user spams. Mitigation: per-project per-day budget cap with a UI banner when 80% reached (reuse the existing sandbox-spend pattern).
7. **Browsers' default contenteditable behavior** — pasted rich text, weird newlines, etc. Mitigation: post-process the new text on commit (strip HTML, normalize whitespace).

## Testing strategy

- **`@atlas/edit-patch-engine` unit tests** — pure module, tested with fixture JSX strings against expected post-patch JSX. Cover every patch kind + each `op`.
- **`atlas-edit-bridge` jest tests** — DOM-level: mock `postMessage`, assert each handler mutates the DOM correctly.
- **`FloatingToolbar` + `ChatPanel` selection chip** — React Testing Library, click flows.
- **`editElementWithAI` server action** — integration test with a stubbed developer role producing a known diff; assert it's applied to a fixture sandbox.
- **Playwright smoke** — open a fresh ritual, click an `<h1>`, edit text inline, assert source file was updated. Behind `ATLAS_FF_INLINE_EDIT_V1`.

## Phased rollout

### Phase 1 (week 1) — foundation + text + style
- `@atlas/edit-patch-engine` package: `annotateAtlasIds` + `text-replace` + `style-class-patch` + `asset-swap` patches.
- Wire `annotateAtlasIds` into `applyDiff` so future developer outputs are tagged.
- `FloatingToolbar`, inline contenteditable, image replace popover.
- ElementInspector style flow already exists — Haiku-axis proposal stays as today; only the patch APPLICATION path is unified (writes through the new patch engine for consistency).
- Flag-gated via `ATLAS_FF_INLINE_EDIT_V1`.

### Phase 2 (week 2) — chat + structural
- Selection chip on ChatPanel.
- `editElementWithAI` Server Action + focused-refine developer prompt.
- Context menu with Delete / Duplicate / Wrap / Move (dom-mutation patches).

### Phase 3 (later) — polish
- Undo/redo keyboard shortcuts + canvas-header buttons.
- History sidebar.
- AI image regeneration for single slot (already half there).
- Per-project per-day edit budget cap.

## Out of scope explicitly

- Multi-user concurrent editing.
- Versioned branches/drafts at the project level.
- Editing files OTHER than the JSX page files (e.g., `next.config.ts`, API routes, etc.).
- Mobile-specific touch gestures beyond what click already gives us.
- Drag-and-drop element reordering (V2; reorder via context menu only in V1).

## Open questions for user

None at this point — UX direction approved (floating toolbar + chip-prefixed left-rail chat), architecture direction approved (hybrid AST + focused-refine), phase plan articulated.

## Self-review log

- ✅ Placeholder scan: no TBDs.
- ✅ Internal consistency: patch types match across architecture / contracts / source-writer sections.
- ✅ Scope: focused on in-place editing only; doesn't dragnet related work like Code-view sandbox-listing.
- ✅ Ambiguity: every patch type has a precise contract; AST identity scheme is concrete via `data-atlas-id`.
