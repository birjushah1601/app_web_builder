import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AccessibilityIssueSchema = z.object({
  severity: SeveritySchema,
  // Display-only label for the issue. The schema previously enforced an
  // Atlas-house taxonomy (A11Y-CAT-NNN), which neither the prompt nor the
  // tool input_schema instructed the model to follow — every real model
  // run produced free-form codes (WCAG-1.4.3, CONTRAST_TEXT, etc.) and
  // failed schema validation, escalating the ritual after 3 retries.
  // Nothing downstream dispatches on this value (UI just renders the
  // string), so accept any non-empty label and let the model pick its
  // own taxonomy.
  code: z.string().min(1),
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional()
});
export type AccessibilityIssue = z.infer<typeof AccessibilityIssueSchema>;

export const AccessibilityReportSchema = z.object({
  passed: z.boolean(),
  issues: z.array(AccessibilityIssueSchema),
  skillsRun: z.array(z.string())
}).superRefine((report, ctx) => {
  const hasCritical = report.issues.some((i) => i.severity === "critical");
  if (report.passed && hasCritical) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when any issue is critical",
      path: ["passed"]
    });
  }
});
export type AccessibilityReport = z.infer<typeof AccessibilityReportSchema>;

export interface AccessibilityInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  /** The proposed diff the Accessibility role is validating. Serialized unified diff. */
  diff: string;
}
