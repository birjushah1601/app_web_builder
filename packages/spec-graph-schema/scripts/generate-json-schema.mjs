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
const codeRegex = /"(I\d{2}_[A-Z0-9_]+)"/g;
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
