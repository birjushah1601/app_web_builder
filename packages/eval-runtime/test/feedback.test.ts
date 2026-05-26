// test/feedback.test.ts
import { describe, it, expect } from "vitest";
import { formatStructuralFeedback, formatJudgeFeedback, shouldRetry } from "../src/feedback.js";

describe("formatStructuralFeedback", () => {
  it("renders failures as a bullet list", () => {
    const fb = formatStructuralFeedback({
      passed: false,
      failures: [
        { check: "plan_has_tasks", reason: "tasks empty" },
        { check: "scope_present", reason: "missing scope" }
      ]
    });
    expect(fb.source).toBe("structural");
    expect(fb.promptFragment).toContain("plan_has_tasks");
    expect(fb.promptFragment).toContain("scope_present");
    expect(fb.failures?.length).toBe(2);
  });
});

describe("formatJudgeFeedback", () => {
  it("includes failed dimensions only", () => {
    const fb = formatJudgeFeedback({
      passed: false,
      score: 5,
      dimensions: [
        { name: "intent", score: 3, rationale: "missed billing" },
        { name: "feasibility", score: 8, rationale: "ok" }
      ],
      fixableBy: "retry",
      feedback: "Address billing"
    }, { passThreshold: 6 });
    expect(fb.promptFragment).toContain("intent");
    expect(fb.promptFragment).toContain("missed billing");
    expect(fb.promptFragment).not.toContain("feasibility");
  });
});

describe("shouldRetry", () => {
  it("structural failed + qualityAttempt=1 → retry", () => {
    expect(shouldRetry(
      { passed: false, failures: [{ check: "x", reason: "y" }] },
      null,
      1
    )).toBe(true);
  });
  it("judge failed with fixableBy=escalate → no retry", () => {
    expect(shouldRetry(
      { passed: true },
      { passed: false, score: 3, dimensions: [], fixableBy: "escalate", feedback: "" },
      1
    )).toBe(false);
  });
  it("everything passed → no retry", () => {
    expect(shouldRetry(
      { passed: true },
      { passed: true, score: 9, dimensions: [], fixableBy: "retry", feedback: "" },
      1
    )).toBe(false);
  });
  it("qualityAttempt=2 → no retry regardless", () => {
    expect(shouldRetry(
      { passed: false, failures: [{ check: "x", reason: "y" }] },
      null,
      2
    )).toBe(false);
  });
});
