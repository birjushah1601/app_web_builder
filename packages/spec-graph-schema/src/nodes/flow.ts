import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const FlowStepSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    surface: z.string().optional()
  })
  .strict();
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z
  .object({
    kind: z.literal("flow"),
    ...BaseNodeFields,
    name: z.string().min(1),
    steps: z.array(FlowStepSchema).nonempty(),
    entryPoints: z.array(z.string().min(1)).nonempty(),
    successCriteria: z.string().optional(),
    failurePaths: z.array(z.string().min(1)).default([]),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Flow = z.infer<typeof FlowSchema>;
