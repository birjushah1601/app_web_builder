import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const MutatesEdgeSchema = z
  .object({
    type: z.literal("mutates"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type MutatesEdge = z.infer<typeof MutatesEdgeSchema>;
