import { describe, expect, it } from "vitest";
import { i12PiiClientStateNeedsCompliance } from "../../src/invariants/i12-pii-clientstate-needs-compliance.js";
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

const clientState = (overrides: Record<string, unknown> = {}) => ({
  kind: "clientstate",
  id: "clientstate:profile",
  name: "UserProfile",
  stateKind: "zustand-store",
  persistence: "localStorage",
  scope: "app",
  piiClassification: "direct",
  ...overrides
});

describe("i12: PII ClientState needs ComplianceClass", () => {
  it("ok when clientstate has piiClassification=none", () => {
    const g = baseGraph({
      nodes: {
        "clientstate:profile": clientState({ piiClassification: "none" })
      } as never
    });
    expect(i12PiiClientStateNeedsCompliance(g)).toEqual([]);
  });

  it("ok when PII clientstate has subjectTo edge to compliance", () => {
    const g = baseGraph({
      nodes: {
        "clientstate:profile": clientState({ piiClassification: "direct" }),
        "compliance:baseline": {
          kind: "compliance",
          id: "compliance:baseline",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        }
      } as never,
      edges: [{ type: "subjectTo", from: "clientstate:profile", to: "compliance:baseline" }] as never
    });
    expect(i12PiiClientStateNeedsCompliance(g)).toEqual([]);
  });

  it("flags PII clientstate missing compliance edge", () => {
    const g = baseGraph({
      nodes: {
        "clientstate:profile": clientState({ piiClassification: "indirect" })
      } as never
    });
    const issues = i12PiiClientStateNeedsCompliance(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I12_PII_CLIENTSTATE_MISSING_COMPLIANCE");
    expect(issues[0]?.nodeId).toBe("clientstate:profile");
  });
});
