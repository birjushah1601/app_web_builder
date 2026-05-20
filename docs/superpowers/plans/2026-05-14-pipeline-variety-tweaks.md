# Pipeline variety tweaks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Atlas's site-output homogeneity by surfacing category-specific structure (`layoutDirective`), patterns-that-win, palette anchors, and category-aware `componentSet` defaults through the existing Designer → Developer pipeline.

**Architecture:** Five tweaks across three packages (`@atlas/role-designer`, `@atlas/role-developer`, `@atlas/ritual-engine`). Foundation task adds a `layoutDirective` schema field; downstream tasks consume it. Cost delta: +~$0.03/ritual from bumping critique to Sonnet.

**Tech Stack:** Zod schemas, TypeScript strict + `exactOptionalPropertyTypes`, Vitest, existing Plan SPU pipeline.

---

## File map

**`@atlas/role-designer`:**
- `src/assemble-proposal.ts` — Zod schema for `DesignDirection` (extend with `layoutDirective`); `draftProposal` user-turn builder (add palette anchor block).
- `src/critique-prompt.ts` — critique user-turn builder (restructure to lead with patternsThatWin/patternsThatLose).
- `src/revise-prompt.ts` — re-emit schema includes `layoutDirective` (preserved across revise pass).
- `src/role.ts` — `ROLE_PROMPT` componentSet rule (category-aware mapping).

**`@atlas/role-developer`:**
- `src/render-user-turn.ts` — surface `selectedLayoutDirective` as page skeleton; add radix-bare guidance when `componentSet === "radix-bare"`.

**`@atlas/ritual-engine`:**
- `src/engine.ts` — fold `selectedLayoutDirective` into Developer's `priorArtifact` after canvas pause resolution.

**`apps/atlas-web/lib/engine/factory.ts`:** environment-driven critique model (`ATLAS_LLM_CRITIQUE_MODEL`) wired through DesignerRole construction.

---

## Task 1: Add `layoutDirective` to the `DesignDirection` Zod schema

**Files:**
- Modify: `packages/role-designer/src/assemble-proposal.ts` (schema definition).
- Modify: `packages/role-designer/test/assemble-proposal.test.ts` if present (any tests asserting the proposal shape).

- [ ] **Step 1: Read the existing schema**

```bash
grep -n "DesignDirection\|PROPOSAL_TOOL_SCHEMA\|TOKENS_SCHEMA" packages/role-designer/src/assemble-proposal.ts
```

Find the Zod schema object where `DesignDirection` (or whatever it's called locally — could be `DesignProposalDirection`, `DirectionSchema`, etc.) declares its fields. Look for `id`, `name`, `shortDescription`, `technicalDescription`, `citedReferences`, `tokens`. You'll add a sibling `layoutDirective` field.

- [ ] **Step 2: Write the failing test**

Add to `packages/role-designer/test/assemble-proposal.test.ts` (or create if missing):

```ts
import { describe, it, expect } from "vitest";
// Import the schema by whatever name it's exported as — the test asserts
// that omitting layoutDirective fails Zod parse.
import { DesignDirectionSchema } from "../src/assemble-proposal.js";

describe("DesignDirectionSchema layoutDirective", () => {
  it("rejects a direction missing layoutDirective", () => {
    const sample = {
      id: "x",
      name: "x",
      shortDescription: "x",
      technicalDescription: "x",
      citedReferences: [],
      tokens: {
        palette: { primary: "#000", accent: "#fff", surface: "#fff", text: "#000", muted: "#888" },
        typeScale: { sansFamily: "Inter", serifFamily: "Georgia", monoFamily: "Mono", baseSizePx: 16, scale: "major-third" },
        density: "comfortable",
        componentSet: "shadcn",
        imageryStrategy: "photo",
        copyVoice: "friendly"
      }
      // layoutDirective intentionally omitted
    };
    const result = DesignDirectionSchema.safeParse(sample);
    expect(result.success).toBe(false);
  });

  it("accepts a direction with a non-empty layoutDirective string", () => {
    const sample = {
      id: "x",
      name: "x",
      shortDescription: "x",
      technicalDescription: "x",
      citedReferences: [],
      tokens: {
        palette: { primary: "#000", accent: "#fff", surface: "#fff", text: "#000", muted: "#888" },
        typeScale: { sansFamily: "Inter", serifFamily: "Georgia", monoFamily: "Mono", baseSizePx: 16, scale: "major-third" },
        density: "comfortable",
        componentSet: "shadcn",
        imageryStrategy: "photo",
        copyVoice: "friendly"
      },
      layoutDirective: "Hero + features + testimonials"
    };
    const result = DesignDirectionSchema.safeParse(sample);
    expect(result.success).toBe(true);
  });
});
```

If `DesignDirectionSchema` is not exported, export it from the module. If the schema is inlined in a larger object (e.g., wrapped in `recommended`/`alternates`), import that wrapping schema and adapt the test to call `.shape.recommended` (Zod object).

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm --filter @atlas/role-designer vitest run test/assemble-proposal.test.ts
```

Expected: 2 test failures (schema doesn't have `layoutDirective` yet).

- [ ] **Step 4: Add the field**

Modify the schema object — add this line alongside the existing `tokens:` field:

```ts
layoutDirective: z.string().min(20)
  .describe("1-3 sentences describing the page skeleton this direction implies, including any explicit exclusions like 'NO testimonials block'.")
```

If existing `PROPOSAL_TOOL_SCHEMA` (the LLM tool-call schema) is generated from the Zod schema, the change propagates automatically. If it's a separate hand-written JSON Schema for the tool call, add `layoutDirective` there too as a required string property.

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm --filter @atlas/role-designer vitest run test/assemble-proposal.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Verify package still builds**

```bash
pnpm --filter @atlas/role-designer build
```

Expected: succeeds. If existing role.ts / critique-prompt.ts / revise-prompt.ts have type errors about missing `layoutDirective` in fixtures or mocks, that's the next task's fault — for THIS task, ensure the package builds without errors in the modified file. Any new type errors elsewhere flag as "downstream — Task 2/3/5 will fix."

- [ ] **Step 7: Commit**

```bash
git add packages/role-designer/src/assemble-proposal.ts packages/role-designer/test/assemble-proposal.test.ts
git commit -m "feat(role-designer): add layoutDirective field to DesignDirection schema"
```

---

## Task 2: Draft system prompt requires `layoutDirective` + palette anchor block

**Files:**
- Modify: `packages/role-designer/src/assemble-proposal.ts` (draft system prompt + user-turn builder).
- Modify: `packages/role-designer/test/assemble-proposal.test.ts` (assert palette anchor appears in user-turn).

- [ ] **Step 1: Locate the draft system prompt**

```bash
grep -n "system prompt\|SYSTEM_PROMPT\|draftProposal\|renderDraftUserTurn\|assembleDraft" packages/role-designer/src/assemble-proposal.ts
```

Find where the draft pass's system prompt is constructed AND where the user-turn message is built. The system prompt is sent in the role's LLM call as the `system` slot; the user-turn carries the brief.

- [ ] **Step 2: Write the failing test for the palette anchor block**

Add to `packages/role-designer/test/assemble-proposal.test.ts`:

```ts
import { renderDraftUserTurn } from "../src/assemble-proposal.js";
// If renderDraftUserTurn isn't already exported, export it.

describe("renderDraftUserTurn palette anchors", () => {
  it("prepends a palette anchor block citing the top reference", () => {
    const brief = {
      category: "restaurant-landing",
      audienceCues: ["foodies"],
      references: [
        {
          name: "Bombay Canteen",
          url: "x",
          why: "x",
          sourceTier: "web" as const,
          palettePreview: ["#fef3c7", "#0a0a0a", "#fbbf24"]
        }
      ],
      patternsThatWin: ["chef portrait"],
      patternsThatLose: ["fake testimonials"]
    };
    const out = renderDraftUserTurn(brief, "build a restaurant site");
    expect(out).toContain("Palette anchor");
    expect(out).toContain("Bombay Canteen");
    expect(out).toContain("#fef3c7");
    expect(out).toContain("#0a0a0a");
    expect(out).toContain("#fbbf24");
  });

  it("renders a no-anchor fallback when the top reference lacks palettePreview", () => {
    const brief = {
      category: "x",
      audienceCues: [],
      references: [{ name: "Generic", url: "x", why: "x", sourceTier: "web" as const }],
      patternsThatWin: [],
      patternsThatLose: []
    };
    const out = renderDraftUserTurn(brief, "x");
    expect(out).toContain("no palette preview available");
  });
});
```

The exact function name (`renderDraftUserTurn`, `buildDraftPrompt`, etc.) depends on what exists in the file — match the existing convention.

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm --filter @atlas/role-designer vitest run test/assemble-proposal.test.ts
```

Expected: 2 new failures (palette-anchor lines not present in output).

- [ ] **Step 4: Add the palette anchor block to the user-turn builder**

Find the user-turn-builder function. Before the existing `JSON.stringify(brief, null, 2)` line, prepend:

```ts
function formatPaletteAnchor(brief: InspirationBrief): string {
  const top = brief.references[0];
  if (!top) return "(no references available)";
  const palette = top.palettePreview;
  if (!palette || palette.length === 0) {
    return `Top reference: ${top.name}\n(no palette preview available — invent a palette from category conventions)`;
  }
  // Label by position: 4-tuple → surface/text/accent/muted; 3-tuple → surface/text/accent
  const labels =
    palette.length >= 4
      ? ["surface", "text", "accent", "muted"]
      : ["surface", "text", "accent"];
  const rows = palette.slice(0, labels.length).map((hex, i) => `  ${labels[i]}: ${hex}`).join("\n");
  return [
    `Top reference: ${top.name}`,
    `Suggested palette to anchor from:`,
    rows
  ].join("\n");
}
```

Then in the user-turn builder, prepend this block before the brief JSON:

```ts
return [
  "## Palette anchors (from researcher's top reference)",
  "",
  formatPaletteAnchor(brief),
  "",
  "You can shift hues, saturation, or contrast — but stay within ±15% of these values unless your direction has a strong category reason. If your direction diverges from this anchor, EXPLAIN WHY in that direction's `technicalDescription` field.",
  "",
  "Alternates can (and should) anchor on the second and third references' palettes for visible differentiation across the three directions.",
  "",
  "## Brief",
  JSON.stringify(brief, null, 2),
  "",
  "## User prompt",
  userPrompt
].join("\n");
```

(Adapt parameter names to whatever the existing function uses; `userPrompt` may be called `intent` or `userTurn` etc.)

- [ ] **Step 5: Update draft SYSTEM_PROMPT to require layoutDirective**

In the draft system prompt block (the `system:` content for the LLM call), append a paragraph:

```
Each direction you emit MUST include a `layoutDirective` field — 1-3 sentences naming the specific sections the page should have AND any explicit exclusions (e.g., "NO testimonials block — restaurants don't lead with reviews"). The layoutDirective is what the Developer uses as the page skeleton. Generic "hero + features + footer" directives defeat the purpose — be category-specific. Examples:

- Restaurant: "Hero with food close-up + reservation chip overlay. Menu by category with photos. Chef portrait + story. Visit info (hours, map). NO testimonials — restaurants lead with the food."
- API docs: "Hero with live code snippet + language switcher. Quickstart in 4 steps. Method gallery (clickable cards). Integration logos."
- Marketplace: "Search-first hero (location/date/category). Featured listings grid. Trust strip (reviews, listing count). Categories cloud."
- Portfolio: "Full-bleed hero with one signature work. Project gallery (large tiles). About + process section. Contact CTA."

If the user's prompt doesn't match a clear category, INFER one and commit to it. Two restaurant sites should not get the same layoutDirective — vary based on cuisine, formality, target audience.
```

- [ ] **Step 6: Run test — verify it passes**

```bash
pnpm --filter @atlas/role-designer vitest run test/assemble-proposal.test.ts
```

Expected: all tests pass (including the 2 from Task 1 + 2 new palette-anchor tests).

- [ ] **Step 7: Commit**

```bash
git add packages/role-designer/src/assemble-proposal.ts packages/role-designer/test/assemble-proposal.test.ts
git commit -m "feat(role-designer): require layoutDirective in draft + prepend palette anchor block to user-turn"
```

---

## Task 3: Critique restructure (patternsThatWin first) + Sonnet model bump

**Files:**
- Modify: `packages/role-designer/src/critique-prompt.ts` — restructure user-turn.
- Modify: `packages/role-designer/src/role.ts` — pass through `critiqueModel` option (if not already supported).
- Modify: `apps/atlas-web/lib/engine/factory.ts` — wire `ATLAS_LLM_CRITIQUE_MODEL` env into DesignerRole construction.
- Modify: `packages/role-designer/test/critique-prompt.test.ts` if present.

- [ ] **Step 1: Read the existing critique builder**

```bash
grep -n "renderCritique\|critiqueUserTurn\|CRITIQUE_SYSTEM" packages/role-designer/src/critique-prompt.ts
cat packages/role-designer/src/critique-prompt.ts | head -100
```

Find where the critique user-turn is built. The current shape probably starts with the draft proposal JSON then includes the brief.

- [ ] **Step 2: Write the failing test**

Add to `packages/role-designer/test/critique-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderCritiqueUserTurn } from "../src/critique-prompt.js";

describe("renderCritiqueUserTurn", () => {
  it("leads with patternsThatWin and patternsThatLose before the draft", () => {
    const brief = {
      category: "restaurant-landing",
      audienceCues: [],
      references: [],
      patternsThatWin: ["chef portrait", "menu with photos"],
      patternsThatLose: ["fake testimonials", "generic hero stock photo"]
    };
    const draft = { recommended: { id: "x" }, alternates: [], reasoning: "x" };
    const out = renderCritiqueUserTurn(brief, draft);
    // Patterns must appear BEFORE the draft serialization
    const patternsIdx = out.indexOf("chef portrait");
    const draftIdx = out.indexOf('"id":"x"');
    expect(patternsIdx).toBeGreaterThan(-1);
    expect(draftIdx).toBeGreaterThan(-1);
    expect(patternsIdx).toBeLessThan(draftIdx);
    expect(out).toContain("MUST appear");
    expect(out).toContain("MUST NOT appear");
    expect(out).toContain("Generic SaaS or landing-page conventions don't apply");
  });
});
```

The function name (`renderCritiqueUserTurn`, `buildCritiquePrompt`, etc.) depends on what's actually in the file — match the convention.

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm --filter @atlas/role-designer vitest run test/critique-prompt.test.ts
```

Expected: failure (patterns not in expected positions).

- [ ] **Step 4: Restructure the critique user-turn**

In `critique-prompt.ts`, replace the existing user-turn builder body with:

```ts
export function renderCritiqueUserTurn(brief: InspirationBrief, draft: DesignProposal): string {
  const wins = (brief.patternsThatWin ?? []).map((p) => `  - ${p}`).join("\n");
  const loses = (brief.patternsThatLose ?? []).map((p) => `  - ${p}`).join("\n");

  return [
    `You are critiquing a design proposal for a website in the category: ${brief.category}.`,
    ``,
    `Patterns that MUST appear in winning designs for this category:`,
    wins || "  (no category patterns supplied — score using general design heuristics)",
    ``,
    `Patterns that MUST NOT appear (these signal a regression to generic SaaS):`,
    loses || "  (no anti-patterns supplied)",
    ``,
    `Score the draft against THESE category-specific patterns. Generic SaaS or landing-page conventions don't apply unless the category IS SaaS or generic-landing.`,
    ``,
    `## Draft proposal`,
    JSON.stringify(draft, null, 2),
    ``,
    `## Rubric — score each axis 1-5 with a specific suggestion if score < 5`,
    `1. palette — distinctness from category defaults; coherence with token typography`,
    `2. typography — fitness for category; hierarchy clarity`,
    `3. composition — section variety; spacing rhythm; matches layoutDirective intent`,
    `4. patterns_alignment — does the proposal honor patternsThatWin? does it avoid patternsThatLose?`,
    `5. distinctness — would two restaurants both get this same proposal? if yes, score low.`
  ].join("\n");
}
```

If the existing rubric is different, preserve the existing rubric and ONLY add the patterns-lead at the top — don't rewrite working rubric language.

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm --filter @atlas/role-designer vitest run test/critique-prompt.test.ts
```

- [ ] **Step 6: Add critique-model option to DesignerRole**

Open `packages/role-designer/src/role.ts`. Find the constructor and the call that runs the critique LLM. Add an option `critiqueModel?: string` and use it for the critique call. Falls back to whatever model the role uses today.

Example (adapt to the actual class shape):

```ts
export interface DesignerRoleOptions {
  llm: LLMProvider;
  draftModel?: string;
  critiqueModel?: string;  // NEW — Sonnet for distinctness scoring
  reviseModel?: string;
  ...
}
```

Inside the critique call site:

```ts
const critiqueModel = this.opts.critiqueModel ?? this.opts.draftModel ?? "anthropic/claude-haiku-4.5";
const response = await this.opts.llm.complete({ model: critiqueModel, system: CRITIQUE_SYSTEM_PROMPT, ... });
```

- [ ] **Step 7: Wire `ATLAS_LLM_CRITIQUE_MODEL` env in atlas-web factory**

Open `apps/atlas-web/lib/engine/factory.ts`. Find where `DesignerRole` is constructed (probably gated behind `isFeatureEnabled("designer")`). Read the constructor args. Append:

```ts
critiqueModel: process.env.ATLAS_LLM_CRITIQUE_MODEL ?? "anthropic/claude-sonnet-4.5",
```

- [ ] **Step 8: Build + run all role-designer tests**

```bash
pnpm --filter @atlas/role-designer build
pnpm --filter @atlas/role-designer vitest run
```

Expected: build succeeds; all existing + new tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/role-designer/src/critique-prompt.ts packages/role-designer/src/role.ts packages/role-designer/test/critique-prompt.test.ts apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(role-designer): critique leads with patternsThatWin/patternsThatLose; default critique model = Sonnet via ATLAS_LLM_CRITIQUE_MODEL"
```

---

## Task 4: `componentSet` category mapping

**Files:**
- Modify: `packages/role-designer/src/assemble-proposal.ts` — add `MARKETING_CATEGORIES` constant + update ROLE_PROMPT / system instructions about componentSet selection.
- Modify: `packages/role-designer/test/assemble-proposal.test.ts` — assert ROLE_PROMPT or system-prompt includes the category-rule wording.

- [ ] **Step 1: Find where componentSet is currently described**

```bash
grep -rn "componentSet\|shadcn unless\|radix-bare" packages/role-designer/src/
```

The current "default shadcn unless brief suggests otherwise" wording lives somewhere in either `role.ts`'s ROLE_PROMPT or `assemble-proposal.ts`'s SYSTEM_PROMPT.

- [ ] **Step 2: Write the failing test**

Add to `packages/role-designer/test/assemble-proposal.test.ts`:

```ts
import { MARKETING_CATEGORIES, DRAFT_SYSTEM_PROMPT } from "../src/assemble-proposal.js";
// Export both from assemble-proposal.ts.

describe("componentSet category rule", () => {
  it("MARKETING_CATEGORIES includes the expected 11 categories", () => {
    expect(MARKETING_CATEGORIES.has("restaurant-landing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("saas-marketing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("portfolio-personal")).toBe(true);
    expect(MARKETING_CATEGORIES.has("e-commerce-product")).toBe(true);
    expect(MARKETING_CATEGORIES.has("agency-creative")).toBe(true);
    expect(MARKETING_CATEGORIES.has("real-estate-listing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("fitness-wellness-landing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("blog-publishing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("travel-booking")).toBe(true);
    expect(MARKETING_CATEGORIES.has("education-marketing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("ngo-marketing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("saas-app")).toBe(false);
    expect(MARKETING_CATEGORIES.has("dashboard")).toBe(false);
  });

  it("DRAFT_SYSTEM_PROMPT explains the radix-bare-for-marketing rule", () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/radix-bare/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/marketing.*content|content.*marketing/i);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm --filter @atlas/role-designer vitest run test/assemble-proposal.test.ts
```

Expected: failures (constant + prompt change not present).

- [ ] **Step 4: Add the constant + update the system prompt**

In `assemble-proposal.ts`, near the top:

```ts
/** Categories where componentSet defaults to radix-bare instead of shadcn.
 *  These are marketing/content surfaces where shadcn's slate+blue defaults
 *  drive every output toward sameness. App surfaces (dashboards, admin,
 *  saas-app) still use shadcn because their primitives are valuable. */
export const MARKETING_CATEGORIES: ReadonlySet<string> = new Set([
  "saas-marketing",
  "restaurant-landing",
  "portfolio-personal",
  "e-commerce-product",
  "agency-creative",
  "real-estate-listing",
  "fitness-wellness-landing",
  "blog-publishing",
  "travel-booking",
  "education-marketing",
  "ngo-marketing"
]);
```

In the draft `SYSTEM_PROMPT` (or `ROLE_PROMPT` in `role.ts` — wherever the componentSet rule is currently described), replace the existing wording with:

```
componentSet selection rule (decide based on the brief's `category` field):
  - "shadcn"     → app surfaces and tools (saas-app, dashboard, admin, internal-tools, productivity-app)
  - "radix-bare" → marketing/content surfaces (saas-marketing, restaurant-landing, portfolio-personal, e-commerce-product, agency-creative, real-estate-listing, fitness-wellness-landing, blog-publishing, travel-booking, education-marketing, ngo-marketing)
  - "custom"     → premium-distinctive brands explicitly asking for hand-crafted components

Default to shadcn ONLY when the category doesn't match any marketing/content listing above. The radix-bare rule prevents shadcn's slate+blue defaults from drowning out the chosen palette on marketing pages.
```

If the system prompt is built dynamically from a template, append this rule cleanly without breaking existing structure. If the prompt is a static string, just rewrite the relevant section.

Make sure `DRAFT_SYSTEM_PROMPT` is exported so the test can import it. If it's an inner const, lift it to a module-level export.

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm --filter @atlas/role-designer vitest run test/assemble-proposal.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/role-designer/src/assemble-proposal.ts packages/role-designer/test/assemble-proposal.test.ts
git commit -m "feat(role-designer): componentSet category mapping — radix-bare for 11 marketing categories"
```

---

## Task 5: Developer surfaces `layoutDirective` + radix-bare guidance

**Files:**
- Modify: `packages/role-developer/src/render-user-turn.ts` — replace hardcoded scaffold; conditional radix-bare section.
- Modify: `packages/role-developer/test/render-user-turn.test.ts` — assert directive and radix-bare guidance appear.

- [ ] **Step 1: Find the hardcoded scaffold block**

```bash
grep -n "Hero section\|Build target\|hero + features" packages/role-developer/src/render-user-turn.ts
```

The current scaffold formula is around line 87-100 area (per the design spec). Read the file to confirm.

- [ ] **Step 2: Write the failing tests**

In `packages/role-developer/test/render-user-turn.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDeveloperUserTurn } from "../src/render-user-turn.js";

describe("renderDeveloperUserTurn layoutDirective", () => {
  it("surfaces selectedLayoutDirective as the page skeleton when present", () => {
    const artifact = {
      selectedTokens: {
        palette: { primary: "#000" },
        componentSet: "shadcn"
      },
      selectedLayoutDirective: "Hero with food close-up. Menu by category. NO testimonials."
    };
    const out = renderDeveloperUserTurn("build", artifact);
    expect(out).toContain("Hero with food close-up");
    expect(out).toContain("NO testimonials");
    // The hardcoded "hero + 2-4 supporting sections" formula should NOT appear
    // when layoutDirective is supplied:
    expect(out).not.toMatch(/2-4 supporting sections/);
  });

  it("falls back to the legacy scaffold when selectedLayoutDirective is absent", () => {
    const artifact = {
      selectedTokens: {
        palette: { primary: "#000" },
        componentSet: "shadcn"
      }
    };
    const out = renderDeveloperUserTurn("build", artifact);
    expect(out).toMatch(/2-4 supporting sections|hero.*features.*footer/i);
  });

  it("adds radix-bare guidance when componentSet === 'radix-bare'", () => {
    const artifact = {
      selectedTokens: {
        palette: { primary: "#000" },
        componentSet: "radix-bare"
      },
      selectedLayoutDirective: "Hero. Menu. Footer."
    };
    const out = renderDeveloperUserTurn("build", artifact);
    expect(out).toContain("radix-bare");
    expect(out).toMatch(/raw Tailwind|lucide.*framer-motion|framer-motion.*lucide/i);
    expect(out).toMatch(/do not.*shadcn|don't.*shadcn/i);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
pnpm --filter @atlas/role-developer vitest run test/render-user-turn.test.ts
```

Expected: 3 new failures.

- [ ] **Step 4: Replace the scaffold + add radix-bare guidance**

In `render-user-turn.ts`, find the "## Build target" section. Replace the existing hardcoded "hero + supporting sections + footer" content with logic that uses `selectedLayoutDirective` when present:

```ts
// Helper near the top of the file:
function extractSelectedLayoutDirective(artifact: unknown): string | undefined {
  if (!artifact || typeof artifact !== "object") return undefined;
  const v = (artifact as { selectedLayoutDirective?: unknown }).selectedLayoutDirective;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// In renderDeveloperUserTurn, around the "## Build target" block:
const layoutDirective = extractSelectedLayoutDirective(architectArtifact);
sections.push("", "## Build target");
if (layoutDirective) {
  sections.push(
    "",
    "Use this page skeleton (specified by the Designer for this category):",
    "",
    "    " + layoutDirective,
    "",
    "Honor the named sections AND any explicit exclusions (e.g., 'NO testimonials' means no testimonials block). The Designer chose what fits the category — do not add 'standard' sections just because they appear on most landing pages."
  );
} else {
  // Legacy fallback — same as before
  sections.push(
    "",
    "Produce a complete landing page (not a stub). Default scaffold for new-app / new-feature requests:",
    "- Hero section with headline, subheading, primary CTA",
    "- 2-4 supporting sections (features grid, about, gallery, testimonials, or pricing — pick what fits the intent)",
    "- Footer"
  );
}
```

Then add the radix-bare conditional. After the existing tokens block / build target block, append:

```ts
const componentSet = (selectedTokens?.componentSet as string | undefined) ?? "shadcn";
if (componentSet === "radix-bare") {
  sections.push(
    "",
    "## Component primitives — radix-bare",
    "",
    "The Designer chose `componentSet: radix-bare` for this marketing/content page. This means:",
    "- Do NOT reach for shadcn's `Button`, `Card`, `Tabs`, `Dialog`, etc. primitives — they'd impose slate+blue defaults that fight the chosen palette.",
    "- DO use raw Tailwind utility classes, lucide-react icons, and framer-motion animations directly.",
    "- Build cards/buttons/sections from `<div>` + the design tokens. Tokens are in `src/design-tokens.json`.",
    "- The atlas-next-ts template still ships shadcn imports — leave them in place but don't import from them in NEW components."
  );
} else if (componentSet === "custom") {
  sections.push(
    "",
    "## Component primitives — custom",
    "",
    "The Designer chose `componentSet: custom` — build hand-crafted components from raw Tailwind + the design tokens. Don't use shadcn's primitives. This is a distinctive-brand surface."
  );
}
// shadcn case is unchanged — existing prompt covers it implicitly.
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pnpm --filter @atlas/role-developer vitest run test/render-user-turn.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Build the package**

```bash
pnpm --filter @atlas/role-developer build
```

- [ ] **Step 7: Commit**

```bash
git add packages/role-developer/src/render-user-turn.ts packages/role-developer/test/render-user-turn.test.ts
git commit -m "feat(role-developer): surface selectedLayoutDirective as page skeleton + radix-bare guidance"
```

---

## Task 6: Engine wires `selectedLayoutDirective` into Developer's priorArtifact

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts` — after canvas pause resolution, fold the chosen direction's `layoutDirective` into the priorArtifact passed to Developer.
- Modify: `packages/ritual-engine/test/` — add a test that asserts the Developer dispatch's priorArtifact includes `selectedLayoutDirective`.

- [ ] **Step 1: Find the engine's canvas-pause resolution + developer dispatch**

```bash
grep -n "selectedTokens\|canvasPauseRegistry\|developerPriorArtifact\|forceRoleId.*developer" packages/ritual-engine/src/engine.ts
```

Find where `selectedTokens = resolution.tokens` is assigned after `waitForOption` returns. This is the line right before AssetGenerator dispatch (Plan SPU Task 7's wiring). The `developerPriorArtifact` is built shortly after, folding `selectedTokens` + `assetManifest`.

- [ ] **Step 2: Write the failing test**

In `packages/ritual-engine/test/engine-layout-directive.test.ts` (new file):

```ts
import { describe, it, expect } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";

describe("Engine — layoutDirective threads to Developer priorArtifact", () => {
  it("folds the chosen direction's layoutDirective into Developer's priorArtifact as selectedLayoutDirective", async () => {
    const developerSeen: unknown[] = [];
    const architect = {
      run: async () => ({
        events: [{
          eventType: "architect.pass2.completed",
          payload: { artifact: {
            canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing", default: true, blockingFor: "design", audience: ["ama"] }] },
            designIntent: { category: "restaurant-landing", audienceCues: [] }
          }}
        }],
        artifact: {
          canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing", default: true, blockingFor: "design", audience: ["ama"] }] },
          designIntent: { category: "restaurant-landing", audienceCues: [] }
        },
        diff: { kind: "none" }
      })
    };
    const researcher = {
      run: async () => ({
        events: [{ eventType: "researcher.brief.completed", payload: { brief: {} } }],
        artifact: { brief: { category: "restaurant-landing" } },
        diff: { kind: "none" }
      })
    };
    const designer = {
      run: async () => ({
        events: [{
          eventType: "designer.proposal.emitted",
          payload: { proposal: {
            recommended: {
              id: "rec",
              tokens: { palette: { primary: "#000" }, componentSet: "radix-bare" },
              layoutDirective: "Hero with food. Menu by category. NO testimonials."
            },
            alternates: [],
            reasoning: "x"
          }}
        }],
        artifact: { proposal: { recommended: { id: "rec", tokens: { palette: { primary: "#000" }, componentSet: "radix-bare" }, layoutDirective: "Hero with food. Menu by category. NO testimonials." }, alternates: [], reasoning: "x" } },
        diff: { kind: "none" }
      })
    };
    const developer = {
      run: async (inv: { priorArtifact: unknown }) => {
        developerSeen.push(inv.priorArtifact);
        return { events: [], artifact: undefined, diff: { kind: "patch", body: "" } };
      }
    };

    // Build a minimal Conductor stub that routes role IDs.
    const conductor = {
      hasRole: (id: string) => ["architect", "researcher", "designer", "developer"].includes(id),
      dispatch: async (inv: { ritualId: string; userTurn: string; projectId: string }, opts: { forceRoleId: string; priorArtifact?: unknown }) => {
        const inv2 = { ...inv, priorArtifact: opts.priorArtifact };
        const role =
          opts.forceRoleId === "architect"  ? architect :
          opts.forceRoleId === "researcher" ? researcher :
          opts.forceRoleId === "designer"   ? designer :
          opts.forceRoleId === "developer"  ? developer :
          null;
        if (!role) throw new Error(`unknown role: ${opts.forceRoleId}`);
        const out = await role.run(inv2 as never);
        return { output: out };
      }
    };

    const pauseRegistry = {
      waitForOption: async () => ({
        directionId: "rec",
        tokens: { palette: { primary: "#000" }, componentSet: "radix-bare" },
        autoSelected: true
      })
    };

    const engine = new RitualEngine({
      conductor: conductor as never,
      eventSink: new InMemoryEventSink(),
      canvasFlowEnabled: true,
      canvasPauseRegistry: pauseRegistry as never
    });

    await engine.start({
      projectId: "11111111-1111-1111-1111-111111111111",
      userTurn: "build a restaurant",
      editClass: "structural",
      userId: "u1"
    });

    expect(developerSeen.length).toBeGreaterThan(0);
    const priorArtifact = developerSeen[0] as { selectedLayoutDirective?: string };
    expect(priorArtifact.selectedLayoutDirective).toBe("Hero with food. Menu by category. NO testimonials.");
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm --filter @atlas/ritual-engine vitest run test/engine-layout-directive.test.ts
```

Expected: failure (`selectedLayoutDirective` is `undefined` because the engine doesn't fold it yet).

- [ ] **Step 4: Modify engine.ts**

Find the block in `engine.ts` where the canvas pause resolves (after `await this.canvasPauseRegistry.waitForOption(...)`) and the developer's priorArtifact is being assembled. The current shape is roughly:

```ts
const resolution = await this.canvasPauseRegistry.waitForOption({...});
selectedTokens = resolution.tokens;
// ... later, after asset-gen:
const developerPriorArtifact = selectedTokens !== undefined && artifact && typeof artifact === "object"
  ? { ...(artifact as object), selectedTokens, ...(assetManifest ? { assetManifest } : {}) }
  : artifact;
```

Extend the resolution to capture the layoutDirective from the chosen direction. The proposal is available on the designer's emitted event payload. Find where `proposal` is referenced near the pause block, then locate the direction by `resolution.directionId`:

```ts
const chosenDirection =
  proposal.recommended.id === resolution.directionId
    ? proposal.recommended
    : proposal.alternates.find((d) => d.id === resolution.directionId) ?? proposal.recommended;
const selectedLayoutDirective: string | undefined =
  typeof (chosenDirection as { layoutDirective?: unknown }).layoutDirective === "string"
    ? (chosenDirection as { layoutDirective: string }).layoutDirective
    : undefined;
```

Then in the `developerPriorArtifact` assembly, conditionally fold it in:

```ts
const developerPriorArtifact = selectedTokens !== undefined && artifact && typeof artifact === "object"
  ? {
      ...(artifact as object),
      selectedTokens,
      ...(selectedLayoutDirective !== undefined ? { selectedLayoutDirective } : {}),
      ...(assetManifest ? { assetManifest } : {})
    }
  : artifact;
```

The conditional spread honors `exactOptionalPropertyTypes`.

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm --filter @atlas/ritual-engine vitest run test/engine-layout-directive.test.ts
```

Expected: pass.

- [ ] **Step 6: Build the package + run full suite**

```bash
pnpm --filter @atlas/ritual-engine build
pnpm --filter @atlas/ritual-engine vitest run
```

Expected: all existing tests pass; new test passes.

- [ ] **Step 7: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-layout-directive.test.ts
git commit -m "feat(ritual-engine): fold chosen direction's layoutDirective into Developer priorArtifact as selectedLayoutDirective"
```

---

## Task 7 (optional, ship if time): Verification ritual

Not a code task — a manual validation step the user runs after Tasks 1-6 land. Documented here so the executor doesn't skip it.

- [ ] **Step 1: Rebuild + restart dev server**

```bash
pnpm --filter @atlas/role-designer build
pnpm --filter @atlas/role-developer build
pnpm --filter @atlas/ritual-engine build
# kill + restart dev server
```

- [ ] **Step 2: Run two contrasting prompts**

a) "build a luxury seafood restaurant in lisbon called Maré"
b) "build a developer documentation site for a graph database called Synapse"

Watch the dev log for `designer.draft.completed` payloads. Each direction should have a `layoutDirective` field with category-specific structure. The restaurant directives should mention menu/chef/visit, NOT testimonials. The docs directives should mention code snippets/quickstart/method gallery, NOT pricing.

- [ ] **Step 3: Click Use this; wait for sandbox.apply.completed; refresh canvas**

Visually compare the two rendered sites. They should have OBSERVABLY DIFFERENT page structures — not the same hero + features template with different palettes.

If both sites still look the same, the directives didn't reach the developer effectively — investigate which step in the pipeline dropped the data.

---

## Self-review log

**1. Spec coverage:**
- ✅ Fix 1 (layoutDirective field on DesignDirection): Task 1 (schema) + Task 2 (draft prompt requires it) + Task 5 (developer surfaces it) + Task 6 (engine wires it).
- ✅ Fix 2 (critique patternsThatWin lead + Sonnet bump): Task 3.
- ✅ Fix 3 (componentSet category defaults): Task 4 + Task 5 (radix-bare guidance for developer).
- ✅ Fix 4 (palette anchor block in draft user-turn): Task 2.
- ❌ Fix 5 (direction randomization on auto-resolve): intentionally out of scope per spec ("deferred").

**2. Placeholder scan:** No TBDs, no "add appropriate handling" — every step has concrete code or commands. Task 7 is explicitly marked manual/optional, not a placeholder.

**3. Type consistency:**
- `DesignDirection.layoutDirective: string` (required) defined in Task 1, referenced verbatim in Tasks 2, 5, 6.
- `selectedLayoutDirective: string` (priorArtifact field) defined in Task 6, referenced verbatim in Task 5's developer prompt logic.
- `MARKETING_CATEGORIES: ReadonlySet<string>` defined in Task 4, exported as a constant.
- `componentSet` allowed values stay `"shadcn" | "radix-bare" | "custom"` across all tasks.
