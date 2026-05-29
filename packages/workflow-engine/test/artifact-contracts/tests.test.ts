import { describe, it, expect } from "vitest";
import { TestsArtifactSchema } from "../../src/artifact-contracts/tests.js";
import { ArtifactContractRegistry } from "../../src/artifact-contracts/registry.js";
import "../../src/artifact-contracts/tests.js";

describe("TestsArtifactSchema", () => {
  const valid = {
    schemaVersion: "1" as const,
    kind: "tests" as const,
    framework: "vitest" as const,
    specs: [
      { file: "__tests__/Home.test.tsx", targets: ["frontend"], passed: 5, failed: 0, skipped: 0, durationMs: 1200 }
    ]
  };
  it("accepts a minimal valid artifact", () => {
    expect(TestsArtifactSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects an unknown framework literal", () => {
    expect(TestsArtifactSchema.safeParse({ ...valid, framework: "mocha" }).success).toBe(false);
  });
  it("rejects negative pass/fail counts", () => {
    const bad = { ...valid, specs: [{ ...valid.specs[0], passed: -1 }] };
    expect(TestsArtifactSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts optional coverage", () => {
    expect(TestsArtifactSchema.safeParse({ ...valid, coverage: { lines: 87.5, branches: 70 } }).success).toBe(true);
  });
  it("accepts optional lastError on a spec", () => {
    const withErr = { ...valid, specs: [{ ...valid.specs[0], failed: 1, lastError: "boom" }] };
    expect(TestsArtifactSchema.safeParse(withErr).success).toBe(true);
  });
  it("is registered under 'tests' kind in ArtifactContractRegistry", () => {
    expect(ArtifactContractRegistry.has("tests")).toBe(true);
  });
});
