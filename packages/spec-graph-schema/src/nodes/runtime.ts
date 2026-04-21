import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const RuntimeLanguageSchema = z.enum([
  "node",
  "python",
  "go",
  "rust",
  "java",
  "ruby",
  "other"
]);
export type RuntimeLanguage = z.infer<typeof RuntimeLanguageSchema>;

export const RuntimeSchema = z
  .object({
    kind: z.literal("runtime"),
    ...BaseNodeFields,
    language: RuntimeLanguageSchema,
    version: z.string().min(1),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Runtime = z.infer<typeof RuntimeSchema>;
