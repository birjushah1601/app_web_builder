# Stunning Pipeline Upgrade — Design

**Status:** Approved 2026-05-12. Pipeline-only spec (UX surfaces live in a sibling doc once UX research lands).

## Goal

Move generated-site quality from "plain hero+features+footer" to a Lovable-tier result. Single-pass Sonnet output is solid but generic; the gap is everywhere `the model wasn't asked to think twice`.

## The three levers

Research (`docs/superpowers/specs/2026-05-12-ai-features-catalog-PARKED.md` precursor research) showed three patterns the leading tools use:

1. **Plan → Critique → Revise** inside the Designer. Lovable's edge over v0 — the model writes its own draft, scores it against a rubric, then revises before handoff.
2. **Reference-image conditioning** on the Designer's input. Stitch's edge — drop a screenshot, the Designer matches the vibe.
3. **Asset generation as a first-class Designer subtask**, not an afterthought left to the Developer's prompt. Hero imagery + section illustrations + favicon all generated against the chosen palette.

Atlas already has the underlying mechanics:
- Designer role exists; the Researcher already feeds it a brief.
- OpenAI-compatible LLM provider supports vision-input messages today.
- E2B sandbox has a writable filesystem we can drop generated assets into.
- Design tokens already flow through to Tailwind theme + CSS vars.

What's missing is the wiring — the rest of this spec is the wiring.

## Architecture changes

### Designer role: split into three passes

Today: `Designer.run(brief) → proposal`.

New shape (single role, three internal passes — like Architect's pass1/pass2):

```
Designer.draftProposal(brief, references?) → DraftProposal     // ~30s, current behavior
Designer.critiqueDraft(draft, brief)       → DraftCritique     // ~10s, new
Designer.reviseDraft(draft, critique)      → FinalProposal     // ~30s, new
```

Each pass emits its own event so the rail timeline can show "Designer drafting / critiquing / revising" rather than one opaque step. `FinalProposal` is what the engine threads into the developer's `priorArtifact` — same shape as today.

**Rubric for critique**: a static prompt template scoring the draft 1-5 on:
- Distinctness from generic Material/shadcn output
- Palette ambition (does it use color or hide behind slate?)
- Typography choice (serif vs sans appropriateness)
- Compositional confidence (whitespace, hierarchy, density)
- Whether `patternsThatWin` from the Researcher's brief actually appear in the design
- Whether `patternsThatLose` are avoided

The critique pass emits structured findings → the revise pass uses them. Same model (Sonnet 4.5), distinct prompts.

### Reference-image conditioning

New optional field on `DesignerInput`: `referenceImages: { url: string; caption?: string }[]`.

When present, `Designer.draftProposal` builds a vision-message that includes the image(s) plus a system instruction: "**Match the typographic personality, palette ambition, and compositional voice of these references. Do not copy layout literally.**"

Source of reference images (two paths, both supported):

- **User upload**: file → S3-compat (MinIO from platform stack) → URL → threaded through `startRitual({ ..., referenceImages: [...] })`.
- **URL paste**: user gives a public URL → we re-fetch + cache → same flow.

A small util `apps/atlas-web/lib/references/take-screenshot.ts` lets users paste a URL of a live site; we headless-render and snapshot it (puppeteer is already in the sandbox template; can reuse for this purpose in atlas-web's process too — short-lived browser instance).

### Asset pipeline as a real step

After `Designer.reviseDraft` lands a `FinalProposal`, the engine dispatches a new role:

```
AssetGenerator.run({ proposal, brief, projectId }) → AssetManifest
```

`AssetManifest` is a small JSON listing image slots the Developer must populate, each with a CDN URL. Example:

```json
{
  "hero": {
    "url": "https://cdn.atlas/img/<hash>.jpg",
    "prompt": "Hero image: warm mumbai restaurant interior, family dining, golden hour, ...",
    "alt": "Family dining at Spice Kitchen in Mumbai"
  },
  "sections": [
    { "slot": "feature-1", "url": "...", "alt": "..." },
    { "slot": "about", "url": "...", "alt": "..." }
  ]
}
```

Gen path: GPT-Image (preferred per earlier brainstorm) — `model: gpt-image-1`, 1024×1024, cached to CDN by content hash. Falls back to Unsplash search by keyword if `ATLAS_FF_HERO_AI_IMAGE=false`; falls back to gradient placeholder if `ATLAS_FF_HERO_UNSPLASH=false`.

The Developer's prompt now receives `assetManifest` alongside `selectedTokens` (folded into `priorArtifact`). Developer is instructed: "Use the URLs from `assetManifest.hero` and `assetManifest.sections` literally — don't invent image URLs."

### Engine wiring

In `packages/ritual-engine/src/engine.ts`, the existing canvas-pause flow at line ~339:

```
canvasFlowEnabled && hasBlockingDesign && artifact
  → researcher (existing)
  → designer.draft  (was: designer)
  → designer.critique (new)
  → designer.revise (new)
  → canvas pause for user direction selection (existing — operates on FinalProposal)
  → on resume: assetGenerator (new)
  → developer (existing, now with assetManifest in priorArtifact)
```

`assetGenerator` is skipped (silently) when no flag enables an AI source AND no Unsplash fallback is on — placeholder gradients remain the fallback.

### New events

Added to `RitualEventSchema` discriminated union:

- `designer.draft.completed` (payload: draft proposal — replaces `designer.proposal.emitted` for the draft phase)
- `designer.critique.started` / `designer.critique.completed`
- `designer.revise.started` / `designer.revise.completed` (final proposal — what `canvas.options.requested` consumes)
- `asset.gen.started` / `asset.gen.completed` / `asset.gen.failed` (payload: AssetManifest)

These flow through SpecEventsSink to broker + DB the same way today's events do.

## Feature flags

```
ATLAS_FF_DESIGNER_CRITIQUE=true     # Plan-critique-revise loop. Default OFF → today's single-pass behavior preserved.
ATLAS_FF_REFERENCE_IMAGES=true      # Reference-image conditioning. Requires above. Default OFF.
ATLAS_FF_ASSET_GEN=true             # AssetGenerator role runs after canvas pause. Default OFF.
ATLAS_FF_HERO_UNSPLASH=true         # Unsplash fallback in AssetGen. Requires UNSPLASH_ACCESS_KEY.
ATLAS_FF_HERO_AI_IMAGE=true         # GPT-Image generation in AssetGen. Requires OPENAI_API_KEY.
```

Each is independently flippable. Default all OFF preserves today's behavior byte-for-byte.

## Tests

For each new pass:
- Unit: assemble-prompt produces the expected sections (rubric for critique, asset slots for revise).
- Unit: parser tolerates missing optional fields.
- Integration (ritual-engine): full pipeline with mocked LLMs runs through draft → critique → revise → asset-gen → developer.
- E2E (Playwright): one smoke spec that fires a prompt + verifies designer.critique events appear in spec_events for the project.

## Risks

- **Cost ~3x per ritual** — three Designer passes + asset gen API costs. Mitigate: critique/revise use Haiku 4.5 (already wired for gates) since they're scoring/editing, not creative. Draft + revise final stay on Sonnet.
- **Latency ~+40s per ritual** — critique (10s) + revise (30s). Visible in the timeline. Acceptable cost for material quality lift.
- **Critique can loop** — model finds reasons to revise forever. Hard cap: 1 critique pass, 1 revise pass. Future spec can add multi-pass.
- **Reference image attribution** — user uploads of copyrighted screenshots is a legal vector. Treat references as "for the model's eyes only" — never echoed in final output. Add ToS line on the upload UI.

## Out of scope for this spec

- **UX surfaces** — covered by the sibling UX research + design doc.
- **AI Features Catalog** — parked.
- **Multi-page sites** — current spec stays single-page.
- **Component-level click-to-edit** — likely V2 once we see what users ask for.
