import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const StyledByEdgeSchema = z
  .object({
    type: z.literal("styledBy"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type StyledByEdge = z.infer<typeof StyledByEdgeSchema>;
