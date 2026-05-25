# Plan E — `tests` Artifact Kind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `tests` artifact kind so workflows can now produce tested apps. v1 supports Playwright e2e against an upstream frontend node; Vitest unit and pytest backend variants are scaffolded in the schema but their roles ship in later plans.

**Architecture:** A new `packages/role-tester` package. Pass 1 reads upstream artifacts to decide what specs to write (e.g., for each frontend page → one Playwright spec). Pass 2 emits the spec files via tool_use. The producing role then provisions a dedicated test sandbox that installs Playwright + runs against the upstream frontend's `previewUrl`, recording pass/fail per spec into the `TestsArtifact`. A new `TestResultsRenderer` surfaces results in the per-node drill-in.

**Tech Stack:** Same. Inside the test sandbox: Playwright (`@playwright/test`) on Node — already a familiar dep in atlas-web. No new top-level deps.

**Spec reference:** Section 4, Section 10 (`tests` row).

**Depends on:** Plans A + B + C + D merged.

---

## File Structure

### New package: `packages/role-tester/`

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Scaffold (mirror Plan A Task 1) |
| `src/index.ts` | Exports `TesterRole`, types |
| `src/types.ts` | `TestsArtifactSchema`, `TestSpecSchema`, `TestResultsSchema` |
| `src/role.ts` | `TesterRole implements Role` |
| `src/pass1-plan-specs.ts` | LLM call: decide which specs to write given upstream artifacts |
| `src/pass2-emit-specs.ts` | LLM call: emit the spec files via tool_use |
| `src/run-specs-in-sandbox.ts` | Provisions test sandbox, installs Playwright, runs `playwright test --reporter=json`, parses results |
| `src/types-results.ts` | Helpers for parsing Playwright's JSON reporter output |
| `test/role.test.ts` | Stub LLM; verifies event emissions |
| `test/run-specs-in-sandbox.test.ts` | Mock E2B; verify command sequence |

### New
| Path | Responsibility |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/tests.ts` | `TestsArtifactSchema` (mirrors source-of-truth in `role-tester` for engine-side validation) |
| `apps/atlas-web/components/workflow/renderers/TestResultsRenderer.tsx` | Per-node renderer: pass/fail grid, click failure → see assertion + last error |

### Modifications
| File | Change |
|---|---|
| `apps/atlas-web/lib/engine/factory.ts` | Register `TesterRole` |
| `packages/role-workflow-planner/src/synthesize-dag.ts` | Update DAG-synthesis prompt to know `tests` kind exists; teach it when to add a tests node (e.g., whenever a frontend or backend kind is present and the user didn't opt out) |
| `apps/atlas-web/components/canvas/register-renderers.ts` | Replace tests stub with `TestResultsRenderer` |
| `apps/atlas-web/e2e/tests/workflow-with-tests.spec.ts` | New |

---

## Tasks

### Task 1: TestsArtifactSchema

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/tests.ts`
- Test: `packages/workflow-engine/test/artifact-contracts-tests.test.ts`

- [ ] **Step 1: Implement**

```ts
// packages/workflow-engine/src/artifact-contracts/tests.ts
import { z } from "zod";

export const TestSpecSchema = z.object({
  file: z.string().min(1),
  targets: z.array(z.string()).default([])  // nodeIds tested
});

export const TestResultSchema = z.object({
  specFile: z.string(),
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  failureMessage: z.string().optional()
});

export const TestsArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("tests"),
  framework: z.enum(["playwright", "vitest", "pytest"]),
  specs: z.array(TestSpecSchema).min(1),
  results: z.array(TestResultSchema),
  coverage: z.object({ lines: z.number(), branches: z.number() }).optional()
});
export type TestsArtifact = z.infer<typeof TestsArtifactSchema>;
```

- [ ] **Step 2: Register + commit**

```ts
// packages/workflow-engine/src/artifact-contracts/index.ts (add)
import { TestsArtifactSchema } from "./tests.js";
ArtifactContractRegistry.register("tests", TestsArtifactSchema);
export { TestsArtifactSchema };
```

```bash
git add packages/workflow-engine/src/artifact-contracts/tests.ts packages/workflow-engine/src/artifact-contracts/index.ts packages/workflow-engine/test/artifact-contracts-tests.test.ts
git commit -m "feat(workflow-engine): TestsArtifactSchema (v1) + registry"
```

---

### Task 2: Scaffold packages/role-tester

Mirror Plan A Task 1 with deps:

```json
{
  "name": "@atlas/role-tester",
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/workflow-engine": "workspace:*",
    "@atlas/sandbox-e2b": "workspace:*",
    "zod": "^3.23.0"
  }
}
```

- [ ] Scaffold + commit (`feat(role-tester): scaffold package skeleton`)

---

### Task 3: pass1-plan-specs

**Files:**
- Create: `packages/role-tester/src/pass1-plan-specs.ts`
- Test: `packages/role-tester/test/pass1-plan-specs.test.ts`

Pass 1 LLM call. System prompt: given upstream artifact summaries (frontend pages, backend routes), return a list of test specs to write.

Tool schema:
```ts
const PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    framework: { type: "string", enum: ["playwright", "vitest", "pytest"] },
    plannedSpecs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          summary: { type: "string" },
          targets: { type: "array", items: { type: "string" } },
          intent: { type: "string", enum: ["smoke", "happy-path", "error-handling", "accessibility"] }
        },
        required: ["file", "summary", "targets", "intent"]
      }
    }
  },
  required: ["framework", "plannedSpecs"]
};
```

- [ ] Implement + test + commit (`feat(role-tester): pass1 plan-specs LLM call`)

---

### Task 4: pass2-emit-specs

**Files:**
- Create: `packages/role-tester/src/pass2-emit-specs.ts`
- Test: `packages/role-tester/test/pass2-emit-specs.test.ts`

Pass 2 LLM call. For each planned spec, generate the actual `.spec.ts` content via tool_use. Tool output:
```ts
{
  diff: string  // unified diff creating all spec files under tests/
  filesCreated: string[]
  envContract: EnvVar[]  // e.g. PLAYWRIGHT_BASE_URL
}
```

- [ ] Implement + test + commit (`feat(role-tester): pass2 emit-specs LLM call`)

---

### Task 5: run-specs-in-sandbox

**Files:**
- Create: `packages/role-tester/src/run-specs-in-sandbox.ts`
- Test: `packages/role-tester/test/run-specs-in-sandbox.test.ts` (mock E2B)

- [ ] **Step 1: Implement**

```ts
// run-specs-in-sandbox.ts
import type { SandboxExec } from "@atlas/sandbox-e2b";

export interface RunSpecsInput {
  diff: string;                        // the specs to write into the sandbox
  framework: "playwright" | "vitest" | "pytest";
  baseUrl: string;                     // upstream frontend's previewUrl
  sandbox: SandboxExec;
}

export interface SpecRunResult {
  specFile: string;
  passed: boolean;
  durationMs: number;
  failureMessage?: string;
}

export async function runSpecsInSandbox(input: RunSpecsInput): Promise<SpecRunResult[]> {
  // 1. Apply the diff (creates the spec files inside the test sandbox)
  await input.sandbox.runCommand({ cmd: "mkdir -p /workspace/tests", timeoutMs: 10_000 });
  // (Atlas's apply-diff helper handles diff application; reuse it.)
  await applyDiffInSandbox(input.sandbox, input.diff);

  // 2. Install runner
  if (input.framework === "playwright") {
    await input.sandbox.runCommand({ cmd: "cd /workspace && npm i -D @playwright/test", timeoutMs: 120_000 });
    await input.sandbox.runCommand({ cmd: "cd /workspace && npx playwright install --with-deps chromium", timeoutMs: 180_000 });
  } else if (input.framework === "vitest") {
    await input.sandbox.runCommand({ cmd: "cd /workspace && npm i -D vitest", timeoutMs: 120_000 });
  } else if (input.framework === "pytest") {
    await input.sandbox.runCommand({ cmd: "pip install pytest", timeoutMs: 60_000 });
  }

  // 3. Run with JSON reporter
  let runCmd: string;
  if (input.framework === "playwright") {
    runCmd = `cd /workspace && PLAYWRIGHT_BASE_URL=${shellQuote(input.baseUrl)} npx playwright test --reporter=json`;
  } else if (input.framework === "vitest") {
    runCmd = `cd /workspace && npx vitest run --reporter=json`;
  } else {
    runCmd = `cd /workspace && pytest --json-report tests/`;
  }
  const result = await input.sandbox.runCommand({ cmd: runCmd, timeoutMs: 300_000 });

  // 4. Parse the JSON output
  return parseResultsByFramework(input.framework, result.stdout);
}
```

(`applyDiffInSandbox`, `parseResultsByFramework`, `shellQuote` are small helpers — implementer fleshes them out.)

- [ ] **Step 2: Tests + commit**

Use a mock `SandboxExec` that records `runCommand` calls and returns canned stdout. Verify the right command sequence per framework.

```bash
git add packages/role-tester/src/run-specs-in-sandbox.ts packages/role-tester/test/run-specs-in-sandbox.test.ts
git commit -m "feat(role-tester): run-specs-in-sandbox (playwright/vitest/pytest)"
```

---

### Task 6: TesterRole composition

**Files:**
- Create: `packages/role-tester/src/role.ts`
- Test: `packages/role-tester/test/role.test.ts`

Composes pass1 + pass2 + run-specs into `Role.run()`. Emits:
- `tester.pass1.started` / `pass1.completed`
- `tester.pass2.started` / `pass2.completed`
- `tester.specs.applied`
- `tester.run.started`
- `tester.run.completed` (with results)

Final artifact written via the engine's existing `node_completed` path.

- [ ] Implement + test + commit (`feat(role-tester): TesterRole composes plan+emit+run`)

---

### Task 7: Register in factory + planner awareness

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `packages/role-workflow-planner/src/synthesize-dag.ts` — extend prompt: "When a frontend or backend node is present, default to also adding a `tests` node that depends on them."

- [ ] **Step 1: Register**

```ts
// factory.ts
import { TesterRole } from "@atlas/role-tester";
roles.set("tester", new TesterRole({ llm, sandboxFactory: getSandboxFactory() }));
```

- [ ] **Step 2: Planner prompt update + commit**

```bash
git commit -m "feat(workflow-engine,role-workflow-planner): wire TesterRole; planner adds tests node by default"
```

---

### Task 8: TestResultsRenderer

**Files:**
- Create: `apps/atlas-web/components/workflow/renderers/TestResultsRenderer.tsx`

Renders the `TestsArtifact.results` array as a grid (one row per spec). Pass/fail icon, runtime, click failure to expand the `failureMessage`.

- [ ] Implement + register in canvas-mode-registry (replace Plan C stub) + commit

---

### Task 9: E2E test

**Files:**
- Create: `apps/atlas-web/e2e/tests/workflow-with-tests.spec.ts`

Flow:
1. Cold-start prompt: "Build a landing page with a sign-up form, plus Playwright tests"
2. Planner emits frontend + tests DAG
3. Approve + execute
4. Frontend renders; tests run; results populate
5. Assert: TestResultsRenderer shows results; at least the smoke spec passes

- [ ] Implement + commit

---

## Plan E — Self-review checklist
- [ ] Spec section 4 (TestsArtifact schema) → Task 1
- [ ] Spec section 10 (`tests` row: framework, specs, sandboxed run, results) → Tasks 3, 4, 5, 6
- [ ] Spec section 10 (per-node renderer = results panel) → Task 8
- [ ] Section 10 implicit: planner adds tests node when relevant → Task 7

**Shippable result:** Workflows can produce tested apps. Playwright is the v1 framework; Vitest and pytest variants are scaffolded but their full integration is a follow-up.
