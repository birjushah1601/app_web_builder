import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const MigratesToEdgeSchema = z
  .object({
    type: z.literal("migratesTo"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type MigratesToEdge = z.infer<typeof MigratesToEdgeSchema>;
