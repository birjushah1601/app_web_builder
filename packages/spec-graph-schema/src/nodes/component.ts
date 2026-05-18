import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const StyleApproachSchema = z.enum([
  "tailwind",
  "css-modules",
  "vanilla-extract",
  "styled-components",
  "emotion",
  "inline"
]);
export type StyleApproach = z.infer<typeof StyleApproachSchema>;

export const ComponentSchema = z
  .object({
    kind: z.literal("component"),
    ...BaseNodeFields,
    name: z.string().min(1),
    propsSchema: z.record(z.string(), z.unknown()).optional(),
    isServerComponent: z.boolean().default(false),
    styleApproach: StyleApproachSchema,
    a11yAnnotations: z.record(z.string(), z.string()).optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Component = z.infer<typeof ComponentSchema>;
