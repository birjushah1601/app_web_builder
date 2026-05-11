import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const SupersedesEdgeSchema = z
  .object({
    type: z.literal("supersedes"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type SupersedesEdge = z.infer<typeof SupersedesEdgeSchema>;
