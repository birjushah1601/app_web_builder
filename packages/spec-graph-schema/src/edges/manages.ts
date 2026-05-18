import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const ManagesEdgeSchema = z
  .object({
    type: z.literal("manages"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type ManagesEdge = z.infer<typeof ManagesEdgeSchema>;
