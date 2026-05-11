import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const FetchesEdgeSchema = z
  .object({
    type: z.literal("fetches"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type FetchesEdge = z.infer<typeof FetchesEdgeSchema>;
