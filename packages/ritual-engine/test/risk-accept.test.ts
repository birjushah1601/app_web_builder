import { describe, it, expect } from "vitest";
import { RiskAcceptedSchema, type RiskAccepted } from "../src/risk-accept.js";

describe("RiskAcceptedSchema", () => {
  it("parses a valid L4-security risk-accept", () => {
    const ev: RiskAccepted = {
      gate: "L4-security",
      failureSummary: "CORS policy reverts to wildcard",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "2026-04-20T00:00:00Z" },
      rationale: "Wildcard required for legacy partner integration; sunset by 2026-06-01",
      scope: "session"
    };
    expect(RiskAcceptedSchema.parse(ev)).toEqual(ev);
  });

  it("rejects rationale shorter than 20 chars", () => {
    expect(() => RiskAcceptedSchema.parse({
      gate: "L5-compliance",
      failureSummary: "f",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "t" },
      rationale: "too short",
      scope: "single-commit"
    })).toThrow();
  });

  it("rejects unknown gate", () => {
    expect(() => RiskAcceptedSchema.parse({
      gate: "L9-imaginary",
      failureSummary: "f",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "t" },
      rationale: "valid rationale that is at least twenty chars",
      scope: "session"
    })).toThrow();
  });

  it("rejects unknown scope", () => {
    expect(() => RiskAcceptedSchema.parse({
      gate: "L4-security",
      failureSummary: "f",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "t" },
      rationale: "valid rationale that is at least twenty chars",
      scope: "forever-and-ever"
    })).toThrow();
  });
});
