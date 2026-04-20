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

// Invoke datamodel-codegen through uv run so the version is locked to uv.lock
const args = [
  "run",
  "datamodel-codegen",
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
  process.stderr.write(`generate-pydantic: datamodel-codegen exited ${codegen.status}\n`);
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
