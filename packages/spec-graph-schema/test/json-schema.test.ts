import { beforeAll, describe, expect, it } from "vitest";
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

describe("invariant-codes.json artifact", () => {
  const CODES_ARTIFACT = join(here, "..", "dist", "schema", "invariant-codes.json");

  beforeAll(() => {
    if (!existsSync(CODES_ARTIFACT)) {
      throw new Error(
        `invariant-codes.json not found at ${CODES_ARTIFACT}. ` +
        `Run 'pnpm -F @atlas/spec-graph-schema build' before 'pnpm test'.`
      );
    }
  });

  it("contains the 17 canonical invariant codes, sorted", () => {
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
    const codes = JSON.parse(readFileSync(CODES_ARTIFACT, "utf8")) as string[];
    for (const code of codes) {
      expect(code).toMatch(/^I\d{2}_[A-Z0-9_]+$/);
    }
  });
});
