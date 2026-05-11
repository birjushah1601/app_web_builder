import { z } from "zod";
import type { EditClass } from "@atlas/edit-classifier";

export const BudgetSchema = z.object({
  p50Ms: z.number().int().positive(),
  p95Ms: z.number().int().positive()
}).superRefine((b, ctx) => {
  if (b.p95Ms < b.p50Ms) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "p95Ms must be >= p50Ms", path: ["p95Ms"] });
  }
});
export type Budget = z.infer<typeof BudgetSchema>;

export const BUDGETS: Record<EditClass, Budget> = {
  "cosmetic": { p50Ms: 200, p95Ms: 800 },
  "structural": { p50Ms: 5_000, p95Ms: 30_000 },
  "security-compliance-touching": { p50Ms: 8_000, p95Ms: 60_000 }
};
