import { z } from "zod";

export const GateLayerSchema = z.enum(["L1", "L2", "L3", "L4", "L5", "L6", "L7"]);
export type GateLayer = z.infer<typeof GateLayerSchema>;

export const GateIssueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  message: z.string()
});

export const GateResultSchema = z.object({
  layer: GateLayerSchema,
  status: z.enum(["passed", "failed"]),
  summary: z.string(),
  issues: z.array(GateIssueSchema).optional()
});
export type GateResult = z.infer<typeof GateResultSchema>;

export interface GateRunInput {
  ritualId: string;
  projectId: string;
  commitSha: string;
  graphSlice: { bytes: string; hash: string };
}

export interface GateRunner {
  readonly layer: GateLayer;
  run(input: GateRunInput): Promise<GateResult>;
}
