import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const RendersEdgeSchema = z
  .object({
    type: z.literal("renders"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type RendersEdge = z.infer<typeof RendersEdgeSchema>;
