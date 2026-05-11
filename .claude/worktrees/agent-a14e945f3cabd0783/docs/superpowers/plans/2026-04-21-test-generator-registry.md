# C.3 — Test-Generator Registry + Human Baseline Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@atlas/test-generator-registry` — the library that resolves a graph node to its test-generator skill, injects human-authored baseline assertions for protected targets, and detects drift against a locked calibration corpus.

**Architecture:** The registry is a thin layer over `@atlas/skill-runtime`. It indexes the 14 `gen-test-*` skills in `packages/skill-library/` by their `activate_on: "node:<kind>"` frontmatter. On invocation for a protected target (AuthBoundary, PII Model, non-baseline ComplianceClass — mirrors I13), it loads the matching human baseline YAML from `.atlas/baselines/` and composes it into the activation record that Conductor / Developer role consumes. A calibration dataset locks expected generator outputs per node kind; a drift detector re-invokes generators against that dataset and fails when output diverges beyond a byte-level tolerance.

**Tech Stack:** TypeScript 5.6.3, Zod 3.23.8, js-yaml 4.1.0, Vitest 2.1.8. Depends on `@atlas/spec-graph-schema` (node kinds, I13 protected-target logic) and `@atlas/skill-runtime` (SkillRegistry, ActivationRecord).

**Prerequisites:**
- Phase A merged (all of A.1–A.4, B.1–B.2, C.1–C.2, D.1–D.5, E.1–E.5, F.1, G.1–G.2).
- `packages/skill-library/skills/test-generators/` contains 14 `gen-test-*.md` files (one per node kind).
- `packages/skill-runtime/` exports `SkillRegistry`, `ActivationRecord`.
- `packages/spec-graph-schema/` exports `SpecGraph`, node kinds, and `i13BaselineTestsForProtectedTargets`.

---

## File Structure

```
packages/test-generator-registry/
├── package.json                  # @atlas/test-generator-registry
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts                  # barrel exports
│   ├── registry.ts               # TestGeneratorRegistry class
│   ├── protected.ts              # isProtectedTarget(node) (mirrors I13)
│   ├── baseline-store.ts         # HumanBaselineStore: load .atlas/baselines/*.yaml
│   ├── baseline-schema.ts        # Zod schema for baseline YAMLs
│   ├── invoker.ts                # invokeGenerator(node, graph) → GeneratorResult
│   ├── drift.ts                  # DriftDetector + CalibrationEntry
│   └── errors.ts                 # NoGeneratorForKind, BaselineMissing, DriftExceeded
└── test/
    ├── registry.test.ts
    ├── protected.test.ts
    ├── baseline-store.test.ts
    ├── baseline-schema.test.ts
    ├── invoker.test.ts
    ├── drift.test.ts
    └── fixtures/
        ├── baselines/
        │   ├── authboundary.yaml
        │   ├── pii-model.yaml
        │   └── compliance.yaml
        └── calibration.json

.atlas/baselines/                 # project-level baselines (committed)
├── authboundary.yaml
├── pii-model.yaml
└── compliance.yaml

tools/
└── test-gen-cli.mjs              # `atlas-tg baseline list|show|check`, `atlas-tg drift check`
```

---

## Types & Contracts

```ts
// baseline-schema.ts
export const BaselineAssertionSchema = z.object({
  id: z.string().min(1),              // stable ID across authoring revisions
  description: z.string().min(1),     // human summary
  rationale: z.string().min(1),       // why the LLM cannot rewrite this
  checklistItem: z.string().min(1),   // injectable string surfaced in generator prompt
  mustEmitTest: z.boolean(),          // if true, generator MUST emit a matching Test node
  owner: z.string().min(1)            // author/team responsible
}).strict();

export const BaselineFileSchema = z.object({
  kind: z.enum(["authboundary", "pii-model", "compliance"]),
  version: z.number().int().positive(),
  assertions: z.array(BaselineAssertionSchema).nonempty()
}).strict();

// invoker.ts
export interface GeneratorResult {
  activationRecord: ActivationRecord; // from @atlas/skill-runtime
  emittedTestSource: "generated" | "baseline";
  baselineAssertions: BaselineAssertion[];  // empty if emittedTestSource === "generated"
}

// drift.ts
export interface CalibrationEntry {
  nodeId: string;
  kind: NodeKind;
  expectedActivationBodyHash: string; // sha256 of activation record body
  pinnedAt: string;                    // ISO date
}

export interface DriftReport {
  entries: Array<{ nodeId: string; drifted: boolean; diff?: string }>;
  driftedCount: number;
  totalCount: number;
}
```

---

### Task 1: Scaffold `@atlas/test-generator-registry` package

**Files:**
- Create: `packages/test-generator-registry/package.json`
- Create: `packages/test-generator-registry/tsconfig.json`
- Create: `packages/test-generator-registry/vitest.config.ts`
- Create: `packages/test-generator-registry/src/index.ts`
- Test: `packages/test-generator-registry/test/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/test-generator-registry/test/scaffold.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";

describe("@atlas/test-generator-registry package barrel", () => {
  it("exposes a stable barrel", () => {
    expect(pkg).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test`
Expected: FAIL — `Cannot find module` or `package not installed`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/package.json`:
```json
{
  "name": "@atlas/test-generator-registry",
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
    "@atlas/skill-runtime": "workspace:*",
    "@atlas/spec-graph-schema": "workspace:*",
    "js-yaml": "4.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "4.0.9",
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`packages/test-generator-registry/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`packages/test-generator-registry/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`packages/test-generator-registry/src/index.ts`:
```ts
export {};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @atlas/test-generator-registry test`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/ pnpm-lock.yaml
git commit -m "feat(test-generator-registry): scaffold package with Vitest + TS config"
```

---

### Task 2: `isProtectedTarget()` mirrors I13 logic

**Files:**
- Create: `packages/test-generator-registry/src/protected.ts`
- Test: `packages/test-generator-registry/test/protected.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isProtectedTarget, protectedKindOf } from "../src/protected.js";

describe("isProtectedTarget", () => {
  it("flags AuthBoundary as protected", () => {
    const node = { id: "ab1", kind: "authboundary" } as never;
    expect(isProtectedTarget(node)).toBe(true);
    expect(protectedKindOf(node)).toBe("authboundary");
  });

  it("flags Model with piiClassification!=none as protected", () => {
    const node = { id: "m1", kind: "model", piiClassification: "pii" } as never;
    expect(isProtectedTarget(node)).toBe(true);
    expect(protectedKindOf(node)).toBe("pii-model");
  });

  it("does NOT flag Model with piiClassification=none", () => {
    const node = { id: "m2", kind: "model", piiClassification: "none" } as never;
    expect(isProtectedTarget(node)).toBe(false);
  });

  it("flags ComplianceClass != baseline as protected", () => {
    const node = { id: "c1", kind: "compliance", name: "hipaa" } as never;
    expect(isProtectedTarget(node)).toBe(true);
    expect(protectedKindOf(node)).toBe("compliance");
  });

  it("does NOT flag ComplianceClass named 'baseline'", () => {
    const node = { id: "c2", kind: "compliance", name: "baseline" } as never;
    expect(isProtectedTarget(node)).toBe(false);
  });

  it("returns false for non-protected kinds", () => {
    const node = { id: "p1", kind: "page" } as never;
    expect(isProtectedTarget(node)).toBe(false);
    expect(protectedKindOf(node)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test`
Expected: FAIL — `Cannot find module '../src/protected.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/src/protected.ts`:
```ts
import type { SpecGraph } from "@atlas/spec-graph-schema";

type Node = SpecGraph["nodes"][string];
export type ProtectedKind = "authboundary" | "pii-model" | "compliance";

export function protectedKindOf(node: Node): ProtectedKind | null {
  if (node.kind === "authboundary") return "authboundary";
  if (node.kind === "model" && node.piiClassification !== "none") return "pii-model";
  if (node.kind === "compliance" && node.name !== "baseline") return "compliance";
  return null;
}

export function isProtectedTarget(node: Node): boolean {
  return protectedKindOf(node) !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/protected.ts packages/test-generator-registry/test/protected.test.ts
git commit -m "feat(test-generator-registry): isProtectedTarget + protectedKindOf mirror I13"
```

---

### Task 3: BaselineFile + BaselineAssertion Zod schemas

**Files:**
- Create: `packages/test-generator-registry/src/baseline-schema.ts`
- Test: `packages/test-generator-registry/test/baseline-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { BaselineFileSchema } from "../src/baseline-schema.js";

describe("BaselineFileSchema", () => {
  const valid = {
    kind: "authboundary",
    version: 1,
    assertions: [
      {
        id: "unauthed-401",
        description: "Unauthed access returns 401",
        rationale: "Hard security floor — LLM cannot reword",
        checklistItem: "GET /protected without session → 401",
        mustEmitTest: true,
        owner: "security-team"
      }
    ]
  };

  it("accepts a valid baseline file", () => {
    const res = BaselineFileSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it("rejects empty assertions array", () => {
    const res = BaselineFileSchema.safeParse({ ...valid, assertions: [] });
    expect(res.success).toBe(false);
  });

  it("rejects unknown kind", () => {
    const res = BaselineFileSchema.safeParse({ ...valid, kind: "page" });
    expect(res.success).toBe(false);
  });

  it("rejects missing rationale (protects LLM-override rule)", () => {
    const bad = { ...valid, assertions: [{ ...valid.assertions[0], rationale: undefined }] };
    expect(BaselineFileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    const bad = { ...valid, extraField: "x" };
    expect(BaselineFileSchema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test`
Expected: FAIL — `Cannot find module '../src/baseline-schema.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/src/baseline-schema.ts`:
```ts
import { z } from "zod";

export const BaselineAssertionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().min(1),
    checklistItem: z.string().min(1),
    mustEmitTest: z.boolean(),
    owner: z.string().min(1)
  })
  .strict();

export const BaselineFileSchema = z
  .object({
    kind: z.enum(["authboundary", "pii-model", "compliance"]),
    version: z.number().int().positive(),
    assertions: z.array(BaselineAssertionSchema).nonempty()
  })
  .strict();

export type BaselineAssertion = z.infer<typeof BaselineAssertionSchema>;
export type BaselineFile = z.infer<typeof BaselineFileSchema>;
export type ProtectedKind = BaselineFile["kind"];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/baseline-schema.ts packages/test-generator-registry/test/baseline-schema.test.ts
git commit -m "feat(test-generator-registry): Zod schemas for BaselineFile + BaselineAssertion"
```

---

### Task 4: HumanBaselineStore — load YAML baselines from disk

**Files:**
- Create: `packages/test-generator-registry/src/baseline-store.ts`
- Create: `packages/test-generator-registry/src/errors.ts`
- Create: `packages/test-generator-registry/test/fixtures/baselines/authboundary.yaml`
- Create: `packages/test-generator-registry/test/fixtures/baselines/pii-model.yaml`
- Create: `packages/test-generator-registry/test/fixtures/baselines/compliance.yaml`
- Test: `packages/test-generator-registry/test/baseline-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/test-generator-registry/test/fixtures/baselines/authboundary.yaml`:
```yaml
kind: authboundary
version: 1
assertions:
  - id: unauthed-returns-401
    description: Unauthed request returns 401
    rationale: Mandatory non-rewritable security floor
    checklistItem: "GET /protected without session → 401"
    mustEmitTest: true
    owner: security-team
  - id: wrong-role-403
    description: Authed but insufficient role returns 403
    rationale: Authorization cannot be relaxed by generator drift
    checklistItem: "Authed with role=guest to admin route → 403"
    mustEmitTest: true
    owner: security-team
```

`packages/test-generator-registry/test/fixtures/baselines/pii-model.yaml`:
```yaml
kind: pii-model
version: 1
assertions:
  - id: pii-not-in-logs
    description: PII fields never appear in application logs
    rationale: Privacy compliance floor
    checklistItem: "Serialize model to log → redacted fields absent"
    mustEmitTest: true
    owner: security-team
```

`packages/test-generator-registry/test/fixtures/baselines/compliance.yaml`:
```yaml
kind: compliance
version: 1
assertions:
  - id: every-assertion-has-test
    description: Each baselineAssertion on the ComplianceClass emits a matching test
    rationale: I13 requires source=baseline coverage
    checklistItem: "For each assertion in ComplianceClass.baselineAssertions → concrete test exists"
    mustEmitTest: true
    owner: compliance-team
```

`packages/test-generator-registry/test/baseline-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { BaselineFileParseError, BaselineMissingError } from "../src/errors.js";

const fixturesDir = resolve(__dirname, "fixtures/baselines");

describe("HumanBaselineStore", () => {
  it("loads all .yaml files in the directory on construction", async () => {
    const store = await HumanBaselineStore.fromDir(fixturesDir);
    expect(store.kinds().sort()).toEqual(["authboundary", "compliance", "pii-model"]);
  });

  it("returns assertions for a given kind", async () => {
    const store = await HumanBaselineStore.fromDir(fixturesDir);
    const assertions = store.getAssertions("authboundary");
    expect(assertions.length).toBe(2);
    expect(assertions[0]?.id).toBe("unauthed-returns-401");
  });

  it("throws BaselineMissingError when kind has no file", async () => {
    const store = await HumanBaselineStore.fromDir(fixturesDir);
    expect(() => store.getAssertions("nonexistent" as never)).toThrow(BaselineMissingError);
  });

  it("throws BaselineFileParseError on invalid YAML", async () => {
    // Create a temp dir with an invalid file
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "baseline-invalid-"));
    await writeFile(join(dir, "bad.yaml"), "kind: authboundary\nversion: 1\nassertions: []\n");
    await expect(HumanBaselineStore.fromDir(dir)).rejects.toThrow(BaselineFileParseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test baseline-store`
Expected: FAIL — `Cannot find module '../src/baseline-store.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/src/errors.ts`:
```ts
export class NoGeneratorForKindError extends Error {
  constructor(kind: string) {
    super(`NoGeneratorForKindError: no test-generator skill registered for node kind "${kind}"`);
    this.name = "NoGeneratorForKindError";
  }
}

export class BaselineMissingError extends Error {
  constructor(kind: string) {
    super(`BaselineMissingError: no human baseline file for kind "${kind}" — author one at .atlas/baselines/${kind}.yaml`);
    this.name = "BaselineMissingError";
  }
}

export class BaselineFileParseError extends Error {
  constructor(path: string, cause: unknown) {
    super(`BaselineFileParseError: failed to parse baseline file at ${path}: ${(cause as Error).message}`);
    this.name = "BaselineFileParseError";
  }
}

export class DriftExceededError extends Error {
  constructor(driftedCount: number, total: number) {
    super(`DriftExceededError: ${driftedCount}/${total} calibration entries drifted`);
    this.name = "DriftExceededError";
  }
}
```

`packages/test-generator-registry/src/baseline-store.ts`:
```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { BaselineFileSchema, type BaselineAssertion, type ProtectedKind } from "./baseline-schema.js";
import { BaselineFileParseError, BaselineMissingError } from "./errors.js";

export class HumanBaselineStore {
  private constructor(private readonly byKind: Map<ProtectedKind, BaselineAssertion[]>) {}

  static async fromDir(dir: string): Promise<HumanBaselineStore> {
    const entries = await readdir(dir);
    const yamlFiles = entries.filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"));
    const byKind = new Map<ProtectedKind, BaselineAssertion[]>();
    for (const file of yamlFiles) {
      const path = join(dir, file);
      const raw = await readFile(path, "utf8");
      let parsed: unknown;
      try {
        parsed = yaml.load(raw);
      } catch (err) {
        throw new BaselineFileParseError(path, err);
      }
      const result = BaselineFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new BaselineFileParseError(path, new Error(JSON.stringify(result.error.issues)));
      }
      byKind.set(result.data.kind, result.data.assertions);
    }
    return new HumanBaselineStore(byKind);
  }

  kinds(): ProtectedKind[] {
    return [...this.byKind.keys()];
  }

  getAssertions(kind: ProtectedKind): BaselineAssertion[] {
    const a = this.byKind.get(kind);
    if (!a) throw new BaselineMissingError(kind);
    return a;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test baseline-store`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/baseline-store.ts packages/test-generator-registry/src/errors.ts packages/test-generator-registry/test/baseline-store.test.ts packages/test-generator-registry/test/fixtures/
git commit -m "feat(test-generator-registry): HumanBaselineStore loads YAML baselines + errors.ts"
```

---

### Task 5: TestGeneratorRegistry — node-kind → generator-skill index

**Files:**
- Create: `packages/test-generator-registry/src/registry.ts`
- Test: `packages/test-generator-registry/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@atlas/skill-runtime";
import type { Skill } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { NoGeneratorForKindError } from "../src/errors.js";

const makeSkill = (name: string, activateOn: string): Skill => ({
  frontmatter: { name, description: "d", activate_on: activateOn },
  body: `# ${name}\nBody for ${name}`
}) as Skill;

describe("TestGeneratorRegistry", () => {
  it("indexes skills with activate_on: node:<kind>", () => {
    const skills = [
      makeSkill("gen-test-page", "node:page"),
      makeSkill("gen-test-component", "node:component"),
      makeSkill("skill-other", "merge-gate.a11y")
    ];
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    expect(reg.generatorFor("page")?.frontmatter.name).toBe("gen-test-page");
    expect(reg.generatorFor("component")?.frontmatter.name).toBe("gen-test-component");
  });

  it("returns undefined for kinds with no generator", () => {
    const skillReg = new SkillRegistry([makeSkill("gen-test-page", "node:page")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    expect(reg.generatorFor("flow")).toBeUndefined();
  });

  it("lists all indexed kinds", () => {
    const skills = [
      makeSkill("gen-test-page", "node:page"),
      makeSkill("gen-test-authboundary", "node:authboundary")
    ];
    const reg = TestGeneratorRegistry.fromSkillRegistry(new SkillRegistry(skills));
    expect(reg.kinds().sort()).toEqual(["authboundary", "page"]);
  });

  it("requireGeneratorFor throws NoGeneratorForKindError for missing kind", () => {
    const reg = TestGeneratorRegistry.fromSkillRegistry(new SkillRegistry([]));
    expect(() => reg.requireGeneratorFor("page")).toThrow(NoGeneratorForKindError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test registry`
Expected: FAIL — `Cannot find module '../src/registry.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/src/registry.ts`:
```ts
import type { Skill, SkillRegistry } from "@atlas/skill-runtime";
import { NoGeneratorForKindError } from "./errors.js";

const NODE_PREFIX = "node:";

export class TestGeneratorRegistry {
  private constructor(private readonly byKind: Map<string, Skill>) {}

  static fromSkillRegistry(skillRegistry: SkillRegistry): TestGeneratorRegistry {
    const byKind = new Map<string, Skill>();
    for (const skill of skillRegistry.list()) {
      const trigger = skill.frontmatter.activate_on;
      if (typeof trigger !== "string" || !trigger.startsWith(NODE_PREFIX)) continue;
      const kind = trigger.slice(NODE_PREFIX.length);
      byKind.set(kind, skill);
    }
    return new TestGeneratorRegistry(byKind);
  }

  generatorFor(kind: string): Skill | undefined {
    return this.byKind.get(kind);
  }

  requireGeneratorFor(kind: string): Skill {
    const s = this.byKind.get(kind);
    if (!s) throw new NoGeneratorForKindError(kind);
    return s;
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test registry`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/registry.ts packages/test-generator-registry/test/registry.test.ts
git commit -m "feat(test-generator-registry): TestGeneratorRegistry indexes skills by node kind"
```

---

### Task 6: `invokeGenerator` — happy path for non-protected node

**Files:**
- Create: `packages/test-generator-registry/src/invoker.ts`
- Test: `packages/test-generator-registry/test/invoker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@atlas/skill-runtime";
import type { Skill } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { invokeGenerator } from "../src/invoker.js";
import { resolve } from "node:path";

const fixturesDir = resolve(__dirname, "fixtures/baselines");

const skill = (name: string, on: string): Skill => ({
  frontmatter: { name, description: "d", activate_on: on },
  body: `# ${name}`
}) as Skill;

describe("invokeGenerator — non-protected node", () => {
  it("returns source=generated and empty baselineAssertions", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-page", "node:page")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "p1", kind: "page" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("generated");
    expect(result.baselineAssertions).toEqual([]);
    expect(result.activationRecord.skillName).toBe("gen-test-page");
    expect(result.activationRecord.body).toContain("gen-test-page");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test invoker`
Expected: FAIL — `Cannot find module '../src/invoker.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/src/invoker.ts`:
```ts
import type { ActivationRecord, SkillRegistry } from "@atlas/skill-runtime";
import type { SpecGraph } from "@atlas/spec-graph-schema";
import type { BaselineAssertion } from "./baseline-schema.js";
import type { HumanBaselineStore } from "./baseline-store.js";
import type { TestGeneratorRegistry } from "./registry.js";
import { protectedKindOf } from "./protected.js";

type Node = SpecGraph["nodes"][string];

export interface InvokeGeneratorInput {
  node: Node;
  registry: TestGeneratorRegistry;
  skillRegistry: SkillRegistry;
  baselines: HumanBaselineStore;
}

export interface GeneratorResult {
  activationRecord: ActivationRecord;
  emittedTestSource: "generated" | "baseline";
  baselineAssertions: BaselineAssertion[];
}

export function invokeGenerator(input: InvokeGeneratorInput): GeneratorResult {
  const { node, registry, skillRegistry, baselines } = input;
  const skill = registry.requireGeneratorFor(node.kind);
  const protectedKind = protectedKindOf(node);

  if (!protectedKind) {
    const activationRecord = skillRegistry.activate(skill.frontmatter.name, { node });
    return { activationRecord, emittedTestSource: "generated", baselineAssertions: [] };
  }

  const assertions = baselines.getAssertions(protectedKind);
  const augmentedBody = composeBody(skill.body, assertions);
  const activationRecord: ActivationRecord = {
    skillName: skill.frontmatter.name,
    validatedInputs: { node },
    body: augmentedBody,
    activatedAt: new Date()
  };
  return { activationRecord, emittedTestSource: "baseline", baselineAssertions: assertions };
}

function composeBody(skillBody: string, assertions: BaselineAssertion[]): string {
  const lines = [
    skillBody.trim(),
    "",
    "## Human-authored baseline assertions (non-overridable — I13)",
    ""
  ];
  for (const a of assertions) {
    lines.push(`- [${a.id}] ${a.checklistItem}`);
    lines.push(`  _rationale: ${a.rationale}_`);
    if (a.mustEmitTest) lines.push(`  **mustEmitTest: true**`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test invoker`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/invoker.ts packages/test-generator-registry/test/invoker.test.ts
git commit -m "feat(test-generator-registry): invokeGenerator happy path for non-protected node"
```

---

### Task 7: `invokeGenerator` — protected node injects baseline assertions

**Files:**
- Modify: `packages/test-generator-registry/test/invoker.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `packages/test-generator-registry/test/invoker.test.ts`:
```ts
describe("invokeGenerator — protected node", () => {
  const fixturesDir = resolve(__dirname, "fixtures/baselines");

  it("AuthBoundary → source=baseline, body contains checklistItem + rationale", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-authboundary", "node:authboundary")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "ab1", kind: "authboundary" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("baseline");
    expect(result.baselineAssertions.length).toBe(2);
    expect(result.activationRecord.body).toContain("Human-authored baseline assertions");
    expect(result.activationRecord.body).toContain("GET /protected without session → 401");
    expect(result.activationRecord.body).toContain("_rationale:");
    expect(result.activationRecord.body).toContain("**mustEmitTest: true**");
  });

  it("Model with piiClassification=pii → uses pii-model baselines", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-model", "node:model")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "m1", kind: "model", piiClassification: "pii" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("baseline");
    expect(result.baselineAssertions[0]?.id).toBe("pii-not-in-logs");
  });

  it("Model with piiClassification=none → source=generated (not protected)", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-model", "node:model")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const store = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "m2", kind: "model", piiClassification: "none" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines: store });

    expect(result.emittedTestSource).toBe("generated");
    expect(result.baselineAssertions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (logic already in invoker.ts from Task 6)**

Run: `pnpm --filter @atlas/test-generator-registry test invoker`
Expected: PASS (4 total — 1 original + 3 new).

- [ ] **Step 3: Commit**

```bash
git add packages/test-generator-registry/test/invoker.test.ts
git commit -m "test(test-generator-registry): invokeGenerator protected-node coverage"
```

---

### Task 8: DriftDetector + CalibrationEntry schema

**Files:**
- Create: `packages/test-generator-registry/src/drift.ts`
- Create: `packages/test-generator-registry/test/fixtures/calibration.json`
- Test: `packages/test-generator-registry/test/drift.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/test-generator-registry/test/fixtures/calibration.json`:
```json
{
  "version": 1,
  "entries": [
    {
      "nodeId": "page-home",
      "kind": "page",
      "expectedActivationBodyHash": "PLACEHOLDER_WILL_BE_REPLACED_IN_TEST",
      "pinnedAt": "2026-04-21T00:00:00.000Z"
    }
  ]
}
```

`packages/test-generator-registry/test/drift.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@atlas/skill-runtime";
import type { Skill } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { DriftDetector, hashActivationBody } from "../src/drift.js";
import { resolve } from "node:path";

const fixturesDir = resolve(__dirname, "fixtures/baselines");

const skill = (name: string, on: string, body: string): Skill => ({
  frontmatter: { name, description: "d", activate_on: on },
  body
}) as Skill;

describe("DriftDetector", () => {
  it("reports zero drift when generator body hash matches pinned hash", async () => {
    const skillObj = skill("gen-test-page", "node:page", "canonical body");
    const skillReg = new SkillRegistry([skillObj]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "page-home", kind: "page" } as never;
    const graph = { nodes: { "page-home": node } } as never;

    const expectedHash = hashActivationBody("canonical body");
    const calibration = {
      version: 1,
      entries: [
        { nodeId: "page-home", kind: "page", expectedActivationBodyHash: expectedHash, pinnedAt: "2026-04-21T00:00:00.000Z" }
      ]
    };

    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);

    expect(report.driftedCount).toBe(0);
    expect(report.totalCount).toBe(1);
    expect(report.entries[0]?.drifted).toBe(false);
  });

  it("reports drift when generator body changes", async () => {
    const skillObj = skill("gen-test-page", "node:page", "NEW BODY");
    const skillReg = new SkillRegistry([skillObj]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(fixturesDir);

    const node = { id: "page-home", kind: "page" } as never;
    const graph = { nodes: { "page-home": node } } as never;

    const calibration = {
      version: 1,
      entries: [
        { nodeId: "page-home", kind: "page", expectedActivationBodyHash: hashActivationBody("old body"), pinnedAt: "2026-04-21T00:00:00.000Z" }
      ]
    };

    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);

    expect(report.driftedCount).toBe(1);
    expect(report.entries[0]?.drifted).toBe(true);
    expect(report.entries[0]?.diff).toContain("hash mismatch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test drift`
Expected: FAIL — `Cannot find module '../src/drift.js'`.

- [ ] **Step 3: Write minimal implementation**

`packages/test-generator-registry/src/drift.ts`:
```ts
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SkillRegistry } from "@atlas/skill-runtime";
import type { SpecGraph } from "@atlas/spec-graph-schema";
import type { TestGeneratorRegistry } from "./registry.js";
import type { HumanBaselineStore } from "./baseline-store.js";
import { invokeGenerator } from "./invoker.js";

export const CalibrationEntrySchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.string().min(1),
    expectedActivationBodyHash: z.string().min(1),
    pinnedAt: z.string().min(1)
  })
  .strict();

export const CalibrationFileSchema = z
  .object({
    version: z.number().int().positive(),
    entries: z.array(CalibrationEntrySchema)
  })
  .strict();

export type CalibrationEntry = z.infer<typeof CalibrationEntrySchema>;
export type CalibrationFile = z.infer<typeof CalibrationFileSchema>;

export interface DriftReport {
  entries: Array<{ nodeId: string; drifted: boolean; diff?: string }>;
  driftedCount: number;
  totalCount: number;
}

export function hashActivationBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export interface DriftDetectorDeps {
  registry: TestGeneratorRegistry;
  skillRegistry: SkillRegistry;
  baselines: HumanBaselineStore;
}

export class DriftDetector {
  constructor(private readonly deps: DriftDetectorDeps) {}

  async check(calibration: CalibrationFile, graph: SpecGraph): Promise<DriftReport> {
    const parsed = CalibrationFileSchema.parse(calibration);
    const entries: DriftReport["entries"] = [];
    let drifted = 0;

    for (const c of parsed.entries) {
      const node = graph.nodes[c.nodeId];
      if (!node) {
        entries.push({ nodeId: c.nodeId, drifted: true, diff: `node missing from graph` });
        drifted++;
        continue;
      }
      const result = invokeGenerator({
        node,
        registry: this.deps.registry,
        skillRegistry: this.deps.skillRegistry,
        baselines: this.deps.baselines
      });
      const actualHash = hashActivationBody(result.activationRecord.body);
      if (actualHash !== c.expectedActivationBodyHash) {
        entries.push({
          nodeId: c.nodeId,
          drifted: true,
          diff: `hash mismatch — expected ${c.expectedActivationBodyHash.slice(0, 8)} got ${actualHash.slice(0, 8)}`
        });
        drifted++;
      } else {
        entries.push({ nodeId: c.nodeId, drifted: false });
      }
    }

    return { entries, driftedCount: drifted, totalCount: parsed.entries.length };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test drift`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/drift.ts packages/test-generator-registry/test/drift.test.ts packages/test-generator-registry/test/fixtures/calibration.json
git commit -m "feat(test-generator-registry): DriftDetector hashes activation body + reports drift"
```

---

### Task 9: Missing-node + missing-baseline drift signaling

**Files:**
- Modify: `packages/test-generator-registry/test/drift.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `packages/test-generator-registry/test/drift.test.ts`:
```ts
describe("DriftDetector edge cases", () => {
  it("reports drift if calibration references a node missing from graph", async () => {
    const skillReg = new SkillRegistry([skill("gen-test-page", "node:page", "body")]);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(fixturesDir);
    const graph = { nodes: {} } as never;

    const calibration = {
      version: 1,
      entries: [
        { nodeId: "missing", kind: "page", expectedActivationBodyHash: "deadbeef", pinnedAt: "2026-04-21T00:00:00.000Z" }
      ]
    };

    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);
    expect(report.entries[0]?.diff).toContain("node missing from graph");
    expect(report.driftedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm it passes (already covered by Task 8 impl)**

Run: `pnpm --filter @atlas/test-generator-registry test drift`
Expected: PASS (3 passed).

- [ ] **Step 3: Commit**

```bash
git add packages/test-generator-registry/test/drift.test.ts
git commit -m "test(test-generator-registry): drift report handles missing calibration nodes"
```

---

### Task 10: Barrel exports + typecheck green

**Files:**
- Modify: `packages/test-generator-registry/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/test-generator-registry/test/barrel.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";

describe("@atlas/test-generator-registry barrel", () => {
  it("exports the public surface", () => {
    expect(typeof pkg.TestGeneratorRegistry).toBe("function");
    expect(typeof pkg.HumanBaselineStore).toBe("function");
    expect(typeof pkg.DriftDetector).toBe("function");
    expect(typeof pkg.invokeGenerator).toBe("function");
    expect(typeof pkg.isProtectedTarget).toBe("function");
    expect(typeof pkg.protectedKindOf).toBe("function");
    expect(typeof pkg.hashActivationBody).toBe("function");
    expect(pkg.BaselineFileSchema).toBeDefined();
    expect(pkg.BaselineAssertionSchema).toBeDefined();
    expect(pkg.CalibrationFileSchema).toBeDefined();
    expect(pkg.CalibrationEntrySchema).toBeDefined();
    expect(pkg.NoGeneratorForKindError).toBeDefined();
    expect(pkg.BaselineMissingError).toBeDefined();
    expect(pkg.BaselineFileParseError).toBeDefined();
    expect(pkg.DriftExceededError).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/test-generator-registry test barrel`
Expected: FAIL — exports undefined.

- [ ] **Step 3: Write minimal implementation**

Replace `packages/test-generator-registry/src/index.ts`:
```ts
export { TestGeneratorRegistry } from "./registry.js";
export { HumanBaselineStore } from "./baseline-store.js";
export { DriftDetector, hashActivationBody, CalibrationEntrySchema, CalibrationFileSchema } from "./drift.js";
export type { CalibrationEntry, CalibrationFile, DriftReport } from "./drift.js";
export { invokeGenerator } from "./invoker.js";
export type { GeneratorResult, InvokeGeneratorInput } from "./invoker.js";
export { isProtectedTarget, protectedKindOf } from "./protected.js";
export type { ProtectedKind } from "./protected.js";
export { BaselineFileSchema, BaselineAssertionSchema } from "./baseline-schema.js";
export type { BaselineFile, BaselineAssertion } from "./baseline-schema.js";
export {
  NoGeneratorForKindError,
  BaselineMissingError,
  BaselineFileParseError,
  DriftExceededError
} from "./errors.js";
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @atlas/test-generator-registry test && pnpm --filter @atlas/test-generator-registry typecheck`
Expected: PASS (all tests) + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/src/index.ts packages/test-generator-registry/test/barrel.test.ts
git commit -m "feat(test-generator-registry): barrel exports full public surface"
```

---

### Task 11: Integration — end-to-end against the real skill-library

**Files:**
- Test: `packages/test-generator-registry/test/integration-skill-library.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSkillsFromDir } from "@atlas/skill-runtime";
import { SkillRegistry } from "@atlas/skill-runtime";
import { TestGeneratorRegistry } from "../src/registry.js";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { invokeGenerator } from "../src/invoker.js";

const testGenDir = resolve(__dirname, "../../skill-library/skills/test-generators");
const baselinesDir = resolve(__dirname, "fixtures/baselines");

describe("integration: real skill-library", () => {
  it("indexes all 14 gen-test-* skills by node kind", async () => {
    const skills = await loadSkillsFromDir(testGenDir);
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);

    const kinds = reg.kinds().sort();
    expect(kinds.length).toBe(14);
    expect(kinds).toContain("page");
    expect(kinds).toContain("authboundary");
    expect(kinds).toContain("compliance");
  });

  it("invokes real gen-test-authboundary against a protected node → source=baseline", async () => {
    const skills = await loadSkillsFromDir(testGenDir);
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(baselinesDir);

    const node = { id: "ab1", kind: "authboundary" } as never;
    const result = invokeGenerator({ node, registry: reg, skillRegistry: skillReg, baselines });

    expect(result.emittedTestSource).toBe("baseline");
    expect(result.activationRecord.body).toMatch(/Human-authored baseline assertions/);
    expect(result.activationRecord.body).toMatch(/I13/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails OR verify `loadSkillsFromDir` exists**

Run: `pnpm --filter @atlas/test-generator-registry test integration-skill-library`
Expected: either FAIL with path issue or `loadSkillsFromDir` missing from skill-runtime.

If `loadSkillsFromDir` is not exported but the loader is available under another name, adjust the import to the actual loader symbol (check `packages/skill-runtime/src/loader.ts`). If no equivalent exists, use the fs-load-then-frontmatter-parse approach that C.2 uses.

- [ ] **Step 3: Ensure loader symbol matches real skill-runtime export**

If the real export name differs (e.g., `loadSkills`, `SkillLoader.loadFromDir`), change the import line only; the rest of the test stays identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test integration-skill-library`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/test-generator-registry/test/integration-skill-library.test.ts
git commit -m "test(test-generator-registry): integration against real packages/skill-library/skills/test-generators"
```

---

### Task 12: Repo-root baselines at `.atlas/baselines/`

**Files:**
- Create: `.atlas/baselines/authboundary.yaml`
- Create: `.atlas/baselines/pii-model.yaml`
- Create: `.atlas/baselines/compliance.yaml`
- Create: `.atlas/baselines/README.md`

- [ ] **Step 1: Author the repo-root authboundary baseline**

`.atlas/baselines/authboundary.yaml`:
```yaml
kind: authboundary
version: 1
assertions:
  - id: unauthed-returns-401
    description: Unauthed access to a protected route returns 401 and the correct redirect
    rationale: |
      Hard security floor. LLM-generated code must not relax this: unauthenticated
      requests to gated routes must fail closed.
    checklistItem: "GET the protected route without any session → response status 401, redirect header to configured sign-in path"
    mustEmitTest: true
    owner: security-team
  - id: wrong-role-403
    description: Authenticated user lacking the required role returns 403
    rationale: |
      Authorization is not the same as authentication. A valid session without the
      required role must be rejected.
    checklistItem: "Authed session with role NOT in AuthBoundary.roles → response status 403"
    mustEmitTest: true
    owner: security-team
  - id: session-expired-401
    description: Session past its expiry returns 401 and prompts re-auth
    rationale: |
      Session expiry is a safety boundary. Re-auth flow must be exercised explicitly.
    checklistItem: "Provide a session whose exp is in the past → 401 + re-auth flow initiated"
    mustEmitTest: true
    owner: security-team
```

- [ ] **Step 2: Author the repo-root pii-model baseline**

`.atlas/baselines/pii-model.yaml`:
```yaml
kind: pii-model
version: 1
assertions:
  - id: pii-not-in-logs
    description: PII-classified fields never appear in application logs
    rationale: |
      Privacy compliance floor. Any serialization path (JSON.stringify, log.info,
      error.stack) must not emit raw PII.
    checklistItem: "Serialize a Model instance containing PII fields via each declared log sink → redacted placeholders only"
    mustEmitTest: true
    owner: security-team
  - id: pii-not-in-error-messages
    description: Thrown errors do not include raw PII field values
    rationale: |
      Error messages frequently leak to external observability services.
    checklistItem: "Throw an error referencing a PII-classified field → err.message contains no raw value"
    mustEmitTest: true
    owner: security-team
```

- [ ] **Step 3: Author the repo-root compliance baseline**

`.atlas/baselines/compliance.yaml`:
```yaml
kind: compliance
version: 1
assertions:
  - id: every-declared-assertion-tested
    description: Each string in ComplianceClass.baselineAssertions has at least one matching Test
    rationale: |
      I13 requires source=baseline coverage for non-baseline ComplianceClasses.
      A declared assertion without a corresponding Test means compliance is only
      "documented", not "enforced".
    checklistItem: "For each item in ComplianceClass.baselineAssertions → emit a Test that exercises the assertion and covers the ComplianceClass node"
    mustEmitTest: true
    owner: compliance-team
```

- [ ] **Step 4: Author README**

`.atlas/baselines/README.md`:
```md
# Human Baselines

Files in this directory define **non-overridable security and compliance assertions**
that the LLM-generated test code must always satisfy. They are authored by humans
and pulled into the test-generator prompt by `@atlas/test-generator-registry`.

## Which kinds are covered

| File | Covers | Owner |
|------|--------|-------|
| `authboundary.yaml` | Every AuthBoundary node (I13 mandatory) | security-team |
| `pii-model.yaml` | Every Model with `piiClassification !== "none"` (I13 mandatory) | security-team |
| `compliance.yaml` | Every ComplianceClass whose `name !== "baseline"` (I13 mandatory) | compliance-team |

## Editing

- Keep the `id` stable across revisions — calibration snapshots pin to it.
- Bump `version` when assertions change; the drift detector will flag all pinned
  calibrations for that kind.
- Add new assertions by appending; do not renumber.

## Why not let the LLM write these

The Council flagged in PRD §10.1 that LLM-generated tests can drift under prompt
changes or model upgrades. Anchoring the security floor in human-authored YAML
makes the floor immutable across model swaps.
```

- [ ] **Step 5: Commit**

```bash
git add .atlas/baselines/
git commit -m "feat(baselines): seed human-authored AuthBoundary + PII-Model + Compliance baselines"
```

---

### Task 13: CLI — `atlas-tg baseline list|show` and `atlas-tg drift check`

**Files:**
- Create: `tools/test-gen-cli.mjs`
- Modify: `package.json` (root) — add `"tg:baseline"` and `"tg:drift"` scripts

- [ ] **Step 1: Write the CLI**

`tools/test-gen-cli.mjs`:
```js
#!/usr/bin/env node
// Usage:
//   node tools/test-gen-cli.mjs baseline list
//   node tools/test-gen-cli.mjs baseline show <kind>
//   node tools/test-gen-cli.mjs drift check <calibration.json>

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { HumanBaselineStore, DriftDetector, TestGeneratorRegistry } from "../packages/test-generator-registry/dist/index.js";
import { SkillRegistry, loadSkillsFromDir } from "../packages/skill-runtime/dist/index.js";

const [, , cmd, sub, ...rest] = process.argv;
const REPO_ROOT = resolve(process.cwd());
const BASELINES_DIR = resolve(REPO_ROOT, ".atlas/baselines");
const TEST_GEN_SKILLS = resolve(REPO_ROOT, "packages/skill-library/skills/test-generators");

async function main() {
  if (cmd === "baseline" && sub === "list") {
    const store = await HumanBaselineStore.fromDir(BASELINES_DIR);
    for (const kind of store.kinds()) {
      console.log(`${kind}: ${store.getAssertions(kind).length} assertions`);
    }
    return 0;
  }
  if (cmd === "baseline" && sub === "show") {
    const [kind] = rest;
    if (!kind) { console.error("Usage: baseline show <kind>"); return 2; }
    const store = await HumanBaselineStore.fromDir(BASELINES_DIR);
    const assertions = store.getAssertions(kind);
    for (const a of assertions) {
      console.log(`[${a.id}] ${a.description}`);
      console.log(`  checklist: ${a.checklistItem}`);
      console.log(`  rationale: ${a.rationale.replace(/\n/g, " ")}`);
      console.log(`  mustEmitTest: ${a.mustEmitTest}  owner: ${a.owner}`);
    }
    return 0;
  }
  if (cmd === "drift" && sub === "check") {
    const [calibPath] = rest;
    if (!calibPath) { console.error("Usage: drift check <calibration.json>"); return 2; }
    const calibration = JSON.parse(await readFile(resolve(calibPath), "utf8"));
    // Graph loading is out of scope for this CLI; require a graph JSON as second arg if present.
    // For v0, we load from .atlas/spec.graph.json if it exists, else skip.
    let graph = { nodes: {} };
    try {
      graph = JSON.parse(await readFile(resolve(REPO_ROOT, ".atlas/spec.graph.json"), "utf8"));
    } catch { /* optional */ }

    const skills = await loadSkillsFromDir(TEST_GEN_SKILLS);
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(BASELINES_DIR);
    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);
    console.log(JSON.stringify(report, null, 2));
    return report.driftedCount > 0 ? 1 : 0;
  }
  console.error("Commands:\n  baseline list\n  baseline show <kind>\n  drift check <calibration.json>");
  return 2;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add root scripts**

In root `package.json`, append under `"scripts"`:
```json
"tg:baseline": "node tools/test-gen-cli.mjs baseline",
"tg:drift": "node tools/test-gen-cli.mjs drift check"
```

- [ ] **Step 3: Smoke test manually**

Run: `pnpm --filter @atlas/skill-runtime build && pnpm --filter @atlas/test-generator-registry build && node tools/test-gen-cli.mjs baseline list`
Expected: lists 3 kinds with their assertion counts.

Run: `node tools/test-gen-cli.mjs baseline show authboundary`
Expected: prints the 3 assertions.

- [ ] **Step 4: Commit**

```bash
git add tools/test-gen-cli.mjs package.json
git commit -m "feat(test-generator-registry): CLI for baseline list/show + drift check"
```

---

### Task 14: CLI smoke test in Vitest

**Files:**
- Test: `packages/test-generator-registry/test/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../../tools/test-gen-cli.mjs");

describe("test-gen-cli smoke", () => {
  it("baseline list prints kind lines", () => {
    const out = execFileSync("node", [CLI, "baseline", "list"], { encoding: "utf8" });
    expect(out).toMatch(/authboundary:/);
    expect(out).toMatch(/pii-model:/);
    expect(out).toMatch(/compliance:/);
  });

  it("baseline show authboundary prints first assertion", () => {
    const out = execFileSync("node", [CLI, "baseline", "show", "authboundary"], { encoding: "utf8" });
    expect(out).toMatch(/unauthed-returns-401/);
  });
});
```

- [ ] **Step 2: Ensure packages are built before running CLI tests**

Prefix the test script: the CLI imports compiled dist/ of skill-runtime and test-generator-registry. Ensure builds exist.

Run: `pnpm --filter @atlas/skill-runtime build && pnpm --filter @atlas/test-generator-registry build`

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter @atlas/test-generator-registry test cli-smoke`
Expected: PASS (2 passed).

- [ ] **Step 4: Commit**

```bash
git add packages/test-generator-registry/test/cli-smoke.test.ts
git commit -m "test(test-generator-registry): CLI smoke coverage for baseline list/show"
```

---

### Task 15: README + public docs

**Files:**
- Create: `packages/test-generator-registry/README.md`

- [ ] **Step 1: Write the README**

`packages/test-generator-registry/README.md`:
```md
# @atlas/test-generator-registry

Resolves a spec-graph node to the correct test-generator skill, injects
human-authored baseline assertions for protected targets (AuthBoundary, PII
Models, non-baseline ComplianceClass), and detects drift against a locked
calibration dataset.

This package is the C.3 deliverable of the Atlas Phase A plan. It is the bridge
between the skill library (C.2) and the Developer / Security / Accessibility
roles (D.3 / D.4 / D.5): roles call `invokeGenerator(node, ...)` to get a prompt
body that already contains the non-overridable baselines.

## Why baselines are human-authored

PRD §10.1 records the Council's concern that LLM-generated tests drift under
model upgrades. Anchoring the security + compliance floor in committed YAML
means the floor is invariant across model swaps and prompt refactors.

## API

```ts
import {
  TestGeneratorRegistry,
  HumanBaselineStore,
  invokeGenerator,
  DriftDetector,
  isProtectedTarget
} from "@atlas/test-generator-registry";

const skillReg = new SkillRegistry(await loadSkillsFromDir("packages/skill-library/skills/test-generators"));
const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
const baselines = await HumanBaselineStore.fromDir(".atlas/baselines");

const result = invokeGenerator({
  node: graph.nodes["ab-admin"], // AuthBoundary
  registry: reg,
  skillRegistry: skillReg,
  baselines
});

// result.emittedTestSource === "baseline"
// result.activationRecord.body contains the generator skill + appended baselines
// result.baselineAssertions lists the injected assertions
```

## Protected target mapping (mirrors I13)

| Node kind | Protected when | Baseline file |
|-----------|---------------|---------------|
| `authboundary` | always | `.atlas/baselines/authboundary.yaml` |
| `model` | `piiClassification !== "none"` | `.atlas/baselines/pii-model.yaml` |
| `compliance` | `name !== "baseline"` | `.atlas/baselines/compliance.yaml` |

Any other node kind yields `emittedTestSource: "generated"` with no baseline injection.

## Drift detection

The `DriftDetector` re-invokes generators for every calibration entry, hashes
the activation body with SHA-256, and compares against the pinned hash. Any
mismatch is reported with a short diff. Intended use: nightly CI job + a
`pre-publish` check on the skill-library repo.

## CLI

```bash
node tools/test-gen-cli.mjs baseline list
node tools/test-gen-cli.mjs baseline show authboundary
node tools/test-gen-cli.mjs drift check calibration.json
```

## Dependencies

- `@atlas/skill-runtime` — SkillRegistry, ActivationRecord, skill loader.
- `@atlas/spec-graph-schema` — node kinds, I13 definitions.

## Exit criteria (C.3 complete)

- [ ] All 14 test-generator skills indexed by kind.
- [ ] Baseline YAMLs committed at repo-root `.atlas/baselines/`.
- [ ] `invokeGenerator` emits `source: "baseline"` for all three protected kinds.
- [ ] `DriftDetector` reports 0 drift on current snapshot.
- [ ] CLI smoke-tested in Vitest.
```

- [ ] **Step 2: Commit**

```bash
git add packages/test-generator-registry/README.md
git commit -m "docs(test-generator-registry): README — API, protected-target table, drift + CLI usage"
```

---

### Task 16: Plan index update — mark C.3 shipped

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add row to plan index**

Insert a new row immediately after the C.2 row (row 8) referencing this plan:

```markdown
| 8a | `2026-04-21-test-generator-registry.md` | **C.3 — Test-Generator Registry + Human Baselines** | Node-kind → generator-skill index; HumanBaselineStore loads `.atlas/baselines/*.yaml`; invokeGenerator injects baselines for AuthBoundary + PII-Model + ComplianceClass (I13-aligned); DriftDetector with SHA-256 pinning; CLI for baseline list/show + drift check | 16 tasks, TDD | Shipped (merged <SHA>) |
```

- [ ] **Step 2: (If a Phase A Exit Checklist row does not exist for C.3, add one)**

If the checklist lists only "C.1" and "C.2", add:
```markdown
- [x] C.3 — Test-Generator Registry + Human Baselines (`<SHA>`)
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): mark C.3 shipped (merged <SHA>)"
```

(Replace `<SHA>` with the actual merge SHA after the branch is merged.)

---

## Completion Checklist

- [ ] Task 1: `@atlas/test-generator-registry` package scaffold
- [ ] Task 2: `isProtectedTarget` / `protectedKindOf` (mirrors I13)
- [ ] Task 3: BaselineFile / BaselineAssertion Zod schemas
- [ ] Task 4: `HumanBaselineStore.fromDir`
- [ ] Task 5: `TestGeneratorRegistry.fromSkillRegistry`
- [ ] Task 6: `invokeGenerator` — non-protected happy path
- [ ] Task 7: `invokeGenerator` — protected-target baseline injection
- [ ] Task 8: `DriftDetector` with SHA-256 body hashing
- [ ] Task 9: Drift edge cases (missing node)
- [ ] Task 10: Barrel exports + typecheck clean
- [ ] Task 11: Integration test against real skill-library
- [ ] Task 12: Repo-root `.atlas/baselines/*.yaml` seed
- [ ] Task 13: `tools/test-gen-cli.mjs` + root scripts
- [ ] Task 14: CLI smoke test in Vitest
- [ ] Task 15: README
- [ ] Task 16: Plan index update

---

## Handoff

Next plan in the chain: none in Phase A — C.3 is the last Unit C plan. The
registry + baselines will be consumed by **D.3 Developer role** (already shipped:
wire a post-merge task that replaces D.3's stub generator calls with
`invokeGenerator`) and **D.4 Security role** (already shipped: the L4 gate reads
`source: "baseline"` tests from the graph to enforce I13 during merge).

Open follow-ups flagged for Phase B:
1. GitHub Action that runs `drift check` nightly against `main`.
2. Baseline-file PR guard: require security-team review for modifications to
   `.atlas/baselines/*.yaml`.
3. Baseline version bump → emit an event on the spec-graph so roles can
   invalidate their cached generator results.
