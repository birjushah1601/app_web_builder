import { describe, it, expect } from "vitest";
import { enforcePersonaGate, type RiskAccepted } from "../src/risk-accept.js";
import { PersonaGateError } from "../src/errors.js";

const baseEvent = (gate: RiskAccepted["gate"], persona: "ama" | "diego" | "priya"): RiskAccepted => ({
  gate,
  failureSummary: "x",
  acceptedBy: { personaTier: persona, userId: "u", timestamp: "t" },
  rationale: "twenty-or-more characters present",
  scope: "single-commit"
});

describe("enforcePersonaGate", () => {
  it("Ama can risk-accept L6 + L7 advisory gates", () => {
    expect(() => enforcePersonaGate(baseEvent("L6-a11y-advisory", "ama"))).not.toThrow();
    expect(() => enforcePersonaGate(baseEvent("L7-visual-advisory", "ama"))).not.toThrow();
  });

  it("Ama CANNOT risk-accept L4-security or L5-compliance", () => {
    expect(() => enforcePersonaGate(baseEvent("L4-security", "ama"))).toThrow(PersonaGateError);
    expect(() => enforcePersonaGate(baseEvent("L5-compliance", "ama"))).toThrow(PersonaGateError);
  });

  it("Diego can risk-accept any gate", () => {
    for (const g of ["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"] as const) {
      expect(() => enforcePersonaGate(baseEvent(g, "diego"))).not.toThrow();
    }
  });

  it("Priya can risk-accept any gate", () => {
    for (const g of ["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"] as const) {
      expect(() => enforcePersonaGate(baseEvent(g, "priya"))).not.toThrow();
    }
  });

  it("PersonaGateError carries the gate + actual persona", () => {
    try {
      enforcePersonaGate(baseEvent("L4-security", "ama"));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PersonaGateError);
      expect((err as PersonaGateError).gate).toBe("L4-security");
      expect((err as PersonaGateError).actualPersona).toBe("ama");
      expect((err as PersonaGateError).requiredPersona).toBe("diego");
    }
  });
});
