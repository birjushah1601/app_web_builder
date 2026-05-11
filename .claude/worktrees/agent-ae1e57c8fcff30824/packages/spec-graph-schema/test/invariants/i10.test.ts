import { describe, expect, it } from "vitest";
import { i10AiFeaturePersonalizedNeedsCompliance } from "../../src/invariants/i10-aifeature-personalized-needs-compliance.js";
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

const aiFeature = (overrides: Record<string, unknown> = {}) => ({
  kind: "aifeature",
  id: "aifeature:rec",
  name: "Recommender",
  category: "search",
  capabilityContract: {},
  inputModality: "text",
  outputModality: "text",
  grounding: "none",
  personalization: "account",
  privacyMode: "no-retain",
  safetyContract: { promptInjectionGuard: true, hallucinationGuard: false },
  fallbackBehavior: "show-error",
  costTier: "standard",
  ...overrides
});

describe("i10: personalized AIFeature needs ComplianceClass", () => {
  it("ok when personalization=none", () => {
    const g = baseGraph({
      nodes: {
        "aifeature:rec": aiFeature({ personalization: "none" })
      } as never
    });
    expect(i10AiFeaturePersonalizedNeedsCompliance(g)).toEqual([]);
  });

  it("ok when personalized AIFeature has subjectTo edge to compliance", () => {
    const g = baseGraph({
      nodes: {
        "aifeature:rec": aiFeature({ personalization: "account" }),
        "compliance:baseline": {
          kind: "compliance",
          id: "compliance:baseline",
          name: "baseline",
          scope: "global",
          attestation: "self-attested",
          effectiveDate: "2026-04-18"
        }
      } as never,
      edges: [{ type: "subjectTo", from: "aifeature:rec", to: "compliance:baseline" }] as never
    });
    expect(i10AiFeaturePersonalizedNeedsCompliance(g)).toEqual([]);
  });

  it("flags personalized AIFeature missing compliance edge", () => {
    const g = baseGraph({
      nodes: {
        "aifeature:rec": aiFeature({ personalization: "session" })
      } as never
    });
    const issues = i10AiFeaturePersonalizedNeedsCompliance(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE");
    expect(issues[0]?.nodeId).toBe("aifeature:rec");
  });
});
