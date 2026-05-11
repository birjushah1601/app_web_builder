import { describe, it, expect } from "vitest";
import {
  VisualQualityReportSchema,
  ViewportSchema,
  IssueSchema,
  type VisualQualityReport
} from "../src/types.js";

describe("ViewportSchema", () => {
  it("accepts the 3 standard viewports", () => {
    expect(ViewportSchema.safeParse("desktop").success).toBe(true);
    expect(ViewportSchema.safeParse("tablet").success).toBe(true);
    expect(ViewportSchema.safeParse("mobile").success).toBe(true);
  });
  it("rejects unknowns", () => {
    expect(ViewportSchema.safeParse("watch").success).toBe(false);
  });
});

describe("IssueSchema", () => {
  it("accepts a valid issue", () => {
    const issue = { severity: "major", category: "contrast", message: "Header text on hero is 3.4:1 — below WCAG AA 4.5:1" };
    expect(IssueSchema.safeParse(issue).success).toBe(true);
  });
  it("rejects unknown severity", () => {
    expect(IssueSchema.safeParse({ severity: "low", category: "contrast", message: "x" }).success).toBe(false);
  });
  it("rejects unknown category", () => {
    expect(IssueSchema.safeParse({ severity: "major", category: "performance", message: "x" }).success).toBe(false);
  });
  it("accepts optional elementSelector", () => {
    const issue = { severity: "minor", category: "alignment", message: "x", elementSelector: "header > h1" };
    expect(IssueSchema.safeParse(issue).success).toBe(true);
  });
});

describe("VisualQualityReportSchema", () => {
  const validReport: VisualQualityReport = {
    passed: true,
    score: 92,
    issues: [{ severity: "minor", category: "alignment", message: "small misalignment" }],
    screenshotUrls: { desktop: "data:image/jpeg;base64,abc", tablet: "data:image/jpeg;base64,abc", mobile: "data:image/jpeg;base64,abc" }
  };

  it("parses a valid passing report", () => {
    expect(VisualQualityReportSchema.safeParse(validReport).success).toBe(true);
  });

  it("forces passed=false when any critical issue is present (superRefine)", () => {
    const withCritical = {
      ...validReport,
      passed: true,
      issues: [{ severity: "critical", category: "design-token-drift", message: "rendered hero uses #f97316; chosen palette accent is #fbbf24" }]
    };
    const parsed = VisualQualityReportSchema.safeParse(withCritical);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.message).toMatch(/critical/i);
  });

  it("accepts passed=false with critical issues", () => {
    const withCritical = {
      ...validReport,
      passed: false,
      issues: [{ severity: "critical", category: "design-token-drift", message: "x" }]
    };
    expect(VisualQualityReportSchema.safeParse(withCritical).success).toBe(true);
  });

  it("clamps score to 0..100 (rejects out-of-range)", () => {
    expect(VisualQualityReportSchema.safeParse({ ...validReport, score: 150 }).success).toBe(false);
    expect(VisualQualityReportSchema.safeParse({ ...validReport, score: -5 }).success).toBe(false);
  });

  it("requires all 3 viewports in screenshotUrls", () => {
    const missing = { ...validReport, screenshotUrls: { desktop: "x", tablet: "x" } };
    expect(VisualQualityReportSchema.safeParse(missing).success).toBe(false);
  });
});
