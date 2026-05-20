import { describe, expect, it } from "vitest";
import { i08BaselineCompliancePresent } from "../../src/invariants/i08-baseline-compliance-present.js";
import type { SpecGraph } from "../../src/graph.js";

const baseGraph = (extras: Partial<SpecGraph> = {}): SpecGraph => ({
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: [],
  ...extras
});

describe("i08: exactly one ComplianceClass with name=baseline must be present", () => {
  it("ok when exactly one baseline ComplianceClass", () => {
    const g = baseGraph({
      nodes: {
        "compliance:baseline": {
          kind: "compliance",
          id: "compliance:baseline",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        }
      } as never
    });
    expect(i08BaselineCompliancePresent(g)).toEqual([]);
  });

  it("flags missing baseline", () => {
    const g = baseGraph();
    const issues = i08BaselineCompliancePresent(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I08_BASELINE_COMPLIANCE_MISSING");
  });

  it("flags duplicate baseline", () => {
    const g = baseGraph({
      nodes: {
        "compliance:baseline-1": {
          kind: "compliance",
          id: "compliance:baseline-1",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        },
        "compliance:baseline-2": {
          kind: "compliance",
          id: "compliance:baseline-2",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        }
      } as never
    });
    const issues = i08BaselineCompliancePresent(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I08_BASELINE_COMPLIANCE_DUPLICATED");
  });
});
