import { z } from "zod";

export const BaselineAssertionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().min(1),
    checklistItem: z.string().min(1),
    mustEmitTest: z.boolean(),
    owner: z.string().min(1)
  })
  .strict();

export const BaselineFileSchema = z
  .object({
    kind: z.enum(["authboundary", "pii-model", "compliance"]),
    version: z.number().int().positive(),
    assertions: z.array(BaselineAssertionSchema).nonempty()
  })
  .strict();

export type BaselineAssertion = z.infer<typeof BaselineAssertionSchema>;
export type BaselineFile = z.infer<typeof BaselineFileSchema>;
export type ProtectedKind = BaselineFile["kind"];
