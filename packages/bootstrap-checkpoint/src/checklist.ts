import { z } from "zod";

export const ChecklistItemSchema = z.object({
  id: z.number().int().min(1).max(6),
  key: z.string().min(1),
  prompt: z.string().min(1),
  kind: z.enum(["affirm", "escape_hatch"])
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CANONICAL_ITEMS: ChecklistItem[] = [
  { id: 1, key: "compliance_class", prompt: "Is the compliance class correct?", kind: "affirm" },
  { id: 2, key: "data_residency_region", prompt: "Is the data-residency region correct?", kind: "affirm" },
  { id: 3, key: "auth_provider", prompt: "Is the auth provider correct?", kind: "affirm" },
  { id: 4, key: "db_provider", prompt: "Is the DB provider correct?", kind: "affirm" },
  { id: 5, key: "persona_tier", prompt: "Is the persona tier correct?", kind: "affirm" },
  { id: 6, key: "intuition_check", prompt: "Is anything off about this plan you can't articulate?", kind: "escape_hatch" }
];

export const ItemResultSchema = z.object({
  key: z.string(),
  passed: z.boolean(),
  notes: z.string().optional()
});
export type ItemResult = z.infer<typeof ItemResultSchema>;

export const ChecklistResultSchema = z.object({
  passed: z.boolean(),
  itemResults: z.array(ItemResultSchema)
}).superRefine((result, ctx) => {
  const anyFailed = result.itemResults.some((r) => !r.passed);
  if (result.passed && anyFailed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when any itemResult.passed=false",
      path: ["passed"]
    });
  }
});
export type ChecklistResult = z.infer<typeof ChecklistResultSchema>;
