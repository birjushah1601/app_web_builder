import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SecurityReportPanel } from "@/components/SecurityReportPanel";

describe("SecurityReportPanel — Plan I Task 5", () => {
  it("renders a green PASSED badge + skill list when report.passed", () => {
    render(<SecurityReportPanel report={{ passed: true, issues: [], skillsRun: ["audit-rls", "secrets-scan"] }} />);
    expect(screen.getByText(/Security PASSED/i)).toBeInTheDocument();
    expect(screen.getByText(/audit-rls/)).toBeInTheDocument();
    expect(screen.getByText(/secrets-scan/)).toBeInTheDocument();
  });

  it("renders a red FAILED badge + each issue with severity", () => {
    render(<SecurityReportPanel report={{
      passed: false,
      issues: [
        { severity: "critical", message: "Secret leaked in foo.ts" },
        { severity: "high",     message: "Missing CORS allowlist" }
      ],
      skillsRun: ["secrets-scan", "cors-policy"]
    }} />);
    expect(screen.getByText(/Security FAILED/i)).toBeInTheDocument();
    expect(screen.getByText(/Secret leaked in foo\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/Missing CORS allowlist/)).toBeInTheDocument();
  });

  it("renders 'no issues' when passed and issues array is empty", () => {
    render(<SecurityReportPanel report={{ passed: true, issues: [], skillsRun: [] }} />);
    expect(screen.getByText(/no issues/i)).toBeInTheDocument();
  });
});
