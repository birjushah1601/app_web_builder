import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccessibilityReportPanel } from "@/components/AccessibilityReportPanel";

describe("AccessibilityReportPanel — Plan I Task 6", () => {
  it("renders a green PASSED badge + skill list when report.passed", () => {
    render(<AccessibilityReportPanel report={{ passed: true, issues: [], skillsRun: ["wcag-audit", "contrast-check"] }} />);
    expect(screen.getByText(/Accessibility PASSED/i)).toBeInTheDocument();
    expect(screen.getByText(/wcag-audit/)).toBeInTheDocument();
    expect(screen.getByText(/contrast-check/)).toBeInTheDocument();
  });

  it("renders a red FAILED badge + each issue with severity", () => {
    render(<AccessibilityReportPanel report={{
      passed: false,
      issues: [
        { severity: "high",   message: "Image missing alt text" },
        { severity: "medium", message: "Insufficient color contrast" }
      ],
      skillsRun: ["wcag-audit"]
    }} />);
    expect(screen.getByText(/Accessibility FAILED/i)).toBeInTheDocument();
    expect(screen.getByText(/Image missing alt text/)).toBeInTheDocument();
    expect(screen.getByText(/Insufficient color contrast/)).toBeInTheDocument();
  });

  it("renders 'no issues' when passed and issues array is empty", () => {
    render(<AccessibilityReportPanel report={{ passed: true, issues: [], skillsRun: [] }} />);
    expect(screen.getByText(/no issues/i)).toBeInTheDocument();
  });
});
