import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const DataResidencySchema = z
  .object({
    kind: z.literal("dataresidency"),
    ...BaseNodeFields,
    jurisdiction: z.string().min(1),
    notes: z.string().optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type DataResidency = z.infer<typeof DataResidencySchema>;
