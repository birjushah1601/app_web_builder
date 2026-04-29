"use client";

interface Issue {
  severity: "critical" | "high" | "medium" | "low";
  message: string;
}

export interface AccessibilityReport {
  passed: boolean;
  issues: Issue[];
  skillsRun?: string[];
}

const SEVERITY_BG: Record<Issue["severity"], string> = {
  critical: "bg-red-100 text-red-900",
  high:     "bg-orange-100 text-orange-900",
  medium:   "bg-amber-100 text-amber-900",
  low:      "bg-slate-100 text-slate-900"
};

export function AccessibilityReportPanel({ report }: { report: AccessibilityReport }) {
  return (
    <details className="mt-2 rounded-md border border-slate-200 p-2" data-testid="a11y-report-panel">
      <summary className="flex items-center gap-2 cursor-pointer">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${
            report.passed ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"
          }`}
        >
          Accessibility {report.passed ? "PASSED" : "FAILED"}
        </span>
        {report.skillsRun && report.skillsRun.length > 0 && (
          <span className="text-xs text-slate-500">Ran: {report.skillsRun.join(", ")}</span>
        )}
      </summary>
      <div className="mt-2">
        {report.issues.length === 0 ? (
          <p className="text-sm text-slate-600">No issues</p>
        ) : (
          <ul className="space-y-1">
            {report.issues.map((issue, i) => (
              <li key={i} className={`rounded px-2 py-1 text-sm ${SEVERITY_BG[issue.severity]}`}>
                <strong className="uppercase mr-1">{issue.severity}</strong>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
