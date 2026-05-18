import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema, PiiClassificationSchema } from "../primitives.js";

export const ModelRelationSchema = z
  .object({
    name: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"])
  })
  .strict();

export const ModelIndexSchema = z
  .object({
    on: z.array(z.string().min(1)).nonempty(),
    unique: z.boolean().default(false)
  })
  .strict();

export const RlsPoliciesSchema = z
  .object({
    select: z.string().optional(),
    insert: z.string().optional(),
    update: z.string().optional(),
    delete: z.string().optional()
  })
  .strict();
export type RlsPolicies = z.infer<typeof RlsPoliciesSchema>;

export const ModelSchema = z
  .object({
    kind: z.literal("model"),
    ...BaseNodeFields,
    name: z.string().min(1),
    fields: z.record(z.string(), z.unknown()),
    relations: z.array(ModelRelationSchema).default([]),
    indexes: z.array(ModelIndexSchema).default([]),
    rlsPolicies: RlsPoliciesSchema.default({}),
    piiClassification: PiiClassificationSchema.default("none"),
    dataRetentionDays: z.number().int().positive().optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Model = z.infer<typeof ModelSchema>;
