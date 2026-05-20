import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const RequiresEdgeSchema = z
  .object({
    type: z.literal("requires"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type RequiresEdge = z.infer<typeof RequiresEdgeSchema>;
