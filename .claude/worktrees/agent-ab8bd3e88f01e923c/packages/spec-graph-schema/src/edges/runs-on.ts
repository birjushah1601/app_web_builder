import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const RunsOnEdgeSchema = z
  .object({
    type: z.literal("runsOn"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type RunsOnEdge = z.infer<typeof RunsOnEdgeSchema>;
