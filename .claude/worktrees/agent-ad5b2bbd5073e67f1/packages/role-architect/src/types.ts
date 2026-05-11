import { z } from "zod";

export const ScopeSchema = z.enum([
  "new-app",
  "new-feature",
  "bug-fix",
  "dep-upgrade",
  "refactor",
  "ship",
  "migrate"
]);
export type Scope = z.infer<typeof ScopeSchema>;

export const AmbiguityQuestionSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(["blocker", "recommended"])
});
export type AmbiguityQuestion = z.infer<typeof AmbiguityQuestionSchema>;

export const AmbiguityReportSchema = z.object({
  passed: z.boolean(),
  scope: ScopeSchema,
  questions: z.array(AmbiguityQuestionSchema)
}).superRefine((report, ctx) => {
  const hasBlocker = report.questions.some((q) => q.severity === "blocker");
  if (report.passed && hasBlocker) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when a blocker question is present",
      path: ["passed"]
    });
  }
});
export type AmbiguityReport = z.infer<typeof AmbiguityReportSchema>;

export const GraphSliceRefSchema = z.object({
  bytes: z.string(),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/)
});
export type GraphSliceRef = z.infer<typeof GraphSliceRefSchema>;

// One variant per scope. Each carries a scope-specific artifact plus the graph slice used for context.
const NewAppOutputSchema = z.object({
  scope: z.literal("new-app"),
  specGraph: z.unknown(),
  runnablePlan: z.object({ tasks: z.array(z.unknown()) }),
  graphSlice: GraphSliceRefSchema
});

const NewFeatureOutputSchema = z.object({
  scope: z.literal("new-feature"),
  diffPlan: z.object({ summary: z.string(), tasks: z.array(z.unknown()) }),
  graphSlice: GraphSliceRefSchema
});

const BugFixOutputSchema = z.object({
  scope: z.literal("bug-fix"),
  bugReport: z.object({
    phase1_reproduce: z.string(),
    phase2_isolate: z.string(),
    phase3_hypothesize: z.string(),
    phase4_verify: z.string(),
    rootCause: z.string()
  }),
  graphSlice: GraphSliceRefSchema
});

const DepUpgradeOutputSchema = z.object({
  scope: z.literal("dep-upgrade"),
  breakingChangeMatrix: z.array(z.object({
    change: z.string(),
    affectedCallsites: z.array(z.string()),
    migration: z.string()
  })),
  rollbackPlan: z.string(),
  graphSlice: GraphSliceRefSchema
});

const RefactorOutputSchema = z.object({
  scope: z.literal("refactor"),
  beforeAfterGraph: z.object({ before: z.unknown(), after: z.unknown() }),
  behaviorPreservationContract: z.array(z.string()),
  regressionTests: z.array(z.string()),
  graphSlice: GraphSliceRefSchema
});

const ShipOutputSchema = z.object({
  scope: z.literal("ship"),
  rerunnableSteps: z.array(z.object({ name: z.string(), command: z.string(), idempotent: z.boolean() })),
  rollbackTrigger: z.string(),
  graphSlice: GraphSliceRefSchema
});

const MigrateOutputSchema = z.object({
  scope: z.literal("migrate"),
  stagedPlan: z.array(z.object({ stage: z.string(), cutoverWindow: z.string(), rollback: z.string() })),
  complianceEvidence: z.array(z.string()),
  graphSlice: GraphSliceRefSchema
});

export const ArchitectOutputSchema = z.discriminatedUnion("scope", [
  NewAppOutputSchema,
  NewFeatureOutputSchema,
  BugFixOutputSchema,
  DepUpgradeOutputSchema,
  RefactorOutputSchema,
  ShipOutputSchema,
  MigrateOutputSchema
]);
export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;

export interface ArchitectInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
}
