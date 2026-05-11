import { describe, it, expect } from "vitest";
import { GateSchema, enforcePersonaGate, type RiskAccepted } from "../src/index.js";

const baseEvent = (persona: "ama" | "diego" | "priya"): RiskAccepted => ({
  gate: "L7-visual-advisory",
  failureSummary: "user accepted minor visual issues",
  acceptedBy: { personaTier: persona, userId: "u", timestamp: "2026-05-02T00:00:00Z" },
  rationale: "twenty-or-more characters present for rationale",
  scope: "single-commit"
});

describe("L7-visual-advisory risk-accept tier", () => {
  it("is registered in GateSchema", () => {
    expect(GateSchema.safeParse("L7-visual-advisory").success).toBe(true);
  });

  it("ama can risk-accept L7", () => {
    expect(() => enforcePersonaGate(baseEvent("ama"))).not.toThrow();
  });

  it("diego can risk-accept L7", () => {
    expect(() => enforcePersonaGate(baseEvent("diego"))).not.toThrow();
  });

  it("priya can risk-accept L7", () => {
    expect(() => enforcePersonaGate(baseEvent("priya"))).not.toThrow();
  });
});
