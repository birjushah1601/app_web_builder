import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const DisplaysEdgeSchema = z
  .object({
    type: z.literal("displays"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type DisplaysEdge = z.infer<typeof DisplaysEdgeSchema>;
