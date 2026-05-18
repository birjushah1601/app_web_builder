# Pipeline variety tweaks — design spec

**Date:** 2026-05-14
**Author:** brainstorming session
**Status:** approved by user; ready for writing-plans handoff

---

## Goal

Reduce the visible sameness across Atlas-generated sites — every output today reads "modern landing page, Material 3 / shadcn defaults, slate + blue, hero + features + testimonials + footer" regardless of category. After this change, a restaurant site, a marketplace, an API-docs site, and a fitness site should each lead with category-appropriate structure (menu + chef, search-first hero, code samples, transformation stories) without burning more LLM cost than today's pipeline already does.

## Non-goals

- Stitch-style multi-direction selection UX (out of scope; bigger UX work, deferred).
- DESIGN.md file format as a user-facing artifact (separate feature; deferred).
- Refactoring the Researcher's 30-category YAML catalog.
- Adding new categories to the catalog.

## What's already in the codebase (reused)

- `@atlas/role-designer` Plan SPU 3-pass pipeline: `draftProposal` (Haiku) → `critiqueDraft` (Haiku, 5-axis findings) → `reviseDraft` (Sonnet). Behind `ATLAS_FF_DESIGNER_CRITIQUE`.
- `@atlas/role-researcher` 30-category YAML catalog with `palettePreview`, `typographyPreview`, `patternsThatWin`, `patternsThatLose` per reference.
- `@atlas/role-developer` `renderDeveloperUserTurn` — currently surfaces selectedTokens, designIntent, canvasManifest, and a hardcoded "## Build target" scaffold formula.

## Approach (no formal alternatives — these are tweaks, not architecture)

Five small fixes inside the existing pipeline. Four ship in this batch; the fifth (direction randomization) is intentionally deferred.

### Fix 1: `layoutDirective` field on `DesignDirection` — highest impact

**Schema**: extend `DesignDirection` (in `assemble-proposal.ts`'s Zod schema) with a required `layoutDirective: string` field — 1-3 sentences describing the page skeleton this direction implies, including any explicit exclusions ("NO testimonials block").

**Designer prompts**: `draftProposal` / `reviseDraft` system prompts updated to require it. `critiqueDraft` doesn't author it but carries it through unchanged (the critique's `composition` and `patterns_alignment` axes can reference it).

**Developer prompt**: in `render-user-turn.ts`, replace the hardcoded "Hero + 2-4 sections + footer" scaffold (current lines ~111-114) with:

```
## Build target — use the Designer's layoutDirective as your skeleton

The Designer specified the page structure for this category:
  ${selectedTokens.layoutDirective}

Honor the named sections AND the explicit exclusions. If the directive
omits something you'd normally add (e.g., a testimonials block), respect
the omission — the Designer chose what fits the category.

Fallback only when the directive is absent (legacy ritual snapshots
before this change): hero + 2-4 supporting sections + footer.
```

The `selectedTokens` object that the engine folds into the Developer's `priorArtifact` after canvas pause must include `layoutDirective`. Currently `selectedTokens` is the `tokens` sub-object of the chosen `DesignDirection`. Either:

- (a) extend `selectedTokens` to be the entire direction (not just tokens), OR
- (b) leave `selectedTokens` shape unchanged and add a separate `selectedLayoutDirective: string` field to the priorArtifact alongside it.

Option (b) is less invasive — pick that.

### Fix 2: Lead the critique with `patternsThatWin` / `patternsThatLose`

**File**: `packages/role-designer/src/critique-prompt.ts`.

Restructure the critique user-turn so the FIRST content the LLM sees is:

```
You are critiquing a design proposal for a website in the category: ${brief.category}.

Patterns that MUST appear in winning designs for this category:
  - ${brief.patternsThatWin.join("\n  - ")}

Patterns that MUST NOT appear (these signal a regression to generic SaaS):
  - ${brief.patternsThatLose.join("\n  - ")}

Score the draft against THESE category-specific patterns. Generic SaaS or
landing-page conventions don't apply unless the category IS SaaS or
generic-landing.

[then the draft + the original 5-axis rubric]
```

**Model**: bump the critique pass from Haiku to Sonnet — accuracy of `distinctness` and `patterns_alignment` scoring matters more than cost here. Set via `ATLAS_LLM_CRITIQUE_MODEL` env, default `anthropic/claude-sonnet-4.5`. Cost delta: ~$0.01 → ~$0.04 per critique. One critique per ritual; ~$0.03 total.

### Fix 3: `componentSet` defaults by category

**File**: `packages/role-designer/src/role.ts` ROLE_PROMPT block (or wherever `componentSet` selection is described).

Replace any "default shadcn unless brief suggests otherwise" text with:

```
componentSet selection rule (decide based on brief.category):
  - shadcn      → app surfaces and tools (saas-app, dashboard, admin,
                  internal-tools, productivity-app)
  - radix-bare  → marketing/content surfaces (saas-marketing,
                  restaurant-landing, portfolio-personal,
                  e-commerce-product, agency-creative, real-estate-listing,
                  fitness-wellness-landing, blog-publishing,
                  travel-booking, education-marketing, ngo-marketing)
  - custom      → premium-distinctive brands when the user explicitly asks

Default to shadcn ONLY when the category doesn't match anything above.
```

The category list above is sourced from the existing 30-category Researcher catalog. Concrete list lives in `assemble-proposal.ts` as a constant `MARKETING_CATEGORIES: ReadonlySet<string>` so adding categories later is a one-line change.

When `componentSet === "radix-bare"`, the Developer's `render-user-turn.ts` should note: "radix-bare means use raw Tailwind + lucide-react + framer-motion + the design tokens directly; do NOT reach for shadcn's `Button`/`Card`/`Tabs` primitives." Add a small conditional section.

### Fix 4: Palette anchor block in the draft user-turn

**File**: `packages/role-designer/src/assemble-proposal.ts` — the function that builds `draftProposal`'s user-turn.

Currently the brief is serialized as `JSON.stringify(brief, null, 2)`. PREPEND an explicit text block before that JSON:

```
## Palette anchors (from researcher's top reference)

Top reference: ${brief.references[0]?.name ?? "—"}
${brief.references[0]?.palettePreview ? `Suggested palette to anchor from:` : `(no palette preview available)`}
${formatPalette(brief.references[0]?.palettePreview)}

You can shift hues, saturation, or contrast — but stay within ±15% of
these values unless your direction has a strong category reason. If your
direction diverges from this anchor (e.g., a restaurant choosing a moody
dark palette where the anchor is bright), EXPLAIN WHY in that direction's
`technicalDescription` field.

Alternates can (and should) anchor on the second and third references'
palettes for visible differentiation across the three directions.

[then the full brief JSON]
```

`formatPalette` is a small helper: takes the reference's `palettePreview` array (already in the catalog as hex strings), labels them by position (`surface`, `text`, `accent`, `muted` for 4-tuple; `surface`, `text`, `accent` for 3-tuple), and pretty-prints.

### Fix 5 (deferred): direction randomization on auto-resolve

Not shipped in this batch. The canvas pause auto-resolve in `engine.ts` currently picks `proposal.recommended` after timeout. A future change can randomize across the three directions to make idle/timeout cases produce more variety. Skipped because users typically click "Use this" within the 5-min pause window, so the marginal impact is low.

## Implementation order + dependencies

Tasks fan out cleanly:

1. **Schema + types** — extend `DesignDirection` with `layoutDirective`. Update Zod, types, tests. (Foundation; everything else depends on this.)
2. **Designer prompts** — `draftProposal` system prompt requires `layoutDirective`. `assemble-proposal.ts` palette anchor block. `componentSet` category mapping. (Fixes 1, 3, 4 — all in `role-designer`.)
3. **Critique prompt restructure + model bump** — Fix 2 (independent of #2 above; can ship in parallel).
4. **Developer prompt** — surface `layoutDirective` as the page skeleton. Conditional radix-bare guidance. (Fix 1, 3 — in `role-developer`.)
5. **Engine wiring** — fold `selectedLayoutDirective` into the Developer's `priorArtifact` after canvas pause. (Fix 1 — in `ritual-engine`.)
6. **Tests** — update fixtures to include `layoutDirective`, verify Developer prompt surfaces it, verify category-radix-bare mapping, verify palette anchor block.

Fix 1 + 5 are the tightly-coupled spine. Fix 2/3/4 are independent prompt edits.

## Costs + risks

| Concern | Mitigation |
|---|---|
| Critique cost: ~$0.03 / ritual | Configurable via `ATLAS_LLM_CRITIQUE_MODEL` — operator can pin Haiku for cheaper runs |
| Existing ritual snapshots lack `layoutDirective` | Zod schema marks it `optional()` for tolerance; Developer prompt explicitly falls back to legacy scaffold when absent |
| radix-bare Developer might miss shadcn primitives | Developer prompt explicitly authorizes raw Tailwind + lucide + framer-motion as substitutes |
| `MARKETING_CATEGORIES` list drifts from catalog | Constant lives in `assemble-proposal.ts`; catalog category names are also exported there |
| Critique LLM ignores the new "patternsThatWin must appear" framing | The 5-axis rubric (palette/typography/composition/patterns_alignment/distinctness) ALREADY uses these in scoring — making them lead is reinforcement, not new behavior |

## Testing strategy

- **`@atlas/role-designer` unit tests**: assert `draftProposal` produces a non-empty `layoutDirective` per direction; assert `MARKETING_CATEGORIES` membership routes to `radix-bare`; assert critique user-turn starts with `patternsThatWin`/`patternsThatLose` lines.
- **`@atlas/role-developer` unit tests**: assert `renderDeveloperUserTurn` surfaces `selectedLayoutDirective` when present and falls back to the legacy scaffold when absent.
- **`@atlas/ritual-engine` integration test**: with a stub Designer producing a direction with `layoutDirective`, assert the Developer dispatch's priorArtifact contains `selectedLayoutDirective`.
- **No e2e smoke**: variety improvements are not deterministic enough to assert against. Manual ritual comparison is the validation: run a restaurant prompt and an API-docs prompt; visibly different page structures = pass.

## Feature flags

No new flags. Always on, gated only by the existing `ATLAS_FF_DESIGNER_CRITIQUE` (which already gates Plan SPU's 3-pass) and `ATLAS_FF_DESIGNER` (which gates the Designer role itself).

## Out of scope

- Multi-direction user-pick UX.
- DESIGN.md file format as a project artifact.
- New categories in the Researcher catalog.
- Direction randomization on auto-resolve (Fix 5; deferred).
- Style-token-patch unification with the in-place editing patch engine (separate, unrelated).

## Self-review log

- ✅ Placeholder scan: no TBDs.
- ✅ Scope: focused tweaks, four files in three packages, no new infra.
- ✅ Internal consistency: `selectedLayoutDirective` referenced in Designer schema, engine wiring, and Developer prompt sections — all aligned on the name.
- ✅ Type consistency: `layoutDirective` (singular) on `DesignDirection`; `selectedLayoutDirective` on the priorArtifact (matches the existing `selectedTokens` naming pattern).
- ✅ Ambiguity check: `MARKETING_CATEGORIES` listed explicitly with the 11 names from the catalog; no "or similar" hand-waving.
