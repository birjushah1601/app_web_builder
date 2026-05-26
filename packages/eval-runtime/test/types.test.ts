import { describe, it, expect } from "vitest";
import {
  StructuralResultSchema,
  JudgeResultSchema,
  EvalFeedbackSchema,
  VerdictSchema,
  EvalCaseSchema
} from "../src/types.js";

describe("StructuralResultSchema", () => {
  it("accepts passed=true", () => {
    expect(StructuralResultSchema.safeParse({ passed: true }).success).toBe(true);
  });
  it("accepts passed=false with failures", () => {
    const ok = StructuralResultSchema.safeParse({
      passed: false,
      failures: [{ check: "x", reason: "y" }]
    });
    expect(ok.success).toBe(true);
  });
  it("rejects passed=false with empty failures", () => {
    const bad = StructuralResultSchema.safeParse({ passed: false, failures: [] });
    expect(bad.success).toBe(false);
  });
});

describe("JudgeResultSchema", () => {
  it("accepts a complete judge result", () => {
    const ok = JudgeResultSchema.safeParse({
      passed: false,
      score: 4.5,
      dimensions: [{ name: "intent", score: 3, rationale: "x" }],
      fixableBy: "retry",
      feedback: "Address the missing intent."
    });
    expect(ok.success).toBe(true);
  });
  it("rejects fixableBy outside the union", () => {
    const bad = JudgeResultSchema.safeParse({
      passed: false,
      score: 4,
      dimensions: [{ name: "x", score: 0, rationale: "" }],
      fixableBy: "whatever",
      feedback: "x"
    });
    expect(bad.success).toBe(false);
  });
  it("rejects score outside 0-10", () => {
    const bad = JudgeResultSchema.safeParse({
      passed: true, score: 11, dimensions: [], fixableBy: "retry", feedback: ""
    });
    expect(bad.success).toBe(false);
  });
});

describe("EvalCaseSchema", () => {
  it("accepts a complete case", () => {
    const ok = EvalCaseSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000001",
      roleId: "architect",
      rubricVersion: "architect@1.0.0",
      inputs: { userTurn: "Build a SaaS" },
      output: { scope: "new-app" },
      expected: { passed: true }
    });
    expect(ok.success).toBe(true);
  });
});
