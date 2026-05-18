import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const SubjectToEdgeSchema = z
  .object({
    type: z.literal("subjectTo"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type SubjectToEdge = z.infer<typeof SubjectToEdgeSchema>;
