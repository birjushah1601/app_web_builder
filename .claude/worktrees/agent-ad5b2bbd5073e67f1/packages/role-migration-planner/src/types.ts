import { z } from "zod";

export const MigrationStageKindSchema = z.enum([
  "dual-run",
  "traffic-shift",
  "verify",
  "cutover",
  "decommission"
]);
export type MigrationStageKind = z.infer<typeof MigrationStageKindSchema>;

export const MigrationStageSchema = z
  .object({
    kind: MigrationStageKindSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    durationEstimateHours: z.number().int().nonnegative(),
    rollbackProcedure: z.string().min(1),
    successCriteria: z.array(z.string().min(1)).nonempty(),
    risks: z.array(z.string().min(1)).default([])
  })
  .strict();
export type MigrationStage = z.infer<typeof MigrationStageSchema>;

export const MigrationPlanSchema = z
  .object({
    /** NodeId of the source WorkloadTopology node. */
    sourceTopologyRef: z.string().min(1),
    /** NodeId of the target WorkloadTopology node. */
    targetTopologyRef: z.string().min(1),
    /** Strict ordered list — exactly the 5 stages, in this order. */
    stages: z.array(MigrationStageSchema).length(5),
    /** Total estimate, derived but explicit so the LLM commits to it. */
    totalEstimateHours: z.number().int().positive(),
    /** Hard prerequisites the operator must verify before stage 1. */
    prerequisites: z.array(z.string().min(1)).nonempty(),
    /** Operational hand-off notes for the on-call team. */
    operatorNotes: z.string().min(1)
  })
  .strict()
  .superRefine((plan, ctx) => {
    const expected: MigrationStageKind[] = [
      "dual-run",
      "traffic-shift",
      "verify",
      "cutover",
      "decommission"
    ];
    plan.stages.forEach((stage, idx) => {
      if (stage.kind !== expected[idx]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `stages[${idx}].kind must be "${expected[idx]}", got "${stage.kind}"`,
          path: ["stages", idx, "kind"]
        });
      }
    });
    const sum = plan.stages.reduce((acc, s) => acc + s.durationEstimateHours, 0);
    if (sum !== plan.totalEstimateHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `totalEstimateHours (${plan.totalEstimateHours}) must equal sum of stage durations (${sum})`,
        path: ["totalEstimateHours"]
      });
    }
  });
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;

export interface MigrationPlannerInput {
  ritualId: string;
  /** NodeId of the source WorkloadTopology. */
  sourceTopologyRef: string;
  /** NodeId of the target WorkloadTopology. */
  targetTopologyRef: string;
  graphSlice: { bytes: string; hash: string };
}
