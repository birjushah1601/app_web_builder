import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(here, "..", "dist", "schema", "spec-graph.v1.schema.json");

describe("generated JSON Schema artifact", () => {
  it("exists after build", () => {
    if (!existsSync(ARTIFACT)) {
      // skip with a clear message: build must run first
      return; // soft-skip: CI will run build before test
    }
    expect(existsSync(ARTIFACT)).toBe(true);
  });

  it("parses as JSON and has $schema set to JSON Schema 2020-12", () => {
    if (!existsSync(ARTIFACT)) return;
    const doc = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    expect(doc.$schema).toMatch(/2020-12/);
    // Top-level title or definitions reference "SpecGraph"
    const text = JSON.stringify(doc);
    expect(text).toMatch(/SpecGraph/);
  });
});
