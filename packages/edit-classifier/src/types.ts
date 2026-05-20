import { z } from "zod";

export const EditClassSchema = z.enum(["cosmetic", "structural", "security-compliance-touching"]);
export type EditClass = z.infer<typeof EditClassSchema>;

const Added = z.object({
  kind: z.literal("added"),
  nodeId: z.string(),
  fieldPath: z.string(),
  newValue: z.unknown()
});
const Modified = z.object({
  kind: z.literal("modified"),
  nodeId: z.string(),
  fieldPath: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown()
});
const Removed = z.object({
  kind: z.literal("removed"),
  nodeId: z.string(),
  fieldPath: z.string(),
  oldValue: z.unknown()
});

export const FieldChangeSchema = z.discriminatedUnion("kind", [Added, Modified, Removed]);
export type FieldChange = z.infer<typeof FieldChangeSchema>;

export const EditClassificationSchema = z.object({
  class: EditClassSchema,
  reason: z.string().min(1),
  drivers: z.array(FieldChangeSchema)
});
export type EditClassification = z.infer<typeof EditClassificationSchema>;
