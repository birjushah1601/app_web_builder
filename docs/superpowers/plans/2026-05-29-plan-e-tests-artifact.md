# Plan E — Tests Artifact Kind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workflow nodes with `artifactKind: "tests"` (consuming a `frontend-app` node) run `role-tester`, which installs Vitest into the frontend sandbox, LLM-generates unit-test files, executes the runner, and emits a typed `TestsArtifact`. The user sees a pass/fail results table in the canvas. Replaces the Plan C `TestsStubCanvas`.

**Architecture:** Reuses every piece Plan D shipped — `ArtifactContractRegistry`, `awaitRitual`, `makeLaunchRitual` upstream merge, the workflow's per-node ritual launch path. New: one Zod schema (`TestsArtifactSchema`), one new role package (`role-tester`), one new canvas renderer (`TestsCanvas`), and a small role-router so tests-kind rituals dispatch `role-tester` instead of `role-architect → role-developer → ...`.

**Tech Stack:** TypeScript pnpm monorepo, Zod 3.23, vitest, `@xyflow/react`-mounted canvas. The frontend sandbox already runs `pnpm` so `pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom` works in-place.

**Spec reference:** `docs/superpowers/specs/2026-05-29-plan-e-tests-artifact-design.md`

**Depends on:** Plans A + B + C + D merged. Branch off current `main` (`2d55d47`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/tests.ts` | `TestsArtifactSchema` + registry registration |
| `packages/workflow-engine/test/artifact-contracts/tests.test.ts` | Schema happy/sad paths |
| `packages/role-tester/package.json` | Workspace package skeleton (deps: zod, @atlas/conductor, @atlas/workflow-engine, @atlas/llm-provider) |
| `packages/role-tester/tsconfig.json` | TS config mirroring role-developer's |
| `packages/role-tester/vitest.config.ts` | Same shape as role-developer's |
| `packages/role-tester/src/index.ts` | Barrel exports |
| `packages/role-tester/src/parse-vitest-json.ts` | Pure: parse `vitest --reporter=json` stdout |
| `packages/role-tester/src/build-artifact.ts` | Pure: assemble TestsArtifact from parse results + spec metadata |
| `packages/role-tester/src/role.ts` | `TestsRole implements Role` — orchestrates install + LLM gen + write + execute + parse + emit |
| `packages/role-tester/test/parse-vitest-json.test.ts` | Vitest JSON fixture tests |
| `packages/role-tester/test/build-artifact.test.ts` | Build helper tests |
| `packages/role-tester/test/role.test.ts` | Role tests with stubbed sandbox + LLM |
| `apps/atlas-web/components/canvas/renderers/TestsCanvas.tsx` | Pass/fail results table |
| `apps/atlas-web/test/components/canvas/renderers/TestsCanvas.test.tsx` | Renderer tests |
| `packages/workflow-engine/test/integration-tests-handoff.test.ts` | End-to-end: tests node consumes frontend, emits TestsArtifact, downstream sees it |

### Modified files
| File | Change |
|---|---|
| `packages/workflow-engine/src/artifact-contracts/index.ts` | Side-effect import of `./tests.js` |
| `apps/atlas-web/lib/engine/factory.ts` | Register `TestsRole` in conductor roles; add per-kind role-router |
| `apps/atlas-web/components/canvas/register-renderers.tsx` | Register `TestsCanvas` for the `test-results` mode ID; remove `TestsStubCanvas` import |

### Deleted files
| File | Reason |
|---|---|
| `apps/atlas-web/components/canvas/renderers/TestsStubCanvas.tsx` | Replaced by `TestsCanvas` |

---

## Tasks

### Task 1: `TestsArtifactSchema` + registry registration

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/tests.ts`
- Create: `packages/workflow-engine/test/artifact-contracts/tests.test.ts`
- Modify: `packages/workflow-engine/src/artifact-contracts/index.ts` — append `import "./tests.js";` at the bottom

- [ ] **Step 1: Write failing test** at `packages/workflow-engine/test/artifact-contracts/tests.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TestsArtifactSchema } from "../../src/artifact-contracts/tests.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/registry.js";
import "../../src/artifact-contracts/tests.js"; // ensures registration

describe("TestsArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "tests" as const,
    framework: "vitest" as const,
    specs: [
      { file: "__tests__/Home.test.tsx", targets: ["frontend"], passed: 5, failed: 0, skipped: 0, durationMs: 1200 }
    ]
  };

  it("accepts a minimal valid artifact", () => {
    expect(TestsArtifactSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown framework literal", () => {
    expect(TestsArtifactSchema.safeParse({ ...valid, framework: "mocha" }).success).toBe(false);
  });

  it("rejects negative pass/fail counts", () => {
    const bad = { ...valid, specs: [{ ...valid.specs[0], passed: -1 }] };
    expect(TestsArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts optional coverage", () => {
    expect(TestsArtifactSchema.safeParse({ ...valid, coverage: { lines: 87.5, branches: 70 } }).success).toBe(true);
  });

  it("accepts optional lastError on a spec", () => {
    const withErr = { ...valid, specs: [{ ...valid.specs[0], failed: 1, lastError: "boom" }] };
    expect(TestsArtifactSchema.safeParse(withErr).success).toBe(true);
  });

  it("is registered under the 'tests' kind in ArtifactContractRegistry", () => {
    expect(ArtifactContractRegistry.has("tests")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test artifact-contracts/tests
```

- [ ] **Step 3: Implement** `packages/workflow-engine/src/artifact-contracts/tests.ts`:

```ts
import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

const SpecResultSchema = z.object({
  file: z.string().min(1),
  targets: z.array(z.string()),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  lastError: z.string().optional()
});

export const TestsArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("tests"),
  framework: z.enum(["vitest", "playwright", "pytest"]),
  specs: z.array(SpecResultSchema),
  coverage: z
    .object({
      lines: z.number().min(0).max(100),
      branches: z.number().min(0).max(100)
    })
    .optional()
});

export type TestsArtifact = z.infer<typeof TestsArtifactSchema>;
export type SpecResult = z.infer<typeof SpecResultSchema>;

ArtifactContractRegistry.register("tests", TestsArtifactSchema);
```

- [ ] **Step 4: Make registration fire**

Append to `packages/workflow-engine/src/artifact-contracts/index.ts`:

```ts
import "./tests.js";
```

- [ ] **Step 5: Add export to workflow-engine's main index**

Append to `packages/workflow-engine/src/index.ts`:

```ts
export { TestsArtifactSchema, type TestsArtifact, type SpecResult } from "./artifact-contracts/tests.js";
```

- [ ] **Step 6: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
git add packages/workflow-engine/src/artifact-contracts/tests.ts packages/workflow-engine/src/artifact-contracts/index.ts packages/workflow-engine/src/index.ts packages/workflow-engine/test/artifact-contracts/tests.test.ts
git commit -m "feat(workflow-engine): TestsArtifact Zod schema + registry registration (Plan E Task 1)"
```

---

### Task 2: `parseVitestJson` pure helper

**Files:**
- Create: `packages/role-tester/package.json` (workspace skeleton)
- Create: `packages/role-tester/tsconfig.json`
- Create: `packages/role-tester/vitest.config.ts`
- Create: `packages/role-tester/src/index.ts`
- Create: `packages/role-tester/src/parse-vitest-json.ts`
- Create: `packages/role-tester/test/parse-vitest-json.test.ts`

- [ ] **Step 1: Create the package skeleton**

Mirror `packages/role-developer/`'s shape. Minimum package.json:

```json
{
  "name": "@atlas/role-tester",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/workflow-engine": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

Copy `tsconfig.json` + `vitest.config.ts` verbatim from `packages/role-developer/` and update package-name references inside.

Empty `src/index.ts` for now (Task 4 fills it).

Run `pnpm install` from the repo root so the workspace links resolve.

- [ ] **Step 2: Write failing test** at `packages/role-tester/test/parse-vitest-json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseVitestJson } from "../src/parse-vitest-json.js";

const VITEST_JSON = JSON.stringify({
  numTotalTests: 3,
  numPassedTests: 2,
  numFailedTests: 1,
  numPendingTests: 0,
  testResults: [
    {
      name: "__tests__/Home.test.tsx",
      status: "failed",
      assertionResults: [
        { status: "passed", title: "renders heading", duration: 12 },
        { status: "passed", title: "fires onClick", duration: 8 },
        { status: "failed", title: "shows error banner", duration: 5, failureMessages: ["Expected 'oops' got 'ok'"] }
      ]
    }
  ]
});

describe("parseVitestJson", () => {
  it("normalizes the per-file pass/fail/skip counts", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ file: "__tests__/Home.test.tsx", passed: 2, failed: 1, skipped: 0 });
  });

  it("extracts the first failureMessages entry as lastError", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r[0]?.lastError).toContain("Expected 'oops'");
  });

  it("sums durationMs across assertions", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r[0]?.durationMs).toBe(25);
  });

  it("returns [] on malformed input", () => {
    expect(parseVitestJson("not json")).toEqual([]);
    expect(parseVitestJson('{"wrong":"shape"}')).toEqual([]);
  });

  it("handles a fully-passing file (no failureMessages)", () => {
    const ok = JSON.stringify({
      testResults: [
        {
          name: "__tests__/X.test.tsx",
          status: "passed",
          assertionResults: [{ status: "passed", title: "x", duration: 4 }]
        }
      ]
    });
    const r = parseVitestJson(ok);
    expect(r[0]).toMatchObject({ file: "__tests__/X.test.tsx", passed: 1, failed: 0 });
    expect(r[0]?.lastError).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run, confirm failure**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester test parse-vitest
```

- [ ] **Step 4: Implement** `packages/role-tester/src/parse-vitest-json.ts`:

```ts
export interface NormalizedSpecResult {
  file: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  lastError?: string;
}

interface VitestAssertion {
  status?: unknown;
  duration?: unknown;
  failureMessages?: unknown;
}

interface VitestTestResult {
  name?: unknown;
  assertionResults?: unknown;
}

export function parseVitestJson(stdout: string): NormalizedSpecResult[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!raw || typeof raw !== "object") return [];
  const testResults = (raw as { testResults?: unknown }).testResults;
  if (!Array.isArray(testResults)) return [];

  const out: NormalizedSpecResult[] = [];
  for (const tr of testResults as VitestTestResult[]) {
    if (!tr || typeof tr !== "object") continue;
    const file = typeof tr.name === "string" ? tr.name : undefined;
    if (!file) continue;
    const assertions = Array.isArray(tr.assertionResults) ? (tr.assertionResults as VitestAssertion[]) : [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let durationMs = 0;
    let lastError: string | undefined;
    for (const a of assertions) {
      if (!a || typeof a !== "object") continue;
      if (a.status === "passed") passed++;
      else if (a.status === "failed") {
        failed++;
        if (!lastError && Array.isArray(a.failureMessages) && a.failureMessages.length > 0) {
          const m = a.failureMessages[0];
          if (typeof m === "string") lastError = m;
        }
      } else if (a.status === "pending" || a.status === "skipped") skipped++;
      if (typeof a.duration === "number") durationMs += a.duration;
    }
    out.push({
      file,
      passed,
      failed,
      skipped,
      durationMs,
      ...(lastError !== undefined ? { lastError } : {})
    });
  }
  return out;
}
```

- [ ] **Step 5: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester test
git add packages/role-tester pnpm-lock.yaml
git commit -m "feat(role-tester): parseVitestJson pure helper + package skeleton (Plan E Task 2)"
```

---

### Task 3: `buildTestsArtifact` pure helper

**Files:**
- Create: `packages/role-tester/src/build-artifact.ts`
- Create: `packages/role-tester/test/build-artifact.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildTestsArtifact } from "../src/build-artifact.js";

describe("buildTestsArtifact", () => {
  it("builds a vitest TestsArtifact from parsed spec results", () => {
    const a = buildTestsArtifact({
      framework: "vitest",
      results: [
        { file: "__tests__/Home.test.tsx", passed: 5, failed: 0, skipped: 0, durationMs: 120 },
        { file: "__tests__/About.test.tsx", passed: 3, failed: 1, skipped: 0, durationMs: 80, lastError: "boom" }
      ],
      targetsBySpec: {
        "__tests__/Home.test.tsx": ["frontend"],
        "__tests__/About.test.tsx": ["frontend"]
      }
    });
    expect(a.kind).toBe("tests");
    expect(a.framework).toBe("vitest");
    expect(a.specs).toHaveLength(2);
    expect(a.specs[0]?.targets).toEqual(["frontend"]);
    expect(a.specs[1]?.lastError).toBe("boom");
  });

  it("threads optional coverage through verbatim", () => {
    const a = buildTestsArtifact({
      framework: "vitest",
      results: [],
      targetsBySpec: {},
      coverage: { lines: 92.3, branches: 81.0 }
    });
    expect(a.coverage).toEqual({ lines: 92.3, branches: 81.0 });
  });

  it("defaults targets to [] when no mapping is provided", () => {
    const a = buildTestsArtifact({
      framework: "vitest",
      results: [{ file: "x.test.tsx", passed: 1, failed: 0, skipped: 0, durationMs: 10 }],
      targetsBySpec: {}
    });
    expect(a.specs[0]?.targets).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester test build-artifact
```

- [ ] **Step 3: Implement**

```ts
// packages/role-tester/src/build-artifact.ts
import type { TestsArtifact } from "@atlas/workflow-engine";
import type { NormalizedSpecResult } from "./parse-vitest-json.js";

export interface BuildTestsArtifactInput {
  framework: TestsArtifact["framework"];
  results: ReadonlyArray<NormalizedSpecResult>;
  targetsBySpec: Record<string, ReadonlyArray<string>>;
  coverage?: { lines: number; branches: number };
}

export function buildTestsArtifact(input: BuildTestsArtifactInput): TestsArtifact {
  return {
    schemaVersion: "1",
    kind: "tests",
    framework: input.framework,
    specs: input.results.map((r) => ({
      file: r.file,
      targets: [...(input.targetsBySpec[r.file] ?? [])],
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      durationMs: r.durationMs,
      ...(r.lastError !== undefined ? { lastError: r.lastError } : {})
    })),
    ...(input.coverage ? { coverage: input.coverage } : {})
  };
}
```

- [ ] **Step 4: Export from `src/index.ts`**

```ts
// packages/role-tester/src/index.ts (append)
export { parseVitestJson, type NormalizedSpecResult } from "./parse-vitest-json.js";
export { buildTestsArtifact, type BuildTestsArtifactInput } from "./build-artifact.js";
```

- [ ] **Step 5: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester test
git add packages/role-tester
git commit -m "feat(role-tester): buildTestsArtifact pure helper (Plan E Task 3)"
```

---

### Task 4: `TestsRole`

**Files:**
- Create: `packages/role-tester/src/role.ts`
- Create: `packages/role-tester/test/role.test.ts`

The role orchestrates: install runner → LLM-generate test files → write to sandbox → execute → parse → emit.

For testability, sandbox + LLM are injected via constructor opts. The "LLM" returns a `Record<filePath, fileContents>` (the generated test files).

- [ ] **Step 1: Write failing test**

```ts
// packages/role-tester/test/role.test.ts
import { describe, it, expect, vi } from "vitest";
import { TestsRole } from "../src/role.js";

const VITEST_JSON_OK = JSON.stringify({
  numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
  testResults: [{ name: "__tests__/Home.test.tsx", status: "passed", assertionResults: [{ status: "passed", title: "x", duration: 10 }] }]
});

describe("TestsRole", () => {
  it("installs vitest, writes generated files, runs the runner, emits a TestsArtifact event", async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd.includes("pnpm add -D")) return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd.includes("vitest run")) return { exitCode: 0, stdout: VITEST_JSON_OK, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const write = vi.fn(async () => {});
    const generateTests = vi.fn(async () => ({
      "__tests__/Home.test.tsx": "import { test } from 'vitest';\ntest('x', () => {});"
    }));

    const role = new TestsRole({ sandbox: { exec, write }, generateTests, frontendNodeId: "frontend" });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: {
        upstream: {
          frontend: { schemaVersion: "1", kind: "frontend-app", pages: [{ route: "/", file: "app/page.tsx" }], designTokens: {}, references: [] }
        }
      }
    });

    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    expect(ev).toBeDefined();
    const artifact = (ev?.payload as { artifact: { kind: string; framework: string; specs: unknown[] } }).artifact;
    expect(artifact.kind).toBe("tests");
    expect(artifact.framework).toBe("vitest");
    expect(artifact.specs).toHaveLength(1);
    expect(write).toHaveBeenCalledWith("__tests__/Home.test.tsx", expect.any(String));
  });

  it("emits a failure event when no upstream frontend artifact is found", async () => {
    const role = new TestsRole({
      sandbox: { exec: vi.fn(), write: vi.fn() },
      generateTests: vi.fn(),
      frontendNodeId: "frontend"
    });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "", priorArtifact: { upstream: {} }
    });
    expect(out.events.some((e) => e.eventType === "tests.failed")).toBe(true);
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(false);
  });

  it("emits failure when the runner exits non-zero with no parseable output", async () => {
    const role = new TestsRole({
      sandbox: {
        exec: vi.fn(async (cmd: string) => cmd.includes("vitest run")
          ? { exitCode: 1, stdout: "", stderr: "boom" }
          : { exitCode: 0, stdout: "", stderr: "" }),
        write: vi.fn()
      },
      generateTests: vi.fn(async () => ({ "x.test.tsx": "..." })),
      frontendNodeId: "frontend"
    });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: { frontend: { schemaVersion: "1", kind: "frontend-app", pages: [], designTokens: {}, references: [] } } }
    });
    expect(out.events.some((e) => e.eventType === "tests.failed")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester test role
```

- [ ] **Step 3: Implement** `packages/role-tester/src/role.ts`:

```ts
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { TestsArtifactSchema } from "@atlas/workflow-engine";
import { parseVitestJson } from "./parse-vitest-json.js";
import { buildTestsArtifact } from "./build-artifact.js";

export interface SandboxLike {
  exec(cmd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  write(path: string, contents: string): Promise<void>;
}

export interface TestsRoleOptions {
  sandbox: SandboxLike;
  /** Generates per-file test source given the upstream artifact. Injected for
   *  unit-testability; production wires the real LLM via the factory. */
  generateTests: (input: {
    frontendArtifact: unknown;
    ritualId: string;
  }) => Promise<Record<string, string>>;
  /** The node id of the upstream frontend node — usually "frontend" but can
   *  be different if the workflow planner used another id. Injected by the
   *  factory at role construction. */
  frontendNodeId: string;
  installCmd?: string;
  runCmd?: string;
}

const DEFAULT_INSTALL = "pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom";
const DEFAULT_RUN = "pnpm exec vitest run --reporter=json";

export class TestsRole implements Role {
  readonly id = "tester";

  constructor(private readonly opts: TestsRoleOptions) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const upstream = (inv.priorArtifact as { upstream?: Record<string, unknown> } | undefined)?.upstream ?? {};
    const frontendArtifact = upstream[this.opts.frontendNodeId];
    if (!frontendArtifact) {
      events.push({ eventType: "tests.failed", payload: { reason: `missing upstream frontend artifact at "${this.opts.frontendNodeId}"` } });
      return { events, diff: { kind: "none" } };
    }

    // 1. Install runner (idempotent — pnpm exits ok if already present)
    const install = await this.opts.sandbox.exec(this.opts.installCmd ?? DEFAULT_INSTALL);
    if (install.exitCode !== 0) {
      events.push({ eventType: "tests.failed", payload: { reason: `runner install failed: ${install.stderr.slice(0, 500)}` } });
      return { events, diff: { kind: "none" } };
    }

    // 2. LLM-generate the test files
    let generated: Record<string, string>;
    try {
      generated = await this.opts.generateTests({ frontendArtifact, ritualId: inv.ritualId });
    } catch (err) {
      events.push({ eventType: "tests.failed", payload: { reason: `LLM generate failed: ${err instanceof Error ? err.message : String(err)}` } });
      return { events, diff: { kind: "none" } };
    }

    // 3. Write generated files into the sandbox
    for (const [path, contents] of Object.entries(generated)) {
      await this.opts.sandbox.write(path, contents);
    }

    // 4. Execute the runner
    const runResult = await this.opts.sandbox.exec(this.opts.runCmd ?? DEFAULT_RUN);
    const results = parseVitestJson(runResult.stdout);

    if (results.length === 0 && runResult.exitCode !== 0) {
      events.push({ eventType: "tests.failed", payload: { reason: `runner failed without parseable output: exit=${runResult.exitCode} stderr=${runResult.stderr.slice(0, 500)}` } });
      return { events, diff: { kind: "none" } };
    }

    // 5. Build artifact (target every file at the frontend node by default)
    const targetsBySpec: Record<string, string[]> = {};
    for (const r of results) targetsBySpec[r.file] = [this.opts.frontendNodeId];

    const artifact = buildTestsArtifact({ framework: "vitest", results, targetsBySpec });
    const parsed = TestsArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({ eventType: "tests.failed", payload: { reason: `artifact failed schema validation: ${parsed.error.message}` } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "ritual.artifact_emitted", payload: { fromRole: "tester", artifact: parsed.data } });
    return { events, diff: { kind: "none" } };
  }
}
```

- [ ] **Step 4: Export from `src/index.ts`**

```ts
export { TestsRole, type TestsRoleOptions, type SandboxLike } from "./role.js";
```

- [ ] **Step 5: Run + typecheck + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester test
cd F:/claude/ai_builder && pnpm -F @atlas/role-tester typecheck
git add packages/role-tester
git commit -m "feat(role-tester): TestsRole — install + LLM gen + execute + parse + emit (Plan E Task 4)"
```

---

### Task 5: Wire `TestsRole` into atlas-web's factory + per-kind role-router

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`

This task is the most archaeology-heavy. Plan D's launchRitual (in workflow-engine) calls `ritualEngine.start({ userTurn: node.summary, editClass: "structural", projectId, userId, priorArtifact })`. The ritual-engine then routes through the architect → developer → post-developer chain — that's the wrong chain for a tests node. We need the tests-kind ritual to dispatch ONLY `tester`.

### Investigation first

Read in this order before changing code:
1. `packages/ritual-engine/src/engine.ts` — find where the engine decides which role to dispatch first. Is there a `roleChain` option, or is it always `architect → developer`?
2. `apps/atlas-web/lib/engine/factory.ts` — look for how it constructs the ritual-engine and where `postDeveloperChain` lives. There may already be a per-kind hook.
3. `packages/workflow-engine/src/engine.ts` — look at the launchRitual call site. Does it pass any kind hint? (Plan D Task 8.5 wired it to `userTurn: node.summary` only.)

Two viable wire-ups, pick whichever the existing engine supports best:

**Option A — RitualEngine.start accepts an opt-in role chain.** Add `roleChain?: string[]` to `IRitualEngine.start`'s input. WorkflowEngine's launchRitual passes `roleChain: ["tester"]` when `node.artifactKind === "tests"`; the ritual engine dispatches just that chain instead of the default architect→developer chain.

**Option B — atlas-web factory short-circuits at the conductor level.** Register a `tester` role; modify the workflow engine's launchRitual to call a separate code path for tests nodes that runs the conductor with just `forceRoleId: "tester"`. Harder to keep clean.

Option A is the recommended one. The exact shape:

- [ ] **Step 1: Investigate** (as listed above). If you find anything different, STOP and report NEEDS_CONTEXT.

- [ ] **Step 2: Extend IRitualEngine.start type to accept an optional roleChain**

In `packages/workflow-engine/src/engine.ts`:

```ts
export interface IRitualEngine {
  start(input: {
    userTurn: string;
    editClass: "structural" | "additive" | "cosmetic";
    projectId: string;
    userId: string;
    priorArtifact?: unknown;
    /** Plan E — optional override of the default architect→developer→gates
     *  chain. Specifies an ordered list of role IDs to dispatch instead.
     *  Used for tests nodes (`["tester"]`). */
    roleChain?: string[];
  }): Promise<string>;
  // ...rest unchanged
}
```

- [ ] **Step 3: Thread roleChain through launchRitual in workflow-engine**

```ts
// in makeLaunchRitual's body, when node.artifactKind === "tests":
return this.opts.ritualEngine.start({
  userTurn: node.summary,
  editClass: "structural",
  projectId: run.projectId,
  userId: run.userId,
  priorArtifact,
  ...(node.artifactKind === "tests" ? { roleChain: ["tester"] } : {})
});
```

- [ ] **Step 4: Honor roleChain in the ritual-engine**

In `packages/ritual-engine/src/engine.ts`, inside `RitualEngine.start`, if `input.roleChain` is non-empty, dispatch those roles in order via the conductor INSTEAD of the default architect/developer dispatch. Skip the planner / canvas-pause / build-gate machinery — `tester` is the entire ritual.

(The exact shape depends on how the conductor's `dispatch` is invoked today. Mirror the per-role dispatch call already used for the post-developer chain — that's the same primitive.)

- [ ] **Step 5: Register `TestsRole` in atlas-web's factory**

```ts
// inside the factory where roles map is constructed:
import { TestsRole } from "@atlas/role-tester";

const testsRole = new TestsRole({
  sandbox: {
    exec: (cmd) => liveSandboxSession.exec(cmd),       // wire to e2b session
    write: (path, contents) => liveSandboxSession.writeFile(path, contents)
  },
  generateTests: async ({ frontendArtifact, ritualId }) => {
    // call the LLM with a prompt that includes the frontend artifact's pages list
    // return Record<filePath, fileContents>
    // (Use whatever LLM provider the factory already constructs; copy-paste-adapt from role-developer's wiring.)
  },
  frontendNodeId: "frontend"  // TODO if node ids are dynamic, pass via priorArtifact instead
});
roles.set("tester", testsRole);
```

NOTE: the `frontendNodeId` should ideally come from the ritual's context, not be hardcoded. If you find that workflow nodes don't have stable names, change `TestsRole.run()` to read the first node in `priorArtifact.upstream` whose `kind === "frontend-app"` instead of looking up by id. Adjust the role + tests accordingly.

- [ ] **Step 6: Run tests + typecheck**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test
cd F:/claude/ai_builder && pnpm -F @atlas/ritual-engine test
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
cd F:/claude/ai_builder && pnpm --filter atlas-web test factory
```

- [ ] **Step 7: Commit**

```bash
git add packages/workflow-engine packages/ritual-engine apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(workflow-engine,ritual-engine,atlas-web): roleChain hint + TestsRole wiring (Plan E Task 5)"
```

---

### Task 6: `TestsCanvas` component

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/TestsCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/TestsCanvas.test.tsx`

A pass/fail results table. Header: total passed / failed / skipped / duration. Body: one row per spec (`file`, status badge, duration, "view error" affordance when `lastError` present). Footer: coverage when present.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TestsCanvas } from "@/components/canvas/renderers/TestsCanvas";

const ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "tests" as const,
  framework: "vitest" as const,
  specs: [
    { file: "Home.test.tsx", targets: ["frontend"], passed: 5, failed: 0, skipped: 0, durationMs: 200 },
    { file: "About.test.tsx", targets: ["frontend"], passed: 3, failed: 1, skipped: 1, durationMs: 90, lastError: "expected oops" }
  ],
  coverage: { lines: 87, branches: 70 }
};

describe("TestsCanvas", () => {
  it("renders the summary header with totals", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-summary")).toHaveTextContent(/8 passed/i);
    expect(screen.getByTestId("tests-summary")).toHaveTextContent(/1 failed/i);
    expect(screen.getByTestId("tests-summary")).toHaveTextContent(/1 skipped/i);
  });

  it("renders one row per spec with status pill", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-spec-row-Home.test.tsx")).toBeInTheDocument();
    expect(screen.getByTestId("tests-spec-row-About.test.tsx")).toHaveTextContent(/failed/i);
  });

  it("shows lastError when present", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-spec-error-About.test.tsx")).toHaveTextContent("expected oops");
  });

  it("renders the empty-state when no artifact is set", () => {
    render(<TestsCanvas artifact={undefined} />);
    expect(screen.getByTestId("tests-canvas-empty")).toBeInTheDocument();
  });

  it("renders coverage footer when present", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-coverage")).toHaveTextContent(/lines.*87/i);
    expect(screen.getByTestId("tests-coverage")).toHaveTextContent(/branches.*70/i);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web test TestsCanvas
```

- [ ] **Step 3: Implement** `apps/atlas-web/components/canvas/renderers/TestsCanvas.tsx`:

```tsx
"use client";

import type { TestsArtifact } from "@atlas/workflow-engine";

export interface TestsCanvasProps {
  artifact?: TestsArtifact;
}

const PASS = "bg-emerald-100 border-emerald-300 text-emerald-900";
const FAIL = "bg-red-100 border-red-300 text-red-900";
const SKIP = "bg-slate-100 border-slate-300 text-slate-700";

export function TestsCanvas({ artifact }: TestsCanvasProps) {
  if (!artifact) {
    return (
      <div data-testid="tests-canvas-empty" className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700">
        Test results not yet available. Waiting for the tester ritual to finish…
      </div>
    );
  }

  const totals = artifact.specs.reduce(
    (acc, s) => ({ passed: acc.passed + s.passed, failed: acc.failed + s.failed, skipped: acc.skipped + s.skipped, durationMs: acc.durationMs + s.durationMs }),
    { passed: 0, failed: 0, skipped: 0, durationMs: 0 }
  );

  return (
    <div className="flex h-full w-full flex-col">
      <header data-testid="tests-summary" className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-mono text-slate-700">{artifact.framework}</span>
        <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-900">{totals.passed} passed</span>
        <span className="rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-red-900">{totals.failed} failed</span>
        <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-slate-700">{totals.skipped} skipped</span>
        <span className="ml-auto text-[11px] text-slate-500">{(totals.durationMs / 1000).toFixed(2)}s</span>
      </header>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-1 font-medium">Spec</th>
              <th className="px-3 py-1 font-medium">Status</th>
              <th className="px-3 py-1 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {artifact.specs.map((s) => {
              const status = s.failed > 0 ? "failed" : s.passed > 0 ? "passed" : "skipped";
              const klass = status === "failed" ? FAIL : status === "passed" ? PASS : SKIP;
              return (
                <tr key={s.file} data-testid={`tests-spec-row-${s.file}`} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-1 font-mono text-slate-800">{s.file}</td>
                  <td className="px-3 py-1"><span className={`rounded border px-2 py-0.5 ${klass}`}>{status}</span></td>
                  <td className="px-3 py-1 text-slate-500">{(s.durationMs / 1000).toFixed(2)}s</td>
                  {s.lastError && (
                    <td colSpan={3} data-testid={`tests-spec-error-${s.file}`} className="px-3 pb-2 text-[11px] text-red-700">
                      {s.lastError}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {artifact.coverage && (
        <footer data-testid="tests-coverage" className="border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
          coverage: lines {artifact.coverage.lines.toFixed(1)}% · branches {artifact.coverage.branches.toFixed(1)}%
        </footer>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm --filter atlas-web typecheck
cd F:/claude/ai_builder && pnpm --filter atlas-web test TestsCanvas
git add apps/atlas-web/components/canvas/renderers/TestsCanvas.tsx apps/atlas-web/test/components/canvas/renderers/TestsCanvas.test.tsx
git commit -m "feat(atlas-web): TestsCanvas — pass/fail results table (Plan E Task 6)"
```

---

### Task 7: Swap the stub renderer

**Files:**
- Modify: `apps/atlas-web/components/canvas/register-renderers.tsx`
- Delete: `apps/atlas-web/components/canvas/renderers/TestsStubCanvas.tsx`

- [ ] Swap `TestsStubCanvas` import + registration for the real `TestsCanvas` at the `test-results` mode ID. Delete the stub.

- [ ] Verify the existing `register-renderers.test.tsx` still passes (it just checks `test-results` is registered).

- [ ] Commit:

```bash
git add apps/atlas-web/components/canvas/register-renderers.tsx apps/atlas-web/components/canvas/renderers/TestsStubCanvas.tsx
git commit -m "feat(atlas-web): swap TestsStubCanvas for real TestsCanvas (Plan E Task 7)"
```

---

### Task 8: Integration test — tests handoff end-to-end

**Files:**
- Create: `packages/workflow-engine/test/integration-tests-handoff.test.ts`

Mirror Plan D's `integration-backend-handoff.test.ts`: 2-node DAG (`frontend` → `tests-of-frontend`), fake `IRitualEngine` that emits a FrontendArtifact for the first ritual and a TestsArtifact for the second, assert (a) tests node's persisted artifact matches what the fake emitted, (b) the tests node's launch saw the frontend artifact in `priorArtifact.upstream.frontend`.

(There's no downstream consumer of the tests node in this plan, so the assertion focuses on the tests node receiving + persisting correctly. A future plan that adds a "test report aggregator" downstream node can extend.)

- [ ] **Step 1: Write the test** (use Plan D's `integration-backend-handoff.test.ts` as the structural template; swap artifact kinds and node ids).

- [ ] **Step 2: Run + commit**

```bash
cd F:/claude/ai_builder && pnpm -F @atlas/workflow-engine test integration-tests-handoff
git add packages/workflow-engine/test/integration-tests-handoff.test.ts
git commit -m "test(workflow-engine): end-to-end typed TestsArtifact handoff (Plan E Task 8)"
```

---

## Plan E — Self-review checklist

- [ ] Spec §"Per-kind shape" → Task 1
- [ ] Spec §"Role flow" → Tasks 2, 3, 4
- [ ] Spec §"Sandbox" (install runner) → Task 4's `installCmd`
- [ ] Spec §"Renderer" (results panel) → Tasks 6, 7
- [ ] Spec §"Workflow-engine wiring" (per-kind dispatch) → Task 5
- [ ] Spec §"Out of scope" (Playwright/pytest deferred) → Honored — only Vitest framework

**Shippable result:** A workflow with a tests node consuming a frontend node runs end-to-end: TestsRole installs Vitest, generates specs, runs them, parses results, emits a TestsArtifact. The user sees the results table in the canvas. The artifact persists on the workflow node and is available to any future downstream consumer via `priorArtifact.upstream`.
