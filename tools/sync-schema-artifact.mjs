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
