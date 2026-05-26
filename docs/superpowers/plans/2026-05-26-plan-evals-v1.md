# Atlas Evals v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Atlas's per-role eval system — every role's output gets evaluated via a typed Rubric (structural + LLM-judge); failures auto-retry once with feedback embedded in the prompt; second failure escalates with a precise rationale. v1 ships rubrics for Architect + Developer behind `ATLAS_FF_WORKFLOW_EVAL` (default off).

**Architecture:** New `@atlas/eval-runtime` package owns the Rubric interface + shared utilities + the `evals` CLI. Each role package implements its own rubric. The conductor's dispatch loop gains an eval gate that wraps each role attempt with 1 quality-retry distinct from the existing transient retries. Verdicts persist to a new `eval_verdicts` table for audit and offline replay. atlas-web renders a red `EvalFailedCard` in chat when a role escalates.

**Tech Stack:** TypeScript pnpm monorepo, Postgres (Drizzle), Zod, the existing `@atlas/conductor` / `@atlas/llm-provider` / role packages. New package: `@atlas/eval-runtime`.

**Spec reference:** [`docs/superpowers/specs/2026-05-26-evals-design.md`](../specs/2026-05-26-evals-design.md) — Sections 1-4, 6, 7, 8, 9. Workflow-level eval (Section 5) is explicitly deferred to a post-Plan-B follow-up.

**Scope-narrowing call-outs (vs full spec):**
- ✅ Per-role evals (Architect + Developer); framework supports others without changes
- ✅ Conductor eval gate + retry-with-feedback
- ✅ Persistence + offline replay CLI
- ✅ Single-ritual UI surface (EvalFailedCard)
- ❌ Workflow-level rubric → defer until Plan B's real workflows exist
- ❌ WorkflowEvalFailedBanner + requestWorkflowFix → defer (workflow-level only)
- ❌ Researcher/Designer/AssetGen rubrics → each gets its own follow-up plan

---

## File Structure

### New package: `packages/eval-runtime/`

| File | Responsibility |
|---|---|
| `package.json` | pnpm manifest, deps on `@atlas/llm-provider`, `@atlas/conductor`, `zod`, `pg` (for CLI) |
| `tsconfig.json` | TS config mirroring other packages |
| `vitest.config.ts` | Test runner config |
| `src/index.ts` | Public exports |
| `src/types.ts` | Zod schemas + types: `JudgeResult`, `StructuralResult`, `EvalFeedback`, `Verdict`, `EvalCase` |
| `src/rubric.ts` | `Rubric<TOutput>` interface |
| `src/feedback.ts` | `formatJudgeFeedback`, `formatStructuralFeedback`, `shouldRetry` pure helpers |
| `src/judge-tool.ts` | Shared OpenAI tool-use schema for judge calls |
| `src/verdict-sink.ts` | `VerdictSink` interface (mock-friendly persistence boundary) |
| `src/cli/build-dataset.ts` | CLI command: build EvalCase JSON from eval_verdicts rows |
| `src/cli/run.ts` | CLI command: replay rubrics against cases, report regressions |
| `src/cli/index.ts` | CLI entry point dispatching to subcommands |
| `cases/architect/.gitkeep` | Starter dataset dir (populated via build-dataset later) |
| `cases/developer/.gitkeep` | Same for developer |
| `test/types.test.ts` | Zod schema tests |
| `test/feedback.test.ts` | Pure helper tests |
| `test/judge-tool.test.ts` | Tool schema validation |

### Persistence

| File | Responsibility |
|---|---|
| `packages/spec-graph-data/src/schema/eval-verdicts.ts` (new) | Drizzle pgTable definition |
| `packages/spec-graph-data/src/repo/eval-verdict.repo.ts` (new) | CRUD methods on eval_verdicts |
| `packages/spec-graph-data/src/index.ts` (modify) | Re-export the new schema + repo |
| `packages/spec-graph-data/drizzle/0010_eval_verdicts.sql` (new) | SQL migration |
| `packages/spec-graph-data/test/eval-verdict.repo.test.ts` (new) | Integration tests against live DB |
| `packages/spec-graph-data/test/helpers.ts` (modify) | Add eval_verdicts to truncate list |

### Conductor integration

| File | Responsibility |
|---|---|
| `packages/conductor/src/errors.ts` (modify) | Add `RoleEvalEscalation` error |
| `packages/conductor/src/conductor.ts` (modify) | Wrap dispatch with eval gate; thread `evalFeedback` into invocations |
| `packages/conductor/src/role.ts` (modify) | Extend `RoleInvocation` with optional `evalFeedback` field |
| `packages/conductor/src/index.ts` (modify) | Re-export new error |
| `packages/conductor/test/eval-gate.test.ts` (new) | Unit tests for the gate (retry, escalate, no-rubric back-compat) |
| `packages/conductor/test/eval-integration.test.ts` (new) | Real-role + stub-LLM integration |

### Per-role rubrics

| File | Responsibility |
|---|---|
| `packages/role-architect/src/rubric.ts` (new) | `architectRubric: Rubric<ArchitectOutput>` |
| `packages/role-architect/src/role.ts` (modify) | Attach rubric to role; thread `evalFeedback` into prompt |
| `packages/role-architect/src/index.ts` (modify) | Re-export rubric |
| `packages/role-architect/test/rubric.test.ts` (new) | Structural + judge unit tests |
| `packages/role-developer/src/rubric.ts` (new) | `developerRubric: Rubric<DeveloperOutput>` |
| `packages/role-developer/src/role.ts` (modify) | Attach rubric; thread `evalFeedback` into prompt |
| `packages/role-developer/src/index.ts` (modify) | Re-export rubric |
| `packages/role-developer/test/rubric.test.ts` (new) | Structural + judge unit tests |

### atlas-web integration + UI

| File | Responsibility |
|---|---|
| `apps/atlas-web/lib/feature-flags.ts` (modify) | Add `evals` flag |
| `apps/atlas-web/lib/engine/factory.ts` (modify) | Wire `EvalVerdictRepo` as the conductor's `VerdictSink`; flag-gate rubric activation |
| `apps/atlas-web/lib/events/EventBroker.ts` (modify) | Add `role.eval_escalated` to the broker type union |
| `apps/atlas-web/components/ritual/EvalFailedCard.tsx` (new) | Red card UI for eval escalation |
| `apps/atlas-web/components/ChatPanel.tsx` (modify) | Render `EvalFailedCard` when a `role.eval_escalated` event is in roleEvents |
| `apps/atlas-web/test/components/ritual/EvalFailedCard.test.tsx` (new) | UI unit tests |

### CLI binary registration

| File | Responsibility |
|---|---|
| `packages/eval-runtime/package.json` (modify) | `bin` field exposing the `evals` command |

---

## Tasks

### Task 1: Scaffold `@atlas/eval-runtime` package

**Files:**
- Create: `packages/eval-runtime/package.json`
- Create: `packages/eval-runtime/tsconfig.json`
- Create: `packages/eval-runtime/vitest.config.ts`
- Create: `packages/eval-runtime/src/index.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@atlas/eval-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "bin": {
    "evals": "./dist/cli/index.js"
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/llm-provider": "workspace:*",
    "@atlas/conductor": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
    "pg": "8.13.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@types/pg": "8.11.10",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist", "cases"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: Placeholder `src/index.ts`**

```ts
// Re-exports populated in later tasks.
export {};
```

- [ ] **Step 5: Install + build**

```bash
pnpm install
pnpm --filter @atlas/eval-runtime build
```

Expected: clean build, `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/eval-runtime
git commit -m "feat(eval-runtime): scaffold package skeleton"
```

---

### Task 2: Zod schemas — Verdict, JudgeResult, EvalCase

**Files:**
- Create: `packages/eval-runtime/src/types.ts`
- Test: `packages/eval-runtime/test/types.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/types.test.ts
import { describe, it, expect } from "vitest";
import {
  StructuralResultSchema,
  JudgeResultSchema,
  EvalFeedbackSchema,
  VerdictSchema,
  EvalCaseSchema
} from "../src/types.js";

describe("StructuralResultSchema", () => {
  it("accepts passed=true", () => {
    expect(StructuralResultSchema.safeParse({ passed: true }).success).toBe(true);
  });
  it("accepts passed=false with failures", () => {
    const ok = StructuralResultSchema.safeParse({
      passed: false,
      failures: [{ check: "x", reason: "y" }]
    });
    expect(ok.success).toBe(true);
  });
  it("rejects passed=false with empty failures", () => {
    const bad = StructuralResultSchema.safeParse({ passed: false, failures: [] });
    expect(bad.success).toBe(false);
  });
});

describe("JudgeResultSchema", () => {
  it("accepts a complete judge result", () => {
    const ok = JudgeResultSchema.safeParse({
      passed: false,
      score: 4.5,
      dimensions: [{ name: "intent", score: 3, rationale: "x" }],
      fixableBy: "retry",
      feedback: "Address the missing intent."
    });
    expect(ok.success).toBe(true);
  });
  it("rejects fixableBy outside the union", () => {
    const bad = JudgeResultSchema.safeParse({
      passed: false,
      score: 4,
      dimensions: [{ name: "x", score: 0, rationale: "" }],
      fixableBy: "whatever",
      feedback: "x"
    });
    expect(bad.success).toBe(false);
  });
  it("rejects score outside 0-10", () => {
    const bad = JudgeResultSchema.safeParse({
      passed: true, score: 11, dimensions: [], fixableBy: "retry", feedback: ""
    });
    expect(bad.success).toBe(false);
  });
});

describe("EvalCaseSchema", () => {
  it("accepts a complete case", () => {
    const ok = EvalCaseSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000001",
      roleId: "architect",
      rubricVersion: "architect@1.0.0",
      inputs: { userTurn: "Build a SaaS" },
      output: { scope: "new-app" },
      expected: { passed: true }
    });
    expect(ok.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --filter @atlas/eval-runtime test
```

Expected: FAIL with "Cannot find module ../src/types.js"

- [ ] **Step 3: Implement `src/types.ts`**

```ts
// src/types.ts
import { z } from "zod";

export const StructuralFailureSchema = z.object({
  check: z.string().min(1),
  reason: z.string().min(1)
});
export type StructuralFailure = z.infer<typeof StructuralFailureSchema>;

export const StructuralResultSchema = z.discriminatedUnion("passed", [
  z.object({ passed: z.literal(true) }),
  z.object({
    passed: z.literal(false),
    failures: z.array(StructuralFailureSchema).min(1)
  })
]);
export type StructuralResult = z.infer<typeof StructuralResultSchema>;

export const JudgeDimensionSchema = z.object({
  name: z.string().min(1),
  score: z.number().min(0).max(10),
  rationale: z.string()
});
export type JudgeDimension = z.infer<typeof JudgeDimensionSchema>;

export const JudgeResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(10),
  dimensions: z.array(JudgeDimensionSchema),
  fixableBy: z.enum(["retry", "escalate"]),
  feedback: z.string()
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export const EvalFeedbackSchema = z.object({
  source: z.enum(["structural", "judge"]),
  promptFragment: z.string().min(1),
  failures: z.array(StructuralFailureSchema).optional(),
  dimensions: z.array(JudgeDimensionSchema).optional()
});
export type EvalFeedback = z.infer<typeof EvalFeedbackSchema>;

export const VerdictSchema = z.object({
  ritualId: z.string(),
  roleId: z.string(),
  workflowRunId: z.string().uuid().optional(),
  workflowNodeId: z.string().optional(),
  projectId: z.string().uuid(),
  userId: z.string(),
  attempt: z.number().int().min(1),
  layer: z.enum(["structural", "judge", "workflow"]),
  passed: z.boolean(),
  score: z.number().optional(),
  dimensions: z.array(JudgeDimensionSchema).optional(),
  failures: z.array(StructuralFailureSchema).optional(),
  fixableBy: z.enum(["retry", "escalate"]).optional(),
  feedbackUsed: EvalFeedbackSchema.optional(),
  userTurn: z.string().optional(),
  priorArtifactHash: z.string().optional(),
  outputHash: z.string().optional(),
  rubricVersion: z.string(),
  judgeModel: z.string().optional(),
  judgeInputTokens: z.number().int().nonnegative().optional(),
  judgeOutputTokens: z.number().int().nonnegative().optional(),
  judgeCostUsd: z.number().nonnegative().optional()
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().min(1),
  rubricVersion: z.string().min(1),
  inputs: z.object({
    userTurn: z.string(),
    priorArtifact: z.unknown().optional(),
    graphSlice: z.object({ bytes: z.string(), hash: z.string() }).optional()
  }),
  output: z.unknown(),
  expected: z.object({
    passed: z.boolean(),
    minScore: z.number().min(0).max(10).optional(),
    requiredDimensions: z.array(z.object({
      name: z.string(),
      minScore: z.number().min(0).max(10)
    })).optional()
  }),
  notes: z.string().optional()
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @atlas/eval-runtime test
```

Expected: all schema tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-runtime/src/types.ts packages/eval-runtime/test/types.test.ts
git commit -m "feat(eval-runtime): Zod schemas for Verdict / JudgeResult / EvalCase"
```

---

### Task 3: Rubric interface + judge tool schema

**Files:**
- Create: `packages/eval-runtime/src/rubric.ts`
- Create: `packages/eval-runtime/src/judge-tool.ts`
- Test: `packages/eval-runtime/test/judge-tool.test.ts`

- [ ] **Step 1: Implement `src/rubric.ts`**

```ts
// src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { StructuralResult, JudgeResult } from "./types.js";

export interface Rubric<TOutput> {
  readonly roleId: string;
  readonly version: string;
  readonly judgeModel?: string;

  structural(output: TOutput, inv: RoleInvocation): StructuralResult;
  judge(output: TOutput, inv: RoleInvocation, llm: LLMProvider): Promise<JudgeResult>;
}
```

- [ ] **Step 2: Write the judge-tool test**

```ts
// test/judge-tool.test.ts
import { describe, it, expect } from "vitest";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME } from "../src/judge-tool.js";

describe("judge tool schema", () => {
  it("has the canonical tool name", () => {
    expect(JUDGE_TOOL_NAME).toBe("verdict");
  });
  it("requires passed/score/dimensions/fixableBy/feedback", () => {
    const schema = JUDGE_TOOL_SCHEMA as { required?: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(["passed", "score", "dimensions", "fixableBy", "feedback"])
    );
  });
  it("fixableBy is constrained to retry|escalate", () => {
    const schema = JUDGE_TOOL_SCHEMA as { properties: { fixableBy: { enum: string[] } } };
    expect(schema.properties.fixableBy.enum).toEqual(["retry", "escalate"]);
  });
});
```

- [ ] **Step 3: Implement `src/judge-tool.ts`**

```ts
// src/judge-tool.ts
export const JUDGE_TOOL_NAME = "verdict";

export const JUDGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean", description: "true iff ALL dimensions scored at or above their pass thresholds" },
    score: { type: "number", minimum: 0, maximum: 10, description: "Overall quality score 0-10" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 10 },
          rationale: { type: "string" }
        },
        required: ["name", "score", "rationale"]
      }
    },
    fixableBy: {
      type: "string",
      enum: ["retry", "escalate"],
      description: "'retry' = the role can likely fix this with feedback; 'escalate' = fundamental issue, no retry"
    },
    feedback: {
      type: "string",
      description: "Specific, actionable feedback the role's next attempt should address"
    }
  },
  required: ["passed", "score", "dimensions", "fixableBy", "feedback"]
} as const;
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter @atlas/eval-runtime test
git add packages/eval-runtime/src/rubric.ts packages/eval-runtime/src/judge-tool.ts packages/eval-runtime/test/judge-tool.test.ts
git commit -m "feat(eval-runtime): Rubric interface + shared judge tool schema"
```

---

### Task 4: Feedback formatters + shouldRetry helper

**Files:**
- Create: `packages/eval-runtime/src/feedback.ts`
- Test: `packages/eval-runtime/test/feedback.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/feedback.test.ts
import { describe, it, expect } from "vitest";
import { formatStructuralFeedback, formatJudgeFeedback, shouldRetry } from "../src/feedback.js";

describe("formatStructuralFeedback", () => {
  it("renders failures as a bullet list", () => {
    const fb = formatStructuralFeedback({
      passed: false,
      failures: [
        { check: "plan_has_tasks", reason: "tasks empty" },
        { check: "scope_present", reason: "missing scope" }
      ]
    });
    expect(fb.source).toBe("structural");
    expect(fb.promptFragment).toContain("plan_has_tasks");
    expect(fb.promptFragment).toContain("scope_present");
    expect(fb.failures?.length).toBe(2);
  });
});

describe("formatJudgeFeedback", () => {
  it("includes failed dimensions only", () => {
    const fb = formatJudgeFeedback({
      passed: false,
      score: 5,
      dimensions: [
        { name: "intent", score: 3, rationale: "missed billing" },
        { name: "feasibility", score: 8, rationale: "ok" }
      ],
      fixableBy: "retry",
      feedback: "Address billing"
    }, { passThreshold: 6 });
    expect(fb.promptFragment).toContain("intent");
    expect(fb.promptFragment).toContain("missed billing");
    expect(fb.promptFragment).not.toContain("feasibility");
  });
});

describe("shouldRetry", () => {
  it("structural failed + qualityAttempt=1 → retry", () => {
    expect(shouldRetry(
      { passed: false, failures: [{ check: "x", reason: "y" }] },
      null,
      1
    )).toBe(true);
  });
  it("judge failed with fixableBy=escalate → no retry", () => {
    expect(shouldRetry(
      { passed: true },
      { passed: false, score: 3, dimensions: [], fixableBy: "escalate", feedback: "" },
      1
    )).toBe(false);
  });
  it("everything passed → no retry", () => {
    expect(shouldRetry(
      { passed: true },
      { passed: true, score: 9, dimensions: [], fixableBy: "retry", feedback: "" },
      1
    )).toBe(false);
  });
  it("qualityAttempt=2 → no retry regardless", () => {
    expect(shouldRetry(
      { passed: false, failures: [{ check: "x", reason: "y" }] },
      null,
      2
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/feedback.ts`**

```ts
// src/feedback.ts
import type { StructuralResult, JudgeResult, EvalFeedback } from "./types.js";

export function formatStructuralFeedback(result: StructuralResult): EvalFeedback {
  if (result.passed) {
    throw new Error("formatStructuralFeedback called on passed result");
  }
  const lines = result.failures.map((f) => `- ${f.check}: ${f.reason}`);
  return {
    source: "structural",
    promptFragment:
      `## Previous-attempt feedback\nYour previous output failed these structural checks:\n${lines.join("\n")}\nAddress each point. Do not repeat the same gap.`,
    failures: result.failures
  };
}

export function formatJudgeFeedback(
  result: JudgeResult,
  opts: { passThreshold: number }
): EvalFeedback {
  const failed = result.dimensions.filter((d) => d.score < opts.passThreshold);
  const lines = failed.map(
    (d) => `- ${d.name} (${d.score}/10): ${d.rationale}`
  );
  const tail = result.feedback ? `\n\nJudge guidance: ${result.feedback}` : "";
  return {
    source: "judge",
    promptFragment:
      `## Previous-attempt feedback\nYour previous output failed these quality dimensions:\n${lines.join("\n")}${tail}\nAddress each dimension. Do not repeat the same gap.`,
    dimensions: failed
  };
}

export function shouldRetry(
  structural: StructuralResult,
  judge: JudgeResult | null,
  qualityAttempt: number
): boolean {
  if (qualityAttempt >= 2) return false;
  if (!structural.passed) return true;
  if (judge && !judge.passed && judge.fixableBy === "retry") return true;
  return false;
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @atlas/eval-runtime test
git add packages/eval-runtime/src/feedback.ts packages/eval-runtime/test/feedback.test.ts
git commit -m "feat(eval-runtime): formatStructuralFeedback / formatJudgeFeedback / shouldRetry helpers"
```

---

### Task 5: VerdictSink interface + InMemoryVerdictSink + exports

**Files:**
- Create: `packages/eval-runtime/src/verdict-sink.ts`
- Modify: `packages/eval-runtime/src/index.ts`
- Test: `packages/eval-runtime/test/verdict-sink.test.ts`

- [ ] **Step 1: Implement `src/verdict-sink.ts`**

```ts
// src/verdict-sink.ts
import type { Verdict } from "./types.js";

export interface VerdictSink {
  write(verdict: Verdict): Promise<void>;
}

/** In-memory implementation for unit tests; production wiring uses EvalVerdictRepo. */
export class InMemoryVerdictSink implements VerdictSink {
  readonly verdicts: Verdict[] = [];
  async write(verdict: Verdict): Promise<void> {
    this.verdicts.push(verdict);
  }
  clear(): void {
    this.verdicts.length = 0;
  }
}
```

- [ ] **Step 2: Quick smoke test**

```ts
// test/verdict-sink.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryVerdictSink } from "../src/verdict-sink.js";

describe("InMemoryVerdictSink", () => {
  it("collects verdicts", async () => {
    const sink = new InMemoryVerdictSink();
    await sink.write({
      ritualId: "r1", roleId: "architect", projectId: "00000000-0000-0000-0000-000000000001",
      userId: "u", attempt: 1, layer: "structural", passed: true, rubricVersion: "architect@1.0.0"
    });
    expect(sink.verdicts).toHaveLength(1);
    sink.clear();
    expect(sink.verdicts).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Update `src/index.ts` with all public exports**

```ts
// src/index.ts
export * from "./types.js";
export * from "./rubric.js";
export * from "./feedback.js";
export * from "./judge-tool.js";
export * from "./verdict-sink.js";
```

- [ ] **Step 4: Verify build + tests**

```bash
pnpm --filter @atlas/eval-runtime build
pnpm --filter @atlas/eval-runtime test
```

Expected: clean build; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-runtime
git commit -m "feat(eval-runtime): VerdictSink + InMemoryVerdictSink + barrel exports"
```

---

### Task 6: Drizzle schema for `eval_verdicts`

**Files:**
- Create: `packages/spec-graph-data/src/schema/eval-verdicts.ts`
- Modify: `packages/spec-graph-data/src/schema/index.ts`

- [ ] **Step 1: Write the schema**

```ts
// packages/spec-graph-data/src/schema/eval-verdicts.ts
import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const evalVerdicts = pgTable(
  "eval_verdicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ritualId: text("ritual_id").notNull(),
    roleId: text("role_id").notNull(),
    workflowRunId: uuid("workflow_run_id"),
    workflowNodeId: text("workflow_node_id"),
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
    attempt: integer("attempt").notNull(),
    layer: text("layer").notNull(),
    passed: boolean("passed").notNull(),
    score: numeric("score", { precision: 4, scale: 2 }),
    dimensions: jsonb("dimensions"),
    failures: jsonb("failures"),
    fixableBy: text("fixable_by"),
    feedbackUsed: jsonb("feedback_used"),
    userTurn: text("user_turn"),
    priorArtifactHash: text("prior_artifact_hash"),
    outputHash: text("output_hash"),
    rubricVersion: text("rubric_version").notNull(),
    judgeModel: text("judge_model"),
    judgeInputTokens: integer("judge_input_tokens"),
    judgeOutputTokens: integer("judge_output_tokens"),
    judgeCostUsd: numeric("judge_cost_usd", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxRitual: index("idx_eval_verdicts_ritual").on(t.ritualId, t.createdAt),
    idxRole: index("idx_eval_verdicts_role").on(t.roleId, t.passed, t.createdAt),
    idxWorkflow: index("idx_eval_verdicts_workflow").on(t.workflowRunId, t.workflowNodeId),
    idxProject: index("idx_eval_verdicts_project").on(t.projectId, t.createdAt),
    idxReplay: index("idx_eval_verdicts_replay").on(t.roleId, t.priorArtifactHash)
  })
);

export type EvalVerdictRow = typeof evalVerdicts.$inferSelect;
export type NewEvalVerdictRow = typeof evalVerdicts.$inferInsert;
```

- [ ] **Step 2: Append re-export to `schema/index.ts`**

```ts
// packages/spec-graph-data/src/schema/index.ts (append)
export * from "./eval-verdicts.js";
```

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @atlas/spec-graph-data build
git add packages/spec-graph-data/src/schema/eval-verdicts.ts packages/spec-graph-data/src/schema/index.ts
git commit -m "feat(spec-graph-data): Drizzle schema for eval_verdicts"
```

---

### Task 7: SQL migration `0010_eval_verdicts.sql`

**Files:**
- Create: `packages/spec-graph-data/drizzle/0010_eval_verdicts.sql`

- [ ] **Step 1: Write migration**

```sql
-- packages/spec-graph-data/drizzle/0010_eval_verdicts.sql
create table if not exists eval_verdicts (
  id uuid primary key default gen_random_uuid(),
  ritual_id text not null,
  role_id text not null,
  workflow_run_id uuid,
  workflow_node_id text,
  project_id uuid not null,
  user_id text not null,
  attempt integer not null,
  layer text not null,
  passed boolean not null,
  score numeric(4,2),
  dimensions jsonb,
  failures jsonb,
  fixable_by text,
  feedback_used jsonb,
  user_turn text,
  prior_artifact_hash text,
  output_hash text,
  rubric_version text not null,
  judge_model text,
  judge_input_tokens integer,
  judge_output_tokens integer,
  judge_cost_usd numeric(8,4),
  created_at timestamptz not null default now()
);

create index if not exists idx_eval_verdicts_ritual on eval_verdicts (ritual_id, created_at);
create index if not exists idx_eval_verdicts_role on eval_verdicts (role_id, passed, created_at);
create index if not exists idx_eval_verdicts_workflow on eval_verdicts (workflow_run_id, workflow_node_id);
create index if not exists idx_eval_verdicts_project on eval_verdicts (project_id, created_at);
create index if not exists idx_eval_verdicts_replay on eval_verdicts (role_id, prior_artifact_hash);
```

- [ ] **Step 2: Apply migration to local DB**

```bash
pnpm --filter @atlas/spec-graph-data run db:psql -f packages/spec-graph-data/drizzle/0010_eval_verdicts.sql
pnpm --filter @atlas/spec-graph-data run db:psql -c "\d eval_verdicts"
```

Expected: `\d` shows all 23 columns + 5 indexes.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-data/drizzle/0010_eval_verdicts.sql
git commit -m "feat(migrations): 0010 — eval_verdicts table"
```

---

### Task 8: `EvalVerdictRepo` + truncate helper

**Files:**
- Create: `packages/spec-graph-data/src/repo/eval-verdict.repo.ts`
- Modify: `packages/spec-graph-data/src/index.ts` (export the repo)
- Modify: `packages/spec-graph-data/test/helpers.ts` (add `eval_verdicts` to TRUNCATE)
- Test: `packages/spec-graph-data/test/eval-verdict.repo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/spec-graph-data/test/eval-verdict.repo.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { EvalVerdictRepo, type NewEvalVerdictRow } from "../src/index.js";
import { truncateAllTables, seedProject } from "./helpers.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://atlas:atlas@localhost:5440/atlas_dev";
const pool = new Pool({ connectionString: DATABASE_URL });
const repo = new EvalVerdictRepo(pool);

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await truncateAllTables(pool); });

function baseRow(overrides: Partial<NewEvalVerdictRow> = {}): NewEvalVerdictRow {
  return {
    ritualId: "r-1",
    roleId: "architect",
    projectId: "00000000-0000-0000-0000-00000000aaaa",
    userId: "u1",
    attempt: 1,
    layer: "structural",
    passed: true,
    rubricVersion: "architect@1.0.0",
    ...overrides
  };
}

describe("EvalVerdictRepo", () => {
  it("insert + findByRitual round-trip", async () => {
    await seedProject(pool, "00000000-0000-0000-0000-00000000aaaa");
    const inserted = await repo.insert(baseRow());
    expect(inserted.id).toBeTruthy();
    const rows = await repo.findByRitual("r-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roleId).toBe("architect");
  });

  it("findFailuresForRole returns only failed verdicts", async () => {
    await seedProject(pool, "00000000-0000-0000-0000-00000000aaaa");
    await repo.insert(baseRow({ passed: true }));
    await repo.insert(baseRow({ ritualId: "r-2", passed: false, failures: [{ check: "x", reason: "y" }] }));
    const failures = await repo.findFailuresForRole("architect", 10);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.ritualId).toBe("r-2");
  });

  it("findUniqueByInputHash dedupes by (role, hash, userTurn)", async () => {
    await seedProject(pool, "00000000-0000-0000-0000-00000000aaaa");
    await repo.insert(baseRow({ priorArtifactHash: "h1", userTurn: "Build X" }));
    await repo.insert(baseRow({ priorArtifactHash: "h1", userTurn: "Build X", ritualId: "r-2" }));
    await repo.insert(baseRow({ priorArtifactHash: "h2", userTurn: "Build X", ritualId: "r-3" }));
    const rows = await repo.findUniqueByInputHash("architect", "h1", "Build X");
    expect(rows).toHaveLength(2); // two rows with same hash+userTurn
  });
});
```

- [ ] **Step 2: Implement `src/repo/eval-verdict.repo.ts`**

```ts
// packages/spec-graph-data/src/repo/eval-verdict.repo.ts
import { and, desc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  evalVerdicts,
  type EvalVerdictRow,
  type NewEvalVerdictRow
} from "../schema/eval-verdicts.js";

export class EvalVerdictRepo {
  private db: ReturnType<typeof drizzle>;
  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async insert(input: NewEvalVerdictRow): Promise<EvalVerdictRow> {
    const [row] = await this.db.insert(evalVerdicts).values(input).returning();
    return row!;
  }

  async findByRitual(ritualId: string): Promise<EvalVerdictRow[]> {
    return this.db
      .select()
      .from(evalVerdicts)
      .where(eq(evalVerdicts.ritualId, ritualId))
      .orderBy(desc(evalVerdicts.createdAt));
  }

  async findFailuresForRole(roleId: string, limit: number): Promise<EvalVerdictRow[]> {
    return this.db
      .select()
      .from(evalVerdicts)
      .where(and(eq(evalVerdicts.roleId, roleId), eq(evalVerdicts.passed, false)))
      .orderBy(desc(evalVerdicts.createdAt))
      .limit(limit);
  }

  async findUniqueByInputHash(
    roleId: string,
    priorArtifactHash: string,
    userTurn: string
  ): Promise<EvalVerdictRow[]> {
    return this.db
      .select()
      .from(evalVerdicts)
      .where(and(
        eq(evalVerdicts.roleId, roleId),
        eq(evalVerdicts.priorArtifactHash, priorArtifactHash),
        eq(evalVerdicts.userTurn, userTurn)
      ));
  }
}
```

- [ ] **Step 3: Append exports + truncate**

```ts
// packages/spec-graph-data/src/index.ts (append)
export { EvalVerdictRepo } from "./repo/eval-verdict.repo.js";
```

```ts
// packages/spec-graph-data/test/helpers.ts (modify truncateAllTables list to include "eval_verdicts")
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @atlas/spec-graph-data build
pnpm --filter @atlas/spec-graph-data test eval-verdict.repo
git add packages/spec-graph-data/src/repo/eval-verdict.repo.ts packages/spec-graph-data/src/index.ts packages/spec-graph-data/test/eval-verdict.repo.test.ts packages/spec-graph-data/test/helpers.ts
git commit -m "feat(spec-graph-data): EvalVerdictRepo + tests"
```

---

### Task 9: `RoleEvalEscalation` error + `RoleInvocation.evalFeedback`

**Files:**
- Modify: `packages/conductor/src/errors.ts` (add error)
- Modify: `packages/conductor/src/role.ts` (extend invocation)
- Modify: `packages/conductor/src/index.ts` (re-export error)

- [ ] **Step 1: Add the error class**

```ts
// packages/conductor/src/errors.ts (append)
import type { Verdict } from "@atlas/eval-runtime";

export class RoleEvalEscalation extends Error {
  readonly ritualId: string;
  readonly roleId: string;
  readonly layer: "structural" | "judge";
  readonly verdicts: Verdict[];
  readonly attempts: number;

  constructor(input: {
    ritualId: string;
    roleId: string;
    layer: "structural" | "judge";
    verdicts: Verdict[];
    attempts: number;
  }) {
    const dims = input.verdicts[input.verdicts.length - 1]?.dimensions
      ?.filter((d) => d.score < 6)
      .map((d) => `${d.name}=${d.score}/10`)
      .join(", ");
    super(`role ${input.roleId} failed ${input.layer} eval after ${input.attempts} attempts${dims ? ` (${dims})` : ""}`);
    this.name = "RoleEvalEscalation";
    this.ritualId = input.ritualId;
    this.roleId = input.roleId;
    this.layer = input.layer;
    this.verdicts = input.verdicts;
    this.attempts = input.attempts;
  }
}
```

- [ ] **Step 2: Extend `RoleInvocation` with optional `evalFeedback`**

```ts
// packages/conductor/src/role.ts (in RoleInvocation interface)
import type { EvalFeedback } from "@atlas/eval-runtime";

export interface RoleInvocation {
  // ...existing fields
  evalFeedback?: EvalFeedback;
}
```

- [ ] **Step 3: Re-export the error**

```ts
// packages/conductor/src/index.ts (append)
export { RoleEvalEscalation } from "./errors.js";
```

- [ ] **Step 4: Add `@atlas/eval-runtime` dep to conductor**

```bash
pnpm --filter @atlas/conductor add @atlas/eval-runtime
```

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @atlas/conductor build
git add packages/conductor
git commit -m "feat(conductor): RoleEvalEscalation error + RoleInvocation.evalFeedback field"
```

---

### Task 10: Conductor eval gate

**Files:**
- Modify: `packages/conductor/src/conductor.ts`
- Test: `packages/conductor/test/eval-gate.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/conductor/test/eval-gate.test.ts
import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role, RoleEvalEscalation } from "../src/index.js";
import { InMemoryVerdictSink, type Rubric } from "@atlas/eval-runtime";

const personaPrefs = { getPersona: async () => "diego" as const };

function makeRubric(opts: { structuralPass: boolean[]; judgePass: boolean[]; fixableBy?: "retry" | "escalate" }): Rubric<unknown> {
  let i = 0;
  let j = 0;
  return {
    roleId: "test",
    version: "test@1.0.0",
    structural(): any {
      const pass = opts.structuralPass[i++] ?? true;
      return pass ? { passed: true } : { passed: false, failures: [{ check: "x", reason: "y" }] };
    },
    async judge(): Promise<any> {
      const pass = opts.judgePass[j++] ?? true;
      return {
        passed: pass, score: pass ? 9 : 4,
        dimensions: [{ name: "x", score: pass ? 9 : 3, rationale: "" }],
        fixableBy: opts.fixableBy ?? "retry", feedback: "x"
      };
    }
  };
}

describe("Conductor eval gate", () => {
  it("structural pass + judge pass → returns output without retry", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn().mockResolvedValue({ events: [], diff: { kind: "none" } });
    const role: Role = { id: "test", run: runFn, rubric: makeRubric({ structuralPass: [true], judgePass: [true] }) };
    const conductor = makeConductor(role, sink);
    await conductor.dispatch(/* ... */);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(sink.verdicts.filter((v) => v.layer === "judge")).toHaveLength(1);
  });

  it("structural fail attempt 1, pass attempt 2 → retried with evalFeedback", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn().mockResolvedValue({ events: [], diff: { kind: "none" } });
    const role: Role = { id: "test", run: runFn, rubric: makeRubric({ structuralPass: [false, true], judgePass: [true] }) };
    const conductor = makeConductor(role, sink);
    await conductor.dispatch(/* ... */);
    expect(runFn).toHaveBeenCalledTimes(2);
    expect((runFn.mock.calls[1]![0] as any).evalFeedback?.source).toBe("structural");
  });

  it("judge fail with fixableBy=escalate → no retry, throws RoleEvalEscalation", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn().mockResolvedValue({ events: [], diff: { kind: "none" } });
    const role: Role = { id: "test", run: runFn, rubric: makeRubric({ structuralPass: [true], judgePass: [false], fixableBy: "escalate" }) };
    const conductor = makeConductor(role, sink);
    await expect(conductor.dispatch(/* ... */)).rejects.toBeInstanceOf(RoleEvalEscalation);
    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it("no rubric on role → today's behavior, no eval calls", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn().mockResolvedValue({ events: [], diff: { kind: "none" } });
    const role: Role = { id: "test", run: runFn }; // no rubric
    const conductor = makeConductor(role, sink);
    await conductor.dispatch(/* ... */);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(sink.verdicts).toHaveLength(0);
  });
});

// Helper - fills in the dispatch context boilerplate
function makeConductor(role: Role, verdictSink: InMemoryVerdictSink): Conductor {
  // ... constructs Conductor with the role registered, the verdictSink injected,
  // and a stub LLM + classifier + checkpointSink + sliceBuilder.
  // Implementation parallels the pattern in packages/conductor/test/dispatch-happy.test.ts.
}
```

- [ ] **Step 2: Implement the eval gate in `packages/conductor/src/conductor.ts`**

The eval gate wraps the existing transient-retry loop. Pseudocode:

```ts
// Add to ConductorOptions:
verdictSink?: VerdictSink;
llm?: LLMProvider;  // already present somewhere, just confirm

// In dispatch:
let evalFeedback: EvalFeedback | undefined = undefined;
for (let qualityAttempt = 1; qualityAttempt <= 2; qualityAttempt++) {
  const invocation = { ...baseInv, evalFeedback };
  const output = await runWithTransientRetries(role, invocation); // existing logic

  if (!role.rubric || !this.verdictSink) {
    return output; // back-compat
  }

  const structural = role.rubric.structural(output, invocation);
  await this.verdictSink.write(buildStructuralVerdict(structural, qualityAttempt, role, invocation));

  if (!structural.passed) {
    if (shouldRetry(structural, null, qualityAttempt)) {
      evalFeedback = formatStructuralFeedback(structural);
      continue;
    }
    throw new RoleEvalEscalation({ /* ... */ });
  }

  const judge = await role.rubric.judge(output, invocation, this.llm!);
  await this.verdictSink.write(buildJudgeVerdict(judge, qualityAttempt, role, invocation));

  if (!judge.passed) {
    if (shouldRetry(structural, judge, qualityAttempt)) {
      evalFeedback = formatJudgeFeedback(judge, { passThreshold: 6 });
      continue;
    }
    throw new RoleEvalEscalation({ /* ... */ });
  }

  return output;
}
```

- [ ] **Step 3: Add helper functions inline in conductor.ts** for `buildStructuralVerdict` and `buildJudgeVerdict` — they assemble a `Verdict` from the role context.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @atlas/conductor test eval-gate
pnpm --filter @atlas/conductor test  # full suite; no regressions
```

- [ ] **Step 5: Commit**

```bash
git add packages/conductor
git commit -m "feat(conductor): eval gate (1 quality retry, structural+judge, RoleEvalEscalation on second fail)"
```

---

### Task 11: Architect rubric

**Files:**
- Create: `packages/role-architect/src/rubric.ts`
- Modify: `packages/role-architect/src/role.ts` (attach rubric; thread `evalFeedback` into prompt)
- Modify: `packages/role-architect/src/index.ts` (export rubric)
- Test: `packages/role-architect/test/rubric.test.ts`

- [ ] **Step 1: Implement `src/rubric.ts`**

```ts
// packages/role-architect/src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { Rubric, JudgeResult, StructuralResult } from "@atlas/eval-runtime";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME, JudgeResultSchema } from "@atlas/eval-runtime";
import type { ArchitectOutput } from "./types.js";

const VERSION = "architect@1.0.0";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

const SYSTEM_PROMPT = `You are an evaluator for Atlas's Architect role.
Score each dimension 0-10. Pass threshold: every dimension >= 6.
Dimensions:
- intent_coverage: does the plan address what the user asked for?
- specificity: concrete enough for the developer?
- feasibility: achievable in the current sandbox template?
- scope_match: is the scope classification correct?`;

export const architectRubric: Rubric<ArchitectOutput> = {
  roleId: "architect",
  version: VERSION,
  judgeModel: process.env.ATLAS_EVAL_ARCHITECT_MODEL,

  structural(output: ArchitectOutput, _inv: RoleInvocation): StructuralResult {
    const failures: Array<{ check: string; reason: string }> = [];

    if (!output.scope) {
      failures.push({ check: "scope_present", reason: "Missing scope" });
    }
    if (output.scope === "new-app") {
      const tasks = (output as any).runnablePlan?.tasks ?? [];
      if (tasks.length < 1) {
        failures.push({ check: "plan_has_tasks", reason: "runnablePlan.tasks is empty for new-app" });
      }
    }
    const kind = (output as any).canvasManifest?.artifactKind as string | undefined;
    if (kind === "frontend-app" || kind?.startsWith("backend-")) {
      const modes = (output as any).canvasManifest?.modes ?? [];
      if (modes.length < 1) {
        failures.push({ check: "canvas_modes", reason: "canvasManifest has no modes" });
      }
    }
    if (!/^sha256:[0-9a-f]{64}$/.test((output as any).graphSlice?.hash ?? "")) {
      failures.push({ check: "graph_slice_hash", reason: "graphSlice.hash is not sha256" });
    }

    return failures.length === 0 ? { passed: true } : { passed: false, failures };
  },

  async judge(output, inv, llm): Promise<JudgeResult> {
    const userTurn = renderJudgeUserTurn(inv.userTurn, output);
    const result = await (llm as any).completeWithToolUse(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userTurn }
      ],
      {
        model: this.judgeModel ?? DEFAULT_MODEL,
        maxTokens: 1500,
        tools: [{ name: JUDGE_TOOL_NAME, description: "Emit verdict", input_schema: JUDGE_TOOL_SCHEMA }],
        toolChoice: { type: "tool", name: JUDGE_TOOL_NAME }
      }
    );
    return JudgeResultSchema.parse(result.input);
  }
};

function renderJudgeUserTurn(userTurn: string, output: ArchitectOutput): string {
  return `User asked for:\n"""${userTurn}"""\n\nArchitect produced:\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\nScore each dimension 0-10. Return verdict via the 'verdict' tool.`;
}
```

- [ ] **Step 2: Attach to role + thread evalFeedback in `src/role.ts`**

Modify role.run() to:
1. Read `inv.evalFeedback` if present and prepend its `promptFragment` to the user prompt
2. Export `rubric` on the role instance

```ts
// In ArchitectRole.run():
const evalFeedbackPrompt = inv.evalFeedback?.promptFragment ?? "";
// In the deepPlan call: pass evalFeedbackPrompt as an additional user message OR prepend to userTurn.
// Easiest: include in the system or user message body of the LLM call.
```

```ts
// Export from class:
import { architectRubric } from "./rubric.js";
export class ArchitectRole implements Role {
  readonly id = "architect";
  readonly rubric = architectRubric;
  // ...
}
```

- [ ] **Step 3: Test**

```ts
// packages/role-architect/test/rubric.test.ts
import { describe, it, expect, vi } from "vitest";
import { architectRubric } from "../src/rubric.js";

describe("architectRubric.structural", () => {
  it("passes a complete new-app artifact", () => {
    const result = architectRubric.structural({
      scope: "new-app",
      runnablePlan: { tasks: [{ id: "t1", text: "do x" }] },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      canvasManifest: { artifactKind: "frontend-app", modes: [{ id: "designing" }] }
    } as any, /* inv */ {} as any);
    expect(result.passed).toBe(true);
  });

  it("fails empty plan for new-app", () => {
    const result = architectRubric.structural({
      scope: "new-app",
      runnablePlan: { tasks: [] },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    } as any, {} as any);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failures.some((f) => f.check === "plan_has_tasks")).toBe(true);
    }
  });
});

describe("architectRubric.judge", () => {
  it("parses a well-formed judge response", async () => {
    const stubLlm = {
      completeWithToolUse: vi.fn().mockResolvedValue({
        input: {
          passed: true, score: 8.5,
          dimensions: [
            { name: "intent_coverage", score: 9, rationale: "addresses billing" },
            { name: "specificity", score: 8, rationale: "concrete" },
            { name: "feasibility", score: 9, rationale: "ok" },
            { name: "scope_match", score: 8, rationale: "right scope" }
          ],
          fixableBy: "retry",
          feedback: "no changes needed"
        }
      })
    };
    const result = await architectRubric.judge(
      { scope: "new-app" } as any,
      { userTurn: "Build it" } as any,
      stubLlm as any
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(8.5);
  });
});
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @atlas/role-architect build
pnpm --filter @atlas/role-architect test
git add packages/role-architect
git commit -m "feat(role-architect): architect rubric + thread evalFeedback in prompt"
```

---

### Task 12: Developer rubric

Mirror Task 11 for `packages/role-developer/`:

- Create `src/rubric.ts` with the developer rubric (default model: `anthropic/claude-sonnet-4.5` per spec):
  - Structural: `diff_present`, `diff_format` (≥1 `diff --git`), `new_app_page` (page file when scope=new-app), `summary_meaningful` (≥20 chars)
  - Judge dimensions: `plan_adherence`, `completeness`, `syntactic_plausibility`, `no_truncation`
- Modify `src/role.ts` to attach rubric + thread evalFeedback in both anthropicPass and googlePass userTurn assembly
- Export from index
- Test (parallel to Task 11's test)

- [ ] Implement, verify, commit (`feat(role-developer): developer rubric + thread evalFeedback`)

---

### Task 13: Wire `EvalVerdictRepo` as VerdictSink in atlas-web factory

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/lib/feature-flags.ts`

- [ ] **Step 1: Add `evals` feature flag**

```ts
// apps/atlas-web/lib/feature-flags.ts (extend the FeatureFlag union + FLAG_TO_ENV)
| "evals"
// And:
"evals": "ATLAS_FF_EVALS"
```

- [ ] **Step 2: Wire VerdictSink in factory**

```ts
// apps/atlas-web/lib/engine/factory.ts (inside getRitualEngine)
import { EvalVerdictRepo } from "@atlas/spec-graph-data";
import type { VerdictSink, Verdict } from "@atlas/eval-runtime";

// When constructing Conductor:
const evalsEnabled = isFeatureEnabled("evals");
const verdictSink: VerdictSink | undefined = evalsEnabled
  ? {
      async write(verdict: Verdict) {
        const repo = new EvalVerdictRepo(pool);
        await repo.insert({
          ritualId: verdict.ritualId,
          roleId: verdict.roleId,
          ...(verdict.workflowRunId ? { workflowRunId: verdict.workflowRunId } : {}),
          ...(verdict.workflowNodeId ? { workflowNodeId: verdict.workflowNodeId } : {}),
          projectId: verdict.projectId,
          userId: verdict.userId,
          attempt: verdict.attempt,
          layer: verdict.layer,
          passed: verdict.passed,
          ...(verdict.score !== undefined ? { score: String(verdict.score) } : {}),
          dimensions: verdict.dimensions ?? null,
          failures: verdict.failures ?? null,
          ...(verdict.fixableBy ? { fixableBy: verdict.fixableBy } : {}),
          feedbackUsed: verdict.feedbackUsed ?? null,
          ...(verdict.userTurn ? { userTurn: verdict.userTurn } : {}),
          ...(verdict.priorArtifactHash ? { priorArtifactHash: verdict.priorArtifactHash } : {}),
          ...(verdict.outputHash ? { outputHash: verdict.outputHash } : {}),
          rubricVersion: verdict.rubricVersion,
          ...(verdict.judgeModel ? { judgeModel: verdict.judgeModel } : {}),
          ...(verdict.judgeInputTokens !== undefined ? { judgeInputTokens: verdict.judgeInputTokens } : {}),
          ...(verdict.judgeOutputTokens !== undefined ? { judgeOutputTokens: verdict.judgeOutputTokens } : {}),
          ...(verdict.judgeCostUsd !== undefined ? { judgeCostUsd: String(verdict.judgeCostUsd) } : {})
        });
      }
    }
  : undefined;

const conductor = new Conductor({
  // ...existing options
  ...(verdictSink ? { verdictSink } : {})
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter atlas-web run typecheck 2>&1 | tail -5
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web): wire EvalVerdictRepo as conductor VerdictSink (ATLAS_FF_EVALS-gated)"
```

---

### Task 14: `role.eval_escalated` SSE event + engine forwarding

**Files:**
- Modify: `apps/atlas-web/lib/events/EventBroker.ts` (add to type union)
- Modify: `packages/ritual-engine/src/engine.ts` (catch `RoleEvalEscalation`, emit event)
- Modify: `apps/atlas-web/test/lib/events/EventBroker.types.test.ts` (sync expected union)

- [ ] **Step 1: Add event type**

```ts
// apps/atlas-web/lib/events/EventBroker.ts (in the type union)
// Per-role eval escalation: rubric failed twice; ritual cannot proceed.
| "role.eval_escalated"
```

- [ ] **Step 2: Engine forwards on catch**

```ts
// packages/ritual-engine/src/engine.ts (inside _runRitual; wrap conductor.dispatch in a try)
try {
  result = await this.conductor.dispatch(/* ... */);
} catch (err) {
  if (err instanceof RoleEvalEscalation) {
    await this.emit({
      type: "role.eval_escalated",
      ritualId,
      ts: new Date().toISOString(),
      payload: {
        roleId: err.roleId,
        layer: err.layer,
        attempts: err.attempts,
        verdicts: err.verdicts
      }
    });
    // Mark ritual escalated and return; do not continue the pipeline.
    record.state = "escalated";
    return ritualId;
  }
  throw err;
}
```

- [ ] **Step 3: Sync the broker types test**

```ts
// apps/atlas-web/test/lib/events/EventBroker.types.test.ts — add to Expected union:
| "role.eval_escalated"
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter atlas-web run typecheck
pnpm --filter @atlas/ritual-engine test
git add apps/atlas-web/lib/events/EventBroker.ts apps/atlas-web/test/lib/events/EventBroker.types.test.ts packages/ritual-engine/src/engine.ts
git commit -m "feat(ritual-engine,atlas-web): role.eval_escalated SSE event"
```

---

### Task 15: `EvalFailedCard` UI component

**Files:**
- Create: `apps/atlas-web/components/ritual/EvalFailedCard.tsx`
- Modify: `apps/atlas-web/components/ChatPanel.tsx` (render the card when `role.eval_escalated` is present in roleEvents)
- Test: `apps/atlas-web/test/components/ritual/EvalFailedCard.test.tsx`

- [ ] **Step 1: Implement `EvalFailedCard.tsx`**

```tsx
// apps/atlas-web/components/ritual/EvalFailedCard.tsx
"use client";
import type { Verdict } from "@atlas/eval-runtime";

export function EvalFailedCard({
  roleId,
  layer,
  attempts,
  verdicts,
  onRetryWithEdits,
  onRestart
}: {
  roleId: string;
  layer: "structural" | "judge";
  attempts: number;
  verdicts: Verdict[];
  onRetryWithEdits?: (prefill: string) => void;
  onRestart?: () => void;
}) {
  const last = verdicts[verdicts.length - 1];
  const structuralFailures = last?.failures ?? [];
  const failedDims = (last?.dimensions ?? []).filter((d) => d.score < 6);

  return (
    <div data-testid="eval-failed-card" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs">
      <div className="mb-2 font-semibold text-red-900">
        ⚠ {roleId.charAt(0).toUpperCase() + roleId.slice(1)} output failed quality check
      </div>
      {structuralFailures.length > 0 && (
        <>
          <div className="mb-1 text-red-900">Structural failures:</div>
          <ul className="mb-2 list-disc space-y-1 pl-4 text-red-900">
            {structuralFailures.map((f, i) => (
              <li key={i}><span className="font-mono">{f.check}</span>: {f.reason}</li>
            ))}
          </ul>
        </>
      )}
      {failedDims.length > 0 && (
        <>
          <div className="mb-1 text-red-900">Failed dimensions:</div>
          <ul className="mb-2 list-disc space-y-1 pl-4 text-red-900">
            {failedDims.map((d, i) => (
              <li key={i}><span className="font-mono">{d.name}</span> ({d.score}/10): {d.rationale}</li>
            ))}
          </ul>
        </>
      )}
      <div className="text-red-700">Retry attempted once with feedback. Failed both times.</div>
      <div className="mt-2 flex gap-2">
        {onRetryWithEdits && (
          <button
            onClick={() => onRetryWithEdits(buildPrefill(structuralFailures, failedDims))}
            className="rounded-md bg-red-700 px-2 py-1 text-xs font-medium text-white"
          >
            Retry with my edits
          </button>
        )}
        {onRestart && (
          <button
            onClick={onRestart}
            className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-900"
          >
            Edit prompt &amp; restart
          </button>
        )}
      </div>
    </div>
  );
}

function buildPrefill(
  failures: { check: string; reason: string }[],
  dims: { name: string; score: number; rationale: string }[]
): string {
  const lines = [
    "## What went wrong",
    ...failures.map((f) => `- ${f.check}: ${f.reason}`),
    ...dims.map((d) => `- ${d.name} (${d.score}/10): ${d.rationale}`),
    "",
    "## Refining the prompt to address this:",
    ""
  ];
  return lines.join("\n");
}
```

- [ ] **Step 2: Mount in `ChatPanel.tsx`** — In the `ArchitectOutput` component, after the existing per-event renderings, check for a `role.eval_escalated` event in `roleEvents` and render `<EvalFailedCard />` with appropriate handlers (delegate to `onRefine` for retry-with-edits; clear `text` for restart).

- [ ] **Step 3: Test**

```tsx
// apps/atlas-web/test/components/ritual/EvalFailedCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvalFailedCard } from "@/components/ritual/EvalFailedCard";

describe("EvalFailedCard", () => {
  it("renders structural failures", () => {
    render(
      <EvalFailedCard
        roleId="architect"
        layer="structural"
        attempts={2}
        verdicts={[{
          ritualId: "r", roleId: "architect", projectId: "p", userId: "u",
          attempt: 2, layer: "structural", passed: false, rubricVersion: "architect@1.0.0",
          failures: [{ check: "plan_has_tasks", reason: "tasks empty" }]
        } as any]}
      />
    );
    expect(screen.getByTestId("eval-failed-card")).toBeInTheDocument();
    expect(screen.getByText(/plan_has_tasks/)).toBeInTheDocument();
    expect(screen.getByText(/tasks empty/)).toBeInTheDocument();
  });

  it("renders failed judge dimensions only (score < 6)", () => {
    render(
      <EvalFailedCard
        roleId="architect" layer="judge" attempts={2}
        verdicts={[{
          ritualId: "r", roleId: "architect", projectId: "p", userId: "u",
          attempt: 2, layer: "judge", passed: false, rubricVersion: "architect@1.0.0",
          dimensions: [
            { name: "intent_coverage", score: 3, rationale: "missed billing" },
            { name: "feasibility", score: 8, rationale: "ok" }
          ]
        } as any]}
      />
    );
    expect(screen.getByText(/intent_coverage/)).toBeInTheDocument();
    expect(screen.getByText(/missed billing/)).toBeInTheDocument();
    expect(screen.queryByText(/feasibility/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter atlas-web test EvalFailedCard
git add apps/atlas-web/components/ritual/EvalFailedCard.tsx apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/test/components/ritual/EvalFailedCard.test.tsx
git commit -m "feat(atlas-web): EvalFailedCard component + ChatPanel mount"
```

---

### Task 16: `evals` CLI — `run` subcommand

**Files:**
- Create: `packages/eval-runtime/src/cli/index.ts`
- Create: `packages/eval-runtime/src/cli/run.ts`

- [ ] **Step 1: CLI entry point**

```ts
// packages/eval-runtime/src/cli/index.ts
#!/usr/bin/env node
import { runReplay } from "./run.js";
import { buildDataset } from "./build-dataset.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "run":
      await runReplay(rest);
      break;
    case "build-dataset":
      await buildDataset(rest);
      break;
    default:
      console.error(`Usage: evals <run|build-dataset> [options]`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 2: `run` subcommand**

```ts
// packages/eval-runtime/src/cli/run.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalCaseSchema, type EvalCase } from "../types.js";
import type { Rubric } from "../rubric.js";

interface RunOpts {
  role?: string;
  rubricRegistry: Record<string, Rubric<unknown>>;
  llm: any;
  casesDir?: string;
}

export async function runReplay(args: string[], opts?: Partial<RunOpts>): Promise<void> {
  const roleArg = parseArg(args, "--role");
  const casesDir = opts?.casesDir
    ?? join(fileURLToPath(import.meta.url), "..", "..", "..", "cases");

  const rubricRegistry = opts?.rubricRegistry ?? {};
  const llm = opts?.llm;
  if (!llm) {
    throw new Error("runReplay requires an LLM provider (inject via opts.llm)");
  }

  const roleIds = roleArg ? [roleArg] : Object.keys(rubricRegistry);
  let totalPassed = 0, totalRegressed = 0, totalFixed = 0, totalCases = 0;

  for (const roleId of roleIds) {
    const rubric = rubricRegistry[roleId];
    if (!rubric) {
      console.warn(`No rubric registered for role "${roleId}", skipping`);
      continue;
    }
    const dir = join(casesDir, roleId);
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      console.warn(`No cases dir for ${roleId} at ${dir}`);
      continue;
    }

    for (const file of files) {
      const raw = await readFile(join(dir, file), "utf-8");
      let parsed: EvalCase;
      try {
        parsed = EvalCaseSchema.parse(JSON.parse(raw));
      } catch (err) {
        console.error(`Invalid case ${file}:`, err);
        continue;
      }
      if (parsed.rubricVersion !== rubric.version) {
        console.warn(`Case ${file} pinned to ${parsed.rubricVersion}, current is ${rubric.version}; running anyway`);
      }
      totalCases++;
      const structural = rubric.structural(parsed.output, { userTurn: parsed.inputs.userTurn } as any);
      let actualPassed = structural.passed;
      let actualScore: number | undefined;
      if (structural.passed) {
        const judge = await rubric.judge(parsed.output, { userTurn: parsed.inputs.userTurn } as any, llm);
        actualPassed = judge.passed;
        actualScore = judge.score;
      }
      const expectedPassed = parsed.expected.passed;
      if (actualPassed === expectedPassed) {
        if (actualPassed) totalPassed++;
      } else if (expectedPassed && !actualPassed) {
        totalRegressed++;
        console.error(`REGRESSED: ${file} (was passing, now failing)`);
      } else {
        totalFixed++;
        console.log(`FIXED: ${file} (was failing, now passing)`);
      }
      void actualScore;
    }
  }

  console.log(`\n=== Results ===\nTotal: ${totalCases}, Passed: ${totalPassed}, Regressed: ${totalRegressed}, Fixed: ${totalFixed}`);
  if (totalRegressed > 0) {
    process.exit(1);
  }
}

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
```

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @atlas/eval-runtime build
git add packages/eval-runtime/src/cli
git commit -m "feat(eval-runtime): evals run CLI (replay cases against rubrics)"
```

---

### Task 17: `evals build-dataset` subcommand

**Files:**
- Create: `packages/eval-runtime/src/cli/build-dataset.ts`

- [ ] **Step 1: Implement build-dataset**

```ts
// packages/eval-runtime/src/cli/build-dataset.ts
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { EvalVerdictRepo } from "@atlas/spec-graph-data";
import type { EvalCase } from "../types.js";

export async function buildDataset(args: string[]): Promise<void> {
  const roleArg = parseArg(args, "--role");
  const limit = parseInt(parseArg(args, "--limit") ?? "100", 10);
  const casesDir = parseArg(args, "--cases-dir") ?? join(process.cwd(), "packages/eval-runtime/cases");
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://atlas:atlas@localhost:5440/atlas_dev";

  if (!roleArg) {
    console.error("Usage: evals build-dataset --role <roleId> [--limit N] [--cases-dir path]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const repo = new EvalVerdictRepo(pool);
  const rows = await repo.findFailuresForRole(roleArg, limit);

  const seen = new Set<string>();
  let written = 0;
  for (const row of rows) {
    if (!row.priorArtifactHash || !row.outputHash) continue;
    const key = `${row.priorArtifactHash}:${row.outputHash}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = randomUUID();
    const evalCase: EvalCase = {
      id,
      roleId: row.roleId,
      rubricVersion: row.rubricVersion,
      inputs: {
        userTurn: row.userTurn ?? "(missing)"
      },
      output: { /* opaque - reconstructed from row */ },
      expected: { passed: row.passed }
    };

    const fileName = `${id}.json`;
    const dir = join(casesDir, row.roleId);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const path = join(dir, fileName);
    if (existsSync(path)) continue;
    await writeFile(path, JSON.stringify(evalCase, null, 2));
    written++;
  }

  await pool.end();
  console.log(`Built ${written} new cases for role=${roleArg}`);
}

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
```

- [ ] **Step 2: Build + verify**

```bash
pnpm --filter @atlas/eval-runtime build
# Confirm `evals` binary exists:
ls packages/eval-runtime/dist/cli/index.js
```

- [ ] **Step 3: Commit**

```bash
git add packages/eval-runtime/src/cli/build-dataset.ts
git commit -m "feat(eval-runtime): evals build-dataset CLI (cases from eval_verdicts)"
```

---

### Task 18: Starter dataset for Architect + Developer

**Files:**
- Create: `packages/eval-runtime/cases/architect/<5-uuid>.json` × 5 hand-curated cases
- Create: `packages/eval-runtime/cases/developer/<5-uuid>.json` × 5 hand-curated cases

- [ ] **Step 1: Curate 5 architect cases** covering:
  - happy path: clean new-app prompt → expected pass
  - empty plan: artifact with no tasks → expected structural fail
  - scope mismatch: prompt asks for backend but artifact says frontend → expected judge fail (scope_match)
  - missing canvasManifest: frontend-app kind with no modes → expected structural fail
  - vague prompt: "make it nice" → expected judge fail (specificity)

- [ ] **Step 2: Curate 5 developer cases** covering:
  - happy path: complete diff with page.tsx → pass
  - empty diff → structural fail
  - truncated diff (page.tsx missing closing brace) → judge fail (no_truncation)
  - diff doesn't touch a page file for new-app → structural fail
  - summary too short → structural fail

Each case file format:

```json
{
  "id": "<uuid>",
  "roleId": "architect",
  "rubricVersion": "architect@1.0.0",
  "inputs": { "userTurn": "Build a SaaS for habit tracking with billing" },
  "output": { /* full architect artifact */ },
  "expected": { "passed": true, "minScore": 6.5 },
  "notes": "happy path"
}
```

- [ ] **Step 3: Run replay locally to verify each case scores as expected**

```bash
pnpm --filter @atlas/eval-runtime build
# Run with a real (cheap) LLM key set in env:
ATLAS_LLM_BASE_URL=... ATLAS_LLM_API_KEY=... \
  node packages/eval-runtime/dist/cli/index.js run --role architect
```

Expected: all 5 cases score as expected; no regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/eval-runtime/cases
git commit -m "feat(eval-runtime): starter eval dataset (5 architect + 5 developer cases)"
```

---

### Task 19: Conductor integration test (real role + stub LLM)

**Files:**
- Create: `packages/conductor/test/eval-integration.test.ts`

- [ ] **Step 1: Write test**

A real ArchitectRole with a stub LLM scripted as:
- First call: returns an empty `runnablePlan.tasks` → fails structural
- Second call: returns a complete artifact → passes structural + judge (judge is also stubbed to return passing)

Verify:
- `role.run()` is invoked twice
- Second invocation's `inv.evalFeedback.source === "structural"`
- Two verdict rows in `InMemoryVerdictSink` (one structural-fail, one structural-pass + judge-pass)
- No `RoleEvalEscalation` thrown

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @atlas/conductor test eval-integration
git add packages/conductor/test/eval-integration.test.ts
git commit -m "test(conductor): eval-gate integration test (real role + stub LLM, retry-with-feedback)"
```

---

### Task 20: Final verification + smoke test

- [ ] **Step 1: Run full test suite across all affected packages**

```bash
cd F:/claude/ai_builder
pnpm --filter @atlas/eval-runtime test
pnpm --filter @atlas/spec-graph-data test
pnpm --filter @atlas/conductor test
pnpm --filter @atlas/role-architect test
pnpm --filter @atlas/role-developer test
pnpm --filter @atlas/ritual-engine test
pnpm --filter atlas-web test
pnpm --filter atlas-web run typecheck
```

All suites must pass. No regressions.

- [ ] **Step 2: Smoke test in dev (flag ON)**

```bash
ATLAS_FF_EVALS=true pnpm --filter atlas-web dev
```

Trigger a real ritual via the UI. Verify in DB:

```sql
select role_id, layer, passed, score, attempt
from eval_verdicts
where created_at > now() - interval '5 minutes'
order by created_at desc;
```

Expected: rows present for `architect` (structural + judge) + `developer` (structural + judge) verdicts.

- [ ] **Step 3: Smoke test in dev (flag OFF)**

```bash
ATLAS_FF_EVALS=false pnpm --filter atlas-web dev
```

Trigger another ritual. Verify NO new rows in `eval_verdicts` (back-compat path).

- [ ] **Step 4: Confirm `evals run` CLI works locally**

```bash
pnpm --filter @atlas/eval-runtime build
node packages/eval-runtime/dist/cli/index.js run --role architect
```

Expected: 5 starter cases run; exit code 0.

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git status --short  # should be empty
```

---

## Self-Review

### Spec coverage check
- ✅ Section 1 (overview/scope) → reflected in plan goal + scope-narrowing call-outs
- ✅ Section 2 (architecture) → Tasks 1-5 (eval-runtime), Task 9 (RoleInvocation extension), Task 10 (eval gate)
- ✅ Section 3 (per-role rubrics) → Task 11 (architect), Task 12 (developer)
- ✅ Section 4 (conductor integration) → Task 10
- ⛔ Section 5 (workflow-level eval) → DEFERRED per scope-narrowing
- ✅ Section 6 (persistence) → Tasks 6-8 (schema, migration, repo, sink wiring in Task 13)
- ✅ Section 7 (offline replay) → Tasks 16-18 (CLI + starter dataset)
- ✅ Section 8 (UX) → Task 14 (SSE event) + Task 15 (EvalFailedCard); workflow banner deferred
- ✅ Section 9 (testing) → tasks have inline tests + Task 19 integration + Task 20 final

### Placeholder scan
Reviewed — every step has actual code or exact commands. No "TBD/TODO/implement later".

### Type consistency
- `Rubric<TOutput>`, `JudgeResult`, `StructuralResult`, `EvalFeedback`, `Verdict`, `EvalCase` — defined once in Task 2/3, referenced by exact name in Tasks 5/8/9/10/11/12/13/15/16.
- `VerdictSink.write(verdict)` — Task 5 interface, Task 13 implementation, Task 10 consumption.
- `RoleEvalEscalation({ritualId, roleId, layer, verdicts, attempts})` — Task 9 constructor, Task 10 throws, Task 14 catches.
- `ATLAS_FF_EVALS` — Task 13 adds to feature flags; Task 20 toggles for smoke.

All consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-plan-evals-v1.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, two-stage review (spec + code quality) between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
