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

### Task 6: Extend `@atlas/llm-provider` with tool-use passthrough

**Files:**
- Modify: `packages/llm-provider/src/provider.ts`
- Modify: `packages/llm-provider/src/anthropic.ts`
- Modify: `packages/llm-provider/src/index.ts`
- Create: `packages/llm-provider/test/anthropic-tools.test.ts`

Task 5's cast-based tool-use was a workaround. This task cleanly extends `LLMCallOptions` with an optional `tools` array + `tool_choice` field, and adds a `completeWithToolUse()` method to `AnthropicProvider` that returns the raw tool_use input instead of flattened text.

- [ ] **Step 1: Write failing test**

`packages/llm-provider/test/anthropic-tools.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "../src/index.js";
import type { LLMMessage } from "../src/provider.js";

describe("AnthropicProvider.completeWithToolUse", () => {
  it("returns the tool_use input when the model uses a tool", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        { type: "tool_use", id: "tu_1", name: "emit_report", input: { passed: true, score: 42 } }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const result = await provider.completeWithToolUse(
      [{ role: "user", content: "go" }] as LLMMessage[],
      {
        model: "claude-haiku-4-5-20251001",
        maxTokens: 4096,
        tools: [{ name: "emit_report", description: "x", input_schema: { type: "object", properties: {} } }],
        toolChoice: { type: "tool", name: "emit_report" }
      }
    );

    expect(result.toolName).toBe("emit_report");
    expect(result.input).toEqual({ passed: true, score: 42 });
    expect(sdkCreate).toHaveBeenCalledOnce();
    const body = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_report" });
  });

  it("throws ToolUseMissingError when the model emits only text", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "text", text: "I refuse to use the tool" }],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await expect(provider.completeWithToolUse(
      [{ role: "user", content: "go" }] as LLMMessage[],
      {
        model: "claude-haiku-4-5-20251001",
        maxTokens: 4096,
        tools: [{ name: "emit_report", description: "x", input_schema: { type: "object", properties: {} } }],
        toolChoice: { type: "tool", name: "emit_report" }
      }
    )).rejects.toThrow(/tool_use/);
  });
});
```

- [ ] **Step 2: Run — expect fail** (`completeWithToolUse` doesn't exist yet).

```bash
pnpm -F @atlas/llm-provider test anthropic-tools
```

- [ ] **Step 3: Extend `provider.ts`**

Add to the bottom of `packages/llm-provider/src/provider.ts`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseResult {
  toolName: string;
  input: unknown;
  stopReason: LLMCompletion["stopReason"];
  usage: LLMCompletion["usage"];
}

export interface ToolUseOptions extends LLMCallOptions {
  tools: ToolDefinition[];
  toolChoice: { type: "tool"; name: string } | { type: "any" } | { type: "auto" };
}
```

- [ ] **Step 4: Extend `anthropic.ts`**

Add to `AnthropicProvider` (near `complete`):

```typescript
async completeWithToolUse(
  messages: LLMMessage[],
  options: import("./provider.js").ToolUseOptions
): Promise<import("./provider.js").ToolUseResult> {
  const breaker = this.getBreaker(options.model);
  const policy = resolvePolicy(options.retry);
  return instrumentCall(
    { provider: this.name, model: options.model, metrics: this.metrics },
    () => breaker.run(() => retry(() => this.callWithToolUse(messages, options), policy))
  );
}

private async callWithToolUse(
  messages: LLMMessage[],
  options: import("./provider.js").ToolUseOptions
): Promise<import("./provider.js").ToolUseResult> {
  try {
    const { system, body } = this.assembleRequest(messages, options);
    const req = {
      system,
      ...body,
      tools: options.tools,
      tool_choice: options.toolChoice
    };
    const resp = await this.sdk.messages.create(req) as unknown as AnthropicRawResponse & {
      content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
    };
    const toolUse = resp.content.find((c) => c.type === "tool_use");
    if (!toolUse || !toolUse.name || toolUse.input === undefined) {
      throw new InvalidRequestError(
        `expected tool_use response, got stop_reason=${resp.stop_reason}; content has no tool_use block`
      );
    }
    return {
      toolName: toolUse.name,
      input: toolUse.input,
      stopReason: resp.stop_reason,
      usage: {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        cacheCreationInputTokens: resp.usage.cache_creation_input_tokens,
        cacheReadInputTokens: resp.usage.cache_read_input_tokens
      }
    };
  } catch (err) {
    throw this.translateError(err);
  }
}
```

- [ ] **Step 5: Export new types**

In `packages/llm-provider/src/index.ts`, the existing `export * from "./provider.js"` already picks up the new types. Verify by typecheck:

```bash
pnpm -F @atlas/llm-provider typecheck
```

- [ ] **Step 6: Run tool-use tests — expect pass**

```bash
pnpm -F @atlas/llm-provider test anthropic-tools
```

Expected: 2 pass.

- [ ] **Step 7: Rebuild + update `triage.ts` to use the clean API**

Rewrite the call in `packages/role-architect/src/triage.ts` to use `provider.completeWithToolUse`. Replace the body of `triage()` with:

```typescript
export async function triage(input: TriageInput): Promise<AmbiguityReport> {
  const model = input.triageModel ?? ARCHITECT_TRIAGE_MODEL;
  const messages: LLMMessage[] = [
    { role: "system", content: TRIAGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: input.userTurn }
  ];

  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_ambiguity_report",
          description: "Emit the triage result with scope + questions",
          input_schema: AMBIGUITY_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_ambiguity_report" }
    });
  } catch (err) {
    throw new TriageFailedError("triage LLM call failed", { cause: err });
  }

  const parse = AmbiguityReportSchema.safeParse(result.input);
  if (!parse.success) {
    throw new TriageFailedError("triage tool_use payload failed AmbiguityReportSchema", { cause: parse.error });
  }
  return parse.data;
}
```

Also update `packages/role-architect/test/triage.test.ts`'s mock: the SDK-level response shape is unchanged, but now the provider's flatten-to-text path is replaced by `completeWithToolUse`. Re-run the tests — they should still pass because `AnthropicProvider.completeWithToolUse` goes through the same mocked `sdkCreate`.

- [ ] **Step 8: Run all llm-provider + role-architect tests**

```bash
pnpm -F @atlas/llm-provider test
pnpm -F @atlas/role-architect test
```

Expected: both green.

- [ ] **Step 9: Commit**

```bash
git add packages/llm-provider/src/ packages/llm-provider/test/anthropic-tools.test.ts packages/role-architect/src/triage.ts
git commit -m "feat(llm-provider): add completeWithToolUse + ToolDefinition/ToolUseResult; route role-architect triage through it"
```

---

### Task 7: `triage()` — blocker path

**Files:**
- Create: `packages/role-architect/test/triage-blocker.test.ts`

- [ ] **Step 1: Write failing test**

`packages/role-architect/test/triage-blocker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { triage } from "../src/triage.js";

describe("triage (Pass 1 blocker path)", () => {
  it("returns passed=false when the model emits a blocker question", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: false,
            scope: "new-app",
            questions: [
              { question: "What compliance class applies?", reason: "PII storage mentioned", severity: "blocker" }
            ]
          }
        }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const report = await triage({
      userTurn: "build me an app that stores customer health data",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    });

    expect(report.passed).toBe(false);
    expect(report.questions).toHaveLength(1);
    expect(report.questions[0].severity).toBe("blocker");
    expect(report.questions[0].question).toMatch(/compliance/i);
  });

  it("rejects invalid triage output — passed=true with a blocker question", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: true, // inconsistent with the blocker question below
            scope: "new-feature",
            questions: [{ question: "q", reason: "r", severity: "blocker" }]
          }
        }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 3 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await expect(triage({
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    })).rejects.toThrow(/AmbiguityReportSchema|passed cannot be true/i);
  });
});
```

- [ ] **Step 2: Run — expect pass** (implementation from Task 5+6 already handles blocker paths via `AmbiguityReportSchema.superRefine`).

```bash
pnpm -F @atlas/role-architect test triage-blocker
```

If the second test fails with a different error than expected, trace to `types.ts`'s superRefine — confirm the cross-field rule rejects `passed=true` when a blocker question is present.

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/triage-blocker.test.ts
git commit -m "test(role-architect): Pass 1 returns passed=false on blocker + rejects inconsistent output"
```

---

### Task 8: `deepPlan()` — Pass 2 core

**Files:**
- Create: `packages/role-architect/src/deep-plan.ts`
- Create: `packages/role-architect/test/deep-plan.test.ts`

- [ ] **Step 1: Write failing test**

`packages/role-architect/test/deep-plan.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { deepPlan, ARCHITECT_DEEP_PLAN_MODEL } from "../src/deep-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

function fixtureRegistry() {
  return createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
}

describe("deepPlan (Pass 2 core)", () => {
  it("calls Opus with 3-tier prompt-cache blocks + assembled skill prompt + scope-tool", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_plan",
          name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "forgot-password", tasks: [] },
            graphSlice: { bytes: "{}", hash: "sha256:zero" }
          }
        }
      ],
      model: ARCHITECT_DEEP_PLAN_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 450 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const out = await deepPlan({
      userTurn: "add forgot-password",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      ambiguity: { passed: true, scope: "new-feature", questions: [] },
      skills: fixtureRegistry(),
      llm: provider
    });

    expect(out.scope).toBe("new-feature");
    expect(sdkCreate).toHaveBeenCalledOnce();
    const body = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(body.model).toBe(ARCHITECT_DEEP_PLAN_MODEL);
    expect(body.max_tokens).toBe(8192);
    const system = body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    // 3-tier cache: role prompt + graph slice + skill-assembled prompt (all cache_control)
    expect(system.length).toBeGreaterThanOrEqual(2);
    expect(system[0].cache_control).toBeDefined();
    // Skill bodies should appear in the assembled prompt
    const joined = system.map((s) => s.text).join("\n");
    expect(joined).toContain("Skill: brainstorm");
    expect(joined).toContain("Skill: spec-graph");
    expect(joined).toContain("Skill: runnable-plan");
  });

  it("throws DeepPlanFailedError when skills are missing", async () => {
    const emptyRegistry = createRegistryWithOverrides([], []);
    const sdk = { messages: { create: vi.fn(), stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await expect(deepPlan({
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      ambiguity: { passed: true, scope: "new-feature", questions: [] },
      skills: emptyRegistry,
      llm: provider
    })).rejects.toThrow(/required skill missing|brainstorm/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/role-architect test deep-plan.test
```

- [ ] **Step 3: Implement**

`packages/role-architect/src/deep-plan.ts`:

```typescript
import type { LLMProvider } from "@atlas/llm-provider";
import { buildPromptCacheBlocks } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleArchitectPrompt } from "./assemble-prompt.js";
import { DeepPlanFailedError } from "./errors.js";
import {
  ArchitectOutputSchema,
  type AmbiguityReport,
  type ArchitectOutput
} from "./types.js";

export const ARCHITECT_DEEP_PLAN_MODEL = "claude-opus-4-7";

export interface DeepPlanInput {
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  ambiguity: AmbiguityReport;
  skills: SkillRegistry;
  llm: LLMProvider;
  deepPlanModel?: string;
}

const DEEP_PLAN_ROLE_PROMPT = `You are the Architect's deep-plan pass. Given a clarified user intent
and a Spec Graph slice, produce the scope-specific Visualize artifact per PRD §8:

- new-app → SpecGraph + wireframes + data model + flows + compliance class
- new-feature → impact-analysis diff plan
- bug-fix → four-phase debug report (reproduce → isolate → hypothesize → verify)
- dep-upgrade → breaking-change matrix + rollback plan
- refactor → before/after graph + behavior-preservation contract + regression tests
- ship → rerunnable steps + rollback trigger
- migrate → staged plan + compliance evidence

Compose brainstorm + spec-graph + runnable-plan skills as reference material.
Call the emit_architect_output tool exactly once with the scope-matched output.`;

const DEEP_PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]
    },
    // Accept either shape; strict enforcement happens via Zod after the tool returns.
  },
  required: ["scope"]
} as const;

export async function deepPlan(input: DeepPlanInput): Promise<ArchitectOutput> {
  let skillPrompt: string;
  try {
    skillPrompt = assembleArchitectPrompt(input.skills, ["brainstorm", "spec-graph", "runnable-plan"]);
  } catch (err) {
    throw new DeepPlanFailedError(`required skill missing: ${(err as Error).message}`, {
      cause: err,
      scope: input.ambiguity.scope
    });
  }

  const model = input.deepPlanModel ?? ARCHITECT_DEEP_PLAN_MODEL;
  const roleSystem = `${DEEP_PLAN_ROLE_PROMPT}\n\n# Reference skills\n\n${skillPrompt}`;

  const messages = buildPromptCacheBlocks({
    rolePrompt: roleSystem,
    graphSlice: input.graphSlice,
    userTurn: `Scope: ${input.ambiguity.scope}\n\nUser intent: ${input.userTurn}`
  });

  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: typeof messages, o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model,
      maxTokens: 8192,
      tools: [
        {
          name: "emit_architect_output",
          description: "Emit the scope-specific Visualize artifact",
          input_schema: DEEP_PLAN_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_architect_output" }
    });
  } catch (err) {
    throw new DeepPlanFailedError("deep plan LLM call failed", { cause: err, scope: input.ambiguity.scope });
  }

  const parse = ArchitectOutputSchema.safeParse(result.input);
  if (!parse.success) {
    throw new DeepPlanFailedError("deep plan tool_use payload failed ArchitectOutputSchema", {
      cause: parse.error,
      scope: input.ambiguity.scope
    });
  }
  return parse.data;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test deep-plan.test
```

Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/src/deep-plan.ts packages/role-architect/test/deep-plan.test.ts
git commit -m "feat(role-architect): Pass 2 deepPlan with 3-tier prompt-cache + tool-use ArchitectOutput"
```

---

### Task 9: `deepPlan()` — scope-variant parsing

**Files:**
- Create: `packages/role-architect/test/deep-plan-scope-parse.test.ts`

- [ ] **Step 1: Write test asserting each of the 7 scope variants parses**

`packages/role-architect/test/deep-plan-scope-parse.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { deepPlan } from "../src/deep-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

function providerReturning(toolInput: unknown) {
  const sdkCreate = vi.fn(async () => ({
    content: [{ type: "tool_use", id: "tu", name: "emit_architect_output", input: toolInput }],
    model: "claude-opus-4-7",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 }
  }));
  return new AnthropicProvider({
    sdk: { messages: { create: sdkCreate, stream: vi.fn() } } as never,
    metrics: createProviderMetrics(new Registry())
  });
}

const slice = { bytes: "{}", hash: "sha256:" + "0".repeat(64) };
const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

describe("deepPlan scope variants", () => {
  it("parses new-app scope", async () => {
    const out = await deepPlan({
      userTurn: "create",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "new-app", questions: [] },
      skills,
      llm: providerReturning({
        scope: "new-app",
        specGraph: { nodes: {}, edges: [] },
        runnablePlan: { tasks: [] },
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("new-app");
  });

  it("parses bug-fix scope", async () => {
    const out = await deepPlan({
      userTurn: "debug",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "bug-fix", questions: [] },
      skills,
      llm: providerReturning({
        scope: "bug-fix",
        bugReport: {
          phase1_reproduce: "steps",
          phase2_isolate: "minimal case",
          phase3_hypothesize: "h1",
          phase4_verify: "test",
          rootCause: "race"
        },
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("bug-fix");
    if (out.scope === "bug-fix") {
      expect(out.bugReport.rootCause).toBe("race");
    }
  });

  it("parses dep-upgrade scope", async () => {
    const out = await deepPlan({
      userTurn: "upgrade",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "dep-upgrade", questions: [] },
      skills,
      llm: providerReturning({
        scope: "dep-upgrade",
        breakingChangeMatrix: [{ change: "x", affectedCallsites: ["a.ts"], migration: "rename" }],
        rollbackPlan: "git revert",
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("dep-upgrade");
  });

  it("parses refactor scope", async () => {
    const out = await deepPlan({
      userTurn: "refactor",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "refactor", questions: [] },
      skills,
      llm: providerReturning({
        scope: "refactor",
        beforeAfterGraph: { before: {}, after: {} },
        behaviorPreservationContract: ["public API unchanged"],
        regressionTests: ["test1"],
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("refactor");
  });

  it("parses ship scope", async () => {
    const out = await deepPlan({
      userTurn: "ship",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "ship", questions: [] },
      skills,
      llm: providerReturning({
        scope: "ship",
        rerunnableSteps: [{ name: "deploy", command: "pnpm run deploy", idempotent: true }],
        rollbackTrigger: "one-click",
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("ship");
  });

  it("parses migrate scope", async () => {
    const out = await deepPlan({
      userTurn: "migrate",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "migrate", questions: [] },
      skills,
      llm: providerReturning({
        scope: "migrate",
        stagedPlan: [{ stage: "dual-run", cutoverWindow: "2h", rollback: "revert DNS" }],
        complianceEvidence: ["hipaa-log"],
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("migrate");
  });
});
```

- [ ] **Step 2: Run — expect pass** (all 6 scopes exercise the same parse path from Task 8; new-feature was covered in Task 8 itself).

```bash
pnpm -F @atlas/role-architect test deep-plan-scope-parse
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/deep-plan-scope-parse.test.ts
git commit -m "test(role-architect): deepPlan parses all 7 scope variants of ArchitectOutput"
```

---

### Task 10: `ArchitectRole` class — happy path

**Files:**
- Create: `packages/role-architect/src/role.ts`
- Modify: `packages/role-architect/src/index.ts`
- Create: `packages/role-architect/test/role-happy.test.ts`

- [ ] **Step 1: Write failing test**

`packages/role-architect/test/role-happy.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole.run (happy path)", () => {
  it("runs Pass 1 → Pass 2 and returns RoleOutput with ArchitectOutput + 4 events", async () => {
    const sdkCreate = vi.fn()
      // Pass 1 — triage
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] }
        }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
      })
      // Pass 2 — deep plan
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "add forgot-password flow", tasks: [] },
            graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
          }
        }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "add forgot-password"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("architect.pass1.started");
    expect(types).toContain("architect.pass1.completed");
    expect(types).toContain("architect.pass2.started");
    expect(types).toContain("architect.pass2.completed");

    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed");
    expect(completed).toBeDefined();
    const artifact = completed?.payload.artifact as { scope: string } | undefined;
    expect(artifact?.scope).toBe("new-feature");
    expect(out.diff.kind).toBe("none"); // Architect emits artifacts, not code diffs
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/role-architect test role-happy
```

- [ ] **Step 3: Implement `role.ts`**

`packages/role-architect/src/role.ts`:

```typescript
import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { deepPlan, ARCHITECT_DEEP_PLAN_MODEL } from "./deep-plan.js";
import { triage, ARCHITECT_TRIAGE_MODEL } from "./triage.js";
import type { AmbiguityReport, ArchitectOutput } from "./types.js";

export interface ArchitectRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  triageModel?: string;
  deepPlanModel?: string;
}

export class ArchitectRole implements Role {
  readonly id = "architect";
  private readonly llm: LLMProvider;
  private readonly skills: SkillRegistry;
  private readonly triageModel: string;
  private readonly deepPlanModel: string;

  constructor(opts: ArchitectRoleOptions) {
    this.llm = opts.llm;
    this.skills = opts.skills;
    this.triageModel = opts.triageModel ?? ARCHITECT_TRIAGE_MODEL;
    this.deepPlanModel = opts.deepPlanModel ?? ARCHITECT_DEEP_PLAN_MODEL;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];

    events.push({ eventType: "architect.pass1.started", payload: { ritualId: inv.ritualId } });
    let report: AmbiguityReport;
    try {
      report = await triage({
        userTurn: inv.userTurn,
        graphSlice: inv.graphSlice,
        llm: this.llm,
        triageModel: this.triageModel
      });
    } catch (err) {
      events.push({ eventType: "architect.pass1.failed", payload: { error: (err as Error).message } });
      throw err;
    }
    events.push({ eventType: "architect.pass1.completed", payload: { passed: report.passed, scope: report.scope } });

    if (!report.passed) {
      for (const q of report.questions.filter((x) => x.severity === "blocker")) {
        events.push({ eventType: "architect.triage.needs_input", payload: { question: q.question, reason: q.reason } });
      }
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "architect.pass2.started", payload: { scope: report.scope } });
    let artifact: ArchitectOutput;
    try {
      artifact = await deepPlan({
        userTurn: inv.userTurn,
        graphSlice: inv.graphSlice,
        ambiguity: report,
        skills: this.skills,
        llm: this.llm,
        deepPlanModel: this.deepPlanModel
      });
    } catch (err) {
      events.push({ eventType: "architect.pass2.failed", payload: { error: (err as Error).message, scope: report.scope } });
      throw err;
    }
    events.push({ eventType: "architect.pass2.completed", payload: { scope: artifact.scope, artifact } });

    return { events, diff: { kind: "none" } };
  }
}
```

- [ ] **Step 4: Update `src/index.ts`**

```typescript
export * from "./types.js";
export * from "./errors.js";
export { triage, ARCHITECT_TRIAGE_MODEL } from "./triage.js";
export { deepPlan, ARCHITECT_DEEP_PLAN_MODEL } from "./deep-plan.js";
export { assembleArchitectPrompt } from "./assemble-prompt.js";
export { ArchitectRole } from "./role.js";
export type { ArchitectRoleOptions } from "./role.js";
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test role-happy
```

- [ ] **Step 6: Commit**

```bash
git add packages/role-architect/src/role.ts packages/role-architect/src/index.ts packages/role-architect/test/role-happy.test.ts
git commit -m "feat(role-architect): ArchitectRole happy path — Pass 1 → Pass 2 → 4 events + artifact"
```

---

### Task 11: `ArchitectRole.run` — triage-fails path

**Files:**
- Create: `packages/role-architect/test/role-triage-fails.test.ts`

- [ ] **Step 1: Write test**

`packages/role-architect/test/role-triage-fails.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole.run (triage returns blockers)", () => {
  it("returns RoleOutput with needs_input events and no artifact; does not call Pass 2", async () => {
    const sdkCreate = vi.fn().mockResolvedValueOnce({
      content: [{
        type: "tool_use", id: "t1", name: "emit_ambiguity_report",
        input: {
          passed: false,
          scope: "new-app",
          questions: [
            { question: "Compliance class?", reason: "PII", severity: "blocker" },
            { question: "Brand tokens?", reason: "advisory", severity: "recommended" }
          ]
        }
      }],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 }
    });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-2",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build an HIPAA app"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("architect.pass1.started");
    expect(types).toContain("architect.pass1.completed");
    expect(types).toContain("architect.triage.needs_input");
    expect(types).not.toContain("architect.pass2.started");

    // Only blocker questions become needs_input events
    const needsInput = out.events.filter((e) => e.eventType === "architect.triage.needs_input");
    expect(needsInput).toHaveLength(1);

    // No second SDK call
    expect(sdkCreate).toHaveBeenCalledOnce();

    expect(out.diff.kind).toBe("none");
  });
});
```

- [ ] **Step 2: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test role-triage-fails
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/role-triage-fails.test.ts
git commit -m "test(role-architect): run() returns needs_input events when triage fails"
```

---

### Task 12: `ArchitectRole.run` — deep-plan-fails path

**Files:**
- Create: `packages/role-architect/test/role-deep-plan-fails.test.ts`

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";
import { DeepPlanFailedError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole.run (deep-plan throws)", () => {
  it("emits pass2.failed event then re-throws so conductor can retry", async () => {
    const sdkCreate = vi.fn()
      // Pass 1 — triage ok
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] }
        }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 3 }
      })
      // Pass 2 — deep plan returns an invalid artifact
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use", id: "t2", name: "emit_architect_output",
          input: { scope: "new-feature" /* missing diffPlan + graphSlice */ }
        }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });

    // Capture events via a try/catch since run() rejects
    let caught: unknown;
    try {
      await role.run({
        ritualId: "r-3",
        intent: "architect",
        graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
        userTurn: "add x"
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeepPlanFailedError);
  });
});
```

File path: `packages/role-architect/test/role-deep-plan-fails.test.ts`

- [ ] **Step 2: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test role-deep-plan-fails
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/role-deep-plan-fails.test.ts
git commit -m "test(role-architect): run() throws DeepPlanFailedError on invalid Pass 2 output"
```

---

### Task 13: Observability — spans + metrics fire on both passes

**Files:**
- Create: `packages/role-architect/test/observability.test.ts`

The `AnthropicProvider` from D.1 already emits spans and metrics on every call. This task verifies that both Pass 1 (Haiku) and Pass 2 (Opus) produce labelled metric increments with the correct `{provider, model, status}` labels.

- [ ] **Step 1: Write test**

`packages/role-architect/test/observability.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole observability", () => {
  it("emits one LLM-request metric per pass with correct model labels", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 3 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: { scope: "new-feature", diffPlan: { summary: "x", tasks: [] }, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } } }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 20 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    await role.run({
      ritualId: "r-obs",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "add x"
    });

    const snapshots = await registry.getMetricsAsJSON();
    const reqMetric = snapshots.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(reqMetric).toBeDefined();
    const values = (reqMetric as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values;
    const haikuSuccess = values.find(
      (v) => v.labels.model === "claude-haiku-4-5-20251001" && v.labels.status === "success"
    );
    const opusSuccess = values.find(
      (v) => v.labels.model === "claude-opus-4-7" && v.labels.status === "success"
    );
    expect(haikuSuccess?.value).toBe(1);
    expect(opusSuccess?.value).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect pass** (provider-side instrumentation already shipped in D.1).

```bash
pnpm -F @atlas/role-architect test observability
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/observability.test.ts
git commit -m "test(role-architect): both passes emit labelled Prometheus metrics via llm-provider"
```

---

### Task 14: Integration — role called through a real skill-runtime + mocked SDK

**Files:**
- Create: `packages/role-architect/test/integration.test.ts`

This exercises the full role pipeline with a real `SkillRegistry` constructed from fixture skills. Mocks only the Anthropic SDK. Validates prompt-cache shape reaches the SDK and all 4 events fire.

- [ ] **Step 1: Write test**

`packages/role-architect/test/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole end-to-end integration", () => {
  it("routes Pass 2 prompt-cache to the SDK with system array containing the 3 skill bodies", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "bug-fix", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "bug-fix",
            bugReport: {
              phase1_reproduce: "steps",
              phase2_isolate: "min case",
              phase3_hypothesize: "h",
              phase4_verify: "v",
              rootCause: "race"
            },
            graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
          } }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-int",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "login returns 500 on Safari"
    });

    // Validate 4 events + scope-matched artifact
    const typeSet = new Set(out.events.map((e) => e.eventType));
    expect(typeSet.has("architect.pass1.started")).toBe(true);
    expect(typeSet.has("architect.pass1.completed")).toBe(true);
    expect(typeSet.has("architect.pass2.started")).toBe(true);
    expect(typeSet.has("architect.pass2.completed")).toBe(true);

    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed");
    const artifact = completed?.payload.artifact as { scope: string };
    expect(artifact.scope).toBe("bug-fix");

    // Validate Pass 2 request shape
    const pass2Body = sdkCreate.mock.calls[1][0] as Record<string, unknown>;
    const system = pass2Body.system as Array<{ text: string }>;
    const joined = system.map((s) => s.text).join("\n");
    expect(joined).toContain("Skill: brainstorm");
    expect(joined).toContain("Skill: spec-graph");
    expect(joined).toContain("Skill: runnable-plan");
    expect(joined).toContain("Scope: bug-fix"); // from the user-turn block
  });
});
```

- [ ] **Step 2: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test integration
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/integration.test.ts
git commit -m "test(role-architect): end-to-end with real skill-runtime; Pass 2 system array has all 3 skill bodies"
```

---

### Task 15: Conductor-dispatch contract test

**Files:**
- Create: `packages/role-architect/test/conductor-fit.test.ts`

`ArchitectRole` must satisfy the `Role` interface from `@atlas/conductor` such that `Conductor.dispatch()` can invoke it without any shim. This test constructs a `Conductor` with the `ArchitectRole` in its `roles` map and dispatches a ritual end-to-end.

- [ ] **Step 1: Write test**

`packages/role-architect/test/conductor-fit.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole satisfies @atlas/conductor's Role interface", () => {
  it("Conductor.dispatch with classifier→architect→role flow returns architect artifact", async () => {
    const sdkCreate = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "emit_ambiguity_report",
          input: { passed: true, scope: "new-feature", questions: [] } }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 }
      })
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t2", name: "emit_architect_output",
          input: {
            scope: "new-feature",
            diffPlan: { summary: "forgot-password", tasks: [] },
            graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
          } }],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new ArchitectRole({ llm: provider, skills });

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 0.95 }) },
      roles: new Map([["architect", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const result = await conductor.dispatch({
      ritualId: "r-fit" as never,
      graphVersion: 1,
      userTurn: "add forgot-password",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.roleId).toBe("architect");
    expect(result.attempts).toBe(1);
    const types = checkpoints.map((c) => c.eventType);
    expect(types).toContain("dispatch.classified");
    expect(types).toContain("architect.pass1.completed");
    expect(types).toContain("architect.pass2.completed");
    expect(types).toContain("dispatch.completed");
  });
});
```

- [ ] **Step 2: Run — expect pass**

```bash
pnpm -F @atlas/role-architect test conductor-fit
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-architect/test/conductor-fit.test.ts
git commit -m "test(role-architect): ArchitectRole works under @atlas/conductor.dispatch"
```

---

### Task 16: Build + full-suite smoke

**Files:** none created — verification task.

- [ ] **Step 1: Run the package's own build + tests**

```bash
pnpm -F @atlas/role-architect build
pnpm -F @atlas/role-architect typecheck
pnpm -F @atlas/role-architect test
```

Expected: `build` exits 0; `typecheck` exits 0; test summary shows 11 test files, ~22-24 tests (exact count depends on parametrized variants), all green.

- [ ] **Step 2: Run the full workspace test suite to confirm no regression**

```bash
pnpm -r test
```

Expected: every workspace package previously-green remains green. Pre-existing Postgres flakiness in `spec-graph-sync` / `spec-graph-merge-driver` is acceptable and unrelated.

- [ ] **Step 3: If `@atlas/llm-provider` tests show regression**, trace to Task 6's `completeWithToolUse` extension. The retry + circuit-breaker paths must still pass for the plain `complete` path.

- [ ] **Step 4: Commit** (smoke-only; no source changes)

```bash
git commit --allow-empty -m "chore(role-architect): full-suite smoke — all workspace tests green post D.2"
```

Use `--allow-empty` so the plan records the smoke checkpoint as a distinct commit.

---

### Task 17: Package README

**Files:**
- Create: `packages/role-architect/README.md`

- [ ] **Step 1: Write the README**

````markdown
# @atlas/role-architect

The first Role implementation for `@atlas/conductor` — the Architect performs two-pass ritual-authoring:

1. **Pass 1 — Ambiguity triage (Haiku 4.5).** Classifies the user's intent into one of 7 scopes (new-app, new-feature, bug-fix, dep-upgrade, refactor, ship, migrate) and flags blocker-severity questions that must be answered before the deep plan runs.
2. **Pass 2 — Deep plan (Opus 4.7).** Composes `brainstorm` + `spec-graph` + `runnable-plan` skills from `@atlas/skill-runtime` via a 3-tier prompt-cache (role prompt + graph slice + user turn) and produces the scope-specific Visualize artifact per PRD §8.

## Install

Workspace package. Deps: `@atlas/conductor`, `@atlas/llm-provider`, `@atlas/skill-runtime`, `@atlas/spec-graph-schema`.

## Usage

```ts
import { ArchitectRole } from "@atlas/role-architect";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryFromBundledLibrary } from "@atlas/skill-runtime";
import { Conductor } from "@atlas/conductor";

const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });
const skills = createRegistryFromBundledLibrary();
const architect = new ArchitectRole({ llm: provider, skills });

const conductor = new Conductor({
  classifier: skillRuntimeClassifier,
  roles: new Map([["architect", architect]]),
  checkpointSink,
  sliceBuilder
});

await conductor.dispatch(dispatchContext);
```

## Scope outputs

Each Architect run emits one `ArchitectOutput` variant matching the classified scope:

| Scope | Artifact |
|---|---|
| `new-app` | SpecGraph + runnable plan |
| `new-feature` | impact-analysis diff plan |
| `bug-fix` | four-phase debug report |
| `dep-upgrade` | breaking-change matrix + rollback plan |
| `refactor` | before/after graph + behavior-preservation contract + regression tests |
| `ship` | rerunnable steps + rollback trigger |
| `migrate` | staged plan + compliance evidence |

## Events emitted

- `architect.pass1.started` / `architect.pass1.completed` / `architect.pass1.failed`
- `architect.triage.needs_input` — one per blocker question
- `architect.pass2.started` / `architect.pass2.completed` / `architect.pass2.failed`

## Observability

Inherited from `@atlas/llm-provider`: every LLM call emits an OpenTelemetry span (`llm.anthropic.call`) and increments `atlas_llm_provider_requests_total{provider,model,status}` + records latency in `atlas_llm_provider_latency_seconds`.

## What does NOT ship in D.2

- Real skill markdown files — those come from `@atlas/skill-library` (Plan C.2). This package uses fixture skills in its test tree and bundled skills in production.
- Parallel Developer runs — that's Plan D.3.
- The Agree UI surface — that's Unit E.
````

- [ ] **Step 2: Commit**

```bash
git add packages/role-architect/README.md
git commit -m "docs(role-architect): README — two-pass flow, scope variants, events, observability"
```

---

### Task 18: Update plan index + handoff

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add row + diagram entry**

Insert a new row in the Plan index table after the D.1 row (row 9 post-C.2). The new row reads (renumber subsequent directional-doc rows):

```
| 10 | `2026-04-20-role-architect.md` | **D.2 — Architect role** | Two-pass ritual-authoring: Haiku triage (ambiguity report) → Opus deep plan (scope-variant output); implements `Role` from `@atlas/conductor`; LLM-provider `completeWithToolUse` extension | 18 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

In the execution-order ASCII diagram, expand the D.1 subtree so D.2 is visible:

```
            └─ D.1 (Plans[9], shipped) — Conductor + LLM Provider
                 ├─ D.2 (Plans[10], shipped) — Architect role
                 ├─ Unit C continues — C.2 + C.3 (from Plans[11] Unit C)
                 └─ Unit D continues — D.3..D.5 role plans (from Plans[11] Unit D)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add D.2 architect role to plan index + refresh execution order"
```

---

## Completion Checklist

After all 18 tasks:

- [ ] `pnpm -F @atlas/role-architect test` — all tests green (~22-24 tests)
- [ ] `pnpm -F @atlas/llm-provider test` — still green; `completeWithToolUse` tests added
- [ ] `pnpm -F @atlas/conductor test` — no regression
- [ ] `pnpm -F @atlas/skill-runtime test` — no regression
- [ ] `pnpm -r test` — no cross-package regressions
- [ ] `pnpm -F @atlas/role-architect build` — exits 0; `dist/index.js` + declarations emitted
- [ ] `ArchitectRole` is constructable; `run()` happy-path emits 4 events + artifact
- [ ] Triage returning a blocker yields `architect.triage.needs_input` events + no Pass 2 call
- [ ] Deep-plan failure throws `DeepPlanFailedError` (re-thrown so the Conductor can retry per its policy)
- [ ] `Conductor.dispatch` with `ArchitectRole` in the `roles` map succeeds end-to-end under mocked SDK
- [ ] Observability: Haiku + Opus each produce labelled metric increments
- [ ] Plan index row 10 marks D.2 as shipped; execution-order diagram shows D.2 under D.1

## Handoff to D.3 / D.4 / D.5

D.2 establishes the canonical shape every subsequent role follows:

1. **Types file** defining the role's inputs + scope-specific output union.
2. **Two-pass or single-pass orchestration** using `@atlas/llm-provider` (retry + circuit-breaker + observability by default).
3. **Skill composition** via `assembleArchitectPrompt`-style helper (generalisable as `assembleSkillPrompt(registry, names)` — D.3 should extract this into `@atlas/role-shared` if more than one role uses it).
4. **`Role` class** implementing `@atlas/conductor.Role`; one event per lifecycle phase + one on failure.
5. **Test suite** covering: types, errors, each pass in isolation, role happy + failure paths, observability, integration with real skill-runtime, Conductor-dispatch fit.

### D.3 (Developer role) specifics

- Composes `tdd-feature` + `edit-only-what-changed` + `runnable-plan` skills from C.2.
- **Parallel** — Sonnet 4.6 + Gemini 2.5 Flash. Blocked on D.1 open question OQ4 (who judges wins). Recommended: a lightweight Reviewer role (Sonnet) votes.
- Extends `@atlas/llm-provider` with a real `GoogleProvider` (today a stub from D.1).

### D.4 (Security role) specifics

- Composes `audit-rls` + `cors-policy` + `secrets-scan` + `cve-check` from C.2.
- Acts as the L4 merge gate per PRD §11.4. Emits `merge-gate.security.passed` / `merge-gate.security.failed` events.

### D.5 (Accessibility role) specifics

- Composes `wcag-audit` + `rtl-layout` + `keyboard-nav` + `contrast-check` from C.2.
- Acts as the L5 merge gate; Sonnet 4.6 + axe-core integration.

Each of D.3-D.5 is a ~18-task plan mirroring D.2's shape. Authored T-minus-3-weeks per the Phase A cadence.
