import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const ProviderTypeSchema = z.enum(["hyperscaler", "regional", "on-prem", "sovereign"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ProviderSchema = z
  .object({
    kind: z.literal("provider"),
    ...BaseNodeFields,
    name: z.string().min(1),
    type: ProviderTypeSchema,
    regionRefs: z.array(z.string()).default([]),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Provider = z.infer<typeof ProviderSchema>;
