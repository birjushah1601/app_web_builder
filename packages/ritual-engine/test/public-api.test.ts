import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API surface", () => {
  it("exports the canonical names", () => {
    const expected = [
      "RitualEngine",
      "InMemoryEventSink",
      "RitualEventSchema",
      "RitualStateSchema",
      "isTerminal",
      "applyTransition",
      "PersonaTierSchema",
      "isAtLeast",
      "ApprovalDecisionSchema",
      "applyApproval",
      "RiskAcceptedSchema",
      "GateSchema",
      "RiskScopeSchema",
      "enforcePersonaGate",
      "EditClassSchema",
      "PersonaGateError",
      "InvalidTransitionError",
      "RitualEngineError",
      "RitualAbortedError"
    ];
    for (const name of expected) {
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
