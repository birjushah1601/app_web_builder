import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const PowersEdgeSchema = z
  .object({
    type: z.literal("powers"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type PowersEdge = z.infer<typeof PowersEdgeSchema>;
