import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AccessibilityIssueSchema = z.object({
  severity: SeveritySchema,
  code: z.string().regex(/^A11Y-[A-Z]+-\d{3}$/),
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
