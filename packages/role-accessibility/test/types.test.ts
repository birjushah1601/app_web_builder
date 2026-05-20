import { describe, it, expect } from "vitest";
import { AccessibilityReportSchema, AccessibilityIssueSchema, type AccessibilityReport } from "../src/types.js";

describe("AccessibilityReport types", () => {
  it("parses a passed report with empty issues", () => {
    const r: AccessibilityReport = { passed: true, issues: [], skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"] };
    expect(AccessibilityReportSchema.parse(r)).toEqual(r);
  });

  it("parses a failed report with critical issues", () => {
    const r: AccessibilityReport = {
      passed: false,
      issues: [
        { severity: "critical", code: "A11Y-WCAG-004", message: "Image missing alt text (WCAG 1.1.1 AA)", file: "src/components/Hero.tsx" },
        { severity: "high", code: "A11Y-CON-003", message: "Contrast ratio below 4.5:1 on body text" }
      ],
      skillsRun: ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"]
    };
    expect(AccessibilityReportSchema.parse(r)).toEqual(r);
  });

  it("rejects passed=true when any issue is critical", () => {
    expect(() => AccessibilityReportSchema.parse({
      passed: true,
      issues: [{ severity: "critical", code: "A11Y-KB-001", message: "focus trap missing" }],
      skillsRun: []
    })).toThrow(/critical/);
  });

  it("accepts passed=true with high/medium/low issues only", () => {
    const r: AccessibilityReport = {
      passed: true,
      issues: [{ severity: "high", code: "A11Y-RTL-010", message: "RTL text direction not explicitly set" }],
      skillsRun: ["rtl-layout"]
    };
    expect(AccessibilityReportSchema.parse(r)).toEqual(r);
  });

  it("AccessibilityIssue severity is constrained to 4 values", () => {
    for (const sev of ["critical", "high", "medium", "low"]) {
      expect(AccessibilityIssueSchema.parse({ severity: sev, code: "A11Y-WCAG-001", message: "x" })).toBeTruthy();
    }
    expect(() => AccessibilityIssueSchema.parse({ severity: "info", code: "A11Y-WCAG-001", message: "x" })).toThrow();
  });

  it("accepts free-form code labels (model picks taxonomy: A11Y, WCAG, descriptive)", () => {
    for (const code of [
      "A11Y-WCAG-001",                  // Atlas house format
      "WCAG-1.4.3",                     // canonical WCAG reference
      "WCAG_1_3_1_SEMANTIC_STRUCTURE",  // underscored variant w/ description
      "CONTRAST_TEXT",                  // free-form descriptive
      "missing-alt"                     // kebab-case freeform
    ]) {
      expect(AccessibilityIssueSchema.parse({ severity: "critical", code, message: "x" })).toMatchObject({ code });
    }
  });

  it("still rejects empty string code", () => {
    expect(() => AccessibilityIssueSchema.parse({ severity: "critical", code: "", message: "x" })).toThrow();
  });
});
