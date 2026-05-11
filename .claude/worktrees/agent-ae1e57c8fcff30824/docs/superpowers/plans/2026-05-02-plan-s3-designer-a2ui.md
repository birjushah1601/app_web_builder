# Plan S.3 — Designer Role + A2UI Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two coordinated additions. **(A)** A new `@atlas/role-researcher`-shaped sibling package `@atlas/role-designer` — a Conductor-dispatched Role that consumes architect's artifact + S.2's optional `InspirationBrief` and emits a Zod-validated `DesignProposal` containing exactly one recommended `DesignDirection` plus two alternates, each carrying full `DesignTokens`. Plus a pure `refineAxis(direction, axis, choice)` helper for the AxisWizard refinement path (no LLM call — mechanical merge). **(B)** Four reusable React components in `apps/atlas-web/components/a2ui/` — `OptionsCard`, `AxisWizard`, `OutcomeCard`, `TechnicalCard` — that render any "pick one of N" question with persona-aware framing (ama gets outcome cards, diego/priya get technical cards). Behind feature flag `ATLAS_FF_DESIGNER` so it does not affect existing pipelines until S.4 wires it into the engine + canvas shell.

**Architecture:** The `@atlas/role-designer` package mirrors `@atlas/role-researcher` exactly: a class implementing `Role` from `@atlas/conductor`, Zod schemas in `types.ts`, typed errors in `errors.ts`, single Sonnet-tier LLM call via `@atlas/llm-provider` with tool-use enforcement. The role reads `priorArtifact.brief` (the S.2 InspirationBrief, optional — Designer degrades gracefully when absent), composes a Sonnet call that returns `DesignProposal { recommended, alternates: [DesignDirection, DesignDirection], reasoning }`, and validates the tool-use payload via Zod. Persona is **NOT** passed to the LLM — the proposal is persona-agnostic; the renderer chooses framing. `refineAxis` is a pure synchronous helper that merges a single axis choice (palette / typeScale / density / componentSet / imageryStrategy / copyVoice) into an existing direction, returning a new direction with updated tokens.

The A2UI components live in `apps/atlas-web/components/a2ui/` alongside today's `PersonaToggle.tsx` / `ApprovalPanel.tsx`. They are framework-agnostic about *what* they render: `OptionsCard` takes generic `recommended` + `alternates` props with `id`, `name`, `shortDescription`, `technicalDescription`, and a `cardPayload` slot the leaf renderer reads. `AxisWizard` steps through any `axes` array (palette / typography / density for designer; field-set / scale-strategy for backend schema in v2) one axis per screen, with an educational tooltip per axis (the user's "fun + educational" steer). The four components are unit-tested with vitest + React Testing Library; Playwright snapshot scaffolds land alongside them but their PNG baselines are committed in Plan S.5.

**Tech Stack:** TypeScript 5.6 · Node 22 · Zod 3.23 · vitest 2.1 · React 18.3 · Tailwind 3.4 utility classes (sandbox-uplifted in S.1; atlas-web already uses Tailwind) · `@testing-library/react` 16 · `@testing-library/user-event` 14 · `@atlas/conductor` + `@atlas/llm-provider` + `@atlas/role-researcher` (workspace deps).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan S.2 MUST be merged first — `@atlas/role-researcher` exports `InspirationBrief` and `InspirationBriefSchema` which this plan imports for the Designer's input contract.
- Plan S.1 not strictly required (the Designer doesn't touch the sandbox), but recommended so end-to-end demos can prove tokens flow through to rendered output once S.4 lands.
- Repo state: on `main` (after S.2 merges), working tree clean, all existing tests green.
- `pnpm` 9 + Node 22.

**Branch:** `plan-s3/designer-a2ui` cut from `main`. Final task in this plan merges back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root.

```
packages/role-designer/                                # NEW PACKAGE
  package.json                                         # NEW
  tsconfig.json                                        # NEW
  vitest.config.ts                                     # NEW
  README.md                                            # NEW
  src/
    index.ts                                           # NEW: public exports
    types.ts                                           # NEW: DesignProposalSchema, DesignDirectionSchema, DesignTokensSchema, AxisChoiceSchema
    errors.ts                                          # NEW: DesignerFailedError
    role.ts                                            # NEW: DesignerRole class
    assemble-proposal.ts                               # NEW: pure helper (architect artifact + brief + designIntent → Sonnet call → DesignProposal)
    refine.ts                                          # NEW: refineAxis(direction, choice) — pure mechanical merge, no LLM call
  test/
    types.test.ts                                      # NEW: Zod schema parse + reject for all four schemas
    errors.test.ts                                     # NEW: typed-error capture
    role.test.ts                                       # NEW: DesignerRole.run happy + missing-brief + LLM-failure
    assemble-proposal.test.ts                          # NEW: LLM call shape, Zod validation, brief-citation invariant
    refine.test.ts                                     # NEW: each axis merges correctly + immutability + unknown-axis rejection

apps/atlas-web/
  components/a2ui/                                     # NEW: A2UI primitive directory
    OptionsCard.tsx                                    # NEW: generic Pattern C component (recommended + alternates)
    AxisWizard.tsx                                     # NEW: generic Pattern B component (axis-by-axis wizard with educational tooltip)
    OutcomeCard.tsx                                    # NEW: ama-tier card framing (no jargon, emoji-leading title)
    TechnicalCard.tsx                                  # NEW: diego/priya-tier framing (token swatches, "Show internals" toggle for priya)
    index.ts                                           # NEW: re-exports + shared prop types
  lib/engine/factory.ts                                # MODIFIED: register DesignerRole behind ATLAS_FF_DESIGNER
  lib/feature-flags.ts                                 # MODIFIED: add "designer" flag → ATLAS_FF_DESIGNER
  .env.example                                         # MODIFIED: add ATLAS_FF_DESIGNER entry
  test/components/a2ui/                                # NEW: per-component vitest specs
    OptionsCard.test.tsx
    AxisWizard.test.tsx
    OutcomeCard.test.tsx
    TechnicalCard.test.tsx
  test/lib/factory-designer.test.ts                    # NEW: 3 cases (flag-OFF, flag-ON, missing-llm)
  e2e/visual/a2ui/                                     # NEW: Playwright snapshot scaffolds (PNG baselines land in S.5)
    options-card.spec.ts
    axis-wizard.spec.ts
    outcome-card.spec.ts
    technical-card.spec.ts

docs/superpowers/
  local-dev-status.md                                  # MODIFIED: add Plan S.3 entry under "What's wired"
```

**Why this shape.** The `role-designer` package mirrors `role-researcher` byte-for-byte in layout (same files, same test conventions) so a developer who has just landed S.2 can pattern-match every step. The A2UI directory sits at `components/a2ui/` (not `components/canvas/a2ui/`) because A2UI is the **primitive** — the canvas in S.4 *uses* A2UI; A2UI itself is reusable for any "pick one of N" surface (architect blocking-questions, future schema-direction picker, etc.). The Playwright spec files are scaffolded here so the test infrastructure is in place; the actual `__snapshots__/` PNG baselines are produced and committed in Plan S.5 (which adds the visual-regression CI workflow).

---

## Design Decisions

These resolve implementation-level questions left implicit in the spec.

1. **Why a single Sonnet LLM call (vs. two passes — one to draft + one to validate).** Cost discipline + latency. Sonnet is strong enough to produce a 1+2 proposal in one tool-use turn; a second validator pass would double cost without measurable quality lift. The Zod-on-tool-use payload is the validator. If a Sonnet response routinely fails Zod, the right fix is to tighten the tool schema, not to add a second LLM call.

2. **Why `refineAxis` is pure (no LLM call).** The user already chose the new value via the AxisWizard UI. The merge is mechanical (`{ ...direction, tokens: { ...direction.tokens, palette: choice } }`) — calling an LLM here would only introduce non-determinism, latency, and cost for no benefit. The Designer LLM picks the *initial* directions; refinement is user-driven mechanical edits.

3. **Why persona is NOT passed to the LLM.** Per spec ("Persona is *not* passed to the LLM — proposal is persona-agnostic. The renderer chooses framing."). The same `DesignDirection` data drives both `<OutcomeCard>` (ama) and `<TechnicalCard>` (diego/priya). Keeping persona out of the LLM call lets the persona toggle live-flip the canvas without re-running the role.

4. **Why `OptionsCard` and `AxisWizard` are generic over their card payload (not Designer-specific).** Reusability. Spec calls out that `OptionsCard` will be reused for `SchemaCanvas` in v1 and architect blocking-questions later. Both primitives take a `payload` slot; the leaf renderer (`OutcomeCard` / `TechnicalCard`) decides how to render the payload's domain-specific fields.

5. **Why the educational tooltip is per-axis, not global.** The user's explicit "fun + educational" steer asked for the wizard to *teach* the user about palettes / typography / density as they choose. A global "what is design?" tooltip would be patronizing; a per-axis tooltip ("A palette is the set of colors a design uses — warm earth tones evoke comfort; cool grays signal precision") is the right grain.

6. **Why scaffold Playwright spec files but commit no PNG baselines.** S.5 owns the visual-regression CI workflow + baseline-update tooling. Landing baselines here would mean either re-generating them in S.5 (wasted effort) or duplicating CI config. The spec files are the test plan; their `expect(...).toHaveScreenshot()` calls run with `--update-snapshots` once in S.5 to seed baselines.

7. **Why the `DesignerRole` reads `priorArtifact.brief?` and not `priorArtifact.inspirationBrief`.** The Conductor passes the *previous role's RoleOutput* as `priorArtifact`. S.2's Researcher emits `events: [{ eventType: "researcher.brief.completed", payload: { brief, fastMode } }]` and a `diff: { kind: "none" }` — the engine will fold the brief into the next role's `priorArtifact.brief` when wiring lands in S.4. This plan codes against that contract; a thin `extractBrief` helper handles the optionality so unit tests can pass `priorArtifact: { brief: someBrief }` directly.

8. **Why no skill-library entry for this plan.** S.2 added `researcher/assemble-brief.md` + `researcher/cite-references.md` because Researcher composes them via `SkillRegistry`. The Designer's prompt is short enough to inline in `assemble-proposal.ts` (~40 lines of system prompt) and adding a markdown indirection layer for one-shot usage would be premature. If the prompt grows past 80 lines or starts being reused across roles, extract to skill-library in a follow-up.

---

## Task List (28 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Each task is independently committable.

---
### Task 1: Cut branch + scaffold @atlas/role-designer package

**Files:**
- Create: `(branch)`
- Create: `packages/role-designer/package.json`
- Create: `packages/role-designer/tsconfig.json`
- Create: `packages/role-designer/vitest.config.ts`
- Create: `packages/role-designer/README.md`

- [ ] **Step 1: Cut the branch**

```bash
cd /f/claude/ai_builder
git checkout main
git pull --ff-only
git checkout -b plan-s3/designer-a2ui
```

- [ ] **Step 2: Create package.json**

Create `packages/role-designer/package.json`:

```json
{
  "name": "@atlas/role-designer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/role-researcher": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/role-designer/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

Create `packages/role-designer/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@atlas/role-designer": path.resolve(__dirname, "src/index.ts")
    }
  }
});
```

- [ ] **Step 5: Create stub README.md (refreshed in Task 25 once all files exist)**

Create `packages/role-designer/README.md`:

```markdown
# @atlas/role-designer

Conductor-dispatched Role that produces a `DesignProposal` (1 recommended + 2 alternates) for the canvas (Plan S.4) by combining the architect artifact with the optional `InspirationBrief` from Plan S.2's Researcher.

(Stub — full README lands in Task 25 once all symbols exist.)
```

- [ ] **Step 6: Install + verify the workspace picks up the package**

```bash
pnpm install
```

Expected: pnpm reports `+ @atlas/role-designer 0.0.0` (or similar; new package detected).

- [ ] **Step 7: Commit**

```bash
git add packages/role-designer/
git commit -m "chore(role-designer): scaffold package + tsconfig + vitest"
```

---

### Task 2: Define DesignTokens Zod schema (`types.ts` part 1)

**Files:**
- Create: `packages/role-designer/src/types.ts`
- Create: `packages/role-designer/test/types.test.ts`

- [ ] **Step 1: Write the failing test (DesignTokens portion)**

Create `packages/role-designer/test/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DesignTokensSchema } from "../src/types.js";

describe("DesignTokensSchema", () => {
  const validTokens = {
    palette: {
      primary: "#0a0a0a",
      accent: "#fbbf24",
      surface: "#fef3c7",
      text: "#1f2937",
      muted: "#6b7280"
    },
    typeScale: {
      sansFamily: "Inter",
      serifFamily: "IBM Plex Serif",
      monoFamily: "JetBrains Mono",
      baseSizePx: 16,
      scale: "minor-third"
    },
    density: "comfortable",
    componentSet: "shadcn",
    imageryStrategy: "photo",
    copyVoice: "premium"
  };

  it("parses fully-specified tokens", () => {
    const parsed = DesignTokensSchema.parse(validTokens);
    expect(parsed.palette.primary).toBe("#0a0a0a");
    expect(parsed.typeScale.scale).toBe("minor-third");
    expect(parsed.density).toBe("comfortable");
  });

  it("makes serifFamily optional", () => {
    const noSerif = { ...validTokens, typeScale: { ...validTokens.typeScale, serifFamily: undefined } };
    expect(() => DesignTokensSchema.parse(noSerif)).not.toThrow();
  });

  it("rejects palette hex without leading #", () => {
    const bad = { ...validTokens, palette: { ...validTokens.palette, primary: "0a0a0a" } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects density outside enum", () => {
    const bad = { ...validTokens, density: "loose" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects scale outside enum", () => {
    const bad = { ...validTokens, typeScale: { ...validTokens.typeScale, scale: "golden-ratio" } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects componentSet outside enum", () => {
    const bad = { ...validTokens, componentSet: "material" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects imageryStrategy outside enum", () => {
    const bad = { ...validTokens, imageryStrategy: "video" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects copyVoice outside enum", () => {
    const bad = { ...validTokens, copyVoice: "snarky" };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects baseSizePx below 12", () => {
    const bad = { ...validTokens, typeScale: { ...validTokens.typeScale, baseSizePx: 8 } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });

  it("rejects baseSizePx above 24", () => {
    const bad = { ...validTokens, typeScale: { ...validTokens.typeScale, baseSizePx: 32 } };
    expect(() => DesignTokensSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/types.test.ts
```

Expected: FAIL — `Cannot find module '../src/types.js'`.

- [ ] **Step 3: Write minimal types.ts (DesignTokensSchema only — additional schemas land in Tasks 3 + 4)**

Create `packages/role-designer/src/types.ts`:

```ts
import { z } from "zod";

const HEX = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "must be a hex color like #0a0a0a");

export const DesignTokensSchema = z.object({
  palette: z.object({
    primary: HEX,
    accent: HEX,
    surface: HEX,
    text: HEX,
    muted: HEX
  }),
  typeScale: z.object({
    sansFamily: z.string().min(1),
    serifFamily: z.string().min(1).optional(),
    monoFamily: z.string().min(1),
    baseSizePx: z.number().int().min(12).max(24),
    scale: z.enum(["minor-third", "major-third", "perfect-fourth"])
  }),
  density: z.enum(["compact", "comfortable", "spacious"]),
  componentSet: z.enum(["shadcn", "radix-bare", "custom"]),
  imageryStrategy: z.enum(["photo", "illustration", "abstract-gradients", "none"]),
  copyVoice: z.enum(["premium", "friendly", "authoritative", "playful"])
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/types.test.ts
```

Expected: PASS — 10 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/types.ts packages/role-designer/test/types.test.ts
git commit -m "feat(role-designer): DesignTokensSchema (palette/typeScale/density/componentSet/imageryStrategy/copyVoice)"
```

---

### Task 3: Add DesignDirection schema to `types.ts`

**Files:**
- Modify: `packages/role-designer/src/types.ts`
- Modify: `packages/role-designer/test/types.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `packages/role-designer/test/types.test.ts`:

```ts
import { DesignDirectionSchema } from "../src/types.js";

describe("DesignDirectionSchema", () => {
  const validDirection = {
    id: "editorial-dark",
    name: "Editorial Dark",
    shortDescription: "A premium, magazine-style look with deep blacks and warm accents.",
    technicalDescription: "Inter sans + IBM Plex Serif headline pairing on a near-black surface; amber accent for CTAs; spacious density.",
    citedReferences: ["Bombay Canteen", "Eleven Madison Park"],
    tokens: {
      palette: {
        primary: "#0a0a0a",
        accent: "#fbbf24",
        surface: "#fef3c7",
        text: "#1f2937",
        muted: "#6b7280"
      },
      typeScale: {
        sansFamily: "Inter",
        serifFamily: "IBM Plex Serif",
        monoFamily: "JetBrains Mono",
        baseSizePx: 16,
        scale: "minor-third"
      },
      density: "spacious",
      componentSet: "shadcn",
      imageryStrategy: "photo",
      copyVoice: "premium"
    }
  };

  it("parses a fully-specified direction", () => {
    const parsed = DesignDirectionSchema.parse(validDirection);
    expect(parsed.id).toBe("editorial-dark");
    expect(parsed.citedReferences).toHaveLength(2);
  });

  it("rejects empty id", () => {
    expect(() => DesignDirectionSchema.parse({ ...validDirection, id: "" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => DesignDirectionSchema.parse({ ...validDirection, name: "" })).toThrow();
  });

  it("requires citedReferences (can be empty array)", () => {
    expect(() => DesignDirectionSchema.parse({ ...validDirection, citedReferences: [] })).not.toThrow();
  });

  it("rejects missing tokens", () => {
    const { tokens: _t, ...noTokens } = validDirection;
    expect(() => DesignDirectionSchema.parse(noTokens)).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/types.test.ts
```

- [ ] **Step 3: Append DesignDirectionSchema to types.ts**

Append to `packages/role-designer/src/types.ts`:

```ts
export const DesignDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortDescription: z.string().min(1),
  technicalDescription: z.string().min(1),
  citedReferences: z.array(z.string()),
  tokens: DesignTokensSchema
});
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/types.test.ts
```

Expected: 15 cases pass (10 from Task 2 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/types.ts packages/role-designer/test/types.test.ts
git commit -m "feat(role-designer): DesignDirectionSchema (id/name/descriptions/citedReferences/tokens)"
```

---

### Task 4: Add DesignProposal + AxisChoice schemas to `types.ts`

**Files:**
- Modify: `packages/role-designer/src/types.ts`
- Modify: `packages/role-designer/test/types.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `packages/role-designer/test/types.test.ts`:

```ts
import { DesignProposalSchema, AxisChoiceSchema } from "../src/types.js";

describe("DesignProposalSchema", () => {
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    citedReferences: [],
    tokens: {
      palette: { primary: "#000000", accent: "#ffffff", surface: "#cccccc", text: "#111111", muted: "#888888" },
      typeScale: { sansFamily: "Inter", monoFamily: "Mono", baseSizePx: 16, scale: "minor-third" as const },
      density: "comfortable" as const,
      componentSet: "shadcn" as const,
      imageryStrategy: "photo" as const,
      copyVoice: "premium" as const
    }
  });

  it("requires exactly 2 alternates", () => {
    const valid = {
      recommended: direction("a"),
      alternates: [direction("b"), direction("c")],
      reasoning: "Recommended A because it cites Bombay Canteen — strongest match for premium-restaurant signal."
    };
    expect(() => DesignProposalSchema.parse(valid)).not.toThrow();
  });

  it("rejects 1 alternate", () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b")],
      reasoning: "x"
    };
    expect(() => DesignProposalSchema.parse(bad)).toThrow();
  });

  it("rejects 3 alternates", () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b"), direction("c"), direction("d")],
      reasoning: "x"
    };
    expect(() => DesignProposalSchema.parse(bad)).toThrow();
  });

  it("requires non-empty reasoning", () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b"), direction("c")],
      reasoning: ""
    };
    expect(() => DesignProposalSchema.parse(bad)).toThrow();
  });
});

describe("AxisChoiceSchema", () => {
  it("accepts a palette choice", () => {
    const parsed = AxisChoiceSchema.parse({
      axis: "palette",
      value: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" }
    });
    expect(parsed.axis).toBe("palette");
  });

  it("accepts a density choice", () => {
    const parsed = AxisChoiceSchema.parse({ axis: "density", value: "spacious" });
    expect(parsed.value).toBe("spacious");
  });

  it("rejects unknown axis", () => {
    expect(() => AxisChoiceSchema.parse({ axis: "vibes", value: "loud" })).toThrow();
  });

  it("rejects density outside enum", () => {
    expect(() => AxisChoiceSchema.parse({ axis: "density", value: "loose" })).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/types.test.ts
```

- [ ] **Step 3: Append the schemas to types.ts**

Append to `packages/role-designer/src/types.ts`:

```ts
export const DesignProposalSchema = z.object({
  recommended: DesignDirectionSchema,
  alternates: z.tuple([DesignDirectionSchema, DesignDirectionSchema]),
  reasoning: z.string().min(1)
});
export type DesignProposal = z.infer<typeof DesignProposalSchema>;

/** A single axis choice the user makes inside the AxisWizard.
 *  refineAxis(direction, choice) merges this into the direction's tokens. */
export const AxisChoiceSchema = z.discriminatedUnion("axis", [
  z.object({ axis: z.literal("palette"), value: DesignTokensSchema.shape.palette }),
  z.object({ axis: z.literal("typeScale"), value: DesignTokensSchema.shape.typeScale }),
  z.object({ axis: z.literal("density"), value: DesignTokensSchema.shape.density }),
  z.object({ axis: z.literal("componentSet"), value: DesignTokensSchema.shape.componentSet }),
  z.object({ axis: z.literal("imageryStrategy"), value: DesignTokensSchema.shape.imageryStrategy }),
  z.object({ axis: z.literal("copyVoice"), value: DesignTokensSchema.shape.copyVoice })
]);
export type AxisChoice = z.infer<typeof AxisChoiceSchema>;
export type AxisId = AxisChoice["axis"];
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/types.test.ts
```

Expected: 23 cases pass.

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/types.ts packages/role-designer/test/types.test.ts
git commit -m "feat(role-designer): DesignProposalSchema (1+2 alternates) + AxisChoiceSchema (discriminated union)"
```

---

### Task 5: Define typed errors (`errors.ts`)

**Files:**
- Create: `packages/role-designer/src/errors.ts`
- Create: `packages/role-designer/test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-designer/test/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DesignerFailedError, RefineAxisError } from "../src/errors.js";

describe("DesignerFailedError", () => {
  it("captures cause + reason", () => {
    const cause = new Error("LLM 503");
    const err = new DesignerFailedError("proposal assembly failed", { cause, reason: "llm-timeout" });
    expect(err.message).toMatch(/proposal assembly failed/);
    expect(err.cause).toBe(cause);
    expect(err.reason).toBe("llm-timeout");
    expect(err.name).toBe("DesignerFailedError");
  });

  it("supports schema-mismatch reason", () => {
    const err = new DesignerFailedError("tool-use payload mismatch", { reason: "schema-mismatch" });
    expect(err.reason).toBe("schema-mismatch");
  });
});

describe("RefineAxisError", () => {
  it("captures axis + value details", () => {
    const err = new RefineAxisError("unknown axis", { axis: "vibes" });
    expect(err.axis).toBe("vibes");
    expect(err.name).toBe("RefineAxisError");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/errors.test.ts
```

- [ ] **Step 3: Implement errors.ts**

Create `packages/role-designer/src/errors.ts`:

```ts
export type DesignerFailureReason =
  | "llm-timeout"
  | "llm-error"
  | "schema-mismatch"
  | "missing-tool-call"
  | "unknown";

export class DesignerFailedError extends Error {
  readonly cause?: unknown;
  readonly reason: DesignerFailureReason;

  constructor(message: string, opts: { cause?: unknown; reason?: DesignerFailureReason } = {}) {
    super(message);
    this.name = "DesignerFailedError";
    this.cause = opts.cause;
    this.reason = opts.reason ?? "unknown";
  }
}

export class RefineAxisError extends Error {
  readonly axis: string;

  constructor(message: string, opts: { axis: string }) {
    super(message);
    this.name = "RefineAxisError";
    this.axis = opts.axis;
  }
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/errors.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/errors.ts packages/role-designer/test/errors.test.ts
git commit -m "feat(role-designer): typed errors (DesignerFailedError, RefineAxisError)"
```

---

### Task 6: refineAxis pure helper (`refine.ts`)

**Files:**
- Create: `packages/role-designer/src/refine.ts`
- Create: `packages/role-designer/test/refine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-designer/test/refine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { refineAxis } from "../src/refine.js";
import { RefineAxisError } from "../src/errors.js";
import type { DesignDirection } from "../src/types.js";

const baseDirection: DesignDirection = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "x",
  technicalDescription: "y",
  citedReferences: ["Bombay Canteen"],
  tokens: {
    palette: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
    typeScale: { sansFamily: "Inter", serifFamily: "IBM Plex Serif", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
    density: "spacious",
    componentSet: "shadcn",
    imageryStrategy: "photo",
    copyVoice: "premium"
  }
};

describe("refineAxis", () => {
  it("merges a palette choice", () => {
    const updated = refineAxis(baseDirection, {
      axis: "palette",
      value: { primary: "#ffffff", accent: "#000000", surface: "#fafafa", text: "#111111", muted: "#999999" }
    });
    expect(updated.tokens.palette.primary).toBe("#ffffff");
    expect(updated.tokens.density).toBe("spacious");
    expect(updated.tokens.typeScale.sansFamily).toBe("Inter");
  });

  it("merges a typeScale choice", () => {
    const updated = refineAxis(baseDirection, {
      axis: "typeScale",
      value: { sansFamily: "Geist", monoFamily: "Geist Mono", baseSizePx: 18, scale: "major-third" }
    });
    expect(updated.tokens.typeScale.sansFamily).toBe("Geist");
    expect(updated.tokens.typeScale.scale).toBe("major-third");
    expect(updated.tokens.palette.primary).toBe("#0a0a0a");
  });

  it("merges a density choice", () => {
    const updated = refineAxis(baseDirection, { axis: "density", value: "compact" });
    expect(updated.tokens.density).toBe("compact");
  });

  it("merges a componentSet choice", () => {
    const updated = refineAxis(baseDirection, { axis: "componentSet", value: "radix-bare" });
    expect(updated.tokens.componentSet).toBe("radix-bare");
  });

  it("merges an imageryStrategy choice", () => {
    const updated = refineAxis(baseDirection, { axis: "imageryStrategy", value: "abstract-gradients" });
    expect(updated.tokens.imageryStrategy).toBe("abstract-gradients");
  });

  it("merges a copyVoice choice", () => {
    const updated = refineAxis(baseDirection, { axis: "copyVoice", value: "playful" });
    expect(updated.tokens.copyVoice).toBe("playful");
  });

  it("does not mutate the input direction", () => {
    const before = JSON.parse(JSON.stringify(baseDirection));
    refineAxis(baseDirection, { axis: "density", value: "compact" });
    expect(baseDirection).toEqual(before);
  });

  it("preserves id + name + citedReferences across merges", () => {
    const updated = refineAxis(baseDirection, { axis: "density", value: "compact" });
    expect(updated.id).toBe("editorial-dark");
    expect(updated.name).toBe("Editorial Dark");
    expect(updated.citedReferences).toEqual(["Bombay Canteen"]);
  });

  it("rejects an unknown axis with RefineAxisError", () => {
    expect(() =>
      refineAxis(baseDirection, { axis: "vibes", value: "loud" } as never)
    ).toThrow(RefineAxisError);
  });

  it("rejects a value that fails the axis-specific schema", () => {
    expect(() =>
      refineAxis(baseDirection, { axis: "density", value: "loose" } as never)
    ).toThrow(RefineAxisError);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/refine.test.ts
```

- [ ] **Step 3: Implement refine.ts**

Create `packages/role-designer/src/refine.ts`:

```ts
import { AxisChoiceSchema, type AxisChoice, type DesignDirection } from "./types.js";
import { RefineAxisError } from "./errors.js";

/** Pure mechanical merge — no LLM call. The user already chose `value` via
 *  the AxisWizard; this just folds it into the direction's tokens and
 *  returns a new direction. Throws RefineAxisError on schema mismatch
 *  (e.g. axis name unknown, value outside enum). */
export function refineAxis(direction: DesignDirection, choice: AxisChoice): DesignDirection {
  const parsed = AxisChoiceSchema.safeParse(choice);
  if (!parsed.success) {
    throw new RefineAxisError(`invalid axis choice: ${parsed.error.message}`, { axis: (choice as { axis?: string }).axis ?? "<missing>" });
  }
  const validated = parsed.data;
  return {
    ...direction,
    tokens: {
      ...direction.tokens,
      [validated.axis]: validated.value
    }
  };
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/refine.test.ts
```

Expected: PASS — 10 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/refine.ts packages/role-designer/test/refine.test.ts
git commit -m "feat(role-designer): refineAxis — pure mechanical merge for AxisWizard refinement (no LLM call)"
```

---
### Task 7: assembleProposal — Sonnet LLM call producing 1+2 proposal via tool-use

**Files:**
- Create: `packages/role-designer/src/assemble-proposal.ts`
- Create: `packages/role-designer/test/assemble-proposal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-designer/test/assemble-proposal.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { assembleProposal, DESIGNER_PROPOSAL_MODEL } from "../src/assemble-proposal.js";
import { DesignProposalSchema } from "../src/types.js";
import type { InspirationBrief } from "@atlas/role-researcher";
import { DesignerFailedError } from "../src/errors.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_proposal", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const tokens = {
  palette: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
  typeScale: { sansFamily: "Inter", serifFamily: "IBM Plex Serif", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
  density: "spacious",
  componentSet: "shadcn",
  imageryStrategy: "photo",
  copyVoice: "premium"
};

const direction = (id: string, refs: string[] = []) => ({
  id,
  name: id,
  shortDescription: `${id} short`,
  technicalDescription: `${id} technical`,
  citedReferences: refs,
  tokens
});

const validProposalReply = {
  recommended: direction("editorial-dark", ["Bombay Canteen"]),
  alternates: [direction("modern-minimal", ["Linear"]), direction("warm-earthen", ["Bombay Canteen"])],
  reasoning: "Recommended editorial-dark because it cites Bombay Canteen — strongest match for the premium-restaurant signal in audienceCues."
};

const sampleBrief: InspirationBrief = {
  category: "restaurant-landing",
  audienceCues: ["fine-dining"],
  references: [
    {
      name: "Bombay Canteen",
      url: "https://thebombaycanteen.com",
      why: "Editorial serif headlines",
      sourceTier: "local-catalog",
      palettePreview: ["#0a0a0a", "#fbbf24"],
      typographyPreview: { primary: "IBM Plex Serif" }
    }
  ],
  patternsThatWin: ["above-the-fold reservation CTA"],
  patternsThatLose: ["stock photo carousels"]
};

describe("assembleProposal", () => {
  it("returns a Zod-valid DesignProposal on happy path", async () => {
    const llm = fakeLLM(validProposalReply);
    const proposal = await assembleProposal({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
      brief: sampleBrief,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    expect(DesignProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal.recommended.id).toBe("editorial-dark");
    expect(proposal.alternates).toHaveLength(2);
  });

  it("invokes the LLM with tool-use shape using DESIGNER_PROPOSAL_MODEL", async () => {
    const llm = fakeLLM(validProposalReply);
    await assembleProposal({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: [] },
      brief: sampleBrief,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    expect((llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledOnce();
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const opts = args[1] as { model: string; tools: Array<{ name: string }>; toolChoice?: unknown };
    expect(opts.model).toBe(DESIGNER_PROPOSAL_MODEL);
    expect(opts.tools[0].name).toBe("emit_proposal");
  });

  it("includes brief references + patterns in the user-turn message", async () => {
    const llm = fakeLLM(validProposalReply);
    await assembleProposal({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
      brief: sampleBrief,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => m.content?.includes("Bombay Canteen"));
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toContain("above-the-fold reservation CTA");
    expect(userMsg?.content).toContain("stock photo carousels");
  });

  it("works when brief is null (graceful degrade)", async () => {
    const llm = fakeLLM(validProposalReply);
    const proposal = await assembleProposal({
      llm: llm as never,
      designIntent: { category: "battle-mech-configurator", audienceCues: [] },
      brief: null,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    expect(DesignProposalSchema.safeParse(proposal).success).toBe(true);
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => /no inspiration brief|general principles/i.test(m.content ?? ""));
    expect(userMsg).toBeDefined();
  });

  it("throws DesignerFailedError on schema mismatch (only 1 alternate)", async () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b")], // only 1 — schema requires exactly 2
      reasoning: "x"
    };
    const llm = fakeLLM(bad);
    await expect(
      assembleProposal({
        llm: llm as never,
        designIntent: { category: "x", audienceCues: [] },
        brief: null,
        architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
      })
    ).rejects.toThrow(DesignerFailedError);
  });

  it("throws DesignerFailedError on LLM failure", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> };
    await expect(
      assembleProposal({
        llm: llm as never,
        designIntent: { category: "x", audienceCues: [] },
        brief: null,
        architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
      })
    ).rejects.toThrow(DesignerFailedError);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/assemble-proposal.test.ts
```

- [ ] **Step 3: Implement assemble-proposal.ts**

Create `packages/role-designer/src/assemble-proposal.ts`:

```ts
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { InspirationBrief, DesignIntent } from "@atlas/role-researcher";
import { DesignProposalSchema, type DesignProposal } from "./types.js";
import { DesignerFailedError } from "./errors.js";

export const DESIGNER_PROPOSAL_MODEL = "claude-sonnet-4";

const ROLE_PROMPT = `You are the Designer role. Given a designIntent (category + audience cues),
an architect artifact (scope + structure), and an optional InspirationBrief
(curated references + patterns that win/lose for this category), produce
ONE DesignProposal containing exactly one recommended DesignDirection and
exactly two alternate DesignDirections.

Each DesignDirection MUST include:
- A short id (kebab-case, e.g. "editorial-dark", "modern-minimal", "warm-earthen").
- A human-readable name.
- A shortDescription (one sentence, jargon-free — for non-technical readers).
- A technicalDescription (one sentence, terse, names font + density + accent — for builders).
- citedReferences: 1-3 names from the InspirationBrief's references list. If no brief, use [].
- A complete DesignTokens object (palette / typeScale / density / componentSet / imageryStrategy / copyVoice).

Rules:
- The recommended direction MUST cite the brief's strongest reference and explain why in the reasoning field.
- The two alternates MUST be meaningfully different from the recommendation (not just palette swaps).
- Palette colors MUST be valid hex (#RRGGBB).
- typeScale.sansFamily and monoFamily are required; serifFamily is optional.
- baseSizePx between 14 and 18 for body text (16 is the safe default).
- Pick density based on category: marketing/editorial = spacious; dashboards/admin = compact; app surfaces = comfortable.
- Pick componentSet = shadcn unless the brief explicitly suggests otherwise.
- copyVoice MUST match audienceCues (premium <-> fine-dining; friendly <-> family-cafe; authoritative <-> enterprise; playful <-> consumer).

Call the emit_proposal tool exactly once.`;

const TOKENS_SCHEMA = {
  type: "object",
  properties: {
    palette: {
      type: "object",
      properties: {
        primary: { type: "string" },
        accent: { type: "string" },
        surface: { type: "string" },
        text: { type: "string" },
        muted: { type: "string" }
      },
      required: ["primary", "accent", "surface", "text", "muted"]
    },
    typeScale: {
      type: "object",
      properties: {
        sansFamily: { type: "string" },
        serifFamily: { type: "string" },
        monoFamily: { type: "string" },
        baseSizePx: { type: "number" },
        scale: { type: "string", enum: ["minor-third", "major-third", "perfect-fourth"] }
      },
      required: ["sansFamily", "monoFamily", "baseSizePx", "scale"]
    },
    density: { type: "string", enum: ["compact", "comfortable", "spacious"] },
    componentSet: { type: "string", enum: ["shadcn", "radix-bare", "custom"] },
    imageryStrategy: { type: "string", enum: ["photo", "illustration", "abstract-gradients", "none"] },
    copyVoice: { type: "string", enum: ["premium", "friendly", "authoritative", "playful"] }
  },
  required: ["palette", "typeScale", "density", "componentSet", "imageryStrategy", "copyVoice"]
} as const;

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    shortDescription: { type: "string" },
    technicalDescription: { type: "string" },
    citedReferences: { type: "array", items: { type: "string" } },
    tokens: TOKENS_SCHEMA
  },
  required: ["id", "name", "shortDescription", "technicalDescription", "citedReferences", "tokens"]
} as const;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    recommended: DIRECTION_SCHEMA,
    alternates: {
      type: "array",
      items: DIRECTION_SCHEMA,
      minItems: 2,
      maxItems: 2
    },
    reasoning: { type: "string" }
  },
  required: ["recommended", "alternates", "reasoning"]
} as const;

export interface AssembleProposalInput {
  llm: LLMProvider;
  designIntent: DesignIntent;
  brief: InspirationBrief | null;
  architectArtifact: unknown;
}

export async function assembleProposal(input: AssembleProposalInput): Promise<DesignProposal> {
  const userTurn = renderUserTurn(input);

  const messages: LLMMessage[] = [
    { role: "system", content: ROLE_PROMPT },
    { role: "user", content: userTurn }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: DESIGNER_PROPOSAL_MODEL,
      maxTokens: 8192,
      tools: [
        {
          name: "emit_proposal",
          description: "Emit the DesignProposal (1 recommended + 2 alternates + reasoning)",
          input_schema: TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_proposal" }
    });
  } catch (err) {
    throw new DesignerFailedError(`proposal LLM call failed: ${(err as Error).message}`, {
      cause: err,
      reason: "llm-error"
    });
  }

  const parsed = DesignProposalSchema.safeParse(result.input);
  if (!parsed.success) {
    throw new DesignerFailedError(`tool_use payload failed schema: ${parsed.error.message}`, {
      cause: parsed.error,
      reason: "schema-mismatch"
    });
  }
  return parsed.data;
}

function renderUserTurn(input: AssembleProposalInput): string {
  const parts: string[] = [];
  parts.push(`# Design Intent`);
  parts.push(`Category: ${input.designIntent.category}`);
  parts.push(`Audience cues: ${input.designIntent.audienceCues.join(", ") || "(none)"}`);

  parts.push("");
  parts.push("# Architect Artifact");
  parts.push("```json");
  parts.push(JSON.stringify(input.architectArtifact, null, 2));
  parts.push("```");

  if (input.brief) {
    parts.push("");
    parts.push("# Inspiration Brief");
    parts.push("```json");
    parts.push(JSON.stringify(input.brief, null, 2));
    parts.push("```");
  } else {
    parts.push("");
    parts.push("# Inspiration Brief");
    parts.push("(no inspiration brief available — use general principles for the category)");
  }

  parts.push("");
  parts.push("Now produce the DesignProposal via the emit_proposal tool.");
  return parts.join("\n");
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/assemble-proposal.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/assemble-proposal.ts packages/role-designer/test/assemble-proposal.test.ts
git commit -m "feat(role-designer): assembleProposal — Sonnet LLM call with tool-use, Zod-validated 1+2 proposal"
```

---

### Task 8: DesignerRole class (`role.ts`) wiring it together

**Files:**
- Create: `packages/role-designer/src/role.ts`
- Create: `packages/role-designer/test/role.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/role-designer/test/role.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { DesignerRole } from "../src/role.js";

const tokens = {
  palette: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
  typeScale: { sansFamily: "Inter", serifFamily: "IBM Plex Serif", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
  density: "spacious",
  componentSet: "shadcn",
  imageryStrategy: "photo",
  copyVoice: "premium"
};

const direction = (id: string, refs: string[] = []) => ({
  id,
  name: id,
  shortDescription: "x",
  technicalDescription: "y",
  citedReferences: refs,
  tokens
});

const validProposalReply = {
  recommended: direction("editorial-dark", ["Bombay Canteen"]),
  alternates: [direction("modern-minimal"), direction("warm-earthen")],
  reasoning: "x"
};

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_proposal", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

describe("DesignerRole", () => {
  it("has id 'designer'", () => {
    const role = new DesignerRole({ llm: fakeLLM(validProposalReply) as never });
    expect(role.id).toBe("designer");
  });

  it("happy path: brief + designIntent in priorArtifact -> proposal in events", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "build a restaurant landing",
      userTurn: "build a restaurant landing",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
        brief: {
          category: "restaurant-landing",
          audienceCues: ["fine-dining"],
          references: [{ name: "Bombay Canteen", why: "x", sourceTier: "local-catalog" }],
          patternsThatWin: [],
          patternsThatLose: []
        },
        architectArtifact: { scope: "frontend-landing" }
      }
    });
    const completed = out.events.find((e) => e.eventType === "designer.proposal.completed");
    expect(completed).toBeDefined();
    const payload = completed?.payload as { proposal?: { recommended: { id: string } } };
    expect(payload?.proposal?.recommended.id).toBe("editorial-dark");
    expect(out.diff).toEqual({ kind: "none" });
  });

  it("emits designer.proposal.started before completed", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "x", audienceCues: [] }, brief: null, architectArtifact: {} }
    });
    const types = out.events.map((e) => e.eventType);
    expect(types[0]).toBe("designer.proposal.started");
    expect(types).toContain("designer.proposal.completed");
  });

  it("works when brief is missing in priorArtifact (graceful degrade)", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "battle-mech-configurator", audienceCues: [] },
        architectArtifact: { scope: "frontend-landing" }
        // no brief field
      }
    });
    const completed = out.events.find((e) => e.eventType === "designer.proposal.completed");
    expect(completed).toBeDefined();
  });

  it("emits designer.proposal.skipped when designIntent missing", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {} // empty — no designIntent
    });
    expect(out.events.find((e) => e.eventType === "designer.proposal.skipped")).toBeDefined();
    expect(out.events.find((e) => e.eventType === "designer.proposal.completed")).toBeUndefined();
  });

  it("LLM error -> designer.proposal.failed event + throws", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> };
    const role = new DesignerRole({ llm: llm as never });
    await expect(
      role.run({
        ritualId: "r1",
        intent: "x",
        userTurn: "x",
        graphSlice: { bytes: "{}", hash: "h" },
        priorArtifact: {
          designIntent: { category: "x", audienceCues: [] },
          brief: null,
          architectArtifact: {}
        }
      })
    ).rejects.toThrow();
  });

  it("does NOT pass persona to the LLM (proposal is persona-agnostic)", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "restaurant-landing", audienceCues: [] },
        brief: null,
        architectArtifact: {},
        persona: "ama" // present in priorArtifact but should NOT reach the LLM
      }
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    for (const msg of messages) {
      expect(msg.content).not.toMatch(/persona/i);
      expect(msg.content).not.toMatch(/\bama\b/);
    }
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @atlas/role-designer test test/role.test.ts
```

- [ ] **Step 3: Implement role.ts**

Create `packages/role-designer/src/role.ts`:

```ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { InspirationBrief, DesignIntent } from "@atlas/role-researcher";
import { DesignIntentSchema, InspirationBriefSchema } from "@atlas/role-researcher";
import { assembleProposal } from "./assemble-proposal.js";
import { DesignerFailedError } from "./errors.js";

export interface DesignerRoleOptions {
  llm: LLMProvider;
}

export class DesignerRole implements Role {
  readonly id = "designer";
  private readonly llm: LLMProvider;

  constructor(opts: DesignerRoleOptions) {
    this.llm = opts.llm;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];

    const designIntent = extractDesignIntent(inv.priorArtifact);
    if (!designIntent) {
      events.push({
        eventType: "designer.proposal.skipped",
        payload: { reason: "no designIntent in priorArtifact" }
      });
      return { events, diff: { kind: "none" } };
    }

    const brief = extractBrief(inv.priorArtifact);
    const architectArtifact = extractArchitectArtifact(inv.priorArtifact);

    events.push({
      eventType: "designer.proposal.started",
      payload: { ritualId: inv.ritualId, category: designIntent.category, hasBrief: brief !== null }
    });

    try {
      const proposal = await assembleProposal({
        llm: this.llm,
        designIntent,
        brief,
        architectArtifact
      });
      events.push({
        eventType: "designer.proposal.completed",
        payload: { proposal }
      });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      const reason = err instanceof DesignerFailedError ? err.reason : "unknown";
      events.push({
        eventType: "designer.proposal.failed",
        payload: { error: (err as Error).message, reason }
      });
      throw err;
    }
  }
}

function extractDesignIntent(priorArtifact: unknown): DesignIntent | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const di = (priorArtifact as { designIntent?: unknown }).designIntent;
  const parsed = DesignIntentSchema.safeParse(di);
  return parsed.success ? parsed.data : null;
}

function extractBrief(priorArtifact: unknown): InspirationBrief | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const brief = (priorArtifact as { brief?: unknown }).brief;
  if (brief == null) return null;
  const parsed = InspirationBriefSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

function extractArchitectArtifact(priorArtifact: unknown): unknown {
  if (!priorArtifact || typeof priorArtifact !== "object") return {};
  return (priorArtifact as { architectArtifact?: unknown }).architectArtifact ?? {};
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter @atlas/role-designer test test/role.test.ts
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/role-designer/src/role.ts packages/role-designer/test/role.test.ts
git commit -m "feat(role-designer): DesignerRole — reads brief + designIntent from priorArtifact, emits proposal events (persona-agnostic)"
```

---

### Task 9: Public exports (`index.ts`) + typecheck

**Files:**
- Create: `packages/role-designer/src/index.ts`

- [ ] **Step 1: Write index.ts**

Create `packages/role-designer/src/index.ts`:

```ts
export {
  DesignTokensSchema,
  DesignDirectionSchema,
  DesignProposalSchema,
  AxisChoiceSchema,
  type DesignTokens,
  type DesignDirection,
  type DesignProposal,
  type AxisChoice,
  type AxisId
} from "./types.js";

export { DesignerRole, type DesignerRoleOptions } from "./role.js";

export { assembleProposal, DESIGNER_PROPOSAL_MODEL, type AssembleProposalInput } from "./assemble-proposal.js";

export { refineAxis } from "./refine.js";

export { DesignerFailedError, RefineAxisError, type DesignerFailureReason } from "./errors.js";
```

- [ ] **Step 2: Run typecheck across the new package**

```bash
pnpm --filter @atlas/role-designer typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run all role-designer tests together**

```bash
pnpm --filter @atlas/role-designer test
```

Expected: PASS — ~50 cases total (10 DesignTokens + 5 DesignDirection + 4 DesignProposal + 4 AxisChoice + 3 errors + 10 refine + 6 assemble-proposal + 6 role).

- [ ] **Step 4: Commit**

```bash
git add packages/role-designer/src/index.ts
git commit -m "feat(role-designer): public exports — Role + types + assembleProposal + refineAxis + errors"
```

---

### Task 10: Wire DesignerRole into atlas-web's factory.ts behind ATLAS_FF_DESIGNER

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/package.json`
- Create: `apps/atlas-web/test/lib/factory-designer.test.ts`

- [ ] **Step 1: Add the "designer" flag to feature-flags.ts**

Open `apps/atlas-web/lib/feature-flags.ts`. Append `"designer"` to the `FeatureFlag` union, add an entry to `FLAG_TO_ENV`, and add a row to `listFlagStates`:

In the `FeatureFlag` union (replace the existing closing `;`):
```ts
  | "editor-layout-v2"
  | "designer";
```

In `FLAG_TO_ENV` (insert before the closing `}`):
```ts
  // Plan S.3 — Designer role + A2UI primitive (proposal LLM call gated; A2UI components are unconditionally compiled but only mounted when canvas wires them in S.4).
  "designer": "ATLAS_FF_DESIGNER"
```

In `listFlagStates` (insert before the closing `}`):
```ts
    "designer": isFeatureEnabled("designer", source)
```

- [ ] **Step 2: Write the failing factory test**

Create `apps/atlas-web/test/lib/factory-designer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("factory designer integration", () => {
  it("getDesignerRole returns null when ATLAS_FF_DESIGNER is not set", async () => {
    delete process.env.ATLAS_FF_DESIGNER;
    const { getDesignerRole } = await import("@/lib/engine/factory");
    const role = await getDesignerRole();
    expect(role).toBeNull();
  });

  it("getDesignerRole returns a DesignerRole when ATLAS_FF_DESIGNER=true and LLM configured", async () => {
    process.env.ATLAS_FF_DESIGNER = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getDesignerRole } = await import("@/lib/engine/factory");
    const role = await getDesignerRole();
    expect(role).not.toBeNull();
    expect(role!.id).toBe("designer");
  });

  it("getDesignerRole returns null when ATLAS_FF_DESIGNER=true but no LLM configured", async () => {
    process.env.ATLAS_FF_DESIGNER = "true";
    delete process.env.ATLAS_LLM_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    const { getDesignerRole } = await import("@/lib/engine/factory");
    const role = await getDesignerRole();
    expect(role).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
pnpm --filter atlas-web test test/lib/factory-designer.test.ts
```

Expected: FAIL — `getDesignerRole` not yet exported.

- [ ] **Step 4: Add `getDesignerRole` to factory.ts**

Open `apps/atlas-web/lib/engine/factory.ts`. The file already imports `cache` from "react". Add at the top with the other type imports:

```ts
import type { DesignerRole as TDesignerRole } from "@atlas/role-designer";
```

At the end of the file (after the `mapCheckpointToBrokerEvent` helper), append:

```ts
/** Lazy + per-request cached. Returns the DesignerRole if ATLAS_FF_DESIGNER=true
 *  AND the LLM provider env is configured; null otherwise. The role is
 *  constructed but NOT yet dispatched by getRitualEngine — that wiring lands
 *  in Plan S.4 (canvas + engine integration). For now this gives atlas-web
 *  a typed handle so the canvas tests can mount the role in isolation. */
export const getDesignerRole = cache(async (): Promise<TDesignerRole | null> => {
  const { isFeatureEnabled } = await import("@/lib/feature-flags");
  if (!isFeatureEnabled("designer")) return null;

  const { OpenAICompatProvider } = await import("./openai-compat-provider");
  type LlmProvider = import("@atlas/llm-provider").LLMProvider;
  let llm: LlmProvider | undefined;

  if (process.env.ATLAS_LLM_BASE_URL) {
    llm = new OpenAICompatProvider({
      baseUrl: process.env.ATLAS_LLM_BASE_URL,
      apiKey: process.env.ATLAS_LLM_API_KEY ?? "sk-no-auth"
    });
  } else if (process.env.ANTHROPIC_API_KEY) {
    const { Registry } = await import("prom-client");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { AnthropicProvider, createProviderMetrics } = await import("@atlas/llm-provider");
    const promRegistry = new Registry();
    const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(promRegistry) });
  }

  if (!llm) return null;

  const { DesignerRole } = await import("@atlas/role-designer");
  return new DesignerRole({ llm });
});
```

- [ ] **Step 5: Add `@atlas/role-designer` to atlas-web's deps**

Open `apps/atlas-web/package.json`. Add to `dependencies`, alphabetically among the existing `@atlas/*` workspace deps (after `@atlas/role-developer`):

```json
    "@atlas/role-designer": "workspace:*",
```

Run from repo root:

```bash
pnpm install
```

- [ ] **Step 6: Run test — expect green**

```bash
pnpm --filter atlas-web test test/lib/factory-designer.test.ts
```

Expected: PASS — 3 cases.

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts \
        apps/atlas-web/lib/engine/factory.ts \
        apps/atlas-web/test/lib/factory-designer.test.ts \
        apps/atlas-web/package.json
git commit -m "feat(atlas-web): factory.getDesignerRole gated by ATLAS_FF_DESIGNER (inert until S.4 wires it)"
```

---

### Task 11: OptionsCard — generic Pattern C component

**Files:**
- Create: `apps/atlas-web/components/a2ui/OptionsCard.tsx`
- Create: `apps/atlas-web/test/components/a2ui/OptionsCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/a2ui/OptionsCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionsCard } from "@/components/a2ui/OptionsCard";

const recommended = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "Premium feel — serif heads, gold accent.",
  technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
  citedReferences: ["Bombay Canteen", "Eleven Madison Park"],
  cardPayload: {}
};
const alternate1 = { ...recommended, id: "warm-cafe", name: "Warm Café", shortDescription: "Friendly neighborhood feel.", technicalDescription: "Hand-drawn + cream + terracotta", citedReferences: [] };
const alternate2 = { ...recommended, id: "modern-minimal", name: "Modern Minimal", shortDescription: "Tech-forward, less moody.", technicalDescription: "Inter + monochrome + grid-led", citedReferences: [] };

describe("<OptionsCard>", () => {
  it("renders the recommendation prominently with RECOMMENDED badge", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="ama" reasoning="Premium signal in your prompt." />);
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText(/RECOMMENDED/i)).toBeInTheDocument();
  });

  it("renders both alternates", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="diego" reasoning="" />);
    expect(screen.getByText("Warm Café")).toBeInTheDocument();
    expect(screen.getByText("Modern Minimal")).toBeInTheDocument();
  });

  it("uses OutcomeCard renderer when persona=ama (no jargon)", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="ama" reasoning="" />);
    expect(screen.getByText("Premium feel — serif heads, gold accent.")).toBeInTheDocument();
    expect(screen.queryByText(/IBM Plex Serif \+ Inter/)).not.toBeInTheDocument();
  });

  it("uses TechnicalCard renderer when persona=diego (shows technical details)", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="diego" reasoning="" />);
    expect(screen.getByText(/IBM Plex Serif \+ Inter/)).toBeInTheDocument();
  });

  it("invokes onSelect with direction id when 'Use this' clicked", async () => {
    const onSelect = vi.fn();
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={onSelect} onRefine={vi.fn()} persona="diego" reasoning="" />);
    await userEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onSelect).toHaveBeenCalledWith("editorial-dark");
  });

  it("invokes onRefine when 'Refine' clicked", async () => {
    const onRefine = vi.fn();
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={onRefine} persona="diego" reasoning="" />);
    await userEvent.click(screen.getByRole("button", { name: /refine/i }));
    expect(onRefine).toHaveBeenCalledWith("editorial-dark");
  });

  it("displays reasoning under the recommended card when provided", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="diego" reasoning="Premium signal in your prompt." />);
    expect(screen.getByText(/Premium signal in your prompt/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure (component missing)**

```bash
pnpm --filter atlas-web test test/components/a2ui/OptionsCard.test.tsx
```

- [ ] **Step 3: Implement OptionsCard.tsx**

Create `apps/atlas-web/components/a2ui/OptionsCard.tsx`:

```tsx
"use client";
import * as React from "react";
import type { PersonaTier } from "@atlas/ritual-engine";
import { OutcomeCard } from "./OutcomeCard";
import { TechnicalCard } from "./TechnicalCard";

export interface DirectionCard {
  id: string;
  name: string;
  shortDescription: string;
  technicalDescription: string;
  citedReferences: string[];
  cardPayload?: Record<string, unknown>;
}

export interface OptionsCardProps {
  recommended: DirectionCard;
  alternates: DirectionCard[];
  reasoning: string;
  persona: PersonaTier;
  onSelect: (directionId: string) => void;
  onRefine: (directionId: string) => void;
}

export function OptionsCard(props: OptionsCardProps) {
  const Renderer = props.persona === "ama" ? OutcomeCard : TechnicalCard;
  return (
    <div data-testid="options-card" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <Renderer
          card={props.recommended}
          recommended
          reasoning={props.reasoning}
          onSelect={() => props.onSelect(props.recommended.id)}
          onRefine={() => props.onRefine(props.recommended.id)}
        />
      </div>
      {props.alternates.map((alt) => (
        <Renderer
          key={alt.id}
          card={alt}
          recommended={false}
          onSelect={() => props.onSelect(alt.id)}
          onRefine={() => props.onRefine(alt.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect green (after Task 13 lands OutcomeCard + TechnicalCard, this test passes)**

For now (before Task 13), the test will fail with "Cannot find module ./OutcomeCard". That's expected — Task 13 closes the loop. Run again after Task 13.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/a2ui/OptionsCard.tsx apps/atlas-web/test/components/a2ui/OptionsCard.test.tsx
git commit -m "feat(atlas-web): A2UI OptionsCard — Pattern C primitive (recommended + alternates)"
```

---

### Task 12: AxisWizard — generic Pattern B (axis-by-axis) component

**Files:**
- Create: `apps/atlas-web/components/a2ui/AxisWizard.tsx`
- Create: `apps/atlas-web/test/components/a2ui/AxisWizard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/components/a2ui/AxisWizard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxisWizard } from "@/components/a2ui/AxisWizard";

const axes = [
  {
    id: "palette",
    label: "Pick a palette",
    educationalTooltip: "A palette is the small set of colors that ties everything together. Think of it as the mood of your app.",
    options: [
      { id: "editorial", name: "Editorial", swatchSvg: "<svg/>", educationCopy: "Black + gold = serious + premium.", funFact: "Used by Eleven Madison Park." },
      { id: "warm", name: "Warm", swatchSvg: "<svg/>", educationCopy: "Cream + terracotta = friendly café.", funFact: "Common in Mediterranean cafes." },
      { id: "cool", name: "Cool", swatchSvg: "<svg/>", educationCopy: "Slate + blue = tech-forward.", funFact: "Stripe and Linear use cool tones." }
    ]
  },
  {
    id: "typography",
    label: "Pick a typography pairing",
    educationalTooltip: "Typography sets the tone before anyone reads a word.",
    options: [
      { id: "serif-sans", name: "Serif heads + sans body", swatchSvg: "<svg/>", educationCopy: "Editorial feel.", funFact: "" },
      { id: "all-sans", name: "All sans-serif", swatchSvg: "<svg/>", educationCopy: "Clean, modern.", funFact: "" }
    ]
  },
  {
    id: "density",
    label: "Pick a density",
    educationalTooltip: "Density is how packed your screen feels.",
    options: [
      { id: "spacious", name: "Spacious", swatchSvg: "<svg/>", educationCopy: "Lots of breathing room.", funFact: "" },
      { id: "comfortable", name: "Comfortable", swatchSvg: "<svg/>", educationCopy: "Balanced.", funFact: "" }
    ]
  }
];

describe("<AxisWizard>", () => {
  it("renders the first axis label and tooltip", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByText("Pick a palette")).toBeInTheDocument();
    expect(screen.getByText(/A palette is the small set of colors/)).toBeInTheDocument();
  });

  it("displays a step indicator (1 of 3)", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("advances to the next axis after a selection + Next click", async () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Pick a typography pairing")).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
  });

  it("calls onComplete with all selections after the final axis", async () => {
    const onComplete = vi.fn();
    render(<AxisWizard axes={axes} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /All sans-serif/ }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /Spacious/ }));
    await userEvent.click(screen.getByRole("button", { name: /finish/i }));
    expect(onComplete).toHaveBeenCalledWith({
      palette: "editorial",
      typography: "all-sans",
      density: "spacious"
    });
  });

  it("disables Next until an option is selected on the current axis", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("renders fun-fact text when provided on an option", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByText(/Used by Eleven Madison Park/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter atlas-web test test/components/a2ui/AxisWizard.test.tsx
```

- [ ] **Step 3: Implement AxisWizard.tsx**

Create `apps/atlas-web/components/a2ui/AxisWizard.tsx`:

```tsx
"use client";
import * as React from "react";

export interface AxisOption {
  id: string;
  name: string;
  swatchSvg: string;
  educationCopy: string;
  funFact: string;
}

export interface Axis {
  id: string;
  label: string;
  educationalTooltip: string;
  options: AxisOption[];
}

export interface AxisWizardProps {
  axes: Axis[];
  onComplete: (selection: Record<string, string>) => void;
}

export function AxisWizard({ axes, onComplete }: AxisWizardProps) {
  const [stepIdx, setStepIdx] = React.useState(0);
  const [selection, setSelection] = React.useState<Record<string, string>>({});
  const axis = axes[stepIdx];
  const isLast = stepIdx === axes.length - 1;
  const currentChoice = selection[axis.id];

  return (
    <div data-testid="axis-wizard" className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Step {stepIdx + 1} of {axes.length}
      </div>
      <h3 className="mb-2 text-lg font-semibold">{axis.label}</h3>
      <p className="mb-4 text-sm text-slate-600">{axis.educationalTooltip}</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="axis-options">
        {axis.options.map((opt) => {
          const selected = currentChoice === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelection({ ...selection, [axis.id]: opt.id })}
              className={`rounded-md border p-3 text-left transition ${
                selected ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="mb-2" dangerouslySetInnerHTML={{ __html: opt.swatchSvg }} />
              <div className="text-sm font-semibold">{opt.name}</div>
              <div className="mt-1 text-xs text-slate-600">{opt.educationCopy}</div>
              {opt.funFact && <div className="mt-1 text-xs italic text-slate-500">{opt.funFact}</div>}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
          disabled={stepIdx === 0}
          className="rounded-md border border-slate-200 px-4 py-2 text-sm disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!currentChoice}
          onClick={() => {
            if (isLast) onComplete(selection);
            else setStepIdx(stepIdx + 1);
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect green**

```bash
pnpm --filter atlas-web test test/components/a2ui/AxisWizard.test.tsx
```

Expected: PASS — 6 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/a2ui/AxisWizard.tsx apps/atlas-web/test/components/a2ui/AxisWizard.test.tsx
git commit -m "feat(atlas-web): A2UI AxisWizard — Pattern B with educational tooltips"
```

---

### Task 13: OutcomeCard + TechnicalCard — persona-tiered card renderers

**Files:**
- Create: `apps/atlas-web/components/a2ui/OutcomeCard.tsx`
- Create: `apps/atlas-web/components/a2ui/TechnicalCard.tsx`
- Create: `apps/atlas-web/test/components/a2ui/OutcomeCard.test.tsx`
- Create: `apps/atlas-web/test/components/a2ui/TechnicalCard.test.tsx`

- [ ] **Step 1: Write OutcomeCard test**

Create `apps/atlas-web/test/components/a2ui/OutcomeCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutcomeCard } from "@/components/a2ui/OutcomeCard";

const card = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "Premium feel — serif heads, gold accent.",
  technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
  citedReferences: ["Bombay Canteen"]
};

describe("<OutcomeCard>", () => {
  it("renders the name + shortDescription (no technical jargon)", () => {
    render(<OutcomeCard card={card} recommended={false} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText("Premium feel — serif heads, gold accent.")).toBeInTheDocument();
    expect(screen.queryByText(/IBM Plex Serif/)).not.toBeInTheDocument();
  });

  it("shows RECOMMENDED badge when recommended=true", () => {
    render(<OutcomeCard card={card} recommended={true} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText(/RECOMMENDED/i)).toBeInTheDocument();
  });

  it("displays reasoning when provided + recommended=true", () => {
    render(<OutcomeCard card={card} recommended={true} reasoning="Premium signal in your prompt." onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText(/Premium signal in your prompt/)).toBeInTheDocument();
  });

  it("invokes onSelect when the use-this button is clicked", async () => {
    const onSelect = vi.fn();
    render(<OutcomeCard card={card} recommended={false} onSelect={onSelect} onRefine={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onSelect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write TechnicalCard test**

Create `apps/atlas-web/test/components/a2ui/TechnicalCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TechnicalCard } from "@/components/a2ui/TechnicalCard";

const card = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "Premium feel — serif heads, gold accent.",
  technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
  citedReferences: ["Bombay Canteen", "Eleven Madison Park"]
};

describe("<TechnicalCard>", () => {
  it("renders the name + technicalDescription with code-style detail", () => {
    render(<TechnicalCard card={card} recommended={false} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText(/IBM Plex Serif \+ Inter/)).toBeInTheDocument();
  });

  it("shows cited references", () => {
    render(<TechnicalCard card={card} recommended={false} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText(/Bombay Canteen/)).toBeInTheDocument();
    expect(screen.getByText(/Eleven Madison Park/)).toBeInTheDocument();
  });

  it("invokes onSelect on use-this click", async () => {
    const onSelect = vi.fn();
    render(<TechnicalCard card={card} recommended={false} onSelect={onSelect} onRefine={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onSelect).toHaveBeenCalled();
  });

  it("invokes onRefine on refine click", async () => {
    const onRefine = vi.fn();
    render(<TechnicalCard card={card} recommended={false} onSelect={vi.fn()} onRefine={onRefine} />);
    await userEvent.click(screen.getByRole("button", { name: /refine/i }));
    expect(onRefine).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement OutcomeCard.tsx**

Create `apps/atlas-web/components/a2ui/OutcomeCard.tsx`:

```tsx
"use client";
import * as React from "react";
import type { DirectionCard } from "./OptionsCard";

export interface OutcomeCardProps {
  card: DirectionCard;
  recommended: boolean;
  reasoning?: string;
  onSelect: () => void;
  onRefine: () => void;
}

export function OutcomeCard({ card, recommended, reasoning, onSelect, onRefine }: OutcomeCardProps) {
  const ringClass = recommended ? "ring-2 ring-emerald-500 shadow-md" : "";
  return (
    <div data-testid="outcome-card" data-direction-id={card.id} className={`rounded-lg border border-slate-200 bg-white p-5 ${ringClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">{card.name}</h3>
        {recommended && (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            Recommended
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-700">{card.shortDescription}</p>
      {recommended && reasoning && <p className="mb-3 text-xs italic text-slate-500">{reasoning}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onSelect} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
          Use this →
        </button>
        <button type="button" onClick={onRefine} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
          Refine
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement TechnicalCard.tsx**

Create `apps/atlas-web/components/a2ui/TechnicalCard.tsx`:

```tsx
"use client";
import * as React from "react";
import type { DirectionCard } from "./OptionsCard";

export interface TechnicalCardProps {
  card: DirectionCard;
  recommended: boolean;
  reasoning?: string;
  onSelect: () => void;
  onRefine: () => void;
}

export function TechnicalCard({ card, recommended, reasoning, onSelect, onRefine }: TechnicalCardProps) {
  const ringClass = recommended ? "ring-2 ring-emerald-500 shadow-md" : "";
  return (
    <div data-testid="technical-card" data-direction-id={card.id} className={`rounded-lg border border-slate-200 bg-white p-5 ${ringClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">{card.name}</h3>
        {recommended && (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            Recommended
          </span>
        )}
      </div>
      <p className="mb-2 text-sm text-slate-700">{card.shortDescription}</p>
      <p className="mb-3 text-xs font-mono text-slate-500">{card.technicalDescription}</p>
      {card.citedReferences.length > 0 && (
        <p className="mb-3 text-xs text-slate-500">
          Cited from: <em>{card.citedReferences.join(", ")}</em>
        </p>
      )}
      {recommended && reasoning && <p className="mb-3 text-xs italic text-slate-500">{reasoning}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onSelect} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
          Use this →
        </button>
        <button type="button" onClick={onRefine} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
          Refine
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run all A2UI tests — expect green for all four components**

```bash
pnpm --filter atlas-web test test/components/a2ui/
```

Expected: PASS — OptionsCard (7), AxisWizard (6), OutcomeCard (4), TechnicalCard (4) = 21 cases.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/components/a2ui/OutcomeCard.tsx apps/atlas-web/components/a2ui/TechnicalCard.tsx apps/atlas-web/test/components/a2ui/OutcomeCard.test.tsx apps/atlas-web/test/components/a2ui/TechnicalCard.test.tsx
git commit -m "feat(atlas-web): A2UI OutcomeCard + TechnicalCard — persona-tiered leaf renderers"
```

---

### Task 14: A2UI index re-exports + .env.example + local-dev-status

**Files:**
- Create: `apps/atlas-web/components/a2ui/index.ts`
- Modify: `apps/atlas-web/.env.example`
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Create the index re-export**

Create `apps/atlas-web/components/a2ui/index.ts`:

```ts
export { OptionsCard, type DirectionCard, type OptionsCardProps } from "./OptionsCard";
export { AxisWizard, type Axis, type AxisOption, type AxisWizardProps } from "./AxisWizard";
export { OutcomeCard, type OutcomeCardProps } from "./OutcomeCard";
export { TechnicalCard, type TechnicalCardProps } from "./TechnicalCard";
```

- [ ] **Step 2: Add ATLAS_FF_DESIGNER to .env.example**

Open `apps/atlas-web/.env.example`. After the `ATLAS_FF_RESEARCHER` block (added in Plan S.2), append:

```bash
# ─── Plan S.3 — Designer role + A2UI primitive ───────────────────────────────
# Enables the Designer role (architect/researcher artifact → DesignProposal).
# Inert until Plan S.4 wires the proposal into the canvas. Default OFF.
ATLAS_FF_DESIGNER=false
```

- [ ] **Step 3: Add Plan S.3 entry to local-dev-status.md**

Open `docs/superpowers/local-dev-status.md`. After the Plan S.2 entry, add:

```markdown
- **Plan S.3: Designer role + A2UI primitive.** When `ATLAS_FF_DESIGNER=true`, `getDesignerRole()` instantiates `DesignerRole` from `@atlas/role-designer`. Consumes architect's artifact + S.2's optional `InspirationBrief`, emits a Sonnet `DesignProposal { recommended, alternates: [DesignDirection, DesignDirection], reasoning }`. Pure `refineAxis` helper for axis-by-axis refinement (no LLM). atlas-web `components/a2ui/` ships four reusable React components: `OptionsCard` (Pattern C), `AxisWizard` (Pattern B with educational tooltips), `OutcomeCard` (ama-tier), `TechnicalCard` (diego/priya-tier). Not yet rendered anywhere — Plan S.4 wires them into `<DesignerCanvas>`.
```

Add a flag-table row:

```markdown
| **S.3** | `ATLAS_FF_DESIGNER=true` | — | Constructs DesignerRole. Inert until S.4 wires it. A2UI primitives are import-ready. |
```

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/components/a2ui/index.ts apps/atlas-web/.env.example docs/superpowers/local-dev-status.md
git commit -m "docs(atlas-web): A2UI index re-export + .env.example + local-dev-status Plan S.3 entry"
```

---

### Task 15: Run full repo test suite + open PR

**Files:**
- (no file edits — verification + handoff)

- [ ] **Step 1: Workspace-wide test + typecheck**

```bash
pnpm -r --no-bail typecheck && pnpm -r --no-bail test
```

Expected: every package green. `@atlas/role-designer` adds ~25 tests; atlas-web vitest gains ~25 cases.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin plan-s3/designer-a2ui
gh pr create --title "Plan S.3 — Designer role + A2UI primitive" --body "Designer role + A2UI primitives. Wires to nothing yet (Plan S.4 takes care of that)."
```

---

## Completion Checklist

- [ ] Branch `plan-s3/designer-a2ui` cut from `main`
- [ ] `@atlas/role-designer` package scaffolded
- [ ] `types.ts`: DesignTokens + DesignDirection + DesignProposal + AxisChoice schemas
- [ ] `errors.ts`: DesignerFailedError
- [ ] `refine.ts`: refineAxis pure helper for all 6 axis kinds
- [ ] `assemble-proposal.ts`: Sonnet LLM call with tool-use, Zod-validated, brief-citation invariant
- [ ] `role.ts`: DesignerRole class with happy + missing-brief + LLM-failure paths
- [ ] `index.ts`: public exports
- [ ] atlas-web factory: `getDesignerRole()` behind `ATLAS_FF_DESIGNER`
- [ ] A2UI components: OptionsCard + AxisWizard + OutcomeCard + TechnicalCard with vitest tests
- [ ] `components/a2ui/index.ts`: re-exports
- [ ] `.env.example`: ATLAS_FF_DESIGNER block
- [ ] `local-dev-status.md`: Plan S.3 entry + flag-table row
- [ ] `pnpm -r test` green
- [ ] PR opened, reviewed, merged

---

## Handoff to Plan S.4

Once Plan S.3 merges, **Plan S.4 (Polymorphic Canvas + Engine Integration)** wires DesignerRole into the engine pipeline AND mounts the A2UI primitives inside the new `<CanvasShell>`. Specifically S.4:

1. Extends `RitualEngine` to dispatch ResearcherRole (S.2) → DesignerRole (this plan) → pause-awaiting-canvas-selection → DeveloperRole.
2. Wires `<OptionsCard>` and `<AxisWizard>` from this plan inside `apps/atlas-web/components/canvas/renderers/DesignerCanvas.tsx` and `RefineWizard.tsx`.
3. Replaces Plan R's preview-only right panel with the polymorphic CanvasShell.

S.4 plan: `docs/superpowers/plans/2026-05-02-plan-s4-canvas-engine.md`.
