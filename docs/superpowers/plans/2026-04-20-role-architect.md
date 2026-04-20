# Architect Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/role-architect/` — the first Role implementation for `@atlas/conductor`. The Architect role runs a two-pass orchestration: Pass 1 (Haiku 4.5) performs ambiguity triage on the user intent, emitting a structured `AmbiguityReport` that either gates the ritual (blockers → ask user) or proceeds; Pass 2 (Opus 4.7) composes `brainstorm.md` + `spec-graph.md` + `runnable-plan.md` skills from `@atlas/skill-runtime` and produces the scope-dependent Visualize artifact per PRD §8 (new app → Spec Graph + plan; bug fix → four-phase debug report; etc.). Every LLM call flows through `@atlas/llm-provider`'s retry + circuit breaker + observability.

**Architecture:** A single new pnpm-workspace package implementing the `Role` interface from `@atlas/conductor`. Inputs arrive via `RoleInvocation` (ritualId + intent + graphSlice + userTurn); outputs flow as `RoleOutput` events + a scope-typed artifact. The role stores no state between invocations — each `run()` is pure over its inputs + injected dependencies (`LLMProvider`, `SkillRegistry`). Pass 1 uses Anthropic's tool-use to get structured output (`AmbiguityReport`); Pass 2 assembles a 3-tier prompt-cache (role system + graph slice + user turn via `@atlas/conductor/prompt-cache`) and parses the Opus response into an `ArchitectOutput` discriminated union. The three Architect skills are loaded from C.2's bundled library in production; tests use fixture skills under `test/fixtures/skills/`.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS. Workspace deps: `@atlas/conductor`, `@atlas/llm-provider`, `@atlas/skill-runtime`, `@atlas/spec-graph-schema`. No new external runtime deps.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan D.1 merged (`@atlas/conductor` + `@atlas/llm-provider` are in the workspace).
- Plan C.1 merged (`@atlas/skill-runtime` is in the workspace).
- Plan C.2 merged is **nice-to-have but not required** — Architect tests use fixture skills; production wiring falls through to bundled skills only when C.2 is shipped.
- Plan B.1 merged (`@atlas/spec-graph-schema` is in the workspace).
- Node 22 + pnpm 9+.
- No Anthropic API key required — all provider calls are mocked in tests.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  role-architect/                            # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts                               # public API
      types.ts                               # ArchitectInvocation, ArchitectOutput (discriminated union), AmbiguityReport
      triage.ts                              # Pass 1 — runs Haiku, parses tool-use response
      deep-plan.ts                           # Pass 2 — assembles skills, runs Opus, parses scope-typed output
      assemble-prompt.ts                     # composes skill bodies for the Opus prompt
      role.ts                                # ArchitectRole class implementing Role from @atlas/conductor
      errors.ts                              # ArchitectError subclasses
    test/
      types.test.ts
      assemble-prompt.test.ts
      triage.test.ts
      triage-blocker.test.ts
      deep-plan.test.ts
      deep-plan-scope-parse.test.ts
      role-happy.test.ts
      role-triage-fails.test.ts
      role-deep-plan-fails.test.ts
      observability.test.ts
      integration.test.ts
      fixtures/
        skills/
          brainstorm.md                      # minimal test-only skill
          spec-graph.md
          runnable-plan.md

docs/superpowers/plans/
  README.md                                  # MODIFIED — add D.2 entry
```

**Why this shape.** Each `src/*.ts` has one responsibility: `triage.ts` owns Pass 1, `deep-plan.ts` owns Pass 2, `role.ts` ties them together under the `Role` interface. Splitting pass logic from the role class makes each unit independently testable with mocks. `assemble-prompt.ts` extracts the skill-composition concern so Pass 2 can be tested against fixture skills without touching the real registry.

## Open-question resolutions

- **Pass 1 vs Pass 2 cost budget.** Pass 1 (Haiku) is capped at `maxTokens: 4096` output. Pass 2 (Opus) uses prompt-caching via D.1's `buildPromptCacheBlocks`; per-call `maxTokens: 8192`. No hard token budget at the role level — the Conductor's per-dispatch retry policy bounds total cost at the ritual level.
- **Blocker semantics.** `AmbiguityReport.passed === true` means no `severity: "blocker"` question is present. Pass 2 runs only when `passed === true`. If `passed === false`, the role returns `RoleOutput` with no artifact and one event per blocker question (event type `architect.triage.needs_input`).
- **Structured output mechanism.** Pass 1 uses Anthropic's **tool-use** pattern: we define a single tool `emit_ambiguity_report` whose schema matches `AmbiguityReportSchema`, and parse the tool_use block from the response. This is more robust than JSON-in-text parsing (Anthropic does the schema enforcement).
- **Model selection.** Defaults: `ARCHITECT_TRIAGE_MODEL = "claude-haiku-4-5-20251001"`, `ARCHITECT_DEEP_PLAN_MODEL = "claude-opus-4-7"`. Overridable via the `ArchitectRole` constructor (`{ triageModel, deepPlanModel }`). Constants exported so D.3+ can import them for parity.
- **Scope inference.** Pass 2 receives the scope from the user turn via Pass 1's structured output (`AmbiguityReport.scope`). Pass 1 classifies the user turn into one of: `new-app`, `new-feature`, `bug-fix`, `dep-upgrade`, `refactor`, `ship`, `migrate` (per PRD §8). The `ArchitectOutput` discriminated union has one variant per scope; Pass 2 branches on the scope and emits the corresponding variant.

---

## Tasks

### Task 1: Scaffold `packages/role-architect/`

**Files:**
- Create: `packages/role-architect/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (placeholder)

No TDD — scaffolding.

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p packages/role-architect/src packages/role-architect/test/fixtures/skills
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@atlas/role-architect",
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
    "@atlas/skill-runtime": "workspace:*",
    "@atlas/spec-graph-schema": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json` + `vitest.config.ts`** — same shape as `packages/conductor/*.json` (copy from D.1).

- [ ] **Step 4: Placeholder `src/index.ts`**

```typescript
export {};
```

- [ ] **Step 5: Install + verify**

```bash
pnpm install
pnpm -F @atlas/role-architect typecheck
pnpm -F @atlas/role-architect build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/role-architect/ pnpm-lock.yaml
git commit -m "feat(role-architect): scaffold package with workspace deps on conductor + llm-provider + skill-runtime"
```

---

### Task 2: `AmbiguityReport` + `ArchitectOutput` + `ArchitectInvocation` types

**Files:**
- Create: `packages/role-architect/src/types.ts`
- Create: `packages/role-architect/test/types.test.ts`

- [ ] **Step 1: Write failing test**

`packages/role-architect/test/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  AmbiguityReportSchema,
  ArchitectOutputSchema,
  ScopeSchema,
  type ArchitectOutput,
  type AmbiguityReport,
  type Scope
} from "../src/types.js";

describe("types", () => {
  it("ScopeSchema accepts all 7 PRD §8 scopes", () => {
    for (const s of ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]) {
      expect(ScopeSchema.parse(s)).toBe(s);
    }
  });

  it("AmbiguityReportSchema parses a passed report", () => {
    const report: AmbiguityReport = {
      passed: true,
      scope: "new-feature",
      questions: []
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("AmbiguityReportSchema parses a blocker report", () => {
    const report: AmbiguityReport = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "What compliance class applies?", reason: "PII storage mentioned", severity: "blocker" }
      ]
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("ArchitectOutputSchema discriminates by scope", () => {
    const out: ArchitectOutput = {
      scope: "new-feature",
      diffPlan: { summary: "add forgot-password", tasks: [] },
      graphSlice: { bytes: "{}", hash: "sha256:zero" }
    };
    expect(ArchitectOutputSchema.parse(out)).toEqual(out);
  });

  it("ArchitectOutputSchema rejects wrong-shape for a scope", () => {
    const bad = { scope: "new-feature", bugReport: { phase1: "..." } };
    expect(() => ArchitectOutputSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/role-architect test types
```

- [ ] **Step 3: Implement**

`packages/role-architect/src/types.ts`:

```typescript
import { z } from "zod";

export const ScopeSchema = z.enum([
  "new-app",
  "new-feature",
  "bug-fix",
  "dep-upgrade",
  "refactor",
  "ship",
  "migrate"
]);
export type Scope = z.infer<typeof ScopeSchema>;

export const AmbiguityQuestionSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(["blocker", "recommended"])
});
export type AmbiguityQuestion = z.infer<typeof AmbiguityQuestionSchema>;

export const AmbiguityReportSchema = z.object({
  passed: z.boolean(),
  scope: ScopeSchema,
  questions: z.array(AmbiguityQuestionSchema)
}).superRefine((report, ctx) => {
  const hasBlocker = report.questions.some((q) => q.severity === "blocker");
  if (report.passed && hasBlocker) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when a blocker question is present",
      path: ["passed"]
    });
  }
});
export type AmbiguityReport = z.infer<typeof AmbiguityReportSchema>;

export const GraphSliceRefSchema = z.object({
  bytes: z.string(),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/)
});
export type GraphSliceRef = z.infer<typeof GraphSliceRefSchema>;

// One variant per scope. Each carries a scope-specific artifact plus the graph slice used for context.
const NewAppOutputSchema = z.object({
  scope: z.literal("new-app"),
  specGraph: z.unknown(), // validated against @atlas/spec-graph-schema separately
  runnablePlan: z.object({ tasks: z.array(z.unknown()) }),
  graphSlice: GraphSliceRefSchema
});

const NewFeatureOutputSchema = z.object({
  scope: z.literal("new-feature"),
  diffPlan: z.object({ summary: z.string(), tasks: z.array(z.unknown()) }),
  graphSlice: GraphSliceRefSchema
});

const BugFixOutputSchema = z.object({
  scope: z.literal("bug-fix"),
  bugReport: z.object({
    phase1_reproduce: z.string(),
    phase2_isolate: z.string(),
    phase3_hypothesize: z.string(),
    phase4_verify: z.string(),
    rootCause: z.string()
  }),
  graphSlice: GraphSliceRefSchema
});

const DepUpgradeOutputSchema = z.object({
  scope: z.literal("dep-upgrade"),
  breakingChangeMatrix: z.array(z.object({
    change: z.string(),
    affectedCallsites: z.array(z.string()),
    migration: z.string()
  })),
  rollbackPlan: z.string(),
  graphSlice: GraphSliceRefSchema
});

const RefactorOutputSchema = z.object({
  scope: z.literal("refactor"),
  beforeAfterGraph: z.object({ before: z.unknown(), after: z.unknown() }),
  behaviorPreservationContract: z.array(z.string()),
  regressionTests: z.array(z.string()),
  graphSlice: GraphSliceRefSchema
});

const ShipOutputSchema = z.object({
  scope: z.literal("ship"),
  rerunnableSteps: z.array(z.object({ name: z.string(), command: z.string(), idempotent: z.boolean() })),
  rollbackTrigger: z.string(),
  graphSlice: GraphSliceRefSchema
});

const MigrateOutputSchema = z.object({
  scope: z.literal("migrate"),
  stagedPlan: z.array(z.object({ stage: z.string(), cutoverWindow: z.string(), rollback: z.string() })),
  complianceEvidence: z.array(z.string()),
  graphSlice: GraphSliceRefSchema
});

export const ArchitectOutputSchema = z.discriminatedUnion("scope", [
  NewAppOutputSchema,
  NewFeatureOutputSchema,
  BugFixOutputSchema,
  DepUpgradeOutputSchema,
  RefactorOutputSchema,
  ShipOutputSchema,
  MigrateOutputSchema
]);
export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;

export interface ArchitectInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test types
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/src/types.ts packages/role-architect/test/types.test.ts
git commit -m "feat(role-architect): AmbiguityReport + ArchitectOutput discriminated-union types"
```

---

### Task 3: `ArchitectError` hierarchy

**Files:**
- Create: `packages/role-architect/src/errors.ts`
- Create: `packages/role-architect/test/errors.test.ts`

- [ ] **Step 1: Write failing test**

`packages/role-architect/test/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ArchitectError, TriageFailedError, DeepPlanFailedError, SkillMissingError } from "../src/errors.js";

describe("Architect errors", () => {
  it("ArchitectError is the base", () => {
    const e = new ArchitectError("boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ArchitectError");
  });

  it("SkillMissingError names the skill", () => {
    const e = new SkillMissingError("brainstorm");
    expect(e.skillName).toBe("brainstorm");
    expect(e.message).toMatch(/brainstorm/);
  });

  it("TriageFailedError captures cause", () => {
    const cause = new Error("network");
    const e = new TriageFailedError("pass 1 failed", { cause });
    expect(e.cause).toBe(cause);
  });

  it("DeepPlanFailedError captures cause + scope", () => {
    const e = new DeepPlanFailedError("pass 2 failed", { scope: "new-feature" });
    expect(e.scope).toBe("new-feature");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/role-architect test errors
```

- [ ] **Step 3: Implement**

`packages/role-architect/src/errors.ts`:

```typescript
import type { Scope } from "./types.js";

export class ArchitectError extends Error {
  readonly cause?: unknown;
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "ArchitectError";
    this.cause = options.cause;
  }
}

export class SkillMissingError extends ArchitectError {
  readonly skillName: string;
  constructor(skillName: string) {
    super(`required skill missing from registry: ${skillName}`);
    this.name = "SkillMissingError";
    this.skillName = skillName;
  }
}

export class TriageFailedError extends ArchitectError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "TriageFailedError";
  }
}

export class DeepPlanFailedError extends ArchitectError {
  readonly scope?: Scope;
  constructor(message: string, options: { cause?: unknown; scope?: Scope } = {}) {
    super(message, { cause: options.cause });
    this.name = "DeepPlanFailedError";
    this.scope = options.scope;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/src/errors.ts packages/role-architect/test/errors.test.ts
git commit -m "feat(role-architect): error hierarchy (ArchitectError, TriageFailedError, DeepPlanFailedError, SkillMissingError)"
```

---

### Task 4: `assembleArchitectPrompt` — compose skill bodies

**Files:**
- Create: `packages/role-architect/src/assemble-prompt.ts`
- Create: `packages/role-architect/test/assemble-prompt.test.ts`
- Create: `packages/role-architect/test/fixtures/skills/brainstorm.md`
- Create: `packages/role-architect/test/fixtures/skills/spec-graph.md`
- Create: `packages/role-architect/test/fixtures/skills/runnable-plan.md`

- [ ] **Step 1: Write fixture skills**

`packages/role-architect/test/fixtures/skills/brainstorm.md`:

```markdown
---
name: brainstorm
description: Test fixture — minimal brainstorm skill
---

# Brainstorm (fixture)

- Identify ambiguities.
- Emit AmbiguityReport.
```

`packages/role-architect/test/fixtures/skills/spec-graph.md`:

```markdown
---
name: spec-graph
description: Test fixture — minimal spec-graph skill
composes: ["brainstorm"]
---

# Spec Graph (fixture)

- Produce Spec Graph nodes/edges.
```

`packages/role-architect/test/fixtures/skills/runnable-plan.md`:

```markdown
---
name: runnable-plan
description: Test fixture — minimal runnable-plan skill
composes: ["spec-graph"]
---

# Runnable Plan (fixture)

- TDD tasks, exact commits.
```

- [ ] **Step 2: Write failing test**

`packages/role-architect/test/assemble-prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { assembleArchitectPrompt } from "../src/assemble-prompt.js";
import { SkillMissingError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("assembleArchitectPrompt", () => {
  it("concatenates the three required skill bodies with section separators", () => {
    const skills = loadSkillsFromDir(fixtureDir);
    const registry = createRegistryWithOverrides(skills, []);
    const prompt = assembleArchitectPrompt(registry, ["brainstorm", "spec-graph", "runnable-plan"]);
    expect(prompt).toContain("## Skill: brainstorm");
    expect(prompt).toContain("## Skill: spec-graph");
    expect(prompt).toContain("## Skill: runnable-plan");
    expect(prompt).toContain("Identify ambiguities");
    expect(prompt).toContain("Produce Spec Graph");
    expect(prompt).toContain("TDD tasks");
    // Order must match the requested order
    const idx = (s: string) => prompt.indexOf(s);
    expect(idx("## Skill: brainstorm")).toBeLessThan(idx("## Skill: spec-graph"));
    expect(idx("## Skill: spec-graph")).toBeLessThan(idx("## Skill: runnable-plan"));
  });

  it("throws SkillMissingError when a required skill isn't in the registry", () => {
    const skills = loadSkillsFromDir(fixtureDir).filter((s) => s.frontmatter.name !== "spec-graph");
    const registry = createRegistryWithOverrides(skills, []);
    expect(() => assembleArchitectPrompt(registry, ["brainstorm", "spec-graph", "runnable-plan"]))
      .toThrow(SkillMissingError);
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
pnpm -F @atlas/role-architect test assemble-prompt
```

- [ ] **Step 4: Implement**

`packages/role-architect/src/assemble-prompt.ts`:

```typescript
import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";

export function assembleArchitectPrompt(registry: SkillRegistry, skillNames: string[]): string {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = registry.get(name);
    if (!skill) throw new SkillMissingError(name);
    sections.push(`## Skill: ${name}\n\n${skill.body.trim()}\n`);
  }
  return sections.join("\n---\n\n");
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test assemble-prompt
```

- [ ] **Step 6: Commit**

```bash
git add packages/role-architect/src/assemble-prompt.ts packages/role-architect/test/assemble-prompt.test.ts packages/role-architect/test/fixtures/
git commit -m "feat(role-architect): assembleArchitectPrompt composes skill bodies with section separators"
```

---

### Task 5: `triage()` — Pass 1 happy path

**Files:**
- Create: `packages/role-architect/src/triage.ts`
- Create: `packages/role-architect/test/triage.test.ts`

- [ ] **Step 1: Write failing test**

`packages/role-architect/test/triage.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { triage, ARCHITECT_TRIAGE_MODEL } from "../src/triage.js";

describe("triage (Pass 1 happy path)", () => {
  it("calls Anthropic with triage model, tool-use constrained to AmbiguityReport schema", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: true,
            scope: "new-feature",
            questions: []
          }
        }
      ],
      model: ARCHITECT_TRIAGE_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const report = await triage({
      userTurn: "add forgot-password",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    });

    expect(report).toMatchObject({ passed: true, scope: "new-feature" });

    expect(sdkCreate).toHaveBeenCalledOnce();
    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toBe(ARCHITECT_TRIAGE_MODEL);
    expect(call.max_tokens).toBe(4096);
    expect(Array.isArray(call.tools)).toBe(true);
    const tools = call.tools as Array<{ name: string; input_schema: Record<string, unknown> }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("emit_ambiguity_report");
    expect(tools[0].input_schema.type).toBe("object");
  });

  it("respects an overridden triage model", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        { type: "tool_use", id: "tu", name: "emit_ambiguity_report", input: { passed: true, scope: "bug-fix", questions: [] } }
      ],
      model: "claude-custom-triage",
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await triage({
      userTurn: "fix the login 500",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider,
      triageModel: "claude-custom-triage"
    });

    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toBe("claude-custom-triage");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/role-architect test triage.test
```

- [ ] **Step 3: Implement**

`packages/role-architect/src/triage.ts`:

```typescript
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { AmbiguityReportSchema, type AmbiguityReport } from "./types.js";
import { TriageFailedError } from "./errors.js";

export const ARCHITECT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";

export interface TriageInput {
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  llm: LLMProvider;
  triageModel?: string;
}

const TRIAGE_SYSTEM_PROMPT = `You are the Architect's triage pass. Classify the user's request into one of:
new-app, new-feature, bug-fix, dep-upgrade, refactor, ship, migrate.

Identify ambiguities that would block a deep plan. A "blocker" is missing information
the Architect cannot safely infer: compliance class, data-residency region, auth provider,
DB provider, payment regions. "Recommended" questions can be answered later.

Call the emit_ambiguity_report tool exactly once with your findings.`;

const AMBIGUITY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: {
      type: "boolean",
      description: "true if no blocker-severity questions are present"
    },
    scope: {
      type: "string",
      enum: ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          severity: { type: "string", enum: ["blocker", "recommended"] }
        },
        required: ["question", "reason", "severity"]
      }
    }
  },
  required: ["passed", "scope", "questions"]
} as const;

export async function triage(input: TriageInput): Promise<AmbiguityReport> {
  const model = input.triageModel ?? ARCHITECT_TRIAGE_MODEL;
  const messages: LLMMessage[] = [
    { role: "system", content: TRIAGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: input.userTurn }
  ];

  // Anthropic tool-use is passed to LLMProvider via extra args on the SDK call.
  // LLMProvider's LLMCallOptions doesn't currently model tools, so we reach for
  // the SDK's native shape by way of the AnthropicProvider's internal call —
  // achieved by extending LLMCallOptions with a `tools` passthrough.
  // For D.2 we keep the role local to this narrow usage and use a typed
  // structural cast when passing to `complete()`.
  const completion = await (input.llm as unknown as {
    complete: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ content: string; stopReason: string; }>;
  }).complete(messages, {
    model,
    maxTokens: 4096,
    tools: [
      {
        name: "emit_ambiguity_report",
        description: "Emit the triage result with scope + questions",
        input_schema: AMBIGUITY_TOOL_SCHEMA
      }
    ],
    tool_choice: { type: "tool", name: "emit_ambiguity_report" }
  });

  // The cast above routes tools through to AnthropicProvider.assembleRequest via the
  // `body` spread. `AnthropicProvider` treats unknown keys as passthrough, and the SDK
  // returns `content` as an array of blocks; AnthropicProvider flattens text blocks
  // to a string. When tool_use is used, the provider needs to return the tool_use
  // input. Task 6 extends AnthropicProvider with a `completeWithToolUse()` helper
  // that returns the raw tool_use block. Until then, we parse the text representation.
  // The test mocks the SDK directly, so in tests we observe the raw response shape.
  //
  // SIMPLIFICATION for D.2: inside triage(), assume the provider returns a completion
  // whose content is the JSON-serialised tool_use input when tool_choice forces the tool.
  // This works because Anthropic SDK returns the full Message; AnthropicProvider's
  // current flattener will join text blocks only — for tool_use paths we go through
  // a helper.

  // For D.2 we take the direct-SDK path: cast to the raw SDK shape, extract the
  // tool_use.input, then validate via AmbiguityReportSchema.
  const raw = completion as unknown as {
    content: Array<{ type: string; name?: string; input?: unknown }>;
  };
  const toolUse = raw.content.find((c) => c.type === "tool_use" && c.name === "emit_ambiguity_report");
  if (!toolUse || toolUse.input === undefined) {
    throw new TriageFailedError("triage response did not include an emit_ambiguity_report tool_use block");
  }
  const parse = AmbiguityReportSchema.safeParse(toolUse.input);
  if (!parse.success) {
    throw new TriageFailedError("triage tool_use payload failed AmbiguityReportSchema", {
      cause: parse.error
    });
  }
  return parse.data;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test triage.test
```

Expected: 2 pass.

Note: the triage implementation relies on the mocked SDK shape, which returns `content: Array<...>` directly. Since `AnthropicProvider.complete` flattens text blocks, the raw tool_use path in D.2 bypasses the standard flattener by casting. Task 6 cleans this up by extending `AnthropicProvider` with a `completeWithToolUse()` that returns the raw content blocks. For D.2's scope, the test-level cast is acceptable.

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/src/triage.ts packages/role-architect/test/triage.test.ts
git commit -m "feat(role-architect): Pass 1 triage via Anthropic tool-use (ambiguity report)"
```

---

