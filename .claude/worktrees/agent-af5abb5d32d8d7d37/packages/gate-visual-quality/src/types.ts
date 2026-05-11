import { z } from "zod";

export const ViewportSchema = z.enum(["desktop", "tablet", "mobile"]);
export type Viewport = z.infer<typeof ViewportSchema>;

export const IssueSeveritySchema = z.enum(["critical", "major", "minor"]);
export const IssueCategorySchema = z.enum(["contrast", "alignment", "hierarchy", "copy", "design-token-drift"]);

export const IssueSchema = z.object({
  severity: IssueSeveritySchema,
  category: IssueCategorySchema,
  message: z.string().min(1),
  elementSelector: z.string().optional()
});
export type Issue = z.infer<typeof IssueSchema>;

const ScreenshotUrlsSchema = z.object({
  desktop: z.string().min(1),
  tablet: z.string().min(1),
  mobile: z.string().min(1)
});

export const VisualQualityReportSchema = z
  .object({
    passed: z.boolean(),
    score: z.number().int().min(0).max(100),
    issues: z.array(IssueSchema),
    screenshotUrls: ScreenshotUrlsSchema
  })
  .superRefine((r, ctx) => {
    const hasCritical = r.issues.some((i) => i.severity === "critical");
    if (hasCritical && r.passed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passed"],
        message: "report has at least one critical issue but passed=true; critical issues must force passed=false"
      });
    }
  });
export type VisualQualityReport = z.infer<typeof VisualQualityReportSchema>;

/** A snapshot of the DesignTokens the user picked, passed to the critique
 *  prompt so the LLM can flag drift between selection and render. Sourced
 *  from RitualSnapshot.selectedTokens (added in S.4). Loose typing here
 *  to avoid a hard-coupling to @atlas/role-designer's exact shape. */
export interface DesignTokensSnapshot {
  palette?: Record<string, string>;
  typeScale?: { sansFamily?: string; serifFamily?: string; monoFamily?: string };
  density?: string;
  componentSet?: string;
  imageryStrategy?: string;
  copyVoice?: string;
}
