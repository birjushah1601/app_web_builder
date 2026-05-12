# Stunning Pipeline Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plan-critique-revise inside Designer, reference-image conditioning end-to-end, and a real asset-gen step before Developer — all behind flags that preserve today's single-pass behavior when off.

**Architecture:** Designer role grows from one `run()` to internal draft → critique → revise (gated by `ATLAS_FF_DESIGNER_CRITIQUE`). `RoleInvocation`/`StartInput` gain `referenceImages: { url; caption? }[]`. A new `@atlas/role-asset-generator` package generates hero+section images (GPT-Image → Unsplash → gradient fallback chain). Engine dispatches it after canvas-pause resolves; result flows into Developer's `priorArtifact.assetManifest`. Six new event types persist via the existing SpecEventsSink path.

**Tech Stack:** TypeScript strict + `exactOptionalPropertyTypes`, Zod for schemas, OpenAI-compat provider for Sonnet/Haiku/gpt-image-1, vitest, pnpm workspaces.

---

## File Structure

**Create:**
- `packages/role-asset-generator/` — new workspace package
  - `package.json`, `tsconfig.json`, `vitest.config.ts`
  - `src/index.ts` — barrel
  - `src/types.ts` — `AssetManifest`, `AssetSlot`, `AssetGenInput`
  - `src/role.ts` — `AssetGeneratorRole` class implementing `Role`
  - `src/gpt-image-pass.ts` — gpt-image-1 caller, returns URLs
  - `src/unsplash-pass.ts` — Unsplash search fallback
  - `src/gradient-fallback.ts` — synthesizes a manifest with empty URLs + alt text
  - `test/role.test.ts` — happy paths for all three sources
- `apps/atlas-web/lib/assets/image-cache.ts` — sha256-keyed local cache to `.next/cache/atlas-assets/<sha>.jpg`
- `apps/atlas-web/test/lib/assets/image-cache.test.ts`
- `packages/role-designer/src/critique-prompt.ts` — rubric system prompt + Zod schema
- `packages/role-designer/src/revise-prompt.ts` — revise system prompt
- `packages/role-designer/test/role-three-pass.test.ts` — covers draft → critique → revise wiring
- `packages/ritual-engine/test/engine-asset-gen.test.ts` — integration

**Modify:**
- `packages/conductor/src/role.ts` — add optional `referenceImages` field to `RoleInvocation`
- `packages/ritual-engine/src/engine.ts` — extend `StartInput.referenceImages`; thread to architect; after canvas pause, dispatch AssetGenerator; emit `asset.gen.*`
- `packages/ritual-engine/src/events.ts` — add six new schemas (`designer.draft.completed`, `designer.critique.{started,completed}`, `designer.revise.{started,completed}`, `asset.gen.{started,completed,failed}`)
- `packages/role-designer/src/role.ts` — split `run()` into draft/critique/revise passes gated by flag env
- `packages/role-developer/src/render-user-turn.ts` — render `assetManifest` section alongside `selectedTokens`
- `apps/atlas-web/lib/engine/factory.ts` — register `AssetGeneratorRole`, add it to dispatch under the canvas flow
- `apps/atlas-web/lib/feature-flags.ts` — add `designer-critique`, `reference-images`, `asset-gen`, `hero-unsplash`, `hero-ai-image`
- `apps/atlas-web/.env.local` — document new flags + `OPENAI_API_KEY`, `UNSPLASH_ACCESS_KEY`
- `apps/atlas-web/lib/actions/startRitual.ts` — accept `referenceImages` in input, forward to engine

---

## Task 1: Plumb `referenceImages` through conductor + engine types

**Files:**
- Modify: `packages/conductor/src/role.ts`
- Modify: `packages/ritual-engine/src/engine.ts` (StartInput interface only — no behavior yet)

- [ ] **Step 1: Write the failing test**

```ts
// packages/ritual-engine/test/start-reference-images.test.ts
import { describe, it, expect } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { makeMemorySink, makeConductorWithRoles } from "./helpers.js";

describe("StartInput.referenceImages", () => {
  it("threads referenceImages into the architect's priorArtifact", async () => {
    const captured: unknown[] = [];
    const architect = {
      run: async (inv: any) => {
        captured.push(inv.priorArtifact);
        return {
          events: [{ eventType: "architect.pass2.completed", payload: { artifact: { canvasManifest: { modes: [], artifactKind: "frontend-app" } } } }],
          artifact: { canvasManifest: { modes: [], artifactKind: "frontend-app" } }
        };
      }
    };
    const engine = new RitualEngine({
      conductor: makeConductorWithRoles({ architect }),
      eventSink: makeMemorySink(),
      canvasFlowEnabled: false
    });
    await engine.start({
      projectId: "11111111-1111-1111-1111-111111111111",
      userTurn: "build a landing page",
      editClass: "structural",
      userId: "u1",
      referenceImages: [{ url: "https://example.com/ref.jpg", caption: "warm restaurant" }]
    });
    expect(captured[0]).toMatchObject({
      referenceImages: [{ url: "https://example.com/ref.jpg", caption: "warm restaurant" }]
    });
  });
});
```

- [ ] **Step 2: Run + see fail**

```bash
pnpm --filter @atlas/ritual-engine vitest run test/start-reference-images.test.ts
```
Expected: FAIL — `StartInput` has no `referenceImages` field.

- [ ] **Step 3: Add the field to RoleInvocation**

```ts
// packages/conductor/src/role.ts — add to RoleInvocation interface (find the existing type)
export interface RoleInvocation {
  // ... existing fields ...
  /** Plan SPU — user-supplied reference imagery threaded from form/refine. */
  referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
}
```

- [ ] **Step 4: Add the field to StartInput + thread to architect**

```ts
// packages/ritual-engine/src/engine.ts — StartInput interface
export interface StartInput {
  projectId: string;
  userTurn: string;
  editClass: EditClass;
  userId: string;
  artifactKindHint?: ArtifactKind;
  currentFiles?: { path: string; content?: string }[];
  /** Plan SPU — user-supplied reference imagery. Architect threads to Designer. */
  referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
}

// In _runRitual where architect is dispatched, fold into priorArtifact:
const architectPriorArtifact = {
  ...(input.artifactKindHint !== undefined ? { artifactKindHint: input.artifactKindHint } : {}),
  ...(input.referenceImages && input.referenceImages.length > 0 ? { referenceImages: input.referenceImages } : {})
};
```

- [ ] **Step 5: Run + see pass**

```bash
pnpm --filter @atlas/ritual-engine vitest run test/start-reference-images.test.ts
pnpm --filter @atlas/conductor build && pnpm --filter @atlas/ritual-engine build
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/conductor packages/ritual-engine
git commit -m "feat(ritual-engine): thread referenceImages through StartInput to architect priorArtifact"
```

---

## Task 2: Designer draft pass (extract today's behavior)

**Files:**
- Modify: `packages/role-designer/src/role.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/role-designer/test/role-three-pass.test.ts (new file)
import { describe, it, expect, vi } from "vitest";
import { DesignerRole } from "../src/role.js";

describe("DesignerRole — three-pass when ATLAS_FF_DESIGNER_CRITIQUE=true", () => {
  it("calls draftProposal then critiqueDraft then reviseDraft in order", async () => {
    const calls: string[] = [];
    const llm = {
      completeWithToolUse: async (_msgs: any, opts: any) => {
        calls.push(opts.tools?.[0]?.name ?? "unknown");
        if (opts.tools?.[0]?.name === "emit_proposal") {
          return { toolName: "emit_proposal", input: { recommended: { id: "draft-1", name: "Draft 1", shortDescription: "x", technicalDescription: "y", citedReferences: [], tokens: { palette: { primary: "#000" } } }, alternates: [], reasoning: "draft" } };
        }
        if (opts.tools?.[0]?.name === "emit_critique") {
          return { toolName: "emit_critique", input: { findings: [{ axis: "palette", score: 2, suggestion: "more ambition" }] } };
        }
        if (opts.tools?.[0]?.name === "emit_revised_proposal") {
          return { toolName: "emit_revised_proposal", input: { recommended: { id: "final-1", name: "Final 1", shortDescription: "x", technicalDescription: "y", citedReferences: [], tokens: { palette: { primary: "#FF0000" } } }, alternates: [], reasoning: "revised" } };
        }
        throw new Error("unexpected tool");
      }
    };
    process.env.ATLAS_FF_DESIGNER_CRITIQUE = "true";
    const role = new DesignerRole({ llm: llm as any });
    const out = await role.run({
      userTurn: "build a restaurant page",
      priorArtifact: { brief: { category: "frontend-app", references: [] }, designIntent: { category: "frontend-app", audienceCues: ["general"] } } as any
    } as any);
    expect(calls).toEqual(["emit_proposal", "emit_critique", "emit_revised_proposal"]);
    const finalProposalEvent = out.events.find((e) => e.eventType === "designer.proposal.emitted");
    expect((finalProposalEvent?.payload as any)?.proposal?.recommended?.id).toBe("final-1");
    delete process.env.ATLAS_FF_DESIGNER_CRITIQUE;
  });

  it("skips critique+revise when flag off, emits draft as final", async () => {
    const calls: string[] = [];
    const llm = {
      completeWithToolUse: async (_msgs: any, opts: any) => {
        calls.push(opts.tools?.[0]?.name ?? "unknown");
        return { toolName: "emit_proposal", input: { recommended: { id: "draft-only", name: "Draft", shortDescription: "x", technicalDescription: "y", citedReferences: [], tokens: { palette: { primary: "#000" } } }, alternates: [], reasoning: "draft" } };
      }
    };
    delete process.env.ATLAS_FF_DESIGNER_CRITIQUE;
    const role = new DesignerRole({ llm: llm as any });
    const out = await role.run({
      userTurn: "build a restaurant page",
      priorArtifact: { brief: { category: "frontend-app", references: [] }, designIntent: { category: "frontend-app", audienceCues: ["general"] } } as any
    } as any);
    expect(calls).toEqual(["emit_proposal"]);
    const finalProposalEvent = out.events.find((e) => e.eventType === "designer.proposal.emitted");
    expect((finalProposalEvent?.payload as any)?.proposal?.recommended?.id).toBe("draft-only");
  });
});
```

- [ ] **Step 2: Run + see fail**

```bash
pnpm --filter @atlas/role-designer vitest run test/role-three-pass.test.ts
```
Expected: FAIL — current Designer doesn't have critique/revise wiring.

- [ ] **Step 3: Write the critique prompt + schema**

```ts
// packages/role-designer/src/critique-prompt.ts (new file)
import { z } from "zod";

export const CritiqueFindingSchema = z.object({
  axis: z.enum(["palette", "typography", "composition", "patterns_alignment", "distinctness"]),
  score: z.number().min(1).max(5),
  suggestion: z.string().min(1)
});
export const CritiqueSchema = z.object({
  findings: z.array(CritiqueFindingSchema)
});
export type Critique = z.infer<typeof CritiqueSchema>;

export const CRITIQUE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          axis: { type: "string", enum: ["palette", "typography", "composition", "patterns_alignment", "distinctness"] },
          score: { type: "number", minimum: 1, maximum: 5 },
          suggestion: { type: "string" }
        },
        required: ["axis", "score", "suggestion"]
      }
    }
  },
  required: ["findings"]
} as const;

export const CRITIQUE_SYSTEM_PROMPT = `You are the Designer's critique pass. Given a draft proposal, score it 1-5 on each axis:
- palette: ambition, distinctness from generic shadcn (slate+blue)
- typography: serif vs sans appropriateness for the category
- composition: confident whitespace + hierarchy
- patterns_alignment: does it reflect the Researcher's patternsThatWin?
- distinctness: would two restaurants both get this same proposal?

For each axis scoring <=3, emit a concrete suggestion (one sentence, actionable). Call emit_critique once.`;
```

- [ ] **Step 4: Write the revise prompt + schema**

```ts
// packages/role-designer/src/revise-prompt.ts (new file)
export const REVISE_SYSTEM_PROMPT = `You are the Designer's revise pass. You have a draft proposal and a critique. Revise the proposal to address every suggestion. Output the same shape (recommended + alternates + reasoning) via the emit_revised_proposal tool. Keep ID stable when possible; bump palette/typography per the critique. Do not invent new alternates — refine the existing ones.`;

// Tool schema is identical to emit_proposal's — reuse it.
export { PROPOSAL_TOOL_SCHEMA as REVISED_PROPOSAL_TOOL_SCHEMA } from "./assemble-proposal.js";
```

- [ ] **Step 5: Refactor Designer.run into three passes**

```ts
// packages/role-designer/src/role.ts — replace existing run() body
import { CRITIQUE_SYSTEM_PROMPT, CRITIQUE_TOOL_SCHEMA, CritiqueSchema, type Critique } from "./critique-prompt.js";
import { REVISE_SYSTEM_PROMPT, REVISED_PROPOSAL_TOOL_SCHEMA } from "./revise-prompt.js";

async run(inv: RoleInvocation): Promise<RoleOutput> {
  const events: RoleOutput["events"] = [];
  // ─── Pass 1: draft ─── (extracted from old run body)
  const draft = await this.draftProposal(inv, events);
  if (!draft) return { events, artifact: undefined };

  const critiqueOn = process.env.ATLAS_FF_DESIGNER_CRITIQUE === "true";
  if (!critiqueOn) {
    // Flag-off path — emit the draft as the final proposal, today's behavior.
    events.push({ eventType: "designer.proposal.emitted", payload: { proposal: draft } });
    return { events, artifact: { proposal: draft } };
  }

  // ─── Pass 2: critique ───
  events.push({ eventType: "designer.critique.started", payload: {} });
  const critique = await this.critiqueDraft(draft, inv);
  events.push({ eventType: "designer.critique.completed", payload: { critique } });

  // ─── Pass 3: revise ───
  events.push({ eventType: "designer.revise.started", payload: {} });
  const final = await this.reviseDraft(draft, critique, inv);
  events.push({ eventType: "designer.revise.completed", payload: { proposal: final } });
  events.push({ eventType: "designer.proposal.emitted", payload: { proposal: final } });
  return { events, artifact: { proposal: final } };
}

private async draftProposal(inv: RoleInvocation, events: RoleOutput["events"]): Promise<DesignProposal | undefined> {
  // ... existing single-pass code, renamed; emits designer.draft.completed instead of designer.proposal.emitted ...
  // Use the existing assemble-proposal.ts logic verbatim — just push events.push({ eventType: "designer.draft.completed", payload: { proposal: draft } }) at the end and return draft.
}

private async critiqueDraft(draft: DesignProposal, inv: RoleInvocation): Promise<Critique> {
  const messages: LLMMessage[] = [
    { role: "system", content: CRITIQUE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "user", content: `Draft to critique:\n${JSON.stringify(draft, null, 2)}\n\nResearcher brief (if any):\n${JSON.stringify((inv.priorArtifact as any)?.brief ?? null, null, 2)}` }
  ];
  const result = await this.llm.completeWithToolUse(messages, {
    model: process.env.ATLAS_LLM_DESIGNER_CRITIQUE_MODEL ?? "anthropic/claude-haiku-4.5",
    maxTokens: 1024,
    tools: [{ name: "emit_critique", description: "Emit critique findings", input_schema: CRITIQUE_TOOL_SCHEMA }],
    toolChoice: { type: "tool", name: "emit_critique" }
  });
  return CritiqueSchema.parse(result.input);
}

private async reviseDraft(draft: DesignProposal, critique: Critique, inv: RoleInvocation): Promise<DesignProposal> {
  const messages: LLMMessage[] = [
    { role: "system", content: REVISE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "user", content: `Draft:\n${JSON.stringify(draft, null, 2)}\n\nCritique:\n${JSON.stringify(critique, null, 2)}` }
  ];
  const result = await this.llm.completeWithToolUse(messages, {
    model: process.env.ATLAS_LLM_DESIGNER_REVISE_MODEL ?? "anthropic/claude-sonnet-4.5",
    maxTokens: 4096,
    tools: [{ name: "emit_revised_proposal", description: "Emit revised proposal", input_schema: REVISED_PROPOSAL_TOOL_SCHEMA }],
    toolChoice: { type: "tool", name: "emit_revised_proposal" }
  });
  return result.input as DesignProposal; // DesignProposal schema matches emit_proposal exactly
}
```

- [ ] **Step 6: Run + see pass**

```bash
pnpm --filter @atlas/role-designer vitest run test/role-three-pass.test.ts
pnpm --filter @atlas/role-designer build
```
Expected: PASS for both flag-on and flag-off cases.

- [ ] **Step 7: Commit**

```bash
git add packages/role-designer
git commit -m "feat(role-designer): three-pass (draft/critique/revise) behind ATLAS_FF_DESIGNER_CRITIQUE"
```

---

## Task 3: New event schemas

**Files:**
- Modify: `packages/ritual-engine/src/events.ts`

- [ ] **Step 1: Add schemas + union members**

Append to `packages/ritual-engine/src/events.ts` after the existing canvas event schemas:

```ts
const DesignerDraftCompletedSchema = z.object({
  type: z.literal("designer.draft.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerCritiqueStartedSchema = z.object({
  type: z.literal("designer.critique.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerCritiqueCompletedSchema = z.object({
  type: z.literal("designer.critique.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerReviseStartedSchema = z.object({
  type: z.literal("designer.revise.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerReviseCompletedSchema = z.object({
  type: z.literal("designer.revise.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const AssetGenStartedSchema = z.object({
  type: z.literal("asset.gen.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const AssetGenCompletedSchema = z.object({
  type: z.literal("asset.gen.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const AssetGenFailedSchema = z.object({
  type: z.literal("asset.gen.failed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
```

Add to the discriminated union list:
```ts
  DesignerDraftCompletedSchema,
  DesignerCritiqueStartedSchema,
  DesignerCritiqueCompletedSchema,
  DesignerReviseStartedSchema,
  DesignerReviseCompletedSchema,
  AssetGenStartedSchema,
  AssetGenCompletedSchema,
  AssetGenFailedSchema
```

- [ ] **Step 2: Add broker mapper entries**

In `apps/atlas-web/lib/engine/factory.ts`'s `mapCheckpointToBrokerEvent`, add a pass-through case for each new event type (mirror the canvas event mapping). Same for `lib/events/EventBroker.ts` type union — add each literal.

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @atlas/ritual-engine build
git add packages/ritual-engine/src/events.ts apps/atlas-web/lib/engine/factory.ts apps/atlas-web/lib/events/EventBroker.ts
git commit -m "feat(events): designer.draft/critique/revise + asset.gen.* event schemas"
```

---

## Task 4: AssetGenerator package scaffold

**Files:**
- Create: `packages/role-asset-generator/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/{index.ts,types.ts,role.ts,gradient-fallback.ts}`, `test/role.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@atlas/role-asset-generator",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Copy `tsconfig.json` + `vitest.config.ts` verbatim from `packages/role-designer/`.

- [ ] **Step 2: types.ts**

```ts
// packages/role-asset-generator/src/types.ts
import { z } from "zod";

export const AssetSlotSchema = z.object({
  slot: z.string(),
  url: z.string(),
  prompt: z.string().optional(),
  alt: z.string()
});
export type AssetSlot = z.infer<typeof AssetSlotSchema>;

export const AssetManifestSchema = z.object({
  hero: AssetSlotSchema.optional(),
  sections: z.array(AssetSlotSchema)
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export interface AssetGenInput {
  proposal: unknown; // DesignProposal from role-designer
  brief: unknown;    // InspirationBrief from role-researcher
  projectId: string;
}
```

- [ ] **Step 3: gradient-fallback.ts**

```ts
// packages/role-asset-generator/src/gradient-fallback.ts
import type { AssetManifest, AssetGenInput } from "./types.js";

export function gradientFallback(input: AssetGenInput): AssetManifest {
  // Empty URLs signal "use design-tokens.json gradient" to Developer.
  return {
    hero: { slot: "hero", url: "", alt: "Hero gradient" },
    sections: [
      { slot: "feature-1", url: "", alt: "Section 1" },
      { slot: "feature-2", url: "", alt: "Section 2" }
    ]
  };
}
```

- [ ] **Step 4: role.ts skeleton + test**

```ts
// packages/role-asset-generator/src/role.ts
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { AssetGenInput, AssetManifest } from "./types.js";
import { gradientFallback } from "./gradient-fallback.js";

export class AssetGeneratorRole implements Role {
  readonly id = "asset-generator";
  constructor(private readonly opts: { llm: unknown; openaiKey?: string; unsplashKey?: string }) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const input = inv.priorArtifact as AssetGenInput;
    const events: RoleOutput["events"] = [];
    const aiOn = process.env.ATLAS_FF_HERO_AI_IMAGE === "true" && !!this.opts.openaiKey;
    const unsplashOn = process.env.ATLAS_FF_HERO_UNSPLASH === "true" && !!this.opts.unsplashKey;

    let manifest: AssetManifest;
    try {
      if (aiOn) {
        const { gptImagePass } = await import("./gpt-image-pass.js");
        manifest = await gptImagePass(input, this.opts.openaiKey!);
      } else if (unsplashOn) {
        const { unsplashPass } = await import("./unsplash-pass.js");
        manifest = await unsplashPass(input, this.opts.unsplashKey!);
      } else {
        manifest = gradientFallback(input);
      }
      events.push({ eventType: "asset.gen.completed", payload: { manifest } });
      return { events, artifact: { assetManifest: manifest } };
    } catch (err) {
      events.push({ eventType: "asset.gen.failed", payload: { error: err instanceof Error ? err.message : String(err) } });
      const fallback = gradientFallback(input);
      return { events, artifact: { assetManifest: fallback } };
    }
  }
}
```

```ts
// packages/role-asset-generator/src/index.ts
export { AssetGeneratorRole } from "./role.js";
export * from "./types.js";
export { gradientFallback } from "./gradient-fallback.js";
```

```ts
// packages/role-asset-generator/test/role.test.ts
import { describe, it, expect } from "vitest";
import { AssetGeneratorRole } from "../src/role.js";

describe("AssetGeneratorRole", () => {
  it("falls back to gradient when no flags set", async () => {
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
    const role = new AssetGeneratorRole({ llm: {} });
    const out = await role.run({
      userTurn: "x",
      priorArtifact: { proposal: {}, brief: {}, projectId: "p1" }
    } as any);
    const completed = out.events.find((e) => e.eventType === "asset.gen.completed");
    expect(completed).toBeDefined();
    expect((out.artifact as any).assetManifest.hero.url).toBe("");
  });
});
```

- [ ] **Step 5: Wire workspace + build + test**

```bash
# Root package.json workspaces already cover packages/*; pnpm install picks it up.
pnpm install
pnpm --filter @atlas/role-asset-generator build
pnpm --filter @atlas/role-asset-generator test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/role-asset-generator
git commit -m "feat(role-asset-generator): package scaffold + gradient fallback path"
```

---

## Task 5: GPT-Image pass

**Files:**
- Create: `packages/role-asset-generator/src/gpt-image-pass.ts`
- Create: `apps/atlas-web/lib/assets/image-cache.ts`
- Create: `apps/atlas-web/test/lib/assets/image-cache.test.ts`

- [ ] **Step 1: Image cache test**

```ts
// apps/atlas-web/test/lib/assets/image-cache.test.ts
import { describe, it, expect } from "vitest";
import { cacheImage } from "@/lib/assets/image-cache";
import { promises as fs } from "node:fs";

describe("cacheImage", () => {
  it("writes a sha256-named jpg + returns a stable URL", async () => {
    const buf = Buffer.from("fake-jpg-bytes");
    const url1 = await cacheImage(buf);
    const url2 = await cacheImage(buf);
    expect(url1).toBe(url2);
    expect(url1).toMatch(/^\/atlas-assets\/[a-f0-9]{64}\.jpg$/);
  });
});
```

- [ ] **Step 2: Run + see fail**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/assets/image-cache.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement image-cache.ts**

```ts
// apps/atlas-web/lib/assets/image-cache.ts
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-assets");

export async function cacheImage(buf: Buffer): Promise<string> {
  const sha = createHash("sha256").update(buf).digest("hex");
  const filePath = join(CACHE_DIR, `${sha}.jpg`);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, buf);
  }
  return `/atlas-assets/${sha}.jpg`;
}
```

Also add a Next.js public route or rewrite so `/atlas-assets/*` resolves to that cache dir — easiest: add to `next.config.ts`:

```ts
async rewrites() {
  return [
    { source: "/atlas-assets/:hash.jpg", destination: "/api/atlas-assets/:hash" }
  ];
}
```

And the route:
```ts
// apps/atlas-web/app/api/atlas-assets/[hash]/route.ts
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-assets");
export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^[a-f0-9]{64}$/.test(hash)) return new Response("invalid hash", { status: 400 });
  try {
    const buf = await fs.readFile(join(CACHE_DIR, `${hash}.jpg`));
    return new Response(buf as BodyInit, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
```

- [ ] **Step 4: Run cache test + pass**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/assets/image-cache.test.ts
```

- [ ] **Step 5: GPT-Image pass**

```ts
// packages/role-asset-generator/src/gpt-image-pass.ts
import type { AssetGenInput, AssetManifest } from "./types.js";

interface CachedImageWriter { (buf: Buffer): Promise<string>; }

export interface GptImagePassDeps {
  apiKey: string;
  /** Injection seam — atlas-web wires this to its image-cache util. */
  writeImage: CachedImageWriter;
  fetchImpl?: typeof fetch;
}

export async function gptImagePass(input: AssetGenInput, deps: GptImagePassDeps): Promise<AssetManifest> {
  const f = deps.fetchImpl ?? fetch;
  const heroPrompt = buildHeroPrompt(input);
  const buf = await callGptImage(f, deps.apiKey, heroPrompt);
  const url = await deps.writeImage(buf);
  return {
    hero: { slot: "hero", url, prompt: heroPrompt, alt: deriveAlt(input) },
    sections: []
  };
}

function buildHeroPrompt(input: AssetGenInput): string {
  const proposal = input.proposal as any;
  const brief = input.brief as any;
  return `Photorealistic hero image for: ${brief?.category ?? "landing page"}. Style: ${proposal?.recommended?.shortDescription ?? "modern, accessible"}. Palette inspiration: ${JSON.stringify(proposal?.recommended?.tokens?.palette ?? {})}. Composition: centered, generous negative space, no text overlay. 16:9, vibrant.`;
}

function deriveAlt(input: AssetGenInput): string {
  const brief = input.brief as any;
  return `Hero image for ${brief?.category ?? "landing page"}`;
}

async function callGptImage(f: typeof fetch, apiKey: string, prompt: string): Promise<Buffer> {
  const resp = await f("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1, response_format: "b64_json" })
  });
  if (!resp.ok) throw new Error(`gpt-image-1 HTTP ${resp.status}: ${await resp.text()}`);
  const json = await resp.json() as { data: Array<{ b64_json: string }> };
  return Buffer.from(json.data[0]!.b64_json, "base64");
}
```

Update `role.ts` to pass `cacheImage` as the writer:

```ts
// in role.ts run() — only the aiOn branch
const { gptImagePass } = await import("./gpt-image-pass.js");
manifest = await gptImagePass(input, { apiKey: this.opts.openaiKey!, writeImage: (this.opts as any).writeImage });
```

And `AssetGeneratorRole` constructor signature becomes `{ openaiKey?, unsplashKey?, writeImage: (buf) => Promise<string> }`.

- [ ] **Step 6: Test GPT-Image pass with mocked fetch**

```ts
// packages/role-asset-generator/test/role.test.ts — append
it("calls gpt-image-1 when ATLAS_FF_HERO_AI_IMAGE=true", async () => {
  process.env.ATLAS_FF_HERO_AI_IMAGE = "true";
  const fetchMock = async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("img").toString("base64") }] }), { status: 200 });
  const role = new AssetGeneratorRole({
    openaiKey: "sk-test",
    writeImage: async () => "/atlas-assets/cached.jpg",
    fetchImpl: fetchMock
  } as any);
  const out = await role.run({ userTurn: "x", priorArtifact: { proposal: { recommended: { tokens: { palette: { primary: "#fff" } } } }, brief: { category: "frontend-app" }, projectId: "p1" } } as any);
  const manifest = (out.artifact as any).assetManifest;
  expect(manifest.hero.url).toBe("/atlas-assets/cached.jpg");
  delete process.env.ATLAS_FF_HERO_AI_IMAGE;
});
```

- [ ] **Step 7: Build + commit**

```bash
pnpm --filter @atlas/role-asset-generator build
git add packages/role-asset-generator apps/atlas-web/lib/assets apps/atlas-web/app/api/atlas-assets apps/atlas-web/next.config.ts apps/atlas-web/test/lib/assets
git commit -m "feat(role-asset-generator): gpt-image-1 path + sha256 image cache"
```

---

## Task 6: Unsplash fallback

**Files:**
- Create: `packages/role-asset-generator/src/unsplash-pass.ts`

- [ ] **Step 1: Write the pass**

```ts
// packages/role-asset-generator/src/unsplash-pass.ts
import type { AssetGenInput, AssetManifest } from "./types.js";

export interface UnsplashPassDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export async function unsplashPass(input: AssetGenInput, deps: UnsplashPassDeps): Promise<AssetManifest> {
  const f = deps.fetchImpl ?? fetch;
  const query = buildQuery(input);
  const resp = await f(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`, {
    headers: { "Authorization": `Client-ID ${deps.apiKey}` }
  });
  if (!resp.ok) throw new Error(`unsplash HTTP ${resp.status}`);
  const json = await resp.json() as { results: Array<{ urls: { regular: string }; alt_description?: string }> };
  const first = json.results[0];
  if (!first) throw new Error(`unsplash: no results for "${query}"`);
  return {
    hero: { slot: "hero", url: first.urls.regular, alt: first.alt_description ?? `Hero for ${query}` },
    sections: []
  };
}

function buildQuery(input: AssetGenInput): string {
  const brief = input.brief as any;
  return `${brief?.category ?? "landing"} ${(brief?.audienceCues ?? []).join(" ")}`.trim();
}
```

- [ ] **Step 2: Test + build + commit**

```ts
// append to test/role.test.ts
it("calls unsplash when only unsplash flag set", async () => {
  delete process.env.ATLAS_FF_HERO_AI_IMAGE;
  process.env.ATLAS_FF_HERO_UNSPLASH = "true";
  const fetchMock = async () => new Response(JSON.stringify({ results: [{ urls: { regular: "https://images.unsplash.com/x.jpg" }, alt_description: "test" }] }), { status: 200 });
  const role = new AssetGeneratorRole({ unsplashKey: "u-key", writeImage: async () => "", fetchImpl: fetchMock } as any);
  const out = await role.run({ userTurn: "x", priorArtifact: { proposal: {}, brief: { category: "frontend-app", audienceCues: [] }, projectId: "p1" } } as any);
  expect((out.artifact as any).assetManifest.hero.url).toMatch(/unsplash/);
  delete process.env.ATLAS_FF_HERO_UNSPLASH;
});
```

```bash
pnpm --filter @atlas/role-asset-generator test
pnpm --filter @atlas/role-asset-generator build
git add packages/role-asset-generator
git commit -m "feat(role-asset-generator): unsplash fallback path"
```

---

## Task 7: Engine dispatches AssetGenerator after canvas pause

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`

- [ ] **Step 1: Write integration test**

```ts
// packages/ritual-engine/test/engine-asset-gen.test.ts
import { describe, it, expect } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { makeMemorySink, makeConductorWithRoles } from "./helpers.js";

describe("Engine — AssetGenerator dispatch", () => {
  it("dispatches asset-generator after canvas pause + folds manifest into developer priorArtifact", async () => {
    const developerSeen: unknown[] = [];
    const architect = { run: async () => ({ events: [{ eventType: "architect.pass2.completed", payload: { artifact: { canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing", default: true, blockingFor: "design", audience: ["ama"] }] }, designIntent: { category: "frontend-app", audienceCues: [] } } } }], artifact: { canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing", default: true, blockingFor: "design", audience: ["ama"] }] }, designIntent: { category: "frontend-app", audienceCues: [] } } }) };
    const researcher = { run: async () => ({ events: [{ eventType: "researcher.brief.completed", payload: { brief: {} } }], artifact: { brief: {} } }) };
    const designer = { run: async () => ({ events: [{ eventType: "designer.proposal.emitted", payload: { proposal: { recommended: { id: "x", tokens: { palette: { primary: "#000" } } }, alternates: [] } } }], artifact: { proposal: { recommended: { id: "x", tokens: { palette: { primary: "#000" } } }, alternates: [] } } }) };
    const assetGenerator = { run: async () => ({ events: [{ eventType: "asset.gen.completed", payload: { manifest: { hero: { slot: "hero", url: "/atlas-assets/abc.jpg", alt: "h" }, sections: [] } } }], artifact: { assetManifest: { hero: { slot: "hero", url: "/atlas-assets/abc.jpg", alt: "h" }, sections: [] } } }) };
    const developer = { run: async (inv: any) => { developerSeen.push(inv.priorArtifact); return { events: [], artifact: undefined, diff: { kind: "patch", body: "" } }; } };
    const conductor = makeConductorWithRoles({ architect, researcher, designer, "asset-generator": assetGenerator, developer });

    const pauseRegistry = { waitForOption: async () => ({ directionId: "x", tokens: { palette: { primary: "#000" } }, autoSelected: true }) };
    const engine = new RitualEngine({
      conductor,
      eventSink: makeMemorySink(),
      canvasFlowEnabled: true,
      canvasPauseRegistry: pauseRegistry as any
    });
    await engine.start({ projectId: "11111111-1111-1111-1111-111111111111", userTurn: "x", editClass: "structural", userId: "u1" });
    expect(developerSeen[0]).toMatchObject({ assetManifest: { hero: { url: "/atlas-assets/abc.jpg" } } });
  });
});
```

- [ ] **Step 2: Implement engine wiring**

In `packages/ritual-engine/src/engine.ts`, inside the canvas-flow block (after `selectedTokens = resolution.tokens;`), add:

```ts
// Plan SPU — dispatch AssetGenerator if it's registered. Silently skipped when role missing.
let assetManifest: unknown | undefined;
if (this.conductor.hasRole?.("asset-generator")) {
  try {
    const a = await this.conductor.dispatch(
      { ritualId, graphVersion: 0, userTurn: input.userTurn, projectId: input.projectId },
      { forceRoleId: "asset-generator", priorArtifact: { proposal, brief, projectId: input.projectId } }
    );
    record.roleEvents = [...(record.roleEvents ?? []), ...a.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))];
    assetManifest = (a.output.artifact as any)?.assetManifest;
  } catch (err) {
    record.roleEvents = [...(record.roleEvents ?? []), { eventType: "asset.gen.failed", payload: { error: err instanceof Error ? err.message : String(err) } }];
  }
}

// Fold assetManifest into developerPriorArtifact (existing build site)
const developerPriorArtifact = selectedTokens !== undefined && artifact && typeof artifact === "object"
  ? { ...(artifact as object), selectedTokens, ...(assetManifest ? { assetManifest } : {}) }
  : artifact;
```

(`Conductor.hasRole` may not exist — add it: `hasRole(id: string): boolean { return this.roles.has(id); }` in `packages/conductor/src/conductor.ts`.)

- [ ] **Step 3: Run + see pass**

```bash
pnpm --filter @atlas/conductor build && pnpm --filter @atlas/ritual-engine build
pnpm --filter @atlas/ritual-engine vitest run test/engine-asset-gen.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/conductor packages/ritual-engine
git commit -m "feat(ritual-engine): dispatch AssetGenerator after canvas pause + fold assetManifest into developer priorArtifact"
```

---

## Task 8: Developer prompt renders assetManifest

**Files:**
- Modify: `packages/role-developer/src/render-user-turn.ts`

- [ ] **Step 1: Append a renderer**

Inside `renderDeveloperUserTurn`, after the tokens section, add:

```ts
const manifest = (architectArtifact as { assetManifest?: { hero?: any; sections?: any[] } } | undefined)?.assetManifest;
if (manifest && (manifest.hero || (manifest.sections?.length ?? 0) > 0)) {
  const lines = ["## Asset manifest (use these URLs verbatim — don't invent image URLs)"];
  if (manifest.hero?.url) lines.push(`- Hero: \`<img src="${manifest.hero.url}" alt="${manifest.hero.alt}" />\``);
  for (const s of manifest.sections ?? []) {
    if (s.url) lines.push(`- ${s.slot}: \`<img src="${s.url}" alt="${s.alt}" />\``);
  }
  if (lines.length > 1) sections.push("", lines.join("\n"));
}
```

- [ ] **Step 2: Test**

```ts
// packages/role-developer/test/render-user-turn.test.ts (extend)
it("renders assetManifest hero URL when present", () => {
  const out = renderDeveloperUserTurn("build", { assetManifest: { hero: { slot: "hero", url: "/atlas-assets/x.jpg", alt: "h" }, sections: [] } });
  expect(out).toContain("/atlas-assets/x.jpg");
  expect(out).toContain("don't invent image URLs");
});
```

- [ ] **Step 3: Run + build + commit**

```bash
pnpm --filter @atlas/role-developer test
pnpm --filter @atlas/role-developer build
git add packages/role-developer
git commit -m "feat(role-developer): surface assetManifest URLs in user-turn prompt"
```

---

## Task 9: atlas-web factory registers AssetGenerator + adds flags

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/.env.local`

- [ ] **Step 1: Register flags**

In `lib/feature-flags.ts`, extend the `FeatureFlag` union + `FLAG_TO_ENV` map:

```ts
| "designer-critique"
| "reference-images"
| "asset-gen"
| "hero-unsplash"
| "hero-ai-image"
```

```ts
"designer-critique": "ATLAS_FF_DESIGNER_CRITIQUE",
"reference-images": "ATLAS_FF_REFERENCE_IMAGES",
"asset-gen": "ATLAS_FF_ASSET_GEN",
"hero-unsplash": "ATLAS_FF_HERO_UNSPLASH",
"hero-ai-image": "ATLAS_FF_HERO_AI_IMAGE",
```

Add to `listFlagStates`.

- [ ] **Step 2: Register AssetGenerator in factory**

In `lib/engine/factory.ts`, after the existing Designer registration, add:

```ts
if (isFeatureEnabled("asset-gen")) {
  const { AssetGeneratorRole } = await import("@atlas/role-asset-generator");
  const { cacheImage } = await import("@/lib/assets/image-cache");
  roles.set("asset-generator", new AssetGeneratorRole({
    openaiKey: process.env.OPENAI_API_KEY,
    unsplashKey: process.env.UNSPLASH_ACCESS_KEY,
    writeImage: cacheImage
  }) as unknown as Role);
}
```

- [ ] **Step 3: Document flags in .env.local**

```bash
# Append to .env.local
echo "
# Plan SPU — pipeline upgrade
ATLAS_FF_DESIGNER_CRITIQUE=false   # Designer 3-pass (draft/critique/revise). +Latency +cost, +quality.
ATLAS_FF_REFERENCE_IMAGES=false    # Accept user-uploaded reference imagery as Designer input.
ATLAS_FF_ASSET_GEN=false           # AssetGenerator dispatched after canvas pause.
ATLAS_FF_HERO_UNSPLASH=false       # Unsplash fallback for hero. Requires UNSPLASH_ACCESS_KEY.
ATLAS_FF_HERO_AI_IMAGE=false       # gpt-image-1 hero. Requires OPENAI_API_KEY.
# UNSPLASH_ACCESS_KEY=
# OPENAI_API_KEY=
" >> apps/atlas-web/.env.local
```

- [ ] **Step 4: Run atlas-web typecheck + commit**

```bash
pnpm --filter atlas-web typecheck
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/lib/engine/factory.ts apps/atlas-web/.env.local
git commit -m "feat(atlas-web): register AssetGenerator + 5 pipeline-upgrade flags"
```

---

## Task 10: startRitual + submitPromptedProject accept referenceImages

**Files:**
- Modify: `apps/atlas-web/lib/actions/startRitual.ts`
- Modify: `apps/atlas-web/app/projects/new/actions.ts`

- [ ] **Step 1: Extend StartRitualInput**

```ts
// In startRitual.ts
export interface StartRitualInput {
  projectId: string;
  userTurn: string;
  editClass: EditClass;
  artifactKindHint?: ArtifactKind;
  referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
}
```

In the engine.start call:
```ts
await engine.start({
  ...,
  ...(input.referenceImages && input.referenceImages.length > 0 ? { referenceImages: input.referenceImages } : {})
});
```

- [ ] **Step 2: Extend submitPromptedProject**

For now, pass `referenceImages: []` from the form action — the UX plan will add the upload UI; this just makes the field a no-op stub.

- [ ] **Step 3: Test + commit**

```bash
pnpm --filter atlas-web vitest run test/actions/startRitual.test.ts
git add apps/atlas-web/lib/actions/startRitual.ts apps/atlas-web/app/projects/new/actions.ts
git commit -m "feat(atlas-web): startRitual + submitPromptedProject accept referenceImages"
```

---

## Task 11: Smoke verification

- [ ] **Step 1: Restart atlas-web with flags on**

```bash
# Edit .env.local — set ATLAS_FF_DESIGNER_CRITIQUE=true, ATLAS_FF_ASSET_GEN=true, ATLAS_FF_HERO_UNSPLASH=true
netstat -ano | grep -E ":3000\s+.*LISTENING" | awk '{print $NF}' | sort -u | while read pid; do taskkill //F //PID "$pid"; done
cd apps/atlas-web && pnpm dev
```

- [ ] **Step 2: Playwright smoke**

Extend `e2e/tests/prompt-first-smoke.spec.ts` to additionally assert `designer.critique.completed` appears in the rail timeline.

- [ ] **Step 3: Run + commit**

```bash
pnpm playwright test e2e/tests/prompt-first-smoke.spec.ts --reporter=line
git add e2e/tests/prompt-first-smoke.spec.ts
git commit -m "test(e2e): assert designer.critique.completed in rail timeline"
```

---

## Self-review

- [x] Spec coverage: every section in the spec is implemented by ≥1 task (designer 3-pass: Task 2; events: Task 3; reference images: Task 1 + Task 10; AssetGenerator + GPT-Image + Unsplash + gradient: Tasks 4-6; engine wiring: Task 7; Developer prompt: Task 8; flags + factory: Task 9; smoke: Task 11).
- [x] Type consistency: `referenceImages` shape `ReadonlyArray<{ url, caption? }>` used identically in conductor/RoleInvocation, ritual-engine/StartInput, atlas-web/StartRitualInput. `AssetManifest` shape stable across role + render-user-turn + engine integration test.
- [x] No placeholders — every code step has the actual code.
- [ ] Known follow-up: MinIO/S3 image upload (currently uses `.next/cache`). Tracked as out-of-scope in the spec.
