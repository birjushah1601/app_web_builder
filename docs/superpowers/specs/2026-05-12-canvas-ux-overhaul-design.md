# Canvas UX Overhaul — Design

**Status:** Approved direction 2026-05-12. Sibling spec to `2026-05-12-stunning-pipeline-upgrade-design.md`. Pipeline is the backend lift; this is the frontend lift. Both ship behind feature flags.

## Goal

Bring Atlas's canvas UX to parity with the May-2026 SOTA (v0.app, Lovable, Bolt.new, Framer AI, Claude Design). The pipeline upgrade gives the agent better material; this spec gives the user better tools to manipulate what the agent produces.

## What's wrong today

Independent research (`docs/superpowers/specs/2026-05-12-ux-research-findings.md`, summary inline below) flagged seven concrete gaps:

1. **No click-to-edit on the iframe** — biggest single miss. Every SOTA tool turns the preview into a selectable surface.
2. **No mode separation** — everything is a generative prompt; there's no path for "fix this copy" that doesn't burn a ritual.
3. **Form-then-redirect onboarding** — 2-3 years behind. SOTA collapses to a single-page morph.
4. **Progress rows are passive** — SOTA renders the plan as editable checkpoints the user can prune mid-flight (critical when asset-gen costs $).
5. **No per-element regeneration** — "regenerate just this section" requires whole-page reruns today.
6. **No reference-image surface** — pipeline accepts them; UI doesn't expose drop/upload.
7. **No version timeline or agent-reasoning surface** — users can't see the critique pass that the new pipeline produces.

## Scope of this spec

Six UX changes, ordered by `(impact / effort)`:

1. **Single-page morph** (replace form-then-redirect)
2. **Three-mode toolbar** (Agent / Plan / Visual Edits)
3. **Click-to-edit overlay** on the iframe
4. **Reference-image drop zone** in the prompt input
5. **Editable plan timeline + collapsed critique disclosure**
6. **Per-element generated sliders** (pulled in from V2 after Claude Design deep-dive 2026-05-12 — this is the one novel UX primitive in the space and the most direct quality leap once Visual Edits is wired)

Out of scope: named checkpoints / git-style timeline (V2), inline-comment threads (V2), Claude Design HTML import as starting artifact (V2 — see note at end).

## Change 1 — single-page morph

Today: `/projects/new` is a separate form. Submit → 303 → `/projects/<id>/canvas`. User sees a flash of empty canvas while the ritual fires.

New: `/` (dashboard) becomes the prompt landing for signed-in users with no recent project. The prompt textarea is the hero. On submit, two things happen simultaneously:
- Server action creates the project + fires the ritual (existing `submitPromptedProject` flow).
- Client transitions the layout via `router.replace(/projects/<id>/canvas)` AND an exit animation that morphs the prompt into the canvas's chat input (single-page feel).

Concretely: prompt-form textarea has `view-transition-name: prompt-input`. Canvas page's chat input has the same name. Use the View Transitions API (already shipping in Chromium and Safari 18) for the morph. Firefox falls back to instant navigation — acceptable.

**Files touched:** `app/page.tsx` (new prompt-first dashboard for signed-in users), `app/projects/new/*` (kept as a redirect target for direct nav), CSS view-transition names.

## Change 2 — three-mode toolbar

Above the canvas, a three-button toolbar (radio): **Agent** (default) / **Plan** / **Visual Edits**.

| Mode | What it does | Atlas wiring |
|---|---|---|
| **Agent** | Free-form chat → ritual fires → autonomous build. Today's behavior. | No change to engine; existing `submitRitual` / `refineRitual` flow. |
| **Plan** | Chat with the architect, see its proposed plan as an editable checklist, **approve before any code runs**. | Architect's pass2 emits a checklist. Engine pauses on a NEW pause type (`canvas-pause: plan-approval`). User approves/edits → resume. |
| **Visual Edits** | Click any element in the iframe → side panel shows palette/typography/spacing controls for that element. **No LLM call.** Edits go directly to design-tokens.json via a server action. | New `lib/actions/updateDesignTokens.ts`. Sandbox apply re-runs without dev role. |

Default to **Agent** for greenfield rituals (matches today's flow). Auto-switch to **Visual Edits** after the first ritual completes — the typical iteration is now token tweaks, not full regenerations.

Cost lever: Visual Edits is the cheap path. Without it, every "make this button red" burns a Sonnet ritual.

**Files touched:** `components/canvas/ModeToolbar.tsx` (new), `lib/canvas/use-canvas-state.ts` (add mode dimension), `lib/actions/updateDesignTokens.ts` (new), engine's pause registry (add plan-approval kind).

## Change 3 — click-to-edit overlay

The preview iframe today is a passive `<iframe src=...>`. New: a transparent overlay layer on top of the iframe that mirrors the iframe's coordinate space and intercepts clicks.

How it works:
- iframe posts `postMessage({ type: "atlas-dom-tree", nodes: [...] })` on load + on every HMR. The sandbox template injects a small `atlas-edit-bridge.js` that walks `document.body`, captures every element's bounding-rect + text + tag, and posts to parent.
- Overlay receives the tree and renders invisible hit-zones aligned to each element's rect. Hover → outline. Click → emits a select event.
- Selection drives the **Visual Edits** side panel (Change 2).

When iframe scrolls, the bridge reposts updated rects. When window resizes, parent recomputes overlay layout.

**Why an overlay, not iframe pointer-events:** the iframe is the live Next dev server; we don't want to inject Atlas UI into the user's site. Overlay-with-bridge keeps the sandbox pristine.

**Files touched:** `components/canvas/IframeOverlay.tsx` (new), `packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts` (new, conditionally loaded), template Dockerfile.

## Change 4 — reference-image drop zone

Drop zone integrated into the prompt input (both the landing prompt and the canvas chat input). Drag a PNG/JPG (or paste a URL) onto the prompt textarea → image floats above the input as a chip with the alt-text overlay → on ritual submit, image URL is threaded as `referenceImages: [{ url, caption }]` (per pipeline spec).

URL-paste path: if the user pastes a URL that looks like a webpage (not an image), we offer "Use this site as a style reference" — a server-side helper headless-renders the URL, screenshots it, and threads the screenshot.

Storage: MinIO bucket from the platform stack (`atlas-references` namespace). 30-day TTL. Image content addressable by sha256 so identical reference uploads share one row.

**Files touched:** `components/prompt/ReferenceDropZone.tsx` (new), `lib/actions/uploadReference.ts` (new), `lib/references/take-screenshot.ts` (new).

## Change 5 — editable plan + critique disclosure

When **Plan** mode is active (Change 2), the rail shows the architect's plan as a checklist. Each item has [edit] / [×] icons. User can:
- Add steps (free-text input → architect refines on next pass)
- Remove steps
- Reorder
- Approve all → engine resumes

After Designer runs the new critique pass (from pipeline spec), the rail shows a collapsed "Critique" disclosure under Designer's row:

> ▶ Critique (3 findings, click to expand)

Expanded: the structured findings from `designer.critique.completed`. This is the SOTA pattern — never fully hide reasoning, default-collapse to keep canvas primary.

**Files touched:** `components/ritual/PlanCheckpoints.tsx` (new), `components/ritual/CritiqueDisclosure.tsx` (new), updates to `RitualTimeline.tsx`.

## Change 6 — per-element generated sliders

Pulled in from V2 after Claude Design research showed this is the single most powerful UX primitive in the field and not patentable. When the user selects an element via click-to-edit (Change 3), the Visual Edits side panel runs a short LLM pass that proposes element-specific axes — and renders them as sliders.

How it works:
- On element select, panel POSTs `{ tag, className, computedStyle, parentContext }` to `lib/actions/proposeElementAxes.ts`.
- Server action calls Haiku 4.5 with a system prompt: "Given this element + its computed style, propose 2-5 adjustable axes a designer would actually want. Return JSON: `[{ name, label, min, max, step, unit, currentValue, cssProperty | tokenKey }]`."
- Panel renders sliders. As the user drags, the change is applied **directly to design-tokens.json** (if it maps to a token like `palette.primary`) or to a scoped Tailwind override on the element's `className` (if it maps to a one-off property like `letter-spacing`).
- No ritual fires; no Sonnet cost. One Haiku call per element-select (~10¢ over a long session).

Axes are element-type-specific by construction:
- Button → primary-color, radius, padding-x, padding-y
- Heading → font-size, weight, letter-spacing, line-height
- Image → aspect-ratio, object-fit, brightness
- Section → padding-top, padding-bottom, max-width

Cache axes per `(tag + significant-classes)` hash within a session — selecting "the third Button" after "the first Button" reuses the same proposal.

**Files touched:** `components/canvas/ElementInspector.tsx` (new), `lib/actions/proposeElementAxes.ts` (new), `lib/actions/applyElementAxisChange.ts` (new — small token / className patches), updates to the bridge script for `className` mutation.

## Feature flags

```
ATLAS_FF_PROMPT_MORPH=true        # Change 1: single-page morph. Falls back to form-redirect when off.
ATLAS_FF_MODE_TOOLBAR=true        # Change 2: Agent/Plan/Visual-Edits toolbar.
ATLAS_FF_CLICK_TO_EDIT=true       # Change 3: iframe overlay.
ATLAS_FF_REFERENCE_INPUT=true     # Change 4: drag-drop reference. Requires pipeline spec's ATLAS_FF_REFERENCE_IMAGES.
ATLAS_FF_EDITABLE_PLAN=true       # Change 5: plan checkpoints + critique disclosure. Requires pipeline's ATLAS_FF_DESIGNER_CRITIQUE.
ATLAS_FF_ELEMENT_SLIDERS=true     # Change 6: per-element generated sliders. Requires ATLAS_FF_CLICK_TO_EDIT.
```

Each defaults OFF. Operators can flip them independently — e.g., ship Visual Edits without click-to-edit (toolbar shows but selection is via dropdown of sections, not iframe-click). Defensible degrade paths matter.

## Tests

- E2E: each change has a Playwright spec covering the happy path + at least one degrade case (overlay covers iframe correctly across viewport sizes; mode toolbar honors flag-off; reference upload accepts PNG; etc.).
- Unit: component-level RTL tests for ModeToolbar selection, IframeOverlay hit-zone rendering against canned DOM tree, PlanCheckpoints edit/remove/reorder, ReferenceDropZone file/URL/drag handlers.
- Visual regression: existing Playwright visual config picks up the new chrome.

## Risks

- **Bridge in sandbox template requires republish** — same caveat as the puppeteer add. Document the republish in the implementation plan.
- **View Transitions API browser support** — Firefox lags. Spec gracefully falls back via media query / feature-detection.
- **Click-to-edit on dynamic content** (animations, modals) — element bounding rects shift. Bridge needs to re-post on `ResizeObserver` + `MutationObserver`. Throttle to ~10fps.
- **Reference image privacy** — user-uploaded screenshots could contain PII. Apply same ToS line as pipeline spec; never echo reference content in final output.

## Out of scope (V2 candidates)

- **Claude Design HTML import** — accept their HTML/PPTX export as a starting artifact dropped onto the prompt. ~1-week lift when prioritized. The strategic logic (per `2026-05-12-claude-design-deep-dive.md` research): Claude Design users hit weekly quota fast and want to escape their walled garden; Atlas can be the "open the bundle and keep iterating" destination. Park until usage data justifies it.
- Inline comments / threads on elements.
- Named checkpoints / undo / time-travel.
- Multi-page nav within a single project.
- Custom domains / one-click deploy.

## Strategic context (Claude Design positioning)

Claude Design (Anthropic Labs, April 2026) is a direct partial substitute for Atlas's Designer→Developer slot, but with four exploitable gaps that this spec doubles down on:

1. **No live sandboxed preview** — output is an HTML/PPTX bundle, not a running env with real data + auth + a refresh loop. Atlas's E2B sandbox is the moat.
2. **No API / no embed** — Claude Design is a destination product. Atlas's owner-extensible AI-features catalog (parked spec) cannot exist on top of it.
3. **No round-trip** — once code leaves their canvas, design diverges. Atlas's spec-graph round-trip preserves intent.
4. **No OSS posture** — closed product, paid Anthropic tier. The OSS-stack pivot remains Atlas's wedge for on-prem / Keycloak / self-host customers.

The one Claude Design primitive worth copying outright is per-element generated sliders (Change 6 above). It's not patentable, it's elegant, and it slots cleanly into our Visual Edits mode.
