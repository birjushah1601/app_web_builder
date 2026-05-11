import { z } from "zod";
import { PersonaTierSchema } from "./personas.js";

export const GateSchema = z.enum(["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"]);
export type Gate = z.infer<typeof GateSchema>;

export const RiskScopeSchema = z.enum(["single-commit", "session", "permanent-for-project"]);
export type RiskScope = z.infer<typeof RiskScopeSchema>;

export const RiskAcceptedSchema = z.object({
  gate: GateSchema,
  failureSummary: z.string().min(1),
  acceptedBy: z.object({
    personaTier: PersonaTierSchema,
    userId: z.string().min(1),
    timestamp: z.string().min(1)
  }),
  rationale: z.string().min(20),
  scope: RiskScopeSchema
});
export type RiskAccepted = z.infer<typeof RiskAcceptedSchema>;

import { isAtLeast, type PersonaTier } from "./personas.js";
import { PersonaGateError } from "./errors.js";

const MIN_PERSONA_FOR_GATE: Record<Gate, PersonaTier> = {
  "L4-security": "diego",
  "L5-compliance": "diego",
  "L6-a11y-advisory": "ama",
  "L7-visual-advisory": "ama"
};

export function enforcePersonaGate(event: RiskAccepted): void {
  const required = MIN_PERSONA_FOR_GATE[event.gate];
  if (!isAtLeast(event.acceptedBy.personaTier, required)) {
    throw new PersonaGateError(event.gate, event.acceptedBy.personaTier, required);
  }
}
