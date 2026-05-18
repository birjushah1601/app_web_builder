import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const DependsOnEdgeSchema = z
  .object({
    type: z.literal("dependsOn"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type DependsOnEdge = z.infer<typeof DependsOnEdgeSchema>;
