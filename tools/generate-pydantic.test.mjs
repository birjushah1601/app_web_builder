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
  // Ensure prereq: sync + first generation
  spawnSync("node", ["tools/sync-schema-artifact.mjs"], { cwd: repoRoot, stdio: "inherit" });
  spawnSync("node", ["tools/generate-pydantic.mjs"], { cwd: repoRoot, stdio: "inherit" });
  const first = readFileSync(modelsFile, "utf8");

  // Generate again and compare
  spawnSync("node", ["tools/generate-pydantic.mjs"], { cwd: repoRoot, stdio: "inherit" });
  const second = readFileSync(modelsFile, "utf8");
  assert.equal(first, second, "output must be identical on repeat runs");
});
