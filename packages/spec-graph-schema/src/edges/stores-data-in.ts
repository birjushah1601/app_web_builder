import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const StoresDataInEdgeSchema = z
  .object({
    type: z.literal("storesDataIn"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type StoresDataInEdge = z.infer<typeof StoresDataInEdgeSchema>;
