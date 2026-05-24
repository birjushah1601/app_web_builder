import { describe, it, expect } from "vitest";
import {
  AmbiguityReportSchema,
  ArchitectOutputSchema,
  ScopeSchema,
  type ArchitectOutput,
  type AmbiguityReport,
  type Scope
} from "../src/types.js";

describe("types", () => {
  it("ScopeSchema accepts all 7 PRD §8 scopes", () => {
    for (const s of ["new-app", "new-feature", "bug-fix", "dep-upgrade", "refactor", "ship", "migrate"]) {
      expect(ScopeSchema.parse(s)).toBe(s);
    }
  });

  it("AmbiguityReportSchema parses a passed report", () => {
    const report: AmbiguityReport = {
      passed: true,
      scope: "new-feature",
      questions: []
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("AmbiguityReportSchema parses a blocker report", () => {
    const report: AmbiguityReport = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "What compliance class applies?", reason: "PII storage mentioned", severity: "blocker" }
      ]
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("ArchitectOutputSchema discriminates by scope", () => {
    const out: ArchitectOutput = {
      scope: "new-feature",
      diffPlan: { summary: "add forgot-password", tasks: [] },
      graphSlice: { bytes: "{}", hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" }
    };
    expect(ArchitectOutputSchema.parse(out)).toEqual(out);
  });

  it("ArchitectOutputSchema rejects wrong-shape for a scope", () => {
    const bad = { scope: "new-feature", bugReport: { phase1: "..." } };
    expect(() => ArchitectOutputSchema.parse(bad)).toThrow();
  });
});

describe("AmbiguityQuestionSchema — Plan U (full) optional widget hints", () => {
  it("accepts a question WITHOUT widgetKind/options (backward compat)", () => {
    const report: AmbiguityReport = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "What's the user count?", reason: "scaling decision", severity: "blocker" }
      ]
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("accepts widgetKind=yes-no without options", () => {
    const report: AmbiguityReport = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "Include guest checkout?", reason: "auth flow varies", severity: "blocker", widgetKind: "yes-no" }
      ]
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("accepts widgetKind=single-select with 2-6 options", () => {
    const report: AmbiguityReport = {
      passed: false,
      scope: "new-app",
      questions: [
        {
          question: "Which payment provider?",
          reason: "checkout integration",
          severity: "blocker",
          widgetKind: "single-select",
          options: ["Stripe", "Razorpay", "PayPal"]
        }
      ]
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("accepts widgetKind=text without options", () => {
    const report: AmbiguityReport = {
      passed: false,
      scope: "new-feature",
      questions: [
        { question: "Who's the audience?", reason: "design direction", severity: "blocker", widgetKind: "text" }
      ]
    };
    expect(AmbiguityReportSchema.parse(report)).toEqual(report);
  });

  it("rejects widgetKind=single-select WITHOUT options (validation)", () => {
    const bad = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "Which?", reason: "x", severity: "blocker", widgetKind: "single-select" }
      ]
    };
    expect(() => AmbiguityReportSchema.parse(bad)).toThrow();
  });

  it("rejects widgetKind=single-select with only 1 option", () => {
    const bad = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "Which?", reason: "x", severity: "blocker", widgetKind: "single-select", options: ["Only one"] }
      ]
    };
    expect(() => AmbiguityReportSchema.parse(bad)).toThrow();
  });

  it("rejects widgetKind=yes-no WITH options (Yes/No is implicit)", () => {
    const bad = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "?", reason: "x", severity: "blocker", widgetKind: "yes-no", options: ["Yes", "No"] }
      ]
    };
    expect(() => AmbiguityReportSchema.parse(bad)).toThrow();
  });

  it("rejects an unknown widgetKind value", () => {
    const bad = {
      passed: false,
      scope: "new-app",
      questions: [
        { question: "?", reason: "x", severity: "blocker", widgetKind: "slider" }
      ]
    };
    expect(() => AmbiguityReportSchema.parse(bad)).toThrow();
  });
});
