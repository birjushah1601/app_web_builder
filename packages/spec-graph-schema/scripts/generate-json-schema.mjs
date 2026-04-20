import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SpecGraphSchema } from "../dist/graph.js";

const NODE_TITLES = {
  "page": "Page",
  "route": "Route",
  "component": "Component",
  "client-state": "ClientState",
  "clientstate": "ClientState",
  "model": "Model",
  "endpoint": "Endpoint",
  "flow": "Flow",
  "auth-boundary": "AuthBoundary",
  "authboundary": "AuthBoundary",
  "test": "Test",
  "design-token": "DesignToken",
  "designtoken": "DesignToken",
  "dependency": "Dependency",
  "compliance": "ComplianceClass",  // kind is "compliance" but class name is ComplianceClass per spec §7
  "ai-feature": "AIFeature",
  "aifeature": "AIFeature",
  "media-asset": "MediaAsset",
  "mediaasset": "MediaAsset",
};
const EDGE_TITLES = {
  "renders": "RendersEdge",
  "fetches": "FetchesEdge",
  "reads": "ReadsEdge",
  "mutates": "MutatesEdge",
  "requires": "RequiresEdge",
  "covers": "CoversEdge",
  "depends-on": "DependsOnEdge",
  "dependsOn": "DependsOnEdge",
  "dependson": "DependsOnEdge",
  "styled-by": "StyledByEdge",
  "styledBy": "StyledByEdge",
  "styledby": "StyledByEdge",
  "subject-to": "SubjectToEdge",
  "subjectTo": "SubjectToEdge",
  "subjectto": "SubjectToEdge",
  "supersedes": "SupersedesEdge",
  "powers": "PowersEdge",
  "displays": "DisplaysEdge",
  "manages": "ManagesEdge",
};

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

// zod-to-json-schema emits Draft4-style `exclusive{Minimum,Maximum}: true` paired
// with `{minimum,maximum}: N` even when targeting Draft 2020-12. In 2020-12,
// `exclusive{Minimum,Maximum}` must be the numeric bound itself, not a boolean
// flag. Walk the schema and rewrite both variants.
function fixDraft4ExclusiveBounds(node) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(fixDraft4ExclusiveBounds); return; }
  if (node.exclusiveMinimum === true && typeof node.minimum === "number") {
    node.exclusiveMinimum = node.minimum;
    delete node.minimum;
  }
  if (node.exclusiveMaximum === true && typeof node.maximum === "number") {
    node.exclusiveMaximum = node.maximum;
    delete node.maximum;
  }
  for (const v of Object.values(node)) fixDraft4ExclusiveBounds(v);
}
fixDraft4ExclusiveBounds(jsonSchema);

// datamodel-codegen names classes from `title` when --use-title-as-name is set.
// Inject titles on each anyOf union member so node/edge classes get semantic
// names (Page, RendersEdge, etc.) instead of anonymous Nodes1..Edges12.
function injectUnionTitles(schema) {
  const specGraph = schema.definitions?.SpecGraph;
  if (!specGraph) return;

  const nodeUnion = specGraph.properties?.nodes?.additionalProperties?.anyOf;
  if (Array.isArray(nodeUnion)) {
    for (const member of nodeUnion) {
      const kindConst = member?.properties?.kind?.const;
      if (typeof kindConst === "string" && NODE_TITLES[kindConst]) {
        member.title = NODE_TITLES[kindConst];
      } else if (typeof kindConst === "string") {
        throw new Error(`injectUnionTitles: unknown node kind "${kindConst}" — add to NODE_TITLES`);
      }
    }
  }

  const edgeUnion = specGraph.properties?.edges?.items?.anyOf;
  if (Array.isArray(edgeUnion)) {
    for (const member of edgeUnion) {
      const typeConst = member?.properties?.type?.const;
      if (typeof typeConst === "string" && EDGE_TITLES[typeConst]) {
        member.title = EDGE_TITLES[typeConst];
      } else if (typeof typeConst === "string") {
        throw new Error(`injectUnionTitles: unknown edge type "${typeConst}" — add to EDGE_TITLES`);
      }
    }
  }
}
injectUnionTitles(jsonSchema);

writeFileSync(schemaFile, JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${schemaFile}\n`);

// 2. Invariant-codes artifact — grep all `code: "I..."` literals from source
const invariantsDir = join(__dirname, "..", "src", "invariants");
const codeRegex = /(?:code\s*:|[?:])\s*"(I\d{2}_[A-Z0-9_]+)"/g;
const codes = new Set();
for (const file of readdirSync(invariantsDir)) {
  if (!file.match(/^i\d{2}-.*\.ts$/)) continue;
  let source = readFileSync(join(invariantsDir, file), "utf8");
  // Strip block comments (/* ... */) before scanning
  source = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip single-line comments (// ...) before scanning
  source = source.replace(/\/\/[^\n]*/g, "");
  for (const match of source.matchAll(codeRegex)) {
    codes.add(match[1]);
  }
}
const sorted = [...codes].sort();
const codesFile = join(outDir, "invariant-codes.json");
writeFileSync(codesFile, JSON.stringify(sorted, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${codesFile} (${sorted.length} codes)\n`);
