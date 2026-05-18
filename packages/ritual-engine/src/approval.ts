import { z } from "zod";
import { PersonaTierSchema } from "./personas.js";
import type { RitualTransition } from "./state.js";

const ApprovedSchema = z.object({
  kind: z.literal("approved"),
  approvedBy: z.string().min(1),
  persona: PersonaTierSchema
});

const ChangesRequestedSchema = z.object({
  kind: z.literal("changes_requested"),
  requestedBy: z.string().min(1),
  notes: z.string().min(1)
});

export const ApprovalDecisionSchema = z.discriminatedUnion("kind", [
  ApprovedSchema,
  ChangesRequestedSchema
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export function applyApproval(decision: ApprovalDecision): RitualTransition {
  if (decision.kind === "approved") return { kind: "approved" };
  return { kind: "changes_requested" };
}
