import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const DesignTokenCategorySchema = z.enum([
  "color",
  "spacing",
  "typography",
  "radius",
  "shadow",
  "motion"
]);
export type DesignTokenCategory = z.infer<typeof DesignTokenCategorySchema>;

export const DesignTokenScaleSchema = z.enum(["light", "dark"]);

export const DesignTokenSchema = z
  .object({
    kind: z.literal("designtoken"),
    ...BaseNodeFields,
    name: z.string().min(1),
    category: DesignTokenCategorySchema,
    value: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]),
    scale: DesignTokenScaleSchema.optional(),
    contrastGroup: z.string().optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type DesignToken = z.infer<typeof DesignTokenSchema>;
