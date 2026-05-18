import { describe, it, expect } from "vitest";
import { RitualStateSchema, applyTransition, isTerminal, type RitualState, type RitualTransition } from "../src/state.js";
import { InvalidTransitionError } from "../src/errors.js";

describe("RitualState transitions", () => {
  it("RitualStateSchema accepts the 6 canonical states", () => {
    for (const s of ["visualize", "agree", "build", "done", "escalated", "aborted"] as const) {
      expect(RitualStateSchema.parse(s)).toBe(s);
    }
  });

  it("isTerminal returns true for done/escalated/aborted only", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("escalated")).toBe(true);
    expect(isTerminal("aborted")).toBe(true);
    expect(isTerminal("visualize")).toBe(false);
    expect(isTerminal("agree")).toBe(false);
    expect(isTerminal("build")).toBe(false);
  });

  it("visualize → agree on artifact_emitted", () => {
    expect(applyTransition("visualize", { kind: "artifact_emitted" })).toBe("agree");
  });

  it("visualize → build on artifact_emitted_cosmetic (fast path)", () => {
    expect(applyTransition("visualize", { kind: "artifact_emitted_cosmetic" })).toBe("build");
  });

  it("agree → build on approved", () => {
    expect(applyTransition("agree", { kind: "approved" })).toBe("build");
  });

  it("agree → visualize on changes_requested", () => {
    expect(applyTransition("agree", { kind: "changes_requested" })).toBe("visualize");
  });

  it("build → done on merge_gates_green", () => {
    expect(applyTransition("build", { kind: "merge_gates_green" })).toBe("done");
  });

  it("any → escalated on escalate", () => {
    for (const s of ["visualize", "agree", "build"] as const) {
      expect(applyTransition(s, { kind: "escalate", reason: "x" })).toBe("escalated");
    }
  });

  it("any → aborted on abort", () => {
    for (const s of ["visualize", "agree", "build"] as const) {
      expect(applyTransition(s, { kind: "abort", reason: "x" })).toBe("aborted");
    }
  });

  it("rejects illegal transitions with InvalidTransitionError", () => {
    expect(() => applyTransition("done", { kind: "approved" })).toThrow(InvalidTransitionError);
    expect(() => applyTransition("visualize", { kind: "approved" })).toThrow(InvalidTransitionError);
    expect(() => applyTransition("build", { kind: "changes_requested" })).toThrow(InvalidTransitionError);
  });
});
