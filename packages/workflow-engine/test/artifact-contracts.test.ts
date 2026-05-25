import { describe, it, expect } from "vitest";
import { GenericArtifactSchema, parseWorkflowArtifact, ArtifactContractRegistry } from "../src/artifact-contracts/index.js";

describe("GenericArtifactSchema", () => {
  it("accepts well-formed generic artifact", () => {
    const ok = GenericArtifactSchema.safeParse({ schemaVersion: "1", kind: "unknown-kind", payload: { x: 1 } });
    expect(ok.success).toBe(true);
  });
  it("rejects when schemaVersion is missing", () => {
    const bad = GenericArtifactSchema.safeParse({ kind: "x", payload: {} });
    expect(bad.success).toBe(false);
  });
});

describe("parseWorkflowArtifact", () => {
  it("validates against a registered schema", () => {
    ArtifactContractRegistry.register("test-kind", GenericArtifactSchema);
    const parsed = parseWorkflowArtifact(
      { schemaVersion: "1", kind: "test-kind", payload: { ok: true } },
      "test-kind"
    );
    expect(parsed).toBeTruthy();
  });
  it("falls back to generic for unknown kinds", () => {
    const parsed = parseWorkflowArtifact(
      { schemaVersion: "1", kind: "brand-new-kind", payload: {} },
      "brand-new-kind"
    );
    expect((parsed as any).kind).toBe("brand-new-kind");
  });
  it("throws on schema version mismatch", () => {
    ArtifactContractRegistry.register("v1-kind", GenericArtifactSchema);
    expect(() =>
      parseWorkflowArtifact({ schemaVersion: "99", kind: "v1-kind", payload: {} }, "v1-kind")
    ).toThrow(/schema version/i);
  });
});
