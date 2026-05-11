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
  const tsDistSchema = join(repoRoot, "packages", "spec-graph-schema", "dist", "schema", "spec-graph.v1.schema.json");
  if (existsSync(tsDistSchema)) rmSync(tsDistSchema);

  const result = spawnSync("node", ["tools/sync-schema-artifact.mjs"], { cwd: repoRoot });
  const stderr = result.stderr.toString();
  assert.notEqual(result.status, 0, "should exit non-zero when source missing");
  assert.ok(stderr.includes("spec-graph.v1.schema.json") && stderr.includes("not found"), "stderr should name the missing file");

  // Restore TS dist for downstream tests
  spawnSync("pnpm", ["-F", "@atlas/spec-graph-schema", "build"], { cwd: repoRoot, stdio: "inherit", shell: true });
});
