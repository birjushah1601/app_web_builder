import { z } from "zod";
import { DependencyProfileSchema } from "@atlas/workflow-engine";

/** Shared ambiguity question shape — mirrors role-architect's AmbiguityQuestion
 *  so the engine-side triage-clarifications canvas-pause kind can handle both. */
export const PlannerAmbiguityQuestionSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(["blocker", "recommended"]),
  widgetKind: z.enum(["yes-no", "single-select", "text"]).optional(),
  options: z.array(z.string().min(1).max(120)).min(2).max(6).optional()
}).superRefine((q, ctx) => {
  if (q.widgetKind === "single-select" && (!q.options || q.options.length < 2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "single-select widgetKind requires at least 2 options",
      path: ["options"]
    });
  }
  if (q.widgetKind === "yes-no" && q.options !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "yes-no widgetKind must not supply options",
      path: ["options"]
    });
  }
});
export type PlannerAmbiguityQuestion = z.infer<typeof PlannerAmbiguityQuestionSchema>;

export const PlannerTriageReportSchema = z.object({
  passed: z.boolean(),
  questions: z.array(PlannerAmbiguityQuestionSchema)
}).superRefine((r, ctx) => {
  const hasBlocker = r.questions.some((q) => q.severity === "blocker");
  if (r.passed && hasBlocker) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when a blocker question is present",
      path: ["passed"]
    });
  }
});
export type PlannerTriageReport = z.infer<typeof PlannerTriageReportSchema>;

export const ALLOWED_ARTIFACT_KINDS = [
  "frontend-app",
  "backend-rest-api",
  "backend-graphql",
  "tests",
  "iac",
  "deploy"
] as const;
export type AllowedArtifactKind = (typeof ALLOWED_ARTIFACT_KINDS)[number];

export const WorkflowNodeLlmSchema = z.object({
  id: z.string().min(1),
  artifactKind: z.enum(ALLOWED_ARTIFACT_KINDS),
  summary: z.string().min(1),
  dependsOn: z.array(z.string()),
  consumes: z.array(z.string())
});
export type WorkflowNodeLlm = z.infer<typeof WorkflowNodeLlmSchema>;

export const DagSynthesisOutputSchema = z.object({
  nodes: z.array(WorkflowNodeLlmSchema).min(1),
  dependencyProfile: DependencyProfileSchema,
  reasoning: z.string()
});
export type DagSynthesisOutput = z.infer<typeof DagSynthesisOutputSchema>;
