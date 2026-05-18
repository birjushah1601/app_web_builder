import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const BrowserIssueSchema = z.object({
  severity: SeveritySchema,
  code: z.string().regex(/^BROWSER-[A-Z]+-\d{3}$/),
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional()
});
export type BrowserIssue = z.infer<typeof BrowserIssueSchema>;

export const BrowserVerificationReportSchema = z
  .object({
    passed: z.boolean(),
    issues: z.array(BrowserIssueSchema),
    skillsRun: z.array(z.string())
  })
  .superRefine((report, ctx) => {
    const hasCritical = report.issues.some((i) => i.severity === "critical");
    if (report.passed && hasCritical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "passed cannot be true when any issue is critical",
        path: ["passed"]
      });
    }
  });
export type BrowserVerificationReport = z.infer<typeof BrowserVerificationReportSchema>;

export interface BrowserVerificationInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  /** The proposed diff the role is validating. Serialized unified diff. */
  diff: string;
}
