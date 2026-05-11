import { describe, it, expect } from "vitest";
import { SecurityReportSchema, SecurityIssueSchema, type SecurityReport } from "../src/types.js";

describe("SecurityReport types", () => {
  it("parses a passed report with empty issues", () => {
    const r: SecurityReport = { passed: true, issues: [], skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"] };
    expect(SecurityReportSchema.parse(r)).toEqual(r);
  });

  it("parses a failed report with critical issues", () => {
    const r: SecurityReport = {
      passed: false,
      issues: [
        { severity: "critical", code: "SEC-RLS-001", message: "Model 'user' missing rlsPolicies.select", file: "src/models/user.ts" },
        { severity: "high", code: "SEC-CORS-003", message: "allowedOrigins contains wildcard on credentialed route" }
      ],
      skillsRun: ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]
    };
    expect(SecurityReportSchema.parse(r)).toEqual(r);
  });

  it("rejects passed=true when any issue is critical", () => {
    expect(() => SecurityReportSchema.parse({
      passed: true,
      issues: [{ severity: "critical", code: "SEC-X-001", message: "x" }],
      skillsRun: []
    })).toThrow(/critical/);
  });

  it("accepts passed=true with high/medium/low issues only", () => {
    const r: SecurityReport = {
      passed: true,
      issues: [{ severity: "high", code: "SEC-CVE-010", message: "unpatched dep (no fix yet)" }],
      skillsRun: ["cve-check"]
    };
    expect(SecurityReportSchema.parse(r)).toEqual(r);
  });

  it("SecurityIssue severity is constrained to 4 values", () => {
    for (const sev of ["critical", "high", "medium", "low"]) {
      expect(SecurityIssueSchema.parse({ severity: sev, code: "SEC-X-001", message: "x" })).toBeTruthy();
    }
    expect(() => SecurityIssueSchema.parse({ severity: "info", code: "SEC-X-001", message: "x" })).toThrow();
  });
});
