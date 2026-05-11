import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const CoversEdgeSchema = z
  .object({
    type: z.literal("covers"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type CoversEdge = z.infer<typeof CoversEdgeSchema>;
