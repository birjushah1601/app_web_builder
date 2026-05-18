import { describe, it, expect } from "vitest";
import {
  BrowserVerificationReportSchema,
  BrowserIssueSchema,
  type BrowserVerificationReport
} from "../src/types.js";

describe("BrowserVerificationReport types", () => {
  it("parses a passed report with empty issues", () => {
    const r: BrowserVerificationReport = {
      passed: true,
      issues: [],
      skillsRun: ["page-load-check", "viewport-render-check", "console-error-check", "network-requests-audit"]
    };
    expect(BrowserVerificationReportSchema.parse(r)).toEqual(r);
  });

  it("rejects passed=true when any issue is critical", () => {
    expect(() =>
      BrowserVerificationReportSchema.parse({
        passed: true,
        issues: [{ severity: "critical", code: "BROWSER-LOAD-001", message: "5xx on load" }],
        skillsRun: []
      })
    ).toThrow(/critical/);
  });

  it("accepts passed=true with high/medium/low issues only", () => {
    const r: BrowserVerificationReport = {
      passed: true,
      issues: [{ severity: "medium", code: "BROWSER-VIEW-002", message: "tap target small" }],
      skillsRun: ["viewport-render-check"]
    };
    expect(BrowserVerificationReportSchema.parse(r)).toEqual(r);
  });

  it("BrowserIssue code must match BROWSER- prefix pattern", () => {
    expect(() =>
      BrowserIssueSchema.parse({ severity: "high", code: "A11Y-001", message: "x" })
    ).toThrow();
    expect(() =>
      BrowserIssueSchema.parse({ severity: "high", code: "BROWSER-LOAD-001", message: "x" })
    ).not.toThrow();
  });
});
