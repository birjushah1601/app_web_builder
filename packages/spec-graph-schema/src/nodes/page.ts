import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const PageRenderModeSchema = z.enum(["ssr", "ssg", "csr", "isr"]);
export type PageRenderMode = z.infer<typeof PageRenderModeSchema>;

export const PageSchema = z
  .object({
    kind: z.literal("page"),
    ...BaseNodeFields,
    path: z.string().min(1),
    title: z.string().min(1),
    layout: z.string().optional(),
    renderMode: PageRenderModeSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
    authRequired: z.boolean().default(false),
    routeRef: z.string().optional(),
    a11yAnnotations: z.record(z.string(), z.string()).optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Page = z.infer<typeof PageSchema>;
