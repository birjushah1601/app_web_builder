import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const RegionSchema = z
  .object({
    kind: z.literal("region"),
    ...BaseNodeFields,
    code: z.string().min(1),
    cloudProviderRef: z.string().optional(),
    jurisdictionRef: z.string().optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Region = z.infer<typeof RegionSchema>;
