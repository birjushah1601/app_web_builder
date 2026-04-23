#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveDatamodelCodegen } from "./_python-bin.mjs";

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

const { command, prefixArgs } = resolveDatamodelCodegen(pyPackage);
const args = [
  ...prefixArgs,
  "--input", schemaFile,
  "--input-file-type", "jsonschema",
  "--output", outFile,
  "--target-python-version", "3.11",
  "--output-model-type", "pydantic_v2.BaseModel",
  "--use-schema-description",
  "--use-title-as-name",
  "--use-standard-collections",
  "--use-union-operator",
  "--disable-timestamp",
  "--use-field-description",
  "--capitalise-enum-members",
  "--snake-case-field"
];

const codegen = spawnSync(command, args, { cwd: pyPackage, stdio: "inherit" });
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

// Post-process codegen output to resolve Model/ComplianceClass name collisions.
// datamodel-codegen generates a top-level RootModel wrapper `Model(RootModel[SpecGraph])`
// and another RootModel `ComplianceClass(RootModel[constr(...)])` for the root-level
// complianceClasses: string[] field. These shadow our node classes (Model, ComplianceClass)
// per spec §7. Rename the wrappers out of the way, then reclaim the names for the
// semantic node classes (Model1 → Model, ComplianceClass1 → ComplianceClass).
function resolveCollisions(source) {
  let result = source;
  // Step 1: rename the complianceClasses string-wrapper RootModel class
  result = result.replaceAll(/\bclass ComplianceClass\(RootModel/g, "class ComplianceClassName(RootModel");
  // Step 2: rename the SpecGraph RootModel wrapper
  result = result.replaceAll(/\bclass Model\(RootModel\[SpecGraph\]\)/g, "class SpecGraphRoot(RootModel[SpecGraph])");
  // Step 3: reclaim the Model name for the node class
  result = result.replaceAll(/\bModel1\b/g, "Model");
  // Step 4: reclaim the ComplianceClass name for the node class
  result = result.replaceAll(/\bComplianceClass1\b/g, "ComplianceClass");
  // Step 5: fix SpecGraph.compliance_classes field — it was pointing at the string-wrapper
  //         RootModel (now ComplianceClassName) but codegen emits it as list[ComplianceClass].
  //         After step 4 that now points at the node model, which is wrong. Restore to the
  //         correct string-wrapper reference.
  result = result.replaceAll(
    /\bcompliance_classes: list\[ComplianceClass\]/g,
    "compliance_classes: list[ComplianceClassName]"
  );
  return result;
}
const processed = resolveCollisions(generated);

writeFileSync(outFile, BANNER + processed, "utf8");
process.stdout.write(`wrote ${outFile}\n`);
