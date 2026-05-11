# Skill Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@atlas/skill-runtime` — the TypeScript package that loads `*.md` skill files from the bundled library and from local `.atlas/skills/` overrides, parses and validates their frontmatter, exposes a typed `SkillRegistry` with `get()`, `list()`, `activate()`, and `match()` operations, resolves `composes` dependency order with cycle detection, validates `.atlas/skills/pin.json` version pins, and provides a provider-agnostic `IntentClassifier` interface (backed by a mock for tests; real Haiku-4.5 wiring is D.1's job).

**Architecture:** A single new pnpm-workspace package (`packages/skill-runtime/`). TypeScript / Zod — no DB, no real LLM calls. Each skill is a markdown file with YAML frontmatter (parsed via `js-yaml`) and a body. `parseFrontmatter` splits the raw string; `validateFrontmatter` runs Zod. The `SkillRegistry` class accepts an injected `IntentClassifier` so it is provider-agnostic from the start. `composes` fields are resolved to a topological order at registry build time; cycles surface as structured `CyclicDependencyError` objects. The package imports `nodeRegistry` and `edgeRegistry` directly from `@atlas/spec-graph-schema` — no local projection — per OQ7 resolution below. The real Haiku-4.5 classifier is wired in D.1; C.1 ships only the interface + a deterministic mock.

**Tech Stack:** TypeScript 5.6.3 · Node 22 LTS · pnpm workspaces · Zod 3.23.8 · js-yaml 4.x · Vitest 2.1.8. Runtime dependency on `@atlas/spec-graph-schema` (workspace: `*`). No live LLM dependency.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans B.1 and B.2 merged (`@atlas/spec-graph-schema` is in the workspace; `dist/index.js` exists after `pnpm -F @atlas/spec-graph-schema build`).
- Node 22 LTS (`node --version` ≥ v22.0.0) and pnpm 9+.
- No DB needed for this package's own tests (pure unit).

---

## Open-question resolutions

These lock the design decisions from `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` §Unit C.

**OQ2 — Intent classifier model.** C.1 ships a provider-agnostic `IntentClassifier` interface with a deterministic `MockIntentClassifier` for tests. The interface includes a `onClassification(result, latencyMs, cacheKey)` telemetry hook from day one so NFR-13 (>80% prompt-cache hit rate) can be measured as soon as D.1 injects the real Haiku-4.5 provider. No live API call in C.1.

**OQ3 — Human-baseline authorship.** Deferred to C.3. C.3 will decide the ownership model (named engineer vs. security-consultant review committee) before the test-generator registry is built.

**OQ4 — OSS release cadence.** Deferred to C.2. C.2 authors the public `github.com/atlas-labs/atlas-skills` mirror workflow and will lock weekly patch / monthly minor cadence there.

**OQ6 — Calibration dataset.** Deferred to C.3. C.3 will decide whether Unit A's reconciliation classifier and Unit C's drift detector share a dataset or maintain separate corpora.

**OQ7 — Registry wiring.** Direct import. `@atlas/skill-runtime` imports `nodeRegistry` and `edgeRegistry` from `@atlas/spec-graph-schema`. Skills that reference node/edge types in their Zod `inputs`/`outputs` schemas import `type Node` from `@atlas/spec-graph-schema` at skill-authoring time. No local projection.

**OQ8 — Cross-field refinement in skill I/O schemas.** Skill frontmatter `inputs` and `outputs` are stored as opaque Zod schemas. Skills needing cross-field rules on a discriminated union must use the B.1 split-then-superRefine pattern: declare the discriminated union with the base (non-refined) schema variants, then apply `.superRefine` at the outer level. Reference: `AuthBoundarySchema` in `packages/spec-graph-schema/src/nodes/auth-boundary.ts`. Task 18 of this plan validates the pattern with a fixture skill.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  skill-runtime/
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts                             # public exports
      frontmatter.ts                       # SkillFrontmatterSchema + parseFrontmatter + validateFrontmatter
      skill.ts                             # Skill type
      loader.ts                            # loadSkillsFromDir
      classifier.ts                        # IntentClassifier interface + MockIntentClassifier
      registry.ts                          # SkillRegistry class
      topo.ts                              # topological sort + cycle detection
      pin.ts                               # SkillPin schema + parsePinFile + loadPinFile
      helpers.ts                           # createRegistryFromBundledLibrary + createRegistryWithOverrides
    test/
      frontmatter.test.ts
      loader.test.ts
      registry-get-list.test.ts
      registry-activate.test.ts
      registry-match.test.ts
      topo.test.ts
      pin.test.ts
      helpers.test.ts
      schema-wire-up.test.ts               # nodeRegistry import round-trip
      cross-field-refinement.test.ts       # superRefine pattern fixture
      classifier-telemetry.test.ts
      fixtures/
        skills/
          brainstorm.md                    # minimal fixture skill (no inputs/outputs)
          tdd-feature.md                   # fixture skill with inputs schema
          compose-a.md                     # composes compose-b
          compose-b.md                     # composes compose-c
          compose-c.md                     # leaf skill
          cycle-x.md                       # composes cycle-y
          cycle-y.md                       # composes cycle-x (creates a cycle)
          page-input.md                    # inputs schema references nodeRegistry.page
          cross-field.md                   # inputs uses superRefine pattern
        pin.json                           # sample pin file with two entries

docs/superpowers/plans/
  2026-04-20-skill-runtime.md             # THIS FILE
  README.md                               # MODIFIED: plan index gains C.1 entry
```

**What Plan C.1 does NOT build.** The ~35 starter skill markdown files themselves (C.2). The OSS publishing pipeline and `github.com/atlas-labs/atlas-skills` mirror workflow (C.2). The test-generator registry keyed to the 14 node types (C.3). Human-authored baseline assertions (C.3). Drift-detection CI job (C.3). Real Haiku-4.5 LLM wiring (D.1). Pin-based dependency-update PRs (C.2).

---

## Task List (20 tasks)

Each task is TDD-shaped: write the failing test, run red, write minimal code, run green, commit. Every task commits. Commits use Conventional Commits prefixes.

---

### Task 1: Package scaffold

**Files:**
- Create: `packages/skill-runtime/package.json`
- Create: `packages/skill-runtime/tsconfig.json`
- Create: `packages/skill-runtime/vitest.config.ts`
- Create: `packages/skill-runtime/src/index.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@atlas/skill-runtime",
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

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: src/index.ts (stub)**

```ts
export const PACKAGE_NAME = "@atlas/skill-runtime";
```

- [ ] **Step 5: Install and verify scaffold**

```bash
pnpm install
pnpm -F @atlas/skill-runtime typecheck
```

Expected: both commands exit 0. `node_modules/@atlas/skill-runtime` does not exist (private package); `pnpm install` resolves the workspace link to `@atlas/spec-graph-schema`.

- [ ] **Step 6: Commit**

```bash
git add packages/skill-runtime pnpm-lock.yaml
git commit -m "feat(skill-runtime): scaffold package with zod 3.23.8 + js-yaml 4.1.0"
```

---

### Task 2: `SkillFrontmatterSchema` Zod schema

**Files:**
- Create: `packages/skill-runtime/src/frontmatter.ts`
- Create: `packages/skill-runtime/test/frontmatter.test.ts` (schema validation tests only; parser tests in Task 3)

- [ ] **Step 1: Write the failing tests**

`packages/skill-runtime/test/frontmatter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateFrontmatter } from "../src/frontmatter.js";

describe("validateFrontmatter", () => {
  it("accepts minimal valid frontmatter", () => {
    const result = validateFrontmatter({
      name: "brainstorm",
      description: "Explore requirements before building",
      activate_on: ["brainstorm", "what should I build"]
    });
    expect(result.name).toBe("brainstorm");
    expect(result.composes).toBeUndefined();
    expect(result.model_hint).toBeUndefined();
  });

  it("accepts full frontmatter with all optional fields", () => {
    const result = validateFrontmatter({
      name: "tdd-feature",
      description: "TDD a new feature end-to-end",
      activate_on: ["tdd", "write tests first"],
      composes: ["brainstorm"],
      model_hint: "claude-haiku-4-5",
      inputs: null,
      outputs: null
    });
    expect(result.composes).toEqual(["brainstorm"]);
    expect(result.model_hint).toBe("claude-haiku-4-5");
  });

  it("rejects missing name", () => {
    expect(() =>
      validateFrontmatter({ description: "x", activate_on: ["x"] })
    ).toThrow();
  });

  it("rejects missing description", () => {
    expect(() =>
      validateFrontmatter({ name: "x", activate_on: ["x"] })
    ).toThrow();
  });

  it("rejects missing activate_on", () => {
    expect(() =>
      validateFrontmatter({ name: "x", description: "x" })
    ).toThrow();
  });

  it("rejects empty activate_on array", () => {
    expect(() =>
      validateFrontmatter({ name: "x", description: "x", activate_on: [] })
    ).toThrow();
  });

  it("rejects name with spaces", () => {
    expect(() =>
      validateFrontmatter({ name: "my skill", description: "x", activate_on: ["x"] })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: `Cannot find module '../src/frontmatter.js'` or similar — all tests fail.

- [ ] **Step 3: Implement `src/frontmatter.ts`**

```ts
import { z } from "zod";

/**
 * Canonical shape of skill frontmatter.
 * `inputs` and `outputs` are stored as `unknown` at parse time;
 * individual skills supply Zod schemas that callers evaluate.
 * Name must be a kebab/snake identifier with no spaces.
 */
export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, "name must contain only word characters and hyphens"),
  description: z.string().min(1),
  activate_on: z.array(z.string().min(1)).min(1),
  composes: z.array(z.string().min(1)).optional(),
  model_hint: z.string().optional(),
  inputs: z.unknown().optional(),
  outputs: z.unknown().optional()
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export function validateFrontmatter(raw: unknown): SkillFrontmatter {
  return SkillFrontmatterSchema.parse(raw);
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|✗|×"
```

Expected: all 7 tests in `frontmatter.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/frontmatter.ts packages/skill-runtime/test/frontmatter.test.ts
git commit -m "feat(skill-runtime): SkillFrontmatterSchema with name/description/activate_on/composes/model_hint/inputs/outputs"
```

---

### Task 3: Frontmatter parser

**Files:**
- Modify: `packages/skill-runtime/src/frontmatter.ts` (add `parseFrontmatter`)
- Extend: `packages/skill-runtime/test/frontmatter.test.ts` (add parser tests)

- [ ] **Step 1: Add failing parser tests**

Append to `packages/skill-runtime/test/frontmatter.test.ts`:

```ts
import { parseFrontmatter } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
  const md = `---
name: brainstorm
description: Explore requirements
activate_on:
  - brainstorm
  - explore
---

# Brainstorm

Think about what you want to build.
`;

  it("extracts frontmatter object", () => {
    const { frontmatter } = parseFrontmatter(md);
    expect((frontmatter as Record<string, unknown>).name).toBe("brainstorm");
  });

  it("extracts body without the delimiters", () => {
    const { body } = parseFrontmatter(md);
    expect(body.trim()).toMatch(/^# Brainstorm/);
    expect(body).not.toContain("---");
  });

  it("returns empty-object frontmatter for a file with no frontmatter block", () => {
    const { frontmatter, body } = parseFrontmatter("# Just a body\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("# Just a body");
  });

  it("throws a descriptive error when YAML is malformed", () => {
    const bad = `---\nkey: [\n---\n# body\n`;
    expect(() => parseFrontmatter(bad)).toThrow(/YAML/i);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "parseFrontmatter|FAIL|Cannot find"
```

Expected: `parseFrontmatter is not a function` or import error — parser tests fail.

- [ ] **Step 3: Implement `parseFrontmatter` in `src/frontmatter.ts`**

Add to the top of `src/frontmatter.ts`:

```ts
import yaml from "js-yaml";
```

Add after the existing exports:

```ts
export interface ParsedSkill {
  frontmatter: unknown;
  body: string;
}

/**
 * Splits a skill markdown file into its YAML frontmatter object and body text.
 * Frontmatter must be fenced by `---` lines at the very start of the file.
 * Files with no opening `---` are returned with an empty frontmatter object.
 * Throws a descriptive error (wrapping js-yaml's YAMLException) if the YAML
 * between the delimiters is syntactically invalid.
 */
export function parseFrontmatter(markdown: string): ParsedSkill {
  const DELIMITER = "---";

  if (!markdown.startsWith(DELIMITER)) {
    return { frontmatter: {}, body: markdown };
  }

  const afterFirst = markdown.slice(DELIMITER.length);
  const secondDelimIdx = afterFirst.indexOf("\n" + DELIMITER);

  if (secondDelimIdx === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const yamlText = afterFirst.slice(0, secondDelimIdx);
  const body = afterFirst.slice(secondDelimIdx + ("\n" + DELIMITER).length);

  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(yamlText) ?? {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`YAML parse error in skill frontmatter: ${msg}`);
  }

  return { frontmatter, body };
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all tests pass (both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/frontmatter.ts packages/skill-runtime/test/frontmatter.test.ts
git commit -m "feat(skill-runtime): parseFrontmatter — split YAML front-matter from markdown body via js-yaml"
```

---

### Task 4: `Skill` type and fixture files

**Files:**
- Create: `packages/skill-runtime/src/skill.ts`
- Create: `packages/skill-runtime/test/fixtures/skills/brainstorm.md`
- Create: `packages/skill-runtime/test/fixtures/skills/tdd-feature.md`
- Create: `packages/skill-runtime/test/fixtures/skills/compose-a.md`
- Create: `packages/skill-runtime/test/fixtures/skills/compose-b.md`
- Create: `packages/skill-runtime/test/fixtures/skills/compose-c.md`
- Create: `packages/skill-runtime/test/fixtures/skills/cycle-x.md`
- Create: `packages/skill-runtime/test/fixtures/skills/cycle-y.md`

- [ ] **Step 1: `src/skill.ts`**

```ts
import type { SkillFrontmatter } from "./frontmatter.js";

/**
 * A fully-parsed skill: its validated frontmatter, the raw markdown body,
 * and the absolute path of the source file (for error messages).
 */
export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  sourcePath: string;
}
```

- [ ] **Step 2: Fixture skill files**

`test/fixtures/skills/brainstorm.md`:
```markdown
---
name: brainstorm
description: Explore requirements before building anything
activate_on:
  - brainstorm
  - what should I build
  - explore
---

# Brainstorm

Work through the user's intent, constraints, and success criteria before touching code.
```

`test/fixtures/skills/tdd-feature.md`:
```markdown
---
name: tdd-feature
description: Implement a new feature using strict TDD
activate_on:
  - tdd
  - write tests first
  - test driven
model_hint: claude-sonnet-4-5
---

# TDD Feature

Write the failing test, run red, write minimal code, run green, refactor, commit.
```

`test/fixtures/skills/compose-a.md`:
```markdown
---
name: compose-a
description: Top-level skill that composes compose-b
activate_on:
  - compose-a
composes:
  - compose-b
---

Body of compose-a.
```

`test/fixtures/skills/compose-b.md`:
```markdown
---
name: compose-b
description: Mid-level skill that composes compose-c
activate_on:
  - compose-b
composes:
  - compose-c
---

Body of compose-b.
```

`test/fixtures/skills/compose-c.md`:
```markdown
---
name: compose-c
description: Leaf skill with no composes
activate_on:
  - compose-c
---

Body of compose-c.
```

`test/fixtures/skills/cycle-x.md`:
```markdown
---
name: cycle-x
description: Skill that causes a dependency cycle
activate_on:
  - cycle-x
composes:
  - cycle-y
---

Body of cycle-x.
```

`test/fixtures/skills/cycle-y.md`:
```markdown
---
name: cycle-y
description: Skill that closes the cycle back to cycle-x
activate_on:
  - cycle-y
composes:
  - cycle-x
---

Body of cycle-y.
```

- [ ] **Step 3: Typecheck**

```bash
pnpm -F @atlas/skill-runtime typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/skill-runtime/src/skill.ts packages/skill-runtime/test/fixtures/
git commit -m "feat(skill-runtime): Skill type + test fixture skills (brainstorm, tdd-feature, compose chain, cycle pair)"
```

---

### Task 5: Skill loader — `loadSkillsFromDir`

**Files:**
- Create: `packages/skill-runtime/src/loader.ts`
- Create: `packages/skill-runtime/test/loader.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/loader.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/loader.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

describe("loadSkillsFromDir", () => {
  it("loads all .md files from the directory", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    const names = skills.map((s) => s.frontmatter.name);
    expect(names).toContain("brainstorm");
    expect(names).toContain("tdd-feature");
    expect(names).toContain("compose-a");
  });

  it("sets sourcePath to the absolute file path", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    const brainstorm = skills.find((s) => s.frontmatter.name === "brainstorm");
    expect(brainstorm?.sourcePath).toMatch(/brainstorm\.md$/);
    expect(path.isAbsolute(brainstorm!.sourcePath)).toBe(true);
  });

  it("populates the body field", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    const brainstorm = skills.find((s) => s.frontmatter.name === "brainstorm");
    expect(brainstorm?.body.trim()).toMatch(/^# Brainstorm/);
  });

  it("returns empty array for a non-existent directory", () => {
    const skills = loadSkillsFromDir(path.join(FIXTURES_DIR, "__no_such_dir__"));
    expect(skills).toEqual([]);
  });

  it("skips non-.md files silently", () => {
    // The fixtures directory has only .md files — confirm no phantom entries
    const skills = loadSkillsFromDir(FIXTURES_DIR);
    for (const skill of skills) {
      expect(skill.sourcePath).toMatch(/\.md$/);
    }
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "loader|Cannot find|FAIL"
```

Expected: import error for `../src/loader.js`.

- [ ] **Step 3: Implement `src/loader.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import type { Skill } from "./skill.js";
import { parseFrontmatter, validateFrontmatter } from "./frontmatter.js";

/**
 * Reads every `*.md` file in `dir`, parses frontmatter + body, and returns
 * the resulting `Skill[]`. Files that fail frontmatter validation are skipped
 * with a `console.warn` rather than crashing the loader — a bad user-authored
 * skill should not prevent the rest of the library from loading.
 * Returns `[]` if the directory does not exist.
 */
export function loadSkillsFromDir(dir: string): Skill[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const sourcePath = path.resolve(dir, entry.name);
    const raw = fs.readFileSync(sourcePath, "utf-8");

    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      console.warn(`[skill-runtime] Skipping ${sourcePath}: YAML parse error — ${String(err)}`);
      continue;
    }

    let frontmatter: ReturnType<typeof validateFrontmatter>;
    try {
      frontmatter = validateFrontmatter(parsed.frontmatter);
    } catch (err) {
      console.warn(`[skill-runtime] Skipping ${sourcePath}: invalid frontmatter — ${String(err)}`);
      continue;
    }

    skills.push({ frontmatter, body: parsed.body, sourcePath });
  }

  return skills;
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all tests in `loader.test.ts` pass in addition to earlier tests.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/loader.ts packages/skill-runtime/test/loader.test.ts
git commit -m "feat(skill-runtime): loadSkillsFromDir — reads *.md, parses frontmatter, skips invalid with warn"
```

---

### Task 6: `IntentClassifier` interface + `MockIntentClassifier`

**Files:**
- Create: `packages/skill-runtime/src/classifier.ts`

- [ ] **Step 1: Write failing typecheck test**

`packages/skill-runtime/test/classifier-telemetry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MockIntentClassifier } from "../src/classifier.js";

describe("MockIntentClassifier", () => {
  it("classifies intent to the first skill whose activate_on contains a matching token", async () => {
    const classifier = new MockIntentClassifier([
      { name: "brainstorm", activate_on: ["brainstorm", "explore"] },
      { name: "tdd-feature", activate_on: ["tdd", "tests"] }
    ]);
    const result = await classifier.classify("I want to brainstorm my app idea");
    expect(result.matches).toContainEqual(expect.objectContaining({ name: "brainstorm" }));
  });

  it("returns empty matches for an unrecognised intent", async () => {
    const classifier = new MockIntentClassifier([
      { name: "brainstorm", activate_on: ["brainstorm"] }
    ]);
    const result = await classifier.classify("deploy to production");
    expect(result.matches).toHaveLength(0);
  });

  it("fires the onClassification telemetry hook with result and latencyMs", async () => {
    const hook = vi.fn();
    const classifier = new MockIntentClassifier(
      [{ name: "brainstorm", activate_on: ["brainstorm"] }],
      { onClassification: hook }
    );
    await classifier.classify("brainstorm an idea");
    expect(hook).toHaveBeenCalledOnce();
    const [result, latencyMs, cacheKey] = hook.mock.calls[0];
    expect(result.matches.length).toBeGreaterThan(0);
    expect(typeof latencyMs).toBe("number");
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof cacheKey).toBe("string");
  });

  it("cacheKey is deterministic for the same input", async () => {
    const keys: string[] = [];
    const classifier = new MockIntentClassifier(
      [{ name: "brainstorm", activate_on: ["brainstorm"] }],
      {
        onClassification: (_result, _ms, key) => {
          keys.push(key);
        }
      }
    );
    await classifier.classify("brainstorm");
    await classifier.classify("brainstorm");
    expect(keys[0]).toBe(keys[1]);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "classifier|Cannot find|FAIL"
```

Expected: import error for `../src/classifier.js`.

- [ ] **Step 3: Implement `src/classifier.ts`**

```ts
/**
 * A single match result from intent classification.
 */
export interface ClassificationMatch {
  name: string;
  confidence: number; // 0–1; mock always uses 1.0 for exact token matches
}

/**
 * The result of classifying a user intent string.
 */
export interface ClassificationResult {
  intent: string;
  matches: ClassificationMatch[];
}

/**
 * Telemetry hook type — called after every classification.
 * `latencyMs` is the wall-clock time of the classification call.
 * `cacheKey` is a deterministic string derived from the intent; identical
 * intents produce identical keys so hit-rate tracking is accurate.
 */
export type OnClassificationHook = (
  result: ClassificationResult,
  latencyMs: number,
  cacheKey: string
) => void;

export interface ClassifierOptions {
  onClassification?: OnClassificationHook;
}

/**
 * Provider-agnostic intent-classifier interface.
 * C.1 ships the interface and a deterministic mock.
 * D.1 injects the real Haiku-4.5-backed implementation.
 */
export interface IntentClassifier {
  classify(intent: string): Promise<ClassificationResult>;
}

/** Minimal skill descriptor used by MockIntentClassifier (avoids circular dep on registry). */
export interface SkillDescriptor {
  name: string;
  activate_on: string[];
}

/**
 * Deterministic classifier for use in tests.
 * Matches when any token in `activate_on` appears (case-insensitive) in the intent string.
 * Fires the `onClassification` telemetry hook after every call.
 */
export class MockIntentClassifier implements IntentClassifier {
  private readonly skills: SkillDescriptor[];
  private readonly hook: OnClassificationHook | undefined;

  constructor(skills: SkillDescriptor[], options: ClassifierOptions = {}) {
    this.skills = skills;
    this.hook = options.onClassification;
  }

  async classify(intent: string): Promise<ClassificationResult> {
    const start = Date.now();
    const lower = intent.toLowerCase();

    const matches: ClassificationMatch[] = this.skills
      .filter((s) => s.activate_on.some((token) => lower.includes(token.toLowerCase())))
      .map((s) => ({ name: s.name, confidence: 1.0 }));

    const result: ClassificationResult = { intent, matches };
    const latencyMs = Date.now() - start;
    const cacheKey = `mock:${intent}`;

    this.hook?.(result, latencyMs, cacheKey);
    return result;
  }
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all tests pass including the 4 classifier-telemetry tests.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/classifier.ts packages/skill-runtime/test/classifier-telemetry.test.ts
git commit -m "feat(skill-runtime): IntentClassifier interface + MockIntentClassifier with telemetry hook (OQ2)"
```

---

### Task 7: Topological sort + cycle detection

**Files:**
- Create: `packages/skill-runtime/src/topo.ts`
- Create: `packages/skill-runtime/test/topo.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/topo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { topoSort, CyclicDependencyError } from "../src/topo.js";

describe("topoSort", () => {
  it("returns a single node with no dependencies as-is", () => {
    const order = topoSort({ leaf: [] });
    expect(order).toEqual(["leaf"]);
  });

  it("returns the correct order for a linear chain (a → b → c)", () => {
    const order = topoSort({ a: ["b"], b: ["c"], c: [] });
    // c must come before b; b before a
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });

  it("handles multiple roots with a shared dependency", () => {
    const order = topoSort({ root1: ["shared"], root2: ["shared"], shared: [] });
    expect(order.indexOf("shared")).toBeLessThan(order.indexOf("root1"));
    expect(order.indexOf("shared")).toBeLessThan(order.indexOf("root2"));
  });

  it("throws CyclicDependencyError for a two-node cycle", () => {
    expect(() => topoSort({ x: ["y"], y: ["x"] })).toThrow(CyclicDependencyError);
  });

  it("CyclicDependencyError carries the cycle node names", () => {
    try {
      topoSort({ x: ["y"], y: ["x"] });
    } catch (err) {
      expect(err).toBeInstanceOf(CyclicDependencyError);
      const cycleErr = err as CyclicDependencyError;
      expect(cycleErr.cycle.length).toBeGreaterThanOrEqual(2);
      expect(cycleErr.cycle).toContain("x");
      expect(cycleErr.cycle).toContain("y");
    }
  });

  it("throws CyclicDependencyError for a self-referential skill", () => {
    expect(() => topoSort({ self: ["self"] })).toThrow(CyclicDependencyError);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "topo|FAIL|Cannot find"
```

Expected: import error for `../src/topo.js`.

- [ ] **Step 3: Implement `src/topo.ts`**

```ts
/**
 * Thrown when `topoSort` detects a cycle in the skill composition graph.
 */
export class CyclicDependencyError extends Error {
  /** The names of the nodes involved in the cycle, in detection order. */
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`Cyclic skill dependency detected: ${cycle.join(" → ")}`);
    this.name = "CyclicDependencyError";
    this.cycle = cycle;
  }
}

/**
 * Kahn's algorithm topological sort.
 *
 * @param graph - An adjacency map `{ node: [dependency, ...] }`.
 *                Every node referenced as a dependency must appear as a key.
 * @returns     - Nodes in dependency-first order (leaves first, roots last).
 * @throws      - `CyclicDependencyError` if the graph contains a cycle.
 */
export function topoSort(graph: Record<string, string[]>): string[] {
  // Build in-degree counts
  const inDegree = new Map<string, number>();
  for (const node of Object.keys(graph)) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
  }
  for (const deps of Object.values(graph)) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Seed the queue with zero-in-degree nodes (leaves)
  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    // Sort for determinism
    queue.sort();
    const node = queue.shift()!;
    order.push(node);

    // For every node that depends on this one, reduce its in-degree
    for (const [n, deps] of Object.entries(graph)) {
      if (deps.includes(node)) {
        const newDeg = (inDegree.get(n) ?? 0) - 1;
        inDegree.set(n, newDeg);
        if (newDeg === 0) queue.push(n);
      }
    }
  }

  if (order.length !== inDegree.size) {
    // Remaining non-zero in-degree nodes form the cycle
    const remaining = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([n]) => n);
    throw new CyclicDependencyError(remaining);
  }

  return order;
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all topo tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/topo.ts packages/skill-runtime/test/topo.test.ts
git commit -m "feat(skill-runtime): topoSort + CyclicDependencyError — Kahn's algorithm for composes resolution"
```

---

### Task 8: `SkillRegistry` class — `get` and `list`

**Files:**
- Create: `packages/skill-runtime/src/registry.ts`
- Create: `packages/skill-runtime/test/registry-get-list.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/registry-get-list.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/loader.js";
import { SkillRegistry } from "../src/registry.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

function makeRegistry(): SkillRegistry {
  const skills = loadSkillsFromDir(FIXTURES_DIR);
  return new SkillRegistry(skills);
}

describe("SkillRegistry.get", () => {
  it("returns a skill by exact name", () => {
    const reg = makeRegistry();
    const skill = reg.get("brainstorm");
    expect(skill).toBeDefined();
    expect(skill!.frontmatter.name).toBe("brainstorm");
  });

  it("returns undefined for an unknown name", () => {
    const reg = makeRegistry();
    expect(reg.get("nonexistent-skill")).toBeUndefined();
  });
});

describe("SkillRegistry.list", () => {
  it("returns all loaded skills", () => {
    const reg = makeRegistry();
    const list = reg.list();
    expect(list.length).toBeGreaterThanOrEqual(5); // brainstorm + tdd-feature + compose-a/b/c
    expect(list.map((s) => s.frontmatter.name)).toContain("brainstorm");
  });

  it("returns a copy — mutating the result does not affect the registry", () => {
    const reg = makeRegistry();
    const list = reg.list();
    list.splice(0, list.length);
    expect(reg.list().length).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "registry-get-list|FAIL|Cannot find"
```

Expected: import error for `../src/registry.js`.

- [ ] **Step 3: Implement `src/registry.ts` (get + list only; activate and match added in Tasks 9–10)**

```ts
import type { Skill } from "./skill.js";
import type { IntentClassifier, ClassificationResult } from "./classifier.js";

export class SkillRegistry {
  private readonly byName: Map<string, Skill>;
  private readonly classifier: IntentClassifier | undefined;

  constructor(skills: Skill[], classifier?: IntentClassifier) {
    this.byName = new Map(skills.map((s) => [s.frontmatter.name, s]));
    this.classifier = classifier;
  }

  /** Returns the skill with the given name, or `undefined` if not found. */
  get(name: string): Skill | undefined {
    return this.byName.get(name);
  }

  /** Returns all loaded skills as a new array. */
  list(): Skill[] {
    return [...this.byName.values()];
  }

  /** Returns the names of all skills whose `composes` field references `name`. */
  composedBy(name: string): string[] {
    return this.list()
      .filter((s) => s.frontmatter.composes?.includes(name))
      .map((s) => s.frontmatter.name);
  }
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all registry-get-list tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/registry.ts packages/skill-runtime/test/registry-get-list.test.ts
git commit -m "feat(skill-runtime): SkillRegistry.get + SkillRegistry.list"
```

---

### Task 9: `SkillRegistry.activate` — input validation

**Files:**
- Modify: `packages/skill-runtime/src/registry.ts`
- Create: `packages/skill-runtime/test/registry-activate.test.ts`
- Create: `packages/skill-runtime/test/fixtures/skills/page-input.md`

- [ ] **Step 1: Create the fixture skill with a Zod inputs schema and write failing tests**

`test/fixtures/skills/page-input.md`:

```markdown
---
name: page-input
description: Fixture skill that validates a page name input
activate_on:
  - page-input
---

This fixture skill is used in registry-activate tests only.
```

`packages/skill-runtime/test/registry-activate.test.ts`:

```ts
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

function makeSkillWithInputs(inputsSchema: z.ZodTypeAny): Skill {
  return {
    frontmatter: {
      name: "typed-skill",
      description: "A skill with typed inputs",
      activate_on: ["typed-skill"],
      inputs: inputsSchema
    },
    body: "# Typed Skill\n\nBody text.",
    sourcePath: "/virtual/typed-skill.md"
  };
}

describe("SkillRegistry.activate", () => {
  const inputsSchema = z.object({ prompt: z.string().min(1), count: z.number().int().positive() });
  const skill = makeSkillWithInputs(inputsSchema);
  const reg = new SkillRegistry([skill]);

  it("returns an ActivationRecord for valid inputs", () => {
    const record = reg.activate("typed-skill", { prompt: "hello", count: 3 });
    expect(record.skillName).toBe("typed-skill");
    expect(record.validatedInputs).toEqual({ prompt: "hello", count: 3 });
    expect(record.body).toContain("Body text.");
    expect(record.activatedAt).toBeInstanceOf(Date);
  });

  it("throws SkillNotFoundError for an unknown skill name", () => {
    expect(() => reg.activate("ghost", {})).toThrow(/SkillNotFoundError|not found/i);
  });

  it("throws SkillInputValidationError when inputs fail the schema", () => {
    expect(() =>
      reg.activate("typed-skill", { prompt: "", count: -1 })
    ).toThrow(/SkillInputValidationError|invalid/i);
  });

  it("returns an ActivationRecord with validatedInputs=null for a skill with no inputs schema", () => {
    const noInputsSkill: Skill = {
      frontmatter: { name: "no-inputs", description: "x", activate_on: ["x"] },
      body: "# No Inputs",
      sourcePath: "/virtual/no-inputs.md"
    };
    const noInputsReg = new SkillRegistry([noInputsSkill]);
    const record = noInputsReg.activate("no-inputs", {});
    expect(record.validatedInputs).toBeNull();
  });

  it("throws SkillInputValidationError with structured Zod issues on the error object", () => {
    try {
      reg.activate("typed-skill", { prompt: "", count: "not-a-number" });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/SkillInputValidationError/);
      // The error carries Zod issues
      expect((err as { issues?: unknown[] }).issues).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "registry-activate|FAIL|activate"
```

Expected: `reg.activate is not a function` — method not yet implemented.

- [ ] **Step 3: Add `activate` to `src/registry.ts`**

Add these classes and method to `src/registry.ts`:

```ts
import { z } from "zod";

export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`SkillNotFoundError: skill "${name}" not found in registry`);
    this.name = "SkillNotFoundError";
  }
}

export class SkillInputValidationError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(skillName: string, issues: z.ZodIssue[]) {
    super(`SkillInputValidationError: inputs for skill "${skillName}" failed validation`);
    this.name = "SkillInputValidationError";
    this.issues = issues;
  }
}

export interface ActivationRecord {
  skillName: string;
  validatedInputs: unknown | null;
  body: string;
  activatedAt: Date;
}
```

And add the `activate` method to the `SkillRegistry` class:

```ts
  /**
   * Validates `args` against the skill's `inputs` Zod schema (if defined) and
   * returns an `ActivationRecord` for downstream consumers (the Conductor, D.1).
   * Throws `SkillNotFoundError` or `SkillInputValidationError` on failure.
   */
  activate(name: string, args: unknown): ActivationRecord {
    const skill = this.byName.get(name);
    if (!skill) throw new SkillNotFoundError(name);

    const inputsSchema = skill.frontmatter.inputs;
    let validatedInputs: unknown | null = null;

    if (inputsSchema != null && typeof (inputsSchema as { parse?: unknown }).parse === "function") {
      const schema = inputsSchema as z.ZodTypeAny;
      const result = schema.safeParse(args);
      if (!result.success) {
        throw new SkillInputValidationError(name, result.error.issues);
      }
      validatedInputs = result.data;
    }

    return {
      skillName: name,
      validatedInputs,
      body: skill.body,
      activatedAt: new Date()
    };
  }
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all 5 registry-activate tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/registry.ts packages/skill-runtime/test/registry-activate.test.ts packages/skill-runtime/test/fixtures/skills/page-input.md
git commit -m "feat(skill-runtime): SkillRegistry.activate with Zod inputs validation + SkillNotFoundError / SkillInputValidationError"
```

---

### Task 10: `SkillRegistry.match` via injected classifier

**Files:**
- Modify: `packages/skill-runtime/src/registry.ts`
- Create: `packages/skill-runtime/test/registry-match.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/registry-match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import { MockIntentClassifier } from "../src/classifier.js";
import type { Skill } from "../src/skill.js";

function makeSkill(name: string, activate_on: string[]): Skill {
  return {
    frontmatter: { name, description: `Fixture ${name}`, activate_on },
    body: `# ${name}`,
    sourcePath: `/virtual/${name}.md`
  };
}

describe("SkillRegistry.match", () => {
  const skills = [
    makeSkill("brainstorm", ["brainstorm", "explore"]),
    makeSkill("tdd-feature", ["tdd", "tests"])
  ];

  it("returns matching skills for a recognised intent", async () => {
    const classifier = new MockIntentClassifier(
      skills.map((s) => ({ name: s.frontmatter.name, activate_on: s.frontmatter.activate_on }))
    );
    const reg = new SkillRegistry(skills, classifier);
    const result = await reg.match("let's brainstorm");
    expect(result.map((s) => s.frontmatter.name)).toContain("brainstorm");
  });

  it("returns empty array for an unrecognised intent", async () => {
    const classifier = new MockIntentClassifier(
      skills.map((s) => ({ name: s.frontmatter.name, activate_on: s.frontmatter.activate_on }))
    );
    const reg = new SkillRegistry(skills, classifier);
    const result = await reg.match("deploy to kubernetes");
    expect(result).toHaveLength(0);
  });

  it("throws if no classifier was injected", async () => {
    const reg = new SkillRegistry(skills);
    await expect(reg.match("brainstorm")).rejects.toThrow(/classifier/i);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "registry-match|FAIL|match"
```

Expected: `reg.match is not a function`.

- [ ] **Step 3: Add `match` to `src/registry.ts`**

```ts
  /**
   * Classifies `intent` using the injected classifier and returns the matching
   * `Skill[]` in confidence-descending order.
   * Throws if no classifier was provided at construction time.
   */
  async match(intent: string): Promise<Skill[]> {
    if (!this.classifier) {
      throw new Error("No IntentClassifier was provided to this SkillRegistry instance");
    }
    const result = await this.classifier.classify(intent);
    return result.matches
      .sort((a, b) => b.confidence - a.confidence)
      .map((m) => this.byName.get(m.name))
      .filter((s): s is Skill => s !== undefined);
  }
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all 3 registry-match tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/registry.ts packages/skill-runtime/test/registry-match.test.ts
git commit -m "feat(skill-runtime): SkillRegistry.match — classifies intent via injected IntentClassifier"
```

---

### Task 11: `composes` resolution integration into registry

**Files:**
- Modify: `packages/skill-runtime/src/registry.ts`
- Create: `packages/skill-runtime/test/topo-registry.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/topo-registry.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/loader.js";
import { SkillRegistry } from "../src/registry.js";
import { CyclicDependencyError } from "../src/topo.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

describe("SkillRegistry composes resolution", () => {
  it("resolveComposeOrder returns dependency-first order for a valid chain", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR).filter((s) =>
      ["compose-a", "compose-b", "compose-c"].includes(s.frontmatter.name)
    );
    const reg = new SkillRegistry(skills);
    const order = reg.resolveComposeOrder("compose-a");
    expect(order.indexOf("compose-c")).toBeLessThan(order.indexOf("compose-b"));
    expect(order.indexOf("compose-b")).toBeLessThan(order.indexOf("compose-a"));
  });

  it("resolveComposeOrder for a leaf skill returns just that skill", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR).filter((s) =>
      s.frontmatter.name === "compose-c"
    );
    const reg = new SkillRegistry(skills);
    expect(reg.resolveComposeOrder("compose-c")).toEqual(["compose-c"]);
  });

  it("throws CyclicDependencyError for a cyclic composes graph", () => {
    const skills = loadSkillsFromDir(FIXTURES_DIR).filter((s) =>
      ["cycle-x", "cycle-y"].includes(s.frontmatter.name)
    );
    const reg = new SkillRegistry(skills);
    expect(() => reg.resolveComposeOrder("cycle-x")).toThrow(CyclicDependencyError);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "topo-registry|resolveComposeOrder|FAIL"
```

Expected: `reg.resolveComposeOrder is not a function`.

- [ ] **Step 3: Add `resolveComposeOrder` to `src/registry.ts`**

Add this import at the top of `src/registry.ts`:

```ts
import { topoSort } from "./topo.js";
```

Add this method to the `SkillRegistry` class:

```ts
  /**
   * Returns all skills in the transitive `composes` closure of `rootName`,
   * ordered dependency-first (leaves first, root last).
   * Throws `CyclicDependencyError` if a cycle is detected.
   * Throws `SkillNotFoundError` if `rootName` is not in the registry.
   */
  resolveComposeOrder(rootName: string): string[] {
    if (!this.byName.has(rootName)) throw new SkillNotFoundError(rootName);

    // Build a sub-graph of just the relevant skills
    const graph: Record<string, string[]> = {};
    const toVisit = [rootName];
    const visited = new Set<string>();

    while (toVisit.length > 0) {
      const name = toVisit.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const skill = this.byName.get(name);
      const deps = skill?.frontmatter.composes ?? [];
      graph[name] = deps;
      for (const dep of deps) {
        if (!visited.has(dep)) toVisit.push(dep);
      }
    }

    return topoSort(graph);
  }
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all 3 topo-registry tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/registry.ts packages/skill-runtime/test/topo-registry.test.ts
git commit -m "feat(skill-runtime): SkillRegistry.resolveComposeOrder — topological sort over composes graph"
```

---

### Task 12: `SkillPin` schema and `parsePinFile`

**Files:**
- Create: `packages/skill-runtime/src/pin.ts`
- Create: `packages/skill-runtime/test/fixtures/pin.json`
- Create: `packages/skill-runtime/test/pin.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/pin.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePinFile, loadPinFile, type SkillPin } from "../src/pin.js";

const FIXTURE_PIN = path.resolve(import.meta.dirname, "fixtures/pin.json");

describe("parsePinFile", () => {
  it("accepts a valid pin array", () => {
    const pins: SkillPin[] = parsePinFile([
      { skill: "brainstorm", version: "1.0.0", provenance: "bundled" },
      { skill: "tdd-feature", version: "1.2.3", provenance: "local" }
    ]);
    expect(pins).toHaveLength(2);
    expect(pins[0].skill).toBe("brainstorm");
  });

  it("rejects a pin with an invalid semver version", () => {
    expect(() =>
      parsePinFile([{ skill: "brainstorm", version: "not-semver", provenance: "bundled" }])
    ).toThrow();
  });

  it("rejects a pin with a missing skill field", () => {
    expect(() =>
      parsePinFile([{ version: "1.0.0", provenance: "bundled" }])
    ).toThrow();
  });

  it("rejects non-array input", () => {
    expect(() => parsePinFile({ skill: "brainstorm", version: "1.0.0", provenance: "bundled" })).toThrow();
  });
});

describe("loadPinFile", () => {
  it("loads and parses the fixture pin.json", () => {
    const pins = loadPinFile(FIXTURE_PIN);
    expect(pins.length).toBeGreaterThanOrEqual(1);
    expect(pins[0].skill).toBeDefined();
  });

  it("returns empty array for a non-existent file", () => {
    const pins = loadPinFile(path.join(import.meta.dirname, "fixtures/__no_pin.json"));
    expect(pins).toEqual([]);
  });
});
```

- [ ] **Step 2: Create fixture `test/fixtures/pin.json`**

```json
[
  { "skill": "brainstorm", "version": "1.0.0", "provenance": "bundled" },
  { "skill": "tdd-feature", "version": "1.1.0", "provenance": "local" }
]
```

- [ ] **Step 3: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "pin|FAIL|Cannot find"
```

Expected: import error for `../src/pin.js`.

- [ ] **Step 4: Implement `src/pin.ts`**

```ts
import fs from "node:fs";
import { z } from "zod";

/**
 * A single entry in `.atlas/skills/pin.json`.
 * `version` must be a semver string (major.minor.patch with optional pre-release).
 * `provenance` identifies the source: "bundled" | "local" | a URL string.
 */
export const SkillPinSchema = z.object({
  skill: z.string().min(1),
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/,
      'version must be a semver string, e.g. "1.2.3" or "1.0.0-beta.1"'
    ),
  provenance: z.string().min(1)
});

export type SkillPin = z.infer<typeof SkillPinSchema>;

const SkillPinArraySchema = z.array(SkillPinSchema);

/**
 * Validates raw JSON (already parsed) against the SkillPin[] schema.
 * Throws a Zod error with structured issues on failure.
 */
export function parsePinFile(raw: unknown): SkillPin[] {
  return SkillPinArraySchema.parse(raw);
}

/**
 * Reads, JSON-parses, and validates a pin.json file.
 * Returns `[]` if the file does not exist.
 * Throws if the file exists but is invalid JSON or fails schema validation.
 */
export function loadPinFile(filePath: string): SkillPin[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  return parsePinFile(raw);
}
```

- [ ] **Step 5: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all pin tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/skill-runtime/src/pin.ts packages/skill-runtime/test/pin.test.ts packages/skill-runtime/test/fixtures/pin.json
git commit -m "feat(skill-runtime): SkillPin schema + parsePinFile + loadPinFile with semver validation"
```

---

### Task 13: Pin version-check against loaded skills

**Files:**
- Modify: `packages/skill-runtime/src/pin.ts`
- Extend: `packages/skill-runtime/test/pin.test.ts`

- [ ] **Step 1: Add failing version-check tests**

Append to `packages/skill-runtime/test/pin.test.ts`:

```ts
import { checkPinVersions, SkillVersionMismatchError } from "../src/pin.js";

describe("checkPinVersions", () => {
  const pins: SkillPin[] = [
    { skill: "brainstorm", version: "1.0.0", provenance: "bundled" }
  ];

  it("passes silently when the loaded skill version matches the pin", () => {
    expect(() =>
      checkPinVersions(pins, [
        {
          frontmatter: { name: "brainstorm", description: "x", activate_on: ["x"], version: "1.0.0" } as never,
          body: "",
          sourcePath: "/virtual/brainstorm.md"
        }
      ])
    ).not.toThrow();
  });

  it("throws SkillVersionMismatchError when a pinned skill has no version field", () => {
    expect(() =>
      checkPinVersions(pins, [
        {
          frontmatter: { name: "brainstorm", description: "x", activate_on: ["x"] } as never,
          body: "",
          sourcePath: "/virtual/brainstorm.md"
        }
      ])
    ).toThrow(SkillVersionMismatchError);
  });

  it("passes silently when a pinned skill is not currently loaded (it may be optional)", () => {
    expect(() => checkPinVersions(pins, [])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "checkPinVersions|SkillVersionMismatch|FAIL"
```

Expected: `checkPinVersions is not a function`.

- [ ] **Step 3: Implement `checkPinVersions` in `src/pin.ts`**

Add these exports to `src/pin.ts`:

```ts
import type { Skill } from "./skill.js";

export class SkillVersionMismatchError extends Error {
  readonly skillName: string;
  readonly pinned: string;
  readonly loaded: string | undefined;

  constructor(skillName: string, pinned: string, loaded: string | undefined) {
    super(
      `SkillVersionMismatchError: skill "${skillName}" is pinned at ${pinned} but loaded version is ${loaded ?? "(none)"}`
    );
    this.name = "SkillVersionMismatchError";
    this.skillName = skillName;
    this.pinned = pinned;
    this.loaded = loaded;
  }
}

/**
 * Checks that every pinned skill, if present in `loadedSkills`, has a
 * `version` field matching the pin exactly. Pinned skills absent from
 * `loadedSkills` are silently ignored (they may be optional or not yet loaded).
 *
 * Note: `version` is not part of `SkillFrontmatterSchema` v1 — it is an
 * extra field passed through via `z.unknown()`. Skills that carry a `version`
 * in their frontmatter will have it available as a raw property; skills that
 * do not carry one are treated as unversioned and fail the check when pinned.
 */
export function checkPinVersions(pins: SkillPin[], loadedSkills: Skill[]): void {
  const byName = new Map(loadedSkills.map((s) => [s.frontmatter.name, s]));

  for (const pin of pins) {
    const skill = byName.get(pin.skill);
    if (!skill) continue; // not loaded — silently skip

    const frontmatterRaw = skill.frontmatter as Record<string, unknown>;
    const loadedVersion = typeof frontmatterRaw.version === "string"
      ? frontmatterRaw.version
      : undefined;

    if (loadedVersion !== pin.version) {
      throw new SkillVersionMismatchError(pin.skill, pin.version, loadedVersion);
    }
  }
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all pin + version-check tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/pin.ts packages/skill-runtime/test/pin.test.ts
git commit -m "feat(skill-runtime): checkPinVersions — exact version match against pin.json; SkillVersionMismatchError"
```

---

### Task 14: Registry construction helpers

**Files:**
- Create: `packages/skill-runtime/src/helpers.ts`
- Create: `packages/skill-runtime/test/helpers.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/helpers.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRegistryWithOverrides } from "../src/helpers.js";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "fixtures/skills");

function makeSkill(name: string, body = `# ${name}`): Skill {
  return {
    frontmatter: { name, description: `Fixture ${name}`, activate_on: [name] },
    body,
    sourcePath: `/virtual/${name}.md`
  };
}

describe("createRegistryWithOverrides", () => {
  it("returns a SkillRegistry instance", () => {
    const reg = createRegistryWithOverrides([makeSkill("brainstorm")], []);
    expect(reg).toBeInstanceOf(SkillRegistry);
  });

  it("local skills take precedence over bundled skills with the same name", () => {
    const bundled = [makeSkill("brainstorm", "# Bundled brainstorm")];
    const local = [makeSkill("brainstorm", "# Local brainstorm override")];
    const reg = createRegistryWithOverrides(bundled, local);
    expect(reg.get("brainstorm")!.body).toContain("Local brainstorm override");
  });

  it("bundled skills that are not overridden are available in the registry", () => {
    const bundled = [makeSkill("brainstorm"), makeSkill("tdd-feature")];
    const local = [makeSkill("brainstorm", "# Override")];
    const reg = createRegistryWithOverrides(bundled, local);
    expect(reg.get("tdd-feature")).toBeDefined();
  });

  it("loads skills from the fixtures directory without error", () => {
    const reg = createRegistryWithOverrides([], []);
    // No-skill registry is still a valid registry
    expect(reg.list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "helpers|FAIL|Cannot find"
```

Expected: import error for `../src/helpers.js`.

- [ ] **Step 3: Implement `src/helpers.ts`**

```ts
import type { Skill } from "./skill.js";
import type { IntentClassifier } from "./classifier.js";
import { SkillRegistry } from "./registry.js";

/**
 * Merges bundled (library) skills and local override skills into a single
 * `SkillRegistry`. Local skills with the same name as a bundled skill win.
 *
 * @param bundled  - Skills loaded from the bundled library (e.g. `packages/skill-library/src/`).
 * @param local    - Skills loaded from `.atlas/skills/` in the user's workspace.
 * @param classifier - Optional intent classifier; injected by D.1 in production.
 */
export function createRegistryWithOverrides(
  bundled: Skill[],
  local: Skill[],
  classifier?: IntentClassifier
): SkillRegistry {
  const merged = new Map<string, Skill>(bundled.map((s) => [s.frontmatter.name, s]));
  for (const skill of local) {
    merged.set(skill.frontmatter.name, skill); // local wins
  }
  return new SkillRegistry([...merged.values()], classifier);
}

/**
 * Placeholder for the C.2 bundled library path.
 * When C.2 ships `packages/skill-library/`, this helper will load from that
 * directory. For C.1, returns an empty array — the library has no skills yet.
 */
export function loadBundledSkills(): Skill[] {
  // C.2 will replace this stub with:
  //   import { fileURLToPath } from "node:url";
  //   const LIBRARY_DIR = fileURLToPath(new URL("../../skill-library/src", import.meta.url));
  //   return loadSkillsFromDir(LIBRARY_DIR);
  return [];
}

/**
 * Creates a registry from the bundled library only (no local overrides).
 * Used in contexts where the user has no `.atlas/skills/` directory.
 */
export function createRegistryFromBundledLibrary(classifier?: IntentClassifier): SkillRegistry {
  return new SkillRegistry(loadBundledSkills(), classifier);
}
```

- [ ] **Step 4: Run green**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all 4 helpers tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/src/helpers.ts packages/skill-runtime/test/helpers.test.ts
git commit -m "feat(skill-runtime): createRegistryWithOverrides + createRegistryFromBundledLibrary helpers"
```

---

### Task 15: Wire-up to `@atlas/spec-graph-schema` registries

**Files:**
- Create: `packages/skill-runtime/test/fixtures/skills/page-input.md` (update with nodeRegistry reference in test)
- Create: `packages/skill-runtime/test/schema-wire-up.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/skill-runtime/test/schema-wire-up.test.ts`:

```ts
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { nodeRegistry, edgeRegistry } from "@atlas/spec-graph-schema";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

describe("spec-graph-schema registry wire-up (OQ7)", () => {
  it("nodeRegistry is importable from @atlas/spec-graph-schema", () => {
    expect(nodeRegistry).toBeDefined();
    expect(nodeRegistry.page).toBeDefined();
    expect(nodeRegistry.component).toBeDefined();
  });

  it("edgeRegistry is importable from @atlas/spec-graph-schema", () => {
    expect(edgeRegistry).toBeDefined();
    expect(edgeRegistry.renders).toBeDefined();
  });

  it("a skill whose inputs schema references nodeRegistry.page parses valid page-shaped data", () => {
    // Use pageSchema as the inputs validator for a fixture skill
    const pageSchema = nodeRegistry.page;
    const skill: Skill = {
      frontmatter: {
        name: "gen-test-page",
        description: "Generate tests for a page node",
        activate_on: ["gen-test-page"],
        inputs: pageSchema
      },
      body: "# Gen Test Page",
      sourcePath: "/virtual/gen-test-page.md"
    };
    const reg = new SkillRegistry([skill]);

    // A valid minimal page node
    const validPage = {
      kind: "page",
      id: "page:home",
      projectId: "11111111-1111-4111-8111-111111111111",
      name: "Home",
      routeRef: "route:home",
      authRequired: false
    };

    const record = reg.activate("gen-test-page", validPage);
    expect(record.skillName).toBe("gen-test-page");
    expect((record.validatedInputs as { kind: string }).kind).toBe("page");
  });

  it("rejects an invalid page node with a SkillInputValidationError", () => {
    const { SkillInputValidationError } = await import("../src/registry.js");
    const pageSchema = nodeRegistry.page;
    const skill: Skill = {
      frontmatter: {
        name: "gen-test-page",
        description: "x",
        activate_on: ["x"],
        inputs: pageSchema
      },
      body: "",
      sourcePath: "/virtual/gen-test-page.md"
    };
    const reg = new SkillRegistry([skill]);

    expect(() => reg.activate("gen-test-page", { kind: "page" /* missing required fields */ }))
      .toThrow(SkillInputValidationError);
  });
});
```

- [ ] **Step 2: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "schema-wire-up|FAIL"
```

Expected: build error or test failure because `@atlas/spec-graph-schema` is not yet built.

- [ ] **Step 3: Build the schema package first, then run tests**

```bash
pnpm -F @atlas/spec-graph-schema build
pnpm -F @atlas/skill-runtime test
```

Expected: all 4 wire-up tests pass. The test proves direct import of `nodeRegistry` and `edgeRegistry` from `@atlas/spec-graph-schema` works without any local projection.

- [ ] **Step 4: Commit**

```bash
git add packages/skill-runtime/test/schema-wire-up.test.ts
git commit -m "test(skill-runtime): validate nodeRegistry + edgeRegistry wire-up from @atlas/spec-graph-schema (OQ7)"
```

---

### Task 16: Cross-field refinement pattern (OQ8)

**Files:**
- Create: `packages/skill-runtime/test/fixtures/skills/cross-field.md`
- Create: `packages/skill-runtime/test/cross-field-refinement.test.ts`

- [ ] **Step 1: Create the fixture skill**

`test/fixtures/skills/cross-field.md`:

```markdown
---
name: cross-field
description: Fixture skill demonstrating the split-then-superRefine pattern for discriminated unions with cross-field rules
activate_on:
  - cross-field
---

# Cross-Field Refinement Fixture

This skill's inputs schema uses the B.1 split-then-superRefine pattern.
When `mode` is "strict", the `threshold` field must be present and > 0.
When `mode` is "permissive", `threshold` is ignored.
```

- [ ] **Step 2: Write failing tests**

`packages/skill-runtime/test/cross-field-refinement.test.ts`:

```ts
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../src/registry.js";
import type { Skill } from "../src/skill.js";

/**
 * Demonstrates the OQ8-documented split-then-superRefine pattern.
 *
 * WRONG (fails at schema construction time in Zod v3):
 *   z.discriminatedUnion("mode", [...]).refine(rule)
 *   → ZodError: ZodEffects cannot be a member of a discriminated union
 *
 * CORRECT (B.1 AuthBoundary pattern):
 *   Build the discriminated union from base schemas (no refinements),
 *   then apply .superRefine at the top level.
 */
const StrictModeBaseSchema = z.object({ mode: z.literal("strict"), threshold: z.number().optional() });
const PermissiveModeSchema = z.object({ mode: z.literal("permissive") });

const CrossFieldInputsSchema = z
  .discriminatedUnion("mode", [StrictModeBaseSchema, PermissiveModeSchema])
  .superRefine((val, ctx) => {
    if (val.mode === "strict" && (val.threshold === undefined || val.threshold <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["threshold"],
        message: 'threshold must be a positive number when mode is "strict"'
      });
    }
  });

function makeCrossFieldSkill(): Skill {
  return {
    frontmatter: {
      name: "cross-field",
      description: "Cross-field fixture",
      activate_on: ["cross-field"],
      inputs: CrossFieldInputsSchema
    },
    body: "# Cross-Field",
    sourcePath: "/virtual/cross-field.md"
  };
}

describe("cross-field refinement pattern (OQ8)", () => {
  const reg = new SkillRegistry([makeCrossFieldSkill()]);

  it("accepts strict mode with a positive threshold", () => {
    const record = reg.activate("cross-field", { mode: "strict", threshold: 0.5 });
    expect((record.validatedInputs as { mode: string }).mode).toBe("strict");
  });

  it("rejects strict mode with no threshold (cross-field rule)", () => {
    expect(() => reg.activate("cross-field", { mode: "strict" })).toThrow(/SkillInputValidationError/);
  });

  it("rejects strict mode with threshold <= 0 (cross-field rule)", () => {
    expect(() => reg.activate("cross-field", { mode: "strict", threshold: 0 })).toThrow(/SkillInputValidationError/);
  });

  it("accepts permissive mode with no threshold (cross-field rule does not apply)", () => {
    const record = reg.activate("cross-field", { mode: "permissive" });
    expect((record.validatedInputs as { mode: string }).mode).toBe("permissive");
  });

  it("schema construction itself does not throw (discriminatedUnion + superRefine is safe)", () => {
    expect(() => CrossFieldInputsSchema.parse({ mode: "permissive" })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run red**

```bash
pnpm -F @atlas/skill-runtime test 2>&1 | grep -E "cross-field|FAIL"
```

Expected: tests are collected but the `SkillInputValidationError` import may need to be confirmed. If `cross-field.ts` is missing the test will fail at import time — which is the expected red state.

- [ ] **Step 4: Run green (no implementation change needed — the pattern is pure Zod)**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all 5 cross-field tests pass. The `superRefine` pattern works with `activate()` because `activate()` calls `.safeParse()` on the `inputs` field, which is the fully-refined schema.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-runtime/test/cross-field-refinement.test.ts packages/skill-runtime/test/fixtures/skills/cross-field.md
git commit -m "test(skill-runtime): document + validate OQ8 split-then-superRefine pattern for skill I/O cross-field rules"
```

---

### Task 17: Public `src/index.ts` exports

**Files:**
- Modify: `packages/skill-runtime/src/index.ts`

- [ ] **Step 1: Replace the stub with the full public API**

`packages/skill-runtime/src/index.ts`:

```ts
// Frontmatter parsing + validation
export {
  SkillFrontmatterSchema,
  parseFrontmatter,
  validateFrontmatter
} from "./frontmatter.js";
export type { SkillFrontmatter, ParsedSkill } from "./frontmatter.js";

// Skill type
export type { Skill } from "./skill.js";

// Loader
export { loadSkillsFromDir } from "./loader.js";

// Intent classifier
export { MockIntentClassifier } from "./classifier.js";
export type {
  IntentClassifier,
  ClassificationResult,
  ClassificationMatch,
  OnClassificationHook,
  ClassifierOptions,
  SkillDescriptor
} from "./classifier.js";

// Registry
export {
  SkillRegistry,
  SkillNotFoundError,
  SkillInputValidationError
} from "./registry.js";
export type { ActivationRecord } from "./registry.js";

// Topological sort
export { topoSort, CyclicDependencyError } from "./topo.js";

// Pin file
export {
  SkillPinSchema,
  parsePinFile,
  loadPinFile,
  checkPinVersions,
  SkillVersionMismatchError
} from "./pin.js";
export type { SkillPin } from "./pin.js";

// Registry helpers
export {
  createRegistryWithOverrides,
  createRegistryFromBundledLibrary,
  loadBundledSkills
} from "./helpers.js";

export const PACKAGE_NAME = "@atlas/skill-runtime";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -F @atlas/skill-runtime typecheck
```

Expected: exits 0 with no errors.

- [ ] **Step 3: Run full test suite**

```bash
pnpm -F @atlas/skill-runtime test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/skill-runtime/src/index.ts
git commit -m "feat(skill-runtime): wire public index.ts — expose all API surface"
```

---

### Task 18: Build and full test-suite smoke

**Files:**
- No new files — verifies the complete package builds cleanly.

- [ ] **Step 1: Build the schema package (dependency)**

```bash
pnpm -F @atlas/spec-graph-schema build
```

Expected: exits 0. `packages/spec-graph-schema/dist/index.js` exists.

- [ ] **Step 2: Typecheck skill-runtime**

```bash
pnpm -F @atlas/skill-runtime typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run the full skill-runtime test suite**

```bash
pnpm -F @atlas/skill-runtime test --reporter=verbose
```

Expected: all tests pass. Reporter shows each test file and test name. No skipped tests.

- [ ] **Step 4: Run workspace-wide tests**

```bash
pnpm -r test
```

Expected: `@atlas/spec-graph-schema` and `@atlas/skill-runtime` both show green. Other packages (data layer, etc.) may be skipped or green depending on local Postgres availability.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(skill-runtime): full suite smoke — typecheck + all tests green"
```

---

### Task 19: README for `packages/skill-runtime/`

**Files:**
- Create: `packages/skill-runtime/README.md`

- [ ] **Step 1: Write the README**

`packages/skill-runtime/README.md`:

```markdown
# @atlas/skill-runtime

The Atlas skill runtime — loads `*.md` skill files, parses their YAML frontmatter, and exposes a typed `SkillRegistry` with `get()`, `list()`, `activate()`, and `match()` operations.

## Install (monorepo)

This package is a private pnpm workspace package. It is not published to npm.

```bash
pnpm install  # from repo root
```

## Quick start

```ts
import { loadSkillsFromDir, createRegistryWithOverrides, MockIntentClassifier } from "@atlas/skill-runtime";

// Load skills from the user's local overrides directory
const localSkills = loadSkillsFromDir(".atlas/skills");

// Compose with bundled library (empty until C.2 ships)
const classifier = new MockIntentClassifier(localSkills.map(s => ({
  name: s.frontmatter.name,
  activate_on: s.frontmatter.activate_on
})));

const registry = createRegistryWithOverrides([], localSkills, classifier);

// Look up a skill by name
const skill = registry.get("brainstorm");

// Activate a skill with validated inputs
const record = registry.activate("brainstorm", { topic: "what should I build" });

// Classify intent and get matching skills
const matches = await registry.match("I want to brainstorm my app idea");
```

## Skill frontmatter shape

```yaml
---
name: brainstorm              # required; kebab/snake identifier, no spaces
description: "..."            # required; one-line human description
activate_on:                  # required; at least one intent string
  - brainstorm
  - explore
composes:                     # optional; list of skill names this skill invokes
  - another-skill
model_hint: claude-haiku-4-5  # optional; preferred model for this skill
inputs:                       # optional; Zod schema evaluated at load time
outputs:                      # optional; Zod schema evaluated at load time
---

# Body

Markdown instructions, checklists, and decision tables.
```

## Cross-field refinement (OQ8)

Skill `inputs`/`outputs` schemas that need cross-field validation on a discriminated union must use the split-then-superRefine pattern. **Do not call `.refine()` on a `z.discriminatedUnion()`** — Zod v3 rejects `ZodEffects` as a union member.

Reference implementation: `packages/spec-graph-schema/src/nodes/auth-boundary.ts` (`AuthBoundaryBaseSchema` + top-level `.superRefine`).

## Intent classifier

`IntentClassifier` is a provider-agnostic interface. C.1 ships `MockIntentClassifier` for tests and local development. The real Haiku-4.5-backed classifier is injected by D.1 (Conductor + LLM Provider Abstraction).

The `onClassification(result, latencyMs, cacheKey)` telemetry hook is part of the interface from day one, enabling NFR-13 (>80% prompt-cache hit rate) measurement as soon as D.1 wires the real provider.

## Pin file (`.atlas/skills/pin.json`)

```json
[
  { "skill": "brainstorm", "version": "1.0.0", "provenance": "bundled" },
  { "skill": "acme-auth",  "version": "2.1.0", "provenance": "https://registry.acme.com/skills" }
]
```

Loaded and validated at startup via `loadPinFile` + `checkPinVersions`. Version must be exact semver.

## Starter skill library

The ~35 starter skills (`brainstorm.md`, `tdd-feature.md`, etc.) will be bundled in `packages/skill-library/` and published to `github.com/atlas-labs/atlas-skills` when **C.2** lands. Until then, `loadBundledSkills()` returns an empty array and `createRegistryFromBundledLibrary()` returns an empty registry.

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `zod` | 3.23.8 | Frontmatter schema validation |
| `js-yaml` | 4.1.0 | YAML frontmatter parsing |
| `@atlas/spec-graph-schema` | workspace:* | `nodeRegistry` / `edgeRegistry` imports |

## Next plans

- **C.2 — Starter Skill Library & OSS pipeline:** authors the ~35 skills, CI validation, public repo mirror.
- **D.1 — Conductor + LLM Provider Abstraction:** injects the real Haiku-4.5 `IntentClassifier` implementation.
- **C.3 — Test-Generator Registry + Human Baseline Infrastructure:** test-generator invocation, drift detection.
```

- [ ] **Step 2: Commit**

```bash
git add packages/skill-runtime/README.md
git commit -m "docs(skill-runtime): README with install, usage, frontmatter shape, OQ8 note, pin file, handoff"
```

---

### Task 20: Update plan index + handoff

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add C.1 entry to the plan index table**

In `docs/superpowers/plans/README.md`, insert a new row after row 6 (B.2) in the plan index table:

```markdown
| 9 | `2026-04-20-skill-runtime.md` | **C.1 — Skill Runtime** | `@atlas/skill-runtime`: frontmatter parser, skill loader, SkillRegistry (get/list/activate/match), IntentClassifier interface + mock, composes topo-sort, pin.json validation, spec-graph-schema wire-up | 20 tasks, TDD | Ready to execute (after B.1) |
```

- [ ] **Step 2: Update the execution order diagram**

In the `## Execution order` section, extend the tree:

```
             └─ Unit C — Skill Framework  [from Plans[7] Unit C]
                  ├─ C.1 (Plans[9], ready)
                  ├─ C.2 — Starter Skill Library (after C.1)
                  └─ C.3 — Test-Generator Registry (after C.2)
                       └─ Unit D — Conductor + Roles [from Plans[7] Unit D]
```

- [ ] **Step 3: Typecheck and full suite**

```bash
pnpm -F @atlas/skill-runtime typecheck
pnpm -F @atlas/skill-runtime test
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add C.1 skill-runtime to plan index + execution order"
```

---

## Completion Checklist

- [ ] `packages/skill-runtime/package.json` exists with correct name, version, dependencies (zod 3.23.8, js-yaml 4.1.0, @atlas/spec-graph-schema workspace:*)
- [ ] `tsconfig.json` + `vitest.config.ts` present and functional
- [ ] `parseFrontmatter` correctly splits `---` YAML block from markdown body; handles missing block + YAML errors
- [ ] `validateFrontmatter` validates all required fields (name, description, activate_on) and optional fields (composes, model_hint, inputs, outputs)
- [ ] `loadSkillsFromDir` reads `*.md`, skips invalid files with `console.warn`, returns `[]` for missing directory
- [ ] `IntentClassifier` interface defined; `MockIntentClassifier` matches on `activate_on` tokens; `onClassification` hook fires after every call
- [ ] `SkillRegistry.get` / `list` / `activate` / `match` / `resolveComposeOrder` all tested green
- [ ] `SkillInputValidationError` carries `.issues` (Zod `ZodIssue[]`)
- [ ] `topoSort` + `CyclicDependencyError` tested with linear chain, multi-root, two-node cycle, self-referential cycle
- [ ] `SkillPin` schema validates semver; `checkPinVersions` detects loaded-skill version mismatches
- [ ] `createRegistryWithOverrides` merges bundled + local; local wins on name collision
- [ ] OQ7: `nodeRegistry` + `edgeRegistry` imported directly from `@atlas/spec-graph-schema`; round-trip test passes
- [ ] OQ8: `discriminatedUnion` + `.superRefine` pattern documented and validated in `cross-field-refinement.test.ts`
- [ ] OQ2: `IntentClassifier` interface ships; `MockIntentClassifier` used for all tests; real Haiku-4.5 wiring deferred to D.1
- [ ] `src/index.ts` exports all public symbols
- [ ] `pnpm -F @atlas/skill-runtime typecheck` exits 0
- [ ] `pnpm -F @atlas/skill-runtime test` exits 0, all tests green
- [ ] `docs/superpowers/plans/README.md` updated with C.1 entry
- [ ] Every task committed separately with Conventional Commits prefix

---

## Handoff

**What ships in C.1:** A fully-tested, type-safe skill runtime package. Any caller can load skill markdown files, resolve `composes` order, validate inputs, and match intents against a mock classifier. The `nodeRegistry`/`edgeRegistry` wire-up is proven. The `IntentClassifier` interface is ready for D.1 to inject the real Haiku-4.5 provider.

**C.2 — Starter Skill Library & OSS pipeline:** Authors the ~35 starter skills (`brainstorm.md`, `tdd-feature.md`, etc.) as committed markdown files under `packages/skill-library/src/`. Sets up `github.com/atlas-labs/atlas-skills` mirror workflow with frontmatter CI validation. Resolves OQ4 (release cadence). Fills in `loadBundledSkills()` (currently a stub returning `[]`).

**C.3 — Test-Generator Registry + Human Baseline Infrastructure:** Builds the test-generator skill registry keyed to all 14 node types, the human-authored baseline assertion authorship workflow (OQ3), drift-detection CI job, and calibration dataset ownership (OQ6).

**D.1 — Conductor + LLM Provider Abstraction:** Injects the real Haiku-4.5 `IntentClassifier` implementation into the registry. Implements the Conductor role that dispatches work to specialized roles. Telemetry hooks wired to NFR-13 hit-rate monitoring from day one.
