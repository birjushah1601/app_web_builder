# Spec Graph Schema — Python Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/spec-graph-schema-py/` — a Python 3.11+ package exposing the Atlas Spec Graph v1 shape as Pydantic v2 models, plus a JSON-Schema-only structural validator and the shared `InvariantCode` enum. Models are regenerated deterministically from the TS package's JSON Schema artifact; drift is caught by a local `pnpm py:check` command that fails on any post-regeneration diff.

**Architecture:** `@atlas/spec-graph-schema` (TS) remains the single source of truth. Its build emits `dist/schema/spec-graph.v1.schema.json` (B.1) and `dist/schema/invariant-codes.json` (added here in T1). Two Node tools under `tools/` — `sync-schema-artifact.mjs` and `generate-pydantic.mjs` — copy those artifacts into the Python package tree and spawn `uv run datamodel-code-generator` to emit `src/spec_graph_schema/models.py` with a deterministic header banner. Hand-authored siblings (`invariants.py`, `validate_structural.py`, `_schema_artifact.py`, `__init__.py`) complete the public API. Pytest reads the single committed TS fixture (`valid-forgot-password.json`) over a relative path — no fixture duplication. Invariant logic is **not** ported; Python consumers call a future HTTP endpoint when they need invariant checks.

**Tech Stack:** Python 3.11 · Pydantic v2.9 · uv (Python env + lockfile manager) · datamodel-code-generator 0.26.3 · jsonschema 4.23 · pytest 8.3 · hatchling build backend · Node 22 LTS for generator scripts. No new TS runtime dependencies.

**Prerequisites the implementing engineer needs installed before starting:**
- Plan B.1 merged (`@atlas/spec-graph-schema` is in the workspace; `dist/schema/spec-graph.v1.schema.json` exists after `pnpm -F @atlas/spec-graph-schema build`).
- Node 22 LTS (`node --version` ≥ v22) and pnpm 9+.
- Python 3.11+ (`python --version` prints 3.11.x or 3.12.x).
- uv ≥ 0.5 — install with one of:
  - `pipx install uv`
  - `winget install astral-sh.uv`
  - `curl -LsSf https://astral.sh/uv/install.sh | sh`
  Verify with `uv --version`.
- No DB required — this package is pure schema binding.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  spec-graph-schema/                       # MODIFIED — TS package
    scripts/
      generate-json-schema.mjs             # +rewrite: also emit invariant-codes.json
    test/
      json-schema.test.ts                  # +3 tests for invariant-codes.json

  spec-graph-schema-py/                    # NEW
    .gitignore                             # ignore .venv/, __pycache__/, .pytest_cache/
    pyproject.toml                         # PEP-621, hatchling, requires-python >=3.11
    uv.lock                                # uv-managed lockfile (committed)
    README.md                              # install, usage, generator policy, drift-check
    src/
      spec_graph_schema/
        __init__.py                        # public API re-exports
        py.typed                           # PEP-561 marker (empty)
        models.py                          # GENERATED — banner on line 1, DO NOT HAND-EDIT
        invariants.py                      # hand-authored: InvariantCode Enum + INVARIANT_CODES
        validate_structural.py             # jsonschema.Draft202012Validator wrapper
        _schema_artifact.py                # importlib.resources loader
        schema/
          __init__.py                      # empty (makes schema/ a resource subpackage)
          spec-graph.v1.schema.json        # synced from TS dist/ by sync-schema-artifact.mjs
          invariant-codes.json             # synced from TS dist/ by sync-schema-artifact.mjs
    tests/
      __init__.py                          # empty
      conftest.py                          # shared fixture: path to TS fixture corpus
      test_invariant_codes.py              # Python codes == TS codes
      test_validate_structural.py          # valid fixture ok; inline malformed fails
      test_generated_banner.py             # models.py line 1 equals the banner
      test_models_roundtrip.py             # valid-forgot-password.json round-trips
      test_drift_check.py                  # py:check fails when models.py is stale

tools/                                     # NEW files in existing folder
  sync-schema-artifact.mjs                 # copies both JSON artifacts into the Python package
  generate-pydantic.mjs                    # spawns `uv run datamodel-code-generator ...`

pnpm-workspace.yaml                        # MODIFIED: exclude packages/spec-graph-schema-py

package.json                               # MODIFIED: add py:gen, py:check, py:test scripts

docs/superpowers/plans/
  2026-04-19-spec-graph-schema.md          # MODIFIED: handoff section points to this plan
  2026-04-18-phase-a-units-b-through-g.md  # MODIFIED: Unit C + Unit D sections refreshed
  README.md                                # MODIFIED: plan index gains B.2 entry
```

**Why this shape.** The Python package is a sibling of the TS package so uv owns its tree cleanly. Generators live under `tools/` alongside `council.mjs` and `smoke-test.mjs` (the monorepo's existing convention for cross-package scripts) — not inside the Python package, because they're Node programs. Schemas live **inside** `src/spec_graph_schema/schema/` (rather than at package root) so `importlib.resources` finds them with no hatchling force-include gymnastics.

---

## Invariant codes — the 17 canonical strings

For reference during T1, T7, and T11. B.1's invariant source emits 17 codes across 14 invariants (three invariants — I04, I07, I08 — emit two codes each):

```
I01_PAGE_MISSING_ROUTEREF
I02_ENDPOINT_MISSING_ROUTEREF
I03_AUTH_PAGE_MISSING_BOUNDARY
I04_PII_ENDPOINT_MISSING_AUTH
I04_PII_ENDPOINT_MISSING_COMPLIANCE
I05_PII_MODEL_MISSING_RLS
I06_DEPENDENCY_HAS_CRITICAL_CVE
I07_RENDERS_DANGLING_REF
I07_RENDERS_WRONG_KIND
I08_BASELINE_COMPLIANCE_MISSING
I08_BASELINE_COMPLIANCE_DUPLICATED
I09_MISSING_TEST_COVERAGE
I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE
I11_GENERATED_MEDIA_MISSING_PROVIDER
I12_PII_CLIENTSTATE_MISSING_COMPLIANCE
I13_PROTECTED_TARGET_MISSING_BASELINE_TEST
I14_MEDIAASSET_KIND_PHASE_B
```

These strings are derived by grepping `code: "I` under `packages/spec-graph-schema/src/invariants/`. T1 writes them to a JSON file; T7 mirrors them in a Python `Enum`; T11 asserts the two sources agree.

---

## Tasks

### Task 1: Emit `invariant-codes.json` from the TS build

**Files:**
- Modify: `packages/spec-graph-schema/scripts/generate-json-schema.mjs`
- Test: `packages/spec-graph-schema/test/json-schema.test.ts` (extend existing)

- [ ] **Step 1: Write the failing tests**

Open `packages/spec-graph-schema/test/json-schema.test.ts`. Append this new `describe` block after the existing one (keep existing content intact):

```typescript
describe("invariant-codes.json artifact", () => {
  const CODES_ARTIFACT = join(here, "..", "dist", "schema", "invariant-codes.json");

  it("exists after build", () => {
    if (!existsSync(CODES_ARTIFACT)) return; // soft-skip: build must run first
    expect(existsSync(CODES_ARTIFACT)).toBe(true);
  });

  it("contains the 17 canonical invariant codes, sorted", () => {
    if (!existsSync(CODES_ARTIFACT)) return;
    const codes = JSON.parse(readFileSync(CODES_ARTIFACT, "utf8")) as string[];
    expect(Array.isArray(codes)).toBe(true);
    expect(codes).toHaveLength(17);
    expect(codes).toContain("I01_PAGE_MISSING_ROUTEREF");
    expect(codes).toContain("I04_PII_ENDPOINT_MISSING_AUTH");
    expect(codes).toContain("I04_PII_ENDPOINT_MISSING_COMPLIANCE");
    expect(codes).toContain("I07_RENDERS_DANGLING_REF");
    expect(codes).toContain("I07_RENDERS_WRONG_KIND");
    expect(codes).toContain("I08_BASELINE_COMPLIANCE_MISSING");
    expect(codes).toContain("I08_BASELINE_COMPLIANCE_DUPLICATED");
    expect(codes).toContain("I14_MEDIAASSET_KIND_PHASE_B");
    expect(codes).toEqual([...codes].sort());
  });

  it("every code matches the I\\d{2}_ prefix pattern", () => {
    if (!existsSync(CODES_ARTIFACT)) return;
    const codes = JSON.parse(readFileSync(CODES_ARTIFACT, "utf8")) as string[];
    for (const code of codes) {
      expect(code).toMatch(/^I\d{2}_[A-Z0-9_]+$/);
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm current state**

```bash
pnpm -F @atlas/spec-graph-schema build
pnpm -F @atlas/spec-graph-schema test json-schema
```

Expected: existing tests still pass; the 3 new tests **soft-skip** (the `if (!existsSync(...)) return;` early-return triggers because `invariant-codes.json` doesn't exist yet). Look for "3 skipped" in the summary — that proves the test file is wired correctly before implementation.

- [ ] **Step 3: Rewrite the generator**

Replace `packages/spec-graph-schema/scripts/generate-json-schema.mjs` with:

```javascript
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SpecGraphSchema } from "../dist/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist", "schema");
mkdirSync(outDir, { recursive: true });

// 1. JSON Schema artifact
const schemaFile = join(outDir, "spec-graph.v1.schema.json");
const jsonSchema = zodToJsonSchema(SpecGraphSchema, {
  name: "SpecGraph",
  $refStrategy: "root",
  target: "jsonSchema2020-12"
});
if (!jsonSchema.$schema) {
  // zod-to-json-schema@3.23.5 silently ignores the 2020-12 target; inject manually
  jsonSchema.$schema = "https://json-schema.org/draft/2020-12/schema";
}
writeFileSync(schemaFile, JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${schemaFile}\n`);

// 2. Invariant-codes artifact — grep all `code: "I..."` literals from source
const invariantsDir = join(__dirname, "..", "src", "invariants");
const codeRegex = /code:\s*"(I\d{2}_[A-Z0-9_]+)"/g;
const codes = new Set();
for (const file of readdirSync(invariantsDir)) {
  if (!file.match(/^i\d{2}-.*\.ts$/)) continue;
  const source = readFileSync(join(invariantsDir, file), "utf8");
  for (const match of source.matchAll(codeRegex)) {
    codes.add(match[1]);
  }
}
const sorted = [...codes].sort();
const codesFile = join(outDir, "invariant-codes.json");
writeFileSync(codesFile, JSON.stringify(sorted, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${codesFile} (${sorted.length} codes)\n`);
```

- [ ] **Step 4: Rebuild and run the tests**

```bash
pnpm -F @atlas/spec-graph-schema build
pnpm -F @atlas/spec-graph-schema test json-schema
```

Expected: 5 tests pass, 0 skipped. The build's stdout includes `wrote .../invariant-codes.json (17 codes)`.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/scripts/generate-json-schema.mjs packages/spec-graph-schema/test/json-schema.test.ts
git commit -m "feat(spec-graph-schema): emit invariant-codes.json artifact for cross-language consumers"
```

---

### Task 2: Scaffold `packages/spec-graph-schema-py/`

**Files:**
- Create: `packages/spec-graph-schema-py/pyproject.toml`
- Create: `packages/spec-graph-schema-py/.gitignore`
- Create: `packages/spec-graph-schema-py/README.md` (one-line placeholder; fleshed out in T13)
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/__init__.py` (placeholder)
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/py.typed` (empty)
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/schema/__init__.py`
- Create: `packages/spec-graph-schema-py/tests/__init__.py` (empty)

No TDD pair — scaffolding. Verification is `uv sync` completing clean.

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p packages/spec-graph-schema-py/src/spec_graph_schema/schema
mkdir -p packages/spec-graph-schema-py/tests
```

- [ ] **Step 2: Write `pyproject.toml`**

`packages/spec-graph-schema-py/pyproject.toml`:

```toml
[project]
name = "spec-graph-schema"
version = "0.0.0"
description = "Python Pydantic bindings for the Atlas Spec Graph v1 schema"
readme = "README.md"
requires-python = ">=3.11"
authors = [{ name = "Atlas" }]
license = { text = "Apache-2.0" }
dependencies = [
  "pydantic>=2.9,<3",
  "jsonschema>=4.23,<5",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/spec_graph_schema"]

[tool.uv]
dev-dependencies = [
  "pytest>=8.3,<9",
  "datamodel-code-generator==0.26.3",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 3: Write `.gitignore`**

`packages/spec-graph-schema-py/.gitignore`:

```
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
*.egg-info/
dist/
```

- [ ] **Step 4: Create placeholder Python files**

`packages/spec-graph-schema-py/README.md`:

```markdown
# spec-graph-schema (Python)

Python Pydantic bindings for the Atlas Spec Graph v1 schema. See top-level `README.md` in T13 for full usage.
```

`packages/spec-graph-schema-py/src/spec_graph_schema/__init__.py`:

```python
"""Atlas Spec Graph v1 — Python bindings.

Public API is populated by later tasks once the generated models exist.
"""
```

`packages/spec-graph-schema-py/src/spec_graph_schema/py.typed`:

```
```
(empty file — its existence is the PEP-561 signal)

`packages/spec-graph-schema-py/src/spec_graph_schema/schema/__init__.py`:

```python
"""Bundled schema artifacts.

Populated by tools/sync-schema-artifact.mjs — do not edit JSON files
in this directory by hand.
"""
```

`packages/spec-graph-schema-py/tests/__init__.py`: empty file.

- [ ] **Step 5: Run `uv sync` to verify the environment resolves**

```bash
cd packages/spec-graph-schema-py
uv sync
cd ../..
```

Expected: uv creates `.venv/`, writes `uv.lock`, exits 0. Installed packages include pydantic, jsonschema, pytest, datamodel-code-generator.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-schema-py/
git commit -m "feat(spec-graph-schema-py): scaffold Python package with pyproject + placeholders"
```

Verify `.venv/` is NOT in the commit (the `.gitignore` should block it).

---

### Task 3: Exclude the Python folder from the pnpm workspace

**Files:**
- Modify: `pnpm-workspace.yaml`
- Test: none (verify pnpm install stays clean)

- [ ] **Step 1: Inspect current workspace config**

```bash
cat pnpm-workspace.yaml
```

Expected current content:

```yaml
packages:
  - "packages/*"
  - "services/*"
```

- [ ] **Step 2: Replace with excluded entry**

Overwrite `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "services/*"
  - "!packages/spec-graph-schema-py"
```

- [ ] **Step 3: Run `pnpm install` to confirm exclusion works**

```bash
pnpm install
```

Expected: pnpm install completes; the output lists the existing TS packages only. No mention of `spec-graph-schema-py` (pnpm would otherwise warn "package.json not found" for the Python folder).

- [ ] **Step 4: Confirm existing TS tests still pass**

```bash
pnpm -r test
```

Expected: all pre-existing tests pass, unchanged from B.1 baseline.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore(monorepo): exclude spec-graph-schema-py from pnpm workspace"
```

---

### Task 4: Add root `pnpm` scripts for the Python package

**Files:**
- Modify: `package.json`
- Test: none (verify by invoking each script)

- [ ] **Step 1: Inspect current root scripts**

```bash
cat package.json
```

Look at the `scripts` block; memorize existing keys (`db:up`, `db:down`, `db:psql`, `build`, `test`, `typecheck`).

- [ ] **Step 2: Extend scripts with three new Python entries**

Edit `package.json`. Replace the entire `scripts` block with:

```json
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:psql": "docker compose exec postgres psql -U atlas -d atlas_dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "py:gen": "node tools/sync-schema-artifact.mjs && node tools/generate-pydantic.mjs",
    "py:check": "pnpm run py:gen && git diff --exit-code -- packages/spec-graph-schema-py/src/spec_graph_schema/models.py packages/spec-graph-schema-py/src/spec_graph_schema/schema/",
    "py:test": "cd packages/spec-graph-schema-py && uv run pytest"
  },
```

Leave the rest of `package.json` untouched.

- [ ] **Step 3: Verify scripts are registered**

```bash
pnpm run
```

Expected stdout includes the three new scripts (`py:gen`, `py:check`, `py:test`) alongside the existing ones.

- [ ] **Step 4: Sanity-check that the scripts fail in the expected way**

At this point `tools/sync-schema-artifact.mjs` doesn't exist yet.

```bash
pnpm run py:gen
```

Expected: Node exits non-zero with `Error: Cannot find module ... tools/sync-schema-artifact.mjs`. This is correct — T5 creates that file.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(monorepo): add py:gen, py:check, py:test root scripts"
```

---

### Task 5: Author `tools/sync-schema-artifact.mjs`

**Files:**
- Create: `tools/sync-schema-artifact.mjs`
- Create: `tools/sync-schema-artifact.test.mjs` (Node test — runs via `node --test`)

- [ ] **Step 1: Write the failing test**

`tools/sync-schema-artifact.test.mjs`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pyPackage = join(repoRoot, "packages", "spec-graph-schema-py", "src", "spec_graph_schema", "schema");
const schemaFile = join(pyPackage, "spec-graph.v1.schema.json");
const codesFile = join(pyPackage, "invariant-codes.json");

test("sync-schema-artifact copies both JSON artifacts into the Python package", () => {
  // Ensure TS dist exists first
  spawnSync("pnpm", ["-F", "@atlas/spec-graph-schema", "build"], { cwd: repoRoot, stdio: "inherit", shell: true });

  // Remove existing synced files so we know the sync wrote them
  if (existsSync(schemaFile)) rmSync(schemaFile);
  if (existsSync(codesFile)) rmSync(codesFile);

  const result = spawnSync("node", ["tools/sync-schema-artifact.mjs"], { cwd: repoRoot, stdio: "inherit" });
  assert.equal(result.status, 0, "sync-schema-artifact should exit 0");

  assert.ok(existsSync(schemaFile), "spec-graph.v1.schema.json should be copied");
  assert.ok(existsSync(codesFile), "invariant-codes.json should be copied");

  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");

  const codes = JSON.parse(readFileSync(codesFile, "utf8"));
  assert.equal(codes.length, 17);
});

test("sync-schema-artifact errors clearly when TS dist is missing", () => {
  // Simulate missing source by running from a temp dir where relative paths won't resolve.
  // Simpler: delete one artifact, rerun, see it fail with a specific message.
  const tsDistSchema = join(repoRoot, "packages", "spec-graph-schema", "dist", "schema", "spec-graph.v1.schema.json");
  if (existsSync(tsDistSchema)) rmSync(tsDistSchema);

  const result = spawnSync("node", ["tools/sync-schema-artifact.mjs"], { cwd: repoRoot });
  const stderr = result.stderr.toString();
  assert.notEqual(result.status, 0, "should exit non-zero when source missing");
  assert.ok(stderr.includes("spec-graph.v1.schema.json") && stderr.includes("not found"), "stderr should name the missing file");

  // Restore TS dist for downstream tests
  spawnSync("pnpm", ["-F", "@atlas/spec-graph-schema", "build"], { cwd: repoRoot, stdio: "inherit", shell: true });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --test tools/sync-schema-artifact.test.mjs
```

Expected: test errors because `tools/sync-schema-artifact.mjs` does not exist (`Cannot find module`). This is the red state.

- [ ] **Step 3: Write the implementation**

`tools/sync-schema-artifact.mjs`:

```javascript
#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const SOURCES = [
  {
    from: join(repoRoot, "packages", "spec-graph-schema", "dist", "schema", "spec-graph.v1.schema.json"),
    name: "spec-graph.v1.schema.json"
  },
  {
    from: join(repoRoot, "packages", "spec-graph-schema", "dist", "schema", "invariant-codes.json"),
    name: "invariant-codes.json"
  }
];

const destDir = join(
  repoRoot,
  "packages",
  "spec-graph-schema-py",
  "src",
  "spec_graph_schema",
  "schema"
);
mkdirSync(destDir, { recursive: true });

for (const { from, name } of SOURCES) {
  if (!existsSync(from)) {
    process.stderr.write(
      `sync-schema-artifact: ${name} not found at ${from}\n` +
      `  Run 'pnpm -F @atlas/spec-graph-schema build' first.\n`
    );
    process.exit(1);
  }
  const to = join(destDir, name);
  copyFileSync(from, to);
  process.stdout.write(`synced ${name} → ${to}\n`);
}
```

- [ ] **Step 4: Run the test; expect pass**

```bash
node --test tools/sync-schema-artifact.test.mjs
```

Expected: 2 tests pass. Synced artifacts now exist at `packages/spec-graph-schema-py/src/spec_graph_schema/schema/`.

- [ ] **Step 5: Commit**

```bash
git add tools/sync-schema-artifact.mjs tools/sync-schema-artifact.test.mjs packages/spec-graph-schema-py/src/spec_graph_schema/schema/spec-graph.v1.schema.json packages/spec-graph-schema-py/src/spec_graph_schema/schema/invariant-codes.json
git commit -m "feat(tools): add sync-schema-artifact.mjs to copy TS JSON artifacts into Python package"
```

---

### Task 6: Author `tools/generate-pydantic.mjs`

**Files:**
- Create: `tools/generate-pydantic.mjs`
- Create: `tools/generate-pydantic.test.mjs`

- [ ] **Step 1: Write the failing test**

`tools/generate-pydantic.test.mjs`:

```javascript
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const modelsFile = join(
  repoRoot,
  "packages",
  "spec-graph-schema-py",
  "src",
  "spec_graph_schema",
  "models.py"
);
const BANNER_LINE_ONE = "# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT";

test("generate-pydantic produces models.py with the banner on line 1", () => {
  // Prereq: schemas must be synced
  spawnSync("node", ["tools/sync-schema-artifact.mjs"], { cwd: repoRoot, stdio: "inherit" });

  const result = spawnSync("node", ["tools/generate-pydantic.mjs"], { cwd: repoRoot, stdio: "inherit" });
  assert.equal(result.status, 0, "generate-pydantic should exit 0");

  assert.ok(existsSync(modelsFile), "models.py should be created");

  const lines = readFileSync(modelsFile, "utf8").split("\n");
  assert.equal(lines[0], BANNER_LINE_ONE, "line 1 must match the banner exactly");
  assert.ok(lines[1].startsWith("# Source:"), "line 2 should start with '# Source:'");
  assert.ok(lines[2].startsWith("# Regenerate:"), "line 3 should start with '# Regenerate:'");
  assert.ok(lines[3].startsWith("# Schema hash: sha256:"), "line 4 should carry the schema hash");
});

test("generate-pydantic is idempotent — running twice produces identical output", () => {
  const first = readFileSync(modelsFile, "utf8");
  spawnSync("node", ["tools/generate-pydantic.mjs"], { cwd: repoRoot, stdio: "inherit" });
  const second = readFileSync(modelsFile, "utf8");
  assert.equal(first, second, "output must be identical on repeat runs");
});
```

- [ ] **Step 2: Run the test to confirm failure**

```bash
node --test tools/generate-pydantic.test.mjs
```

Expected: tests error because `tools/generate-pydantic.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

`tools/generate-pydantic.mjs`:

```javascript
#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pyPackage = join(repoRoot, "packages", "spec-graph-schema-py");
const schemaFile = join(pyPackage, "src", "spec_graph_schema", "schema", "spec-graph.v1.schema.json");
const outFile = join(pyPackage, "src", "spec_graph_schema", "models.py");

if (!existsSync(schemaFile)) {
  process.stderr.write(
    `generate-pydantic: schema not found at ${schemaFile}\n` +
    `  Run 'node tools/sync-schema-artifact.mjs' first (or 'pnpm py:gen' which does both).\n`
  );
  process.exit(1);
}

const schemaBytes = readFileSync(schemaFile);
const schemaHash = "sha256:" + createHash("sha256").update(schemaBytes).digest("hex");

// Invoke datamodel-code-generator through uv run so the version is locked to uv.lock
const args = [
  "run",
  "datamodel-code-generator",
  "--input", schemaFile,
  "--input-file-type", "jsonschema",
  "--output", outFile,
  "--target-python-version", "3.11",
  "--output-model-type", "pydantic_v2.BaseModel",
  "--use-schema-description",
  "--use-standard-collections",
  "--use-union-operator",
  "--disable-timestamp",
  "--use-field-description",
  "--capitalise-enum-members",
  "--snake-case-field"
];

const codegen = spawnSync("uv", args, { cwd: pyPackage, stdio: "inherit" });
if (codegen.status !== 0) {
  process.stderr.write(`generate-pydantic: datamodel-code-generator exited ${codegen.status}\n`);
  process.exit(codegen.status ?? 1);
}

// Prepend the banner
const BANNER = [
  "# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT",
  "# Source: packages/spec-graph-schema/src/",
  "# Regenerate: pnpm py:gen",
  `# Schema hash: ${schemaHash}`,
  ""
].join("\n");

const generated = readFileSync(outFile, "utf8");
writeFileSync(outFile, BANNER + generated, "utf8");
process.stdout.write(`wrote ${outFile}\n`);
```

- [ ] **Step 4: Run the test; expect pass**

Verify `uv sync` has already been done inside `packages/spec-graph-schema-py/` (done in T2.5). Then:

```bash
node --test tools/generate-pydantic.test.mjs
```

Expected: 2 tests pass. `models.py` exists with the banner on line 1.

- [ ] **Step 5: Commit**

Hold off on committing `models.py` — T10 is the task that explicitly commits it as the first generated artifact. For now:

```bash
git add tools/generate-pydantic.mjs tools/generate-pydantic.test.mjs
git commit -m "feat(tools): add generate-pydantic.mjs to emit models.py from JSON Schema"
```

---

### Task 7: Hand-author `invariants.py` + `test_invariant_codes.py`

**Files:**
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/invariants.py`
- Create: `packages/spec-graph-schema-py/tests/conftest.py`
- Create: `packages/spec-graph-schema-py/tests/test_invariant_codes.py`

- [ ] **Step 1: Write shared `conftest.py`**

`packages/spec-graph-schema-py/tests/conftest.py`:

```python
"""Shared pytest fixtures for spec-graph-schema-py tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_PACKAGES_DIR = Path(__file__).resolve().parent.parent.parent  # .../packages/
PY_PACKAGE_ROOT = REPO_PACKAGES_DIR / "spec-graph-schema-py"
TS_PACKAGE_ROOT = REPO_PACKAGES_DIR / "spec-graph-schema"
BUNDLED_SCHEMA_DIR = PY_PACKAGE_ROOT / "src" / "spec_graph_schema" / "schema"


@pytest.fixture(scope="session")
def ts_fixtures_dir() -> Path:
    return TS_PACKAGE_ROOT / "test" / "fixtures"


@pytest.fixture(scope="session")
def valid_forgot_password_graph(ts_fixtures_dir: Path) -> dict:
    path = ts_fixtures_dir / "valid-forgot-password.json"
    assert path.exists(), (
        f"TS fixture missing at {path}. "
        "Plan B.1 must be merged before these tests run."
    )
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def bundled_invariant_codes() -> list[str]:
    path = BUNDLED_SCHEMA_DIR / "invariant-codes.json"
    assert path.exists(), (
        f"Bundled artifact missing at {path}. "
        "Run `pnpm py:gen` first."
    )
    return json.loads(path.read_text(encoding="utf-8"))
```

- [ ] **Step 2: Write the failing test**

`packages/spec-graph-schema-py/tests/test_invariant_codes.py`:

```python
"""The Python InvariantCode enum must match the TS source of truth exactly."""
from __future__ import annotations


def test_invariant_code_enum_matches_bundled_artifact(bundled_invariant_codes: list[str]) -> None:
    from spec_graph_schema.invariants import InvariantCode, INVARIANT_CODES

    python_codes = {code.value for code in InvariantCode}
    ts_codes = set(bundled_invariant_codes)
    assert python_codes == ts_codes, f"drift: TS-Python = {ts_codes - python_codes}; Python-TS = {python_codes - ts_codes}"

    assert sorted(INVARIANT_CODES) == sorted(bundled_invariant_codes)


def test_invariant_code_cardinality(bundled_invariant_codes: list[str]) -> None:
    """Three invariants (I04, I07, I08) emit two codes each; total is 17."""
    from spec_graph_schema.invariants import InvariantCode

    assert len(bundled_invariant_codes) == 17
    assert len(list(InvariantCode)) == 17


def test_invariant_code_format(bundled_invariant_codes: list[str]) -> None:
    import re
    pattern = re.compile(r"^I\d{2}_[A-Z0-9_]+$")
    for code in bundled_invariant_codes:
        assert pattern.match(code), f"code {code!r} does not match I\\d{{2}}_... pattern"
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_invariant_codes.py -v
cd ../..
```

Expected: `ModuleNotFoundError: No module named 'spec_graph_schema.invariants'` (or an ImportError for `InvariantCode`).

- [ ] **Step 4: Write `invariants.py`**

`packages/spec-graph-schema-py/src/spec_graph_schema/invariants.py`:

```python
"""Canonical invariant codes emitted by the TS validator.

These mirror packages/spec-graph-schema/src/invariants/*.ts exactly.
The TS build emits invariant-codes.json (bundled inside this package's
schema/ directory); test_invariant_codes.py asserts this enum stays in
lockstep with that artifact.

Python consumers do NOT run invariant logic — these codes exist so that
cross-language tooling (error-reporting UIs, cloud_migration future
fusion) can speak the same error vocabulary as the TS validator.
"""
from __future__ import annotations

from enum import Enum


class InvariantCode(str, Enum):
    I01_PAGE_MISSING_ROUTEREF = "I01_PAGE_MISSING_ROUTEREF"
    I02_ENDPOINT_MISSING_ROUTEREF = "I02_ENDPOINT_MISSING_ROUTEREF"
    I03_AUTH_PAGE_MISSING_BOUNDARY = "I03_AUTH_PAGE_MISSING_BOUNDARY"
    I04_PII_ENDPOINT_MISSING_AUTH = "I04_PII_ENDPOINT_MISSING_AUTH"
    I04_PII_ENDPOINT_MISSING_COMPLIANCE = "I04_PII_ENDPOINT_MISSING_COMPLIANCE"
    I05_PII_MODEL_MISSING_RLS = "I05_PII_MODEL_MISSING_RLS"
    I06_DEPENDENCY_HAS_CRITICAL_CVE = "I06_DEPENDENCY_HAS_CRITICAL_CVE"
    I07_RENDERS_DANGLING_REF = "I07_RENDERS_DANGLING_REF"
    I07_RENDERS_WRONG_KIND = "I07_RENDERS_WRONG_KIND"
    I08_BASELINE_COMPLIANCE_MISSING = "I08_BASELINE_COMPLIANCE_MISSING"
    I08_BASELINE_COMPLIANCE_DUPLICATED = "I08_BASELINE_COMPLIANCE_DUPLICATED"
    I09_MISSING_TEST_COVERAGE = "I09_MISSING_TEST_COVERAGE"
    I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE = "I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE"
    I11_GENERATED_MEDIA_MISSING_PROVIDER = "I11_GENERATED_MEDIA_MISSING_PROVIDER"
    I12_PII_CLIENTSTATE_MISSING_COMPLIANCE = "I12_PII_CLIENTSTATE_MISSING_COMPLIANCE"
    I13_PROTECTED_TARGET_MISSING_BASELINE_TEST = "I13_PROTECTED_TARGET_MISSING_BASELINE_TEST"
    I14_MEDIAASSET_KIND_PHASE_B = "I14_MEDIAASSET_KIND_PHASE_B"


INVARIANT_CODES: list[str] = sorted(code.value for code in InvariantCode)
```

- [ ] **Step 5: Run the tests; expect pass**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_invariant_codes.py -v
cd ../..
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-schema-py/src/spec_graph_schema/invariants.py packages/spec-graph-schema-py/tests/conftest.py packages/spec-graph-schema-py/tests/test_invariant_codes.py
git commit -m "feat(spec-graph-schema-py): add InvariantCode enum with drift test against TS codes"
```

---

### Task 8: Hand-author `_schema_artifact.py`

**Files:**
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/_schema_artifact.py`

No dedicated test file — this module is exercised by T9 (`test_validate_structural.py`) which imports it. Keep it minimal and unsurprising.

- [ ] **Step 1: Write the module**

`packages/spec-graph-schema-py/src/spec_graph_schema/_schema_artifact.py`:

```python
"""Load the bundled JSON Schema artifact via importlib.resources.

The schema lives alongside this module in the `schema/` subpackage. It
is populated by tools/sync-schema-artifact.mjs (run via `pnpm py:gen`)
and MUST NOT be hand-edited.
"""
from __future__ import annotations

import json
from functools import lru_cache
from importlib.resources import files
from typing import Any


_SCHEMA_RESOURCE = "spec-graph.v1.schema.json"
_CODES_RESOURCE = "invariant-codes.json"


@lru_cache(maxsize=1)
def load_schema() -> dict[str, Any]:
    """Return the bundled JSON Schema 2020-12 document as a Python dict."""
    resource = files("spec_graph_schema.schema").joinpath(_SCHEMA_RESOURCE)
    with resource.open("rb") as f:
        return json.loads(f.read().decode("utf-8"))


@lru_cache(maxsize=1)
def load_invariant_codes() -> list[str]:
    """Return the bundled list of canonical invariant code strings."""
    resource = files("spec_graph_schema.schema").joinpath(_CODES_RESOURCE)
    with resource.open("rb") as f:
        return json.loads(f.read().decode("utf-8"))
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
cd packages/spec-graph-schema-py
uv run python -c "from spec_graph_schema._schema_artifact import load_schema; s = load_schema(); print(s['\$schema'])"
cd ../..
```

Expected stdout: `https://json-schema.org/draft/2020-12/schema`.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-schema-py/src/spec_graph_schema/_schema_artifact.py
git commit -m "feat(spec-graph-schema-py): add _schema_artifact loader for bundled JSON Schema"
```

---

### Task 9: Hand-author `validate_structural.py` + `test_validate_structural.py`

**Files:**
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/validate_structural.py`
- Create: `packages/spec-graph-schema-py/tests/test_validate_structural.py`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-schema-py/tests/test_validate_structural.py`:

```python
"""JSON-Schema-only structural validation.

Invariant logic (the 14 graph-level checks) is NOT ported in B.2;
`validate_structural` runs only Draft 2020-12 schema validation.
"""
from __future__ import annotations


def test_valid_fixture_passes(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema.validate_structural import validate_structural

    result = validate_structural(valid_forgot_password_graph)
    assert result.ok is True, f"expected ok, got issues: {result.issues}"
    assert result.issues == []


def test_missing_required_field_fails() -> None:
    from spec_graph_schema.validate_structural import validate_structural

    malformed = {
        # "schemaVersion" deliberately missing
        "projectId": "11111111-1111-4111-8111-111111111111",
        "name": "demo",
        "complianceClasses": ["baseline"],
        "nodes": {},
        "edges": [],
    }
    result = validate_structural(malformed)
    assert result.ok is False
    assert len(result.issues) >= 1
    joined = " ".join(issue.message for issue in result.issues).lower()
    assert "schemaversion" in joined or "required" in joined


def test_wrong_type_fails() -> None:
    from spec_graph_schema.validate_structural import validate_structural

    malformed = {
        "schemaVersion": "1.0.0",
        "projectId": 12345,  # should be a UUID string
        "name": "demo",
        "complianceClasses": ["baseline"],
        "databaseProvider": {"tier": "atlas-run", "provider": "neon", "region": "us-east-1", "connectionStringRef": "env:DB"},
        "templateDigest": "sha256:" + "0" * 64,
        "createdAt": "2026-04-20T00:00:00.000Z",
        "updatedAt": "2026-04-20T00:00:00.000Z",
        "nodes": {},
        "edges": [],
    }
    result = validate_structural(malformed)
    assert result.ok is False


def test_issue_path_is_tuple_of_str_or_int() -> None:
    from spec_graph_schema.validate_structural import validate_structural

    malformed = {"schemaVersion": 1}  # many required fields missing, and wrong type
    result = validate_structural(malformed)
    assert result.ok is False
    for issue in result.issues:
        assert isinstance(issue.path, tuple)
        for segment in issue.path:
            assert isinstance(segment, (str, int)), f"segment {segment!r} has type {type(segment)}"
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_validate_structural.py -v
cd ../..
```

Expected: `ModuleNotFoundError: No module named 'spec_graph_schema.validate_structural'`.

- [ ] **Step 3: Write the implementation**

`packages/spec-graph-schema-py/src/spec_graph_schema/validate_structural.py`:

```python
"""Draft 2020-12 JSON Schema structural validation.

This is intentionally *not* equivalent to the TS `validate()` function
— it runs no invariant logic. Python consumers that need invariant
checks call across to the TS validator via a future HTTP endpoint.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator

from ._schema_artifact import load_schema


@dataclass(frozen=True)
class StructuralIssue:
    path: tuple[str | int, ...]
    message: str


@dataclass(frozen=True)
class StructuralValidationResult:
    ok: bool
    issues: list[StructuralIssue] = field(default_factory=list)


def validate_structural(graph: Any) -> StructuralValidationResult:
    """Run JSON Schema 2020-12 structural validation over `graph`.

    Returns a StructuralValidationResult. When `ok` is False, `issues`
    is populated with one StructuralIssue per schema violation found.
    """
    schema = load_schema()
    validator = Draft202012Validator(schema)
    raw_errors = sorted(validator.iter_errors(graph), key=lambda e: list(e.absolute_path))

    issues = [
        StructuralIssue(path=tuple(err.absolute_path), message=err.message)
        for err in raw_errors
    ]
    return StructuralValidationResult(ok=(len(issues) == 0), issues=issues)
```

- [ ] **Step 4: Run the tests; expect pass**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_validate_structural.py -v
cd ../..
```

Expected: 4 tests pass. Test #1 (`test_valid_fixture_passes`) only succeeds if the bundled `spec-graph.v1.schema.json` has been synced — T5's commit included the initial sync, so this should be present.

If `test_valid_fixture_passes` fails with schema validation errors against the canonical fixture: the JSON Schema has drifted or is misaligned with the fixture. Do not loosen the schema — inspect the reported issues, confirm the fixture matches the TS `SpecGraphSchema`, and fix the upstream schema if there's a genuine discrepancy.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema-py/src/spec_graph_schema/validate_structural.py packages/spec-graph-schema-py/tests/test_validate_structural.py
git commit -m "feat(spec-graph-schema-py): add validate_structural + StructuralValidationResult"
```

---

### Task 10: First `py:gen` run + `test_generated_banner.py`

**Files:**
- Create: `packages/spec-graph-schema-py/src/spec_graph_schema/models.py` (via `pnpm py:gen`)
- Create: `packages/spec-graph-schema-py/tests/test_generated_banner.py`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-schema-py/tests/test_generated_banner.py`:

```python
"""Guard against hand-edits to the generated models.py."""
from __future__ import annotations

from pathlib import Path

MODELS_PATH = (
    Path(__file__).resolve().parent.parent
    / "src"
    / "spec_graph_schema"
    / "models.py"
)
BANNER_LINE_ONE = "# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT"


def test_models_file_exists() -> None:
    assert MODELS_PATH.exists(), (
        f"{MODELS_PATH} missing. Run `pnpm py:gen` from the repo root."
    )


def test_banner_on_line_one() -> None:
    lines = MODELS_PATH.read_text(encoding="utf-8").splitlines()
    assert lines[0] == BANNER_LINE_ONE
    assert lines[1].startswith("# Source:")
    assert lines[2].startswith("# Regenerate:")
    assert lines[3].startswith("# Schema hash: sha256:")


def test_banner_hash_format() -> None:
    import re
    line = MODELS_PATH.read_text(encoding="utf-8").splitlines()[3]
    assert re.match(r"^# Schema hash: sha256:[0-9a-f]{64}$", line)
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_generated_banner.py -v
cd ../..
```

Expected: `test_models_file_exists` fails (models.py absent).

- [ ] **Step 3: Run `pnpm py:gen` to produce `models.py`**

```bash
pnpm -F @atlas/spec-graph-schema build  # ensure TS dist is fresh
pnpm py:gen
```

Expected stdout: `synced spec-graph.v1.schema.json ...`, `synced invariant-codes.json ...`, `wrote .../models.py`. Inspect the first 5 lines:

```bash
head -n 5 packages/spec-graph-schema-py/src/spec_graph_schema/models.py
```

Expected:
```
# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT
# Source: packages/spec-graph-schema/src/
# Regenerate: pnpm py:gen
# Schema hash: sha256:<64 hex chars>

```

- [ ] **Step 4: Re-run the test; expect pass**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_generated_banner.py -v
cd ../..
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema-py/src/spec_graph_schema/models.py packages/spec-graph-schema-py/tests/test_generated_banner.py
git commit -m "feat(spec-graph-schema-py): commit initial generated models.py with banner test"
```

The generated `models.py` is now the pinned artifact; all subsequent regenerations must match it byte-for-byte.

---

### Task 11: `__init__.py` re-exports + `test_models_roundtrip.py`

**Files:**
- Modify: `packages/spec-graph-schema-py/src/spec_graph_schema/__init__.py`
- Create: `packages/spec-graph-schema-py/tests/test_models_roundtrip.py`

- [ ] **Step 1: Inspect generated symbol names**

```bash
grep -E "^class " packages/spec-graph-schema-py/src/spec_graph_schema/models.py | head -30
```

Record the top-level class names (typical output includes `class SpecGraph`, `class Page`, `class Route`, etc.). The exact casing depends on the JSON Schema title for each `$ref` target. If a class is named `SpecGraph`, re-export it as-is; if it arrived as `Node` or `Spec_graph`, revisit the generator flags.

**Expected top-level models** (may vary slightly based on generator's naming heuristic):
- `SpecGraph` (root)
- 14 node classes: `Page`, `Route`, `Component`, `ClientState`, `Model`, `Endpoint`, `Flow`, `AuthBoundary`, `Test`, `DesignToken`, `Dependency`, `ComplianceClass`, `AIFeature`, `MediaAsset`
- 13 edge classes (if emitted as distinct types): `RendersEdge`, `FetchesEdge`, etc. — or a single `Edge` union depending on codegen

If the codegen produced different names (e.g., `Model1`, `Page1` for disambiguation), file a follow-up note in the task but proceed: the re-exports list adapts to whatever was emitted. The round-trip test validates behavior, not names.

- [ ] **Step 2: Write the failing test**

`packages/spec-graph-schema-py/tests/test_models_roundtrip.py`:

```python
"""The canonical fixture must parse via Pydantic and round-trip to equal JSON."""
from __future__ import annotations

import json


def test_spec_graph_parses(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema import SpecGraph

    graph = SpecGraph.model_validate(valid_forgot_password_graph)
    assert graph is not None


def test_spec_graph_roundtrips(valid_forgot_password_graph: dict) -> None:
    from spec_graph_schema import SpecGraph

    graph = SpecGraph.model_validate(valid_forgot_password_graph)
    dumped = graph.model_dump(mode="json", by_alias=True, exclude_none=True)

    # Round-trip equality modulo key ordering
    input_canon = json.dumps(valid_forgot_password_graph, sort_keys=True)
    dumped_canon = json.dumps(dumped, sort_keys=True)
    assert input_canon == dumped_canon, (
        f"round-trip mismatch:\n"
        f"  input  = {input_canon[:300]}...\n"
        f"  dumped = {dumped_canon[:300]}..."
    )


def test_public_exports_are_importable() -> None:
    """Spec §7 public API must be importable from the top-level package."""
    import spec_graph_schema as sgs

    expected = {
        # Root
        "SpecGraph",
        # 14 nodes
        "Page", "Route", "Component", "ClientState", "Model", "Endpoint",
        "Flow", "AuthBoundary", "Test", "DesignToken", "Dependency",
        "ComplianceClass", "AIFeature", "MediaAsset",
        # 13 edges
        "RendersEdge", "FetchesEdge", "ReadsEdge", "MutatesEdge",
        "RequiresEdge", "CoversEdge", "DependsOnEdge", "StyledByEdge",
        "SubjectToEdge", "SupersedesEdge", "PowersEdge", "DisplaysEdge",
        "ManagesEdge",
        # Error vocabulary
        "InvariantCode", "INVARIANT_CODES",
        # Validation
        "validate_structural", "StructuralValidationResult", "StructuralIssue",
    }
    missing = expected - set(sgs.__all__)
    assert not missing, f"missing from spec_graph_schema.__all__: {missing}"

    # Verify each name resolves to a real attribute.
    for name in expected:
        assert hasattr(sgs, name), f"spec_graph_schema has no attribute {name!r}"

    assert isinstance(sgs.INVARIANT_CODES, list) and len(sgs.INVARIANT_CODES) == 17
    assert callable(sgs.validate_structural)
```

- [ ] **Step 3: Run the test to confirm failure**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_models_roundtrip.py -v
cd ../..
```

Expected: `ImportError` on `from spec_graph_schema import SpecGraph` — `__init__.py` doesn't re-export it yet.

- [ ] **Step 4: Rewrite `__init__.py` to match spec §7's public API**

Overwrite `packages/spec-graph-schema-py/src/spec_graph_schema/__init__.py`:

```python
"""Atlas Spec Graph v1 — Python bindings.

Public API (matches docs/superpowers/specs/2026-04-20-spec-graph-schema-py-and-c1-d1-refresh-design.md §7):
    SpecGraph                                   — root Pydantic model
    14 node types: Page, Route, Component, ClientState, Model, Endpoint,
                   Flow, AuthBoundary, Test, DesignToken, Dependency,
                   ComplianceClass, AIFeature, MediaAsset
    13 edge types: RendersEdge, FetchesEdge, ReadsEdge, MutatesEdge,
                   RequiresEdge, CoversEdge, DependsOnEdge, StyledByEdge,
                   SubjectToEdge, SupersedesEdge, PowersEdge, DisplaysEdge,
                   ManagesEdge
    InvariantCode, INVARIANT_CODES              — canonical error vocabulary
    validate_structural                         — Draft 2020-12 validator
    StructuralValidationResult, StructuralIssue — result dataclasses
"""
from __future__ import annotations

from .invariants import INVARIANT_CODES, InvariantCode
from .models import (
    AIFeature,
    AuthBoundary,
    ClientState,
    Component,
    ComplianceClass,
    CoversEdge,
    Dependency,
    DependsOnEdge,
    DesignToken,
    DisplaysEdge,
    Endpoint,
    FetchesEdge,
    Flow,
    ManagesEdge,
    MediaAsset,
    Model,
    MutatesEdge,
    Page,
    PowersEdge,
    ReadsEdge,
    RendersEdge,
    RequiresEdge,
    Route,
    SpecGraph,
    StyledByEdge,
    SubjectToEdge,
    SupersedesEdge,
    Test,
)
from .validate_structural import (
    StructuralIssue,
    StructuralValidationResult,
    validate_structural,
)

__all__ = [
    # Root
    "SpecGraph",
    # Nodes (14)
    "Page", "Route", "Component", "ClientState", "Model", "Endpoint",
    "Flow", "AuthBoundary", "Test", "DesignToken", "Dependency",
    "ComplianceClass", "AIFeature", "MediaAsset",
    # Edges (13)
    "RendersEdge", "FetchesEdge", "ReadsEdge", "MutatesEdge",
    "RequiresEdge", "CoversEdge", "DependsOnEdge", "StyledByEdge",
    "SubjectToEdge", "SupersedesEdge", "PowersEdge", "DisplaysEdge",
    "ManagesEdge",
    # Error vocabulary
    "InvariantCode", "INVARIANT_CODES",
    # Validation
    "validate_structural",
    "StructuralValidationResult", "StructuralIssue",
]
```

**If the generator produced different class names** (e.g., `PageNode` instead of `Page`, or `RendersEdgeSchema` instead of `RendersEdge`): use `as` aliases to preserve the spec §7 public contract. For example, if Step 1's grep showed `class PageNode(BaseModel):` in models.py, replace the import line with `from .models import PageNode as Page`. The public API is the contract; the internal generated names are not.

If the generator split a node into two classes (e.g., `Page` + `PageConfig`), re-export only the outer one.

If an expected class is entirely absent from `models.py`: this indicates a generator-flag mismatch. Before proceeding, confirm with the §5.5 fixture — if the fixture uses the missing class, the generator is under-emitting; adjust `tools/generate-pydantic.mjs` flags and regenerate.

- [ ] **Step 5: Run the tests; expect pass**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_models_roundtrip.py -v
cd ../..
```

Expected: 3 tests pass.

If `test_spec_graph_roundtrips` fails on a key-ordering / alias issue (e.g., a camelCase field in the fixture not round-tripping because `--snake-case-field` renamed it and the alias isn't being applied), the fix is on the generator side: adjust `tools/generate-pydantic.mjs` to invoke datamodel-code-generator with `--strict-nullable --use-annotated` (or similar Pydantic v2 alias-preserving flags) so Pydantic emits `Field(..., alias="camelCase")` declarations. Regenerate via `pnpm py:gen`, verify test passes, and commit both the tool change and the regenerated `models.py` in the same commit as this task.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-schema-py/src/spec_graph_schema/__init__.py packages/spec-graph-schema-py/tests/test_models_roundtrip.py
git commit -m "feat(spec-graph-schema-py): public API re-exports + round-trip test against §5.5 fixture"
```

---

### Task 12: Drift-check smoke test

**Files:**
- Create: `packages/spec-graph-schema-py/tests/test_drift_check.py`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-schema-py/tests/test_drift_check.py`:

```python
"""The `pnpm py:check` command must catch drift in models.py.

This test is the teeth behind the drift-check contract: if a developer
edits Zod schemas without regenerating, pnpm py:check exits non-zero.

Test strategy: regenerate models.py (should be a no-op; exits 0), then
mutate it, rerun py:check, assert exit code is non-zero.
"""
from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # .../ai_builder
MODELS_PATH = (
    REPO_ROOT
    / "packages"
    / "spec-graph-schema-py"
    / "src"
    / "spec_graph_schema"
    / "models.py"
)


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd, cwd=REPO_ROOT, capture_output=True, text=True, shell=False
    )


def test_py_check_passes_when_models_are_in_sync() -> None:
    result = _run(["pnpm", "run", "py:check"])
    assert result.returncode == 0, (
        f"pnpm py:check failed unexpectedly:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


def test_py_check_fails_when_models_have_been_edited() -> None:
    original = MODELS_PATH.read_text(encoding="utf-8")
    try:
        MODELS_PATH.write_text(
            original + "\n# stray hand-edit — drift check should catch this\n",
            encoding="utf-8",
        )
        result = _run(["pnpm", "run", "py:check"])
        assert result.returncode != 0, (
            "pnpm py:check did NOT fail after a hand-edit to models.py — drift is undetectable"
        )
    finally:
        # Always restore the original before the test harness sees it.
        MODELS_PATH.write_text(original, encoding="utf-8")

    # Sanity: after restore, py:check goes green again.
    result = _run(["pnpm", "run", "py:check"])
    assert result.returncode == 0, "py:check should pass again after restore"
```

- [ ] **Step 2: Run the test**

```bash
cd packages/spec-graph-schema-py
uv run pytest tests/test_drift_check.py -v
cd ../..
```

Expected: both tests pass. This is not a "failing test first" TDD step — the infrastructure it tests (`pnpm py:check`) already exists from T4. The test is the first-class guarantee that the drift check works as advertised.

If `test_py_check_fails_when_models_have_been_edited` passes accidentally (exit code 0 despite mutation), `pnpm py:check` is misconfigured — trace the issue to the `git diff --exit-code` glob in `package.json` T4, confirm the models.py path is included, and fix.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-schema-py/tests/test_drift_check.py
git commit -m "test(spec-graph-schema-py): add drift-check smoke test guarding pnpm py:check"
```

---

### Task 13: Python package README

**Files:**
- Modify: `packages/spec-graph-schema-py/README.md`

No TDD — prose.

- [ ] **Step 1: Rewrite the README**

Replace the placeholder `packages/spec-graph-schema-py/README.md` with:

````markdown
# spec-graph-schema (Python)

Python Pydantic v2 bindings for the Atlas Spec Graph v1 schema.

This package is a **generated-from-TypeScript** mirror of `@atlas/spec-graph-schema`. The canonical source of truth is the Zod schema in `packages/spec-graph-schema/src/`; this package re-publishes that schema's JSON Schema artifact as typed Pydantic models so that Python consumers (notably `cloud_migration`) can parse and serialize Spec Graph documents without re-implementing the shape.

## What this package provides

- `SpecGraph` — root Pydantic model (generated)
- Every node and edge type as a Pydantic model (generated; see `spec_graph_schema.models`)
- `InvariantCode` — `Enum` of the 17 canonical invariant code strings
- `INVARIANT_CODES` — sorted `list[str]` of those codes
- `validate_structural(graph)` — Draft 2020-12 JSON Schema structural validator; returns `StructuralValidationResult(ok, issues)`

## What this package does NOT provide

- **The 14 structural invariants.** Invariant logic lives in the TS package (`@atlas/spec-graph-schema/validate`) and is canonical there. Python consumers that need invariant-level checks call the TS validator via a future HTTP endpoint, not a duplicated Python port.

## Install

This package is workspace-private; it is not on PyPI. To use it in a sibling Python project:

```bash
# from the repo root, editable install
uv pip install -e packages/spec-graph-schema-py
```

## Usage

```python
import json
from spec_graph_schema import SpecGraph, validate_structural, InvariantCode

# Structural validation
graph = json.loads(open("my_graph.json").read())
result = validate_structural(graph)
if not result.ok:
    for issue in result.issues:
        print(f"{issue.path}: {issue.message}")

# Typed parse
model = SpecGraph.model_validate(graph)
print(model.project_id, len(model.nodes))

# Error vocabulary shared with the TS validator
print(InvariantCode.I01_PAGE_MISSING_ROUTEREF.value)
```

## Generator policy

The file `src/spec_graph_schema/models.py` is **generated** — do not hand-edit. Its first line is the banner:

```
# AUTO-GENERATED from spec-graph.v1.schema.json — DO NOT EDIT
```

To regenerate (after a TS schema change):

```bash
pnpm -F @atlas/spec-graph-schema build   # rebuilds JSON Schema + invariant codes
pnpm py:gen                               # syncs artifacts + regenerates models.py
```

The generator is `tools/generate-pydantic.mjs` (invoked via `uv run datamodel-code-generator`, version-pinned in `pyproject.toml`'s dev dependencies).

## Drift check

`pnpm py:check` regenerates `models.py` and runs `git diff --exit-code` against the committed file. It fails if the two do not match — catching the case where a Zod schema change wasn't followed by a Python regeneration. Run before every commit that touches the TS schema; the check is CI-ready when CI is wired (not in B.2 scope).

## Testing

```bash
cd packages/spec-graph-schema-py
uv sync
uv run pytest
```

Tests read TS fixtures at `../spec-graph-schema/test/fixtures/` — no duplicated fixture corpus.
````

- [ ] **Step 2: Commit**

```bash
git add packages/spec-graph-schema-py/README.md
git commit -m "docs(spec-graph-schema-py): add package README with install, usage, generator policy"
```

---

### Task 14: Update B.1 plan's handoff section

**Files:**
- Modify: `docs/superpowers/plans/2026-04-19-spec-graph-schema.md`

The existing B.1 plan's handoff section references "Plan B.2" generically. Point it at the concrete filename now that B.2 exists.

- [ ] **Step 1: Locate the handoff section**

Open `docs/superpowers/plans/2026-04-19-spec-graph-schema.md`. Scroll to the section titled `## Handoff to Plan B.2`. The first paragraph currently reads:

```
Plan B.2 (Python Pydantic bindings + markdown reference doc generator) consumes:
```

- [ ] **Step 2: Update the paragraph + add concrete plan-file link**

Replace the paragraph with:

```
Plan B.2 (Python Pydantic bindings; see `docs/superpowers/plans/2026-04-20-spec-graph-schema-py.md`) consumes:
```

In the same section, remove the "markdown reference doc generator" bullet — per B.2's §13 non-goals, the markdown reference doc is deferred to C.2 (OSS Skill Library), not B.2.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-19-spec-graph-schema.md
git commit -m "docs(plans): point B.1 handoff at concrete B.2 plan file"
```

---

### Task 15: Update the plans README index

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add a row to the plan index table**

Open `docs/superpowers/plans/README.md`. In the `## Plan index` table, add a new row immediately after the existing row for Plan A.4 (`2026-04-18-spec-graph-compaction-offline.md`):

```
| 5 | `2026-04-19-spec-graph-schema.md` | **B.1 — Spec Graph Schema** | TS types, Zod schemas, 14 invariants, JSON Schema artifact | 43 tasks, TDD | Shipped (merged c7ab760) |
| 6 | `2026-04-20-spec-graph-schema-py.md` | **B.2 — Python bindings** | Pydantic v2 models generated from the JSON Schema; structural validator; drift check | 17 tasks, TDD | Ready to execute |
```

Renumber the two existing directional-roadmap rows (`phase-a-units-b-through-g` and `phases-b-through-f-roadmap`) accordingly (they become rows 7 and 8).

- [ ] **Step 2: Update the execution-order diagram**

In the `### Phase A — immediate` section of the README, the ASCII dependency diagram currently shows `Unit B — Schema & Validation` as a bracket on the right. Expand the Unit B leaf so that B.1 and B.2 are visible:

```
A.1 (Plans[1])
  ├─ A.2 (Plans[2])  ─┬─ A.3 (Plans[3])
  │                    └─ A.4 (Plans[4])
  └─ Unit B — Schema & Validation
       ├─ B.1 (Plans[5], shipped)
       └─ B.2 (Plans[6], ready)
            └─ Unit C — Skill Framework  [from Plans[7] Unit C]
                 ├─ Unit D — Conductor + Roles [from Plans[7] Unit D]
                      └─ Unit E — Ritual + UX [from Plans[7] Unit E]
                           └─ Unit F — Bootstrap + risk gates [from Plans[7] Unit F]
                                └─ Unit G — Edit tiering [from Plans[7] Unit G]
```

(The bullet text under the diagram already explains the critical path; leave it unchanged.)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add B.1 (shipped) + B.2 (ready) entries to plan index"
```

---

### Task 16: Refresh Unit C section in the directional doc

**Files:**
- Modify: `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md`

Apply the refresh specified in the spec's §11.1. Two open questions lock, two new ones added.

- [ ] **Step 1: Locate Unit C's open-questions block**

Open `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md`. Find the section `## Unit C — Skill Framework Scaffold + Test Generator Registry`, then its subsection `**Open questions:**`.

- [ ] **Step 2: Replace the open-questions block**

Replace the existing `**Open questions:**` section (the numbered list of 6 items) with:

```markdown
**Resolved (post-B.1):**

1. **Skill execution isolation → main-process loader.** Rationale: B.1 confirmed the schemas-as-data pattern scales; skills stay markdown+frontmatter with no side-effect surface, so process isolation is unnecessary machinery.

5. **Pinning granularity → exact pin + dependabot-style upgrade PRs.** Rationale: B.1's exact-version discipline for `zod`, `zod-to-json-schema`, and `vitest` caught a silent `target: "jsonSchema2020-12"` ignore bug that a range pin would have hidden.

**Open questions (for C.1 plan-authoring time):**

2. **Intent-classifier prompt-cache hit rate.** NFR-13 targets >80%. Does a Haiku-4.5 classifier get us there, or do we need a local tiny model (e.g., distilled) for zero-latency triage? Recommendation: start with Haiku, measure, replace if miss rate is >20%.
3. **Human-baseline authorship.** Who writes the non-LLM baseline assertions at L4/L5? This is the Chairman-flagged Council blind-spot. Options: a named owner (dedicated engineer), external security consultants, staff engineering review committee. Decision needed before C.3 starts.
4. **OSS release cadence.** Weekly? Monthly? Recommendation: weekly patch releases, monthly minors — matches the community RFC rhythm.
6. **Calibration dataset.** Unit A's reconciliation classifier needs one; Unit C's drift detector needs one. Same dataset? Different? Recommendation: shared dataset starts in Unit C, grown by both.

7. **Registry wiring (new).** Does the skill framework import `nodeRegistry` + `edgeRegistry` from `@atlas/spec-graph-schema` directly (tight coupling, single source) or re-declare a skill-local projection (looser, decoupled evolution)? Recommendation: direct import; the registry is already a public export and that's what it's for.

8. **Cross-field refinement in skill I/O schemas (new).** B.1 learning: Zod v3 `discriminatedUnion` rejects `ZodEffects`, so `z.discriminatedUnion([...]).refine(...)` fails at parse time. Skill input/output schemas often need cross-field rules. Pattern to document in C.1: split the discriminator, apply `.superRefine` at the outer level, or use `z.union` + runtime discriminator check (B.1 used the split-then-refine pattern for `AuthBoundarySchema`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md
git commit -m "docs(plans): lock Unit C OQ1+OQ5 and add OQ7+OQ8 from B.1 learnings"
```

---

### Task 17: Refresh Unit D section in the directional doc

**Files:**
- Modify: `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md`

Apply the refresh specified in the spec's §11.2.

- [ ] **Step 1: Locate Unit D's open-questions block**

In the same file, find the section `## Unit D — Conductor + Orchestration Roles`, then its subsection `**Open questions:**`.

- [ ] **Step 2: Replace the open-questions block**

Replace the existing `**Open questions:**` section (5 numbered items) with:

```markdown
**Resolved (post-B.1):**

1. **Agent-Teams abstraction vs internal lib → internal lib.** Rationale: Claude Code's Agent Teams primitives are a developer-ergonomics convenience, not a runtime contract. Keeping the Conductor free of that import surface avoids runtime lock-in when Atlas ships as Helm chart (Phase D-5).

5. **Browser Verification (L3 gate) role → confirmed deferred to Phase B-8.** Rationale: B.1 shipped on time without it; L3 is advisory per PRD §11.4 for Phase A, merge-gating in Phase B. No change to D.1 scope; v1 = 4 roles.

**Open questions (for D.1 plan-authoring time):**

2. **Prompt-cache prefix shape.** Developer role is the biggest LLM consumer. Cache hit rate target is >80% (NFR-13). Three-tier structure: (a) skill system prompt (stable), (b) graph context slice (slow-changing, keyed by graph version), (c) user turn. Plan D.1 must spell out: how is slice (b) generated from `@atlas/spec-graph-data`? Deterministic ordering of nodes + edges? Content-hash of the slice as cache key?
3. **Role recovery on failure.** If a role crashes mid-execution, does Conductor retry? Resume from last checkpoint? Discard work? Recommendation: checkpoint after every emitted event; retry with exponential backoff up to 3 attempts; on third failure, escalate to user per edit-class policy (PRD §9.5). Apply B.1's opt-in pattern — retry policy is conductor-injected per dispatch, not hard-coded in the role.
4. **Parallel Developer runs.** Sonnet + Gemini Flash in parallel requires a voting or merge strategy. Who judges which output wins? Recommendation: a lightweight Reviewer role (Sonnet) votes. Flag for refinement in D.3.

6. **Retry / circuit-breaker location (new).** Library-level (every LLM call wrapped) or conductor-level (retries per role invocation)? Recommendation: library-level default with per-role override, matching the `@atlas/spec-graph-data` observability pattern.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md
git commit -m "docs(plans): lock Unit D OQ1+OQ5 and add OQ6 from B.1 learnings"
```

---

## Completion Checklist

After all 17 tasks:

- [ ] `pnpm -F @atlas/spec-graph-schema build` — exits 0; `dist/schema/spec-graph.v1.schema.json` and `dist/schema/invariant-codes.json` both exist
- [ ] `pnpm -F @atlas/spec-graph-schema test` — all B.1 tests still green + 3 new invariant-codes tests pass
- [ ] `pnpm py:gen` — exits 0; synced artifacts present; `models.py` regenerated
- [ ] `pnpm py:check` — exits 0 on clean tree; non-zero after any hand-edit to `models.py`
- [ ] `pnpm py:test` — all 5 pytest files green (`test_invariant_codes`, `test_validate_structural`, `test_generated_banner`, `test_models_roundtrip`, `test_drift_check`)
- [ ] `pnpm -r test` — every workspace TS package still green (no regressions)
- [ ] `packages/spec-graph-schema-py/src/spec_graph_schema/models.py` line 1 equals the exact banner string
- [ ] The 17 invariant codes in `invariants.py` equal the TS-emitted `invariant-codes.json` (enforced by `test_invariant_codes.py`)
- [ ] The §5.5 `valid-forgot-password.json` fixture round-trips through `SpecGraph.model_validate() → .model_dump()` with key-sorted JSON equality
- [ ] Python README documents install, usage, generator policy, drift-check
- [ ] Unit C and Unit D sections in `2026-04-18-phase-a-units-b-through-g.md` show the locked OQs and the new OQs
- [ ] The plans README index lists B.2 as "Ready to execute"
- [ ] B.1's handoff section points to the concrete B.2 plan filename

## Handoff to Unit C (Plan C.1) and Unit D (Plan D.1)

With B.2 shipped, the Python surface is available for `cloud_migration` fusion (Phase B-2) and any other non-TS consumer. The `InvariantCode` enum is the stable cross-language error vocabulary.

**Plan C.1 authoring prereq:** B.2 must be merged (C.1's skill runtime registry exports will import `nodeRegistry`/`edgeRegistry` from `@atlas/spec-graph-schema` per OQ7; Python bindings aren't on the critical path but prove the "generated, not hand-written" discipline the skill library will adopt).

**Plan D.1 authoring prereq:** B.2 is nice-to-have, not a blocker. D.1's LLM provider abstraction can proceed in parallel once B.1 is merged (which it is). D.1's prompt-cache prefix (OQ2) design work can start immediately.

Neither C.1 nor D.1 modifies this package's TypeScript or Python surface. Any extension is additive — a new node type, a new invariant, a new invariant code — and regenerates the Python bindings as an additive minor version.
