import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AccessibilityIssueSchema = z.object({
  severity: SeveritySchema,
  // Accept both Atlas's house format (A11Y-CAT-NNN) and W3C's canonical
  // WCAG references (WCAG-1.4.3, WCAG_1_4_3, WCAG-1.4.3-CONTRAST). The
  // real LLM emits WCAG-* references naturally; the schema was tightening
  // to A11Y-* without prompt support, which made every model run fail
  // schema validation and escalate the ritual after 3 retries.
  code: z.string().regex(/^(?:A11Y-[A-Z]+-\d{3}|WCAG[-_]\d+(?:[._]\d+)*(?:[-_][A-Za-z0-9_]+)?)$/),
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
