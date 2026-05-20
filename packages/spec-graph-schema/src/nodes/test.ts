import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const TestLayerSchema = z.enum(["L1", "L2", "L3", "L4", "L5"]);
export type TestLayer = z.infer<typeof TestLayerSchema>;

export const TestSourceSchema = z.enum(["generated", "user", "baseline"]);
export type TestSource = z.infer<typeof TestSourceSchema>;

export const TestSchema = z
  .object({
    kind: z.literal("test"),
    ...BaseNodeFields,
    name: z.string().min(1),
    layer: TestLayerSchema,
    source: TestSourceSchema,
    filepath: z.string().min(1),
    coversRef: z.array(z.string().min(1)).nonempty(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Test = z.infer<typeof TestSchema>;
