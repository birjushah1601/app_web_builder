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
