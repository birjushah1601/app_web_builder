import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SpecGraphSchema } from "../dist/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist", "schema");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "spec-graph.v1.schema.json");

const jsonSchema = zodToJsonSchema(SpecGraphSchema, {
  name: "SpecGraph",
  $refStrategy: "root",
  target: "jsonSchema2020-12"
});

// zod-to-json-schema@3.23.5 does not emit $schema for the 2020-12 target.
// Inject it so downstream consumers see the dialect they asked for.
if (!jsonSchema.$schema) {
  jsonSchema.$schema = "https://json-schema.org/draft/2020-12/schema";
}

writeFileSync(outFile, JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${outFile}\n`);
