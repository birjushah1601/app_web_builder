import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const ReadsEdgeSchema = z
  .object({
    type: z.literal("reads"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type ReadsEdge = z.infer<typeof ReadsEdgeSchema>;
