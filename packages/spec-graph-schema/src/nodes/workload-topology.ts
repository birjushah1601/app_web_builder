import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const WorkloadShapeSchema = z.enum([
  "single-region",
  "multi-region-active-passive",
  "multi-region-active-active",
  "edge-only",
  "hybrid-on-prem-cloud"
]);
export type WorkloadShape = z.infer<typeof WorkloadShapeSchema>;

export const WorkloadTopologySchema = z
  .object({
    kind: z.literal("workloadtopology"),
    ...BaseNodeFields,
    shape: WorkloadShapeSchema,
    providerRefs: z.array(z.string()).nonempty(),
    regionRefs: z.array(z.string()).nonempty(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type WorkloadTopology = z.infer<typeof WorkloadTopologySchema>;
