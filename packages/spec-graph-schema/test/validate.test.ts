import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate, ALL_INVARIANTS } from "../src/validate.js";

const minimalValid = {
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {
    "compliance:baseline": {
      kind: "compliance", id: "compliance:baseline",
      name: "baseline", scope: "global", attestation: "self-attested",
      effectiveDate: "2026-04-19"
    }
  },
  edges: []
};

describe("validate()", () => {
  it("ALL_INVARIANTS contains 16 entries (v1.1)", () => {
    expect(ALL_INVARIANTS).toHaveLength(16);
  });

  it("clean minimal graph passes", () => {
    const result = validate(minimalValid);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags structural error for missing baseline ComplianceClass", () => {
    const bad = { ...minimalValid, nodes: {} };
    const result = validate(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "I08_BASELINE_COMPLIANCE_MISSING")).toBe(true);
  });

  it("returns Zod issues when structural parse fails", () => {
    const bad = { ...minimalValid, schemaVersion: "0.9.0" };
    const result = validate(bad);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toMatch(/^STRUCTURAL_/);
  });
});

const here = dirname(fileURLToPath(import.meta.url));

describe("validate() on §5.5 forgot-password example", () => {
  it("accepts the realistic forgot-password graph", () => {
    const fx = JSON.parse(readFileSync(join(here, "fixtures", "valid-forgot-password.json"), "utf8"));
    const result = validate(fx);
    if (!result.ok) console.error(JSON.stringify(result.issues, null, 2));
    expect(result.ok).toBe(true);
  });
});
