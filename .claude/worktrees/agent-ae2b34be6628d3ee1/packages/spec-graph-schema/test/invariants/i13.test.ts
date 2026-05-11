import { describe, expect, it } from "vitest";
import { i13BaselineTestsForProtectedTargets } from "../../src/invariants/i13-baseline-tests-for-protected-targets.js";
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

describe("i13: AuthBoundary/PII-Model/non-baseline-Compliance need baseline Test", () => {
  it("ok when no protected targets exist", () => {
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
    expect(i13BaselineTestsForProtectedTargets(g)).toEqual([]);
  });

  it("ok when authboundary has baseline-source test covering it", () => {
    const g = baseGraph({
      nodes: {
        "authboundary:admin": {
          kind: "authboundary",
          id: "authboundary:admin",
          name: "AdminOnly",
          type: "role",
          roles: ["admin"],
          permissions: [],
          bypassConditions: []
        },
        "test:AdminBoundaryBaseline": {
          kind: "test",
          id: "test:AdminBoundaryBaseline",
          name: "AdminBoundaryBaseline",
          layer: "L3",
          source: "baseline",
          filepath: "tests/e2e/admin.spec.ts",
          coversRef: ["authboundary:admin"]
        }
      } as never
    });
    expect(i13BaselineTestsForProtectedTargets(g)).toEqual([]);
  });

  it("flags authboundary without baseline test (only generated coverage)", () => {
    const g = baseGraph({
      nodes: {
        "authboundary:admin": {
          kind: "authboundary",
          id: "authboundary:admin",
          name: "AdminOnly",
          type: "role",
          roles: ["admin"],
          permissions: [],
          bypassConditions: []
        },
        "test:AdminBoundaryGenerated": {
          kind: "test",
          id: "test:AdminBoundaryGenerated",
          name: "AdminBoundaryGenerated",
          layer: "L3",
          source: "generated",
          filepath: "tests/e2e/admin.generated.spec.ts",
          coversRef: ["authboundary:admin"]
        }
      } as never
    });
    const issues = i13BaselineTestsForProtectedTargets(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I13_PROTECTED_TARGET_MISSING_BASELINE_TEST");
    expect(issues[0]?.nodeId).toBe("authboundary:admin");
  });

  it("flags PII model without baseline test", () => {
    const g = baseGraph({
      nodes: {
        "model:User": {
          kind: "model",
          id: "model:User",
          name: "User",
          fields: { email: "string" },
          relations: [],
          indexes: [],
          rlsPolicies: {},
          piiClassification: "direct"
        }
      } as never
    });
    const issues = i13BaselineTestsForProtectedTargets(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I13_PROTECTED_TARGET_MISSING_BASELINE_TEST");
    expect(issues[0]?.nodeId).toBe("model:User");
  });
});
