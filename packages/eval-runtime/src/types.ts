import { z } from "zod";

export const StructuralFailureSchema = z.object({
  check: z.string().min(1),
  reason: z.string().min(1)
});
export type StructuralFailure = z.infer<typeof StructuralFailureSchema>;

export const StructuralResultSchema = z.discriminatedUnion("passed", [
  z.object({ passed: z.literal(true) }),
  z.object({
    passed: z.literal(false),
    failures: z.array(StructuralFailureSchema).min(1)
  })
]);
export type StructuralResult = z.infer<typeof StructuralResultSchema>;

export const JudgeDimensionSchema = z.object({
  name: z.string().min(1),
  score: z.number().min(0).max(10),
  rationale: z.string()
});
export type JudgeDimension = z.infer<typeof JudgeDimensionSchema>;

export const JudgeResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(10),
  dimensions: z.array(JudgeDimensionSchema),
  fixableBy: z.enum(["retry", "escalate"]),
  feedback: z.string()
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export const EvalFeedbackSchema = z.object({
  source: z.enum(["structural", "judge"]),
  promptFragment: z.string().min(1),
  failures: z.array(StructuralFailureSchema).optional(),
  dimensions: z.array(JudgeDimensionSchema).optional()
});
export type EvalFeedback = z.infer<typeof EvalFeedbackSchema>;

export const VerdictSchema = z.object({
  ritualId: z.string(),
  roleId: z.string(),
  workflowRunId: z.string().uuid().optional(),
  workflowNodeId: z.string().optional(),
  projectId: z.string().uuid(),
  userId: z.string(),
  attempt: z.number().int().min(1),
  layer: z.enum(["structural", "judge", "workflow"]),
  passed: z.boolean(),
  score: z.number().optional(),
  dimensions: z.array(JudgeDimensionSchema).optional(),
  failures: z.array(StructuralFailureSchema).optional(),
  fixableBy: z.enum(["retry", "escalate"]).optional(),
  feedbackUsed: EvalFeedbackSchema.optional(),
  userTurn: z.string().optional(),
  priorArtifactHash: z.string().optional(),
  outputHash: z.string().optional(),
  rubricVersion: z.string(),
  judgeModel: z.string().optional(),
  judgeInputTokens: z.number().int().nonnegative().optional(),
  judgeOutputTokens: z.number().int().nonnegative().optional(),
  judgeCostUsd: z.number().nonnegative().optional()
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().min(1),
  rubricVersion: z.string().min(1),
  inputs: z.object({
    userTurn: z.string(),
    priorArtifact: z.unknown().optional(),
    graphSlice: z.object({ bytes: z.string(), hash: z.string() }).optional()
  }),
  output: z.unknown(),
  expected: z.object({
    passed: z.boolean(),
    minScore: z.number().min(0).max(10).optional(),
    requiredDimensions: z.array(z.object({
      name: z.string(),
      minScore: z.number().min(0).max(10)
    })).optional()
  }),
  notes: z.string().optional()
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;
