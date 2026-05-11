import { z } from "zod";
import { RitualStateSchema } from "./state.js";

export const EditClassSchema = z.enum(["cosmetic", "structural", "security-compliance-touching"]);
export type EditClass = z.infer<typeof EditClassSchema>;

const RitualStartedSchema = z.object({
  type: z.literal("ritual.started"),
  ritualId: z.string().min(1),
  ts: z.string(),
  payload: z.object({
    intent: z.string(),
    editClass: EditClassSchema,
    projectId: z.string(),
    userId: z.string()
  })
});

const RitualTransitionedSchema = z.object({
  type: z.literal("ritual.transitioned"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    from: RitualStateSchema,
    to: RitualStateSchema,
    transitionKind: z.string()
  })
});

const RitualArtifactEmittedSchema = z.object({
  type: z.literal("ritual.artifact_emitted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    fromRole: z.string(),
    artifact: z.unknown()
  })
});

const RitualApprovedSchema = z.object({
  type: z.literal("ritual.approved"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    approvedBy: z.string(),
    persona: z.enum(["ama", "diego", "priya"])
  })
});

const RitualChangesRequestedSchema = z.object({
  type: z.literal("ritual.changes_requested"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ requestedBy: z.string(), notes: z.string() })
});

const RitualRiskAcceptedSchema = z.object({
  type: z.literal("ritual.risk_accepted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    gate: z.enum(["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"]),
    failureSummary: z.string(),
    acceptedBy: z.object({
      personaTier: z.enum(["ama", "diego", "priya"]),
      userId: z.string(),
      timestamp: z.string()
    }),
    rationale: z.string().min(20),
    scope: z.enum(["single-commit", "session", "permanent-for-project"])
  })
});

const RitualEscalationRequestedSchema = z.object({
  type: z.literal("ritual.escalation_requested"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ reason: z.string(), requestedBy: z.string() })
});

const RitualMergeGateResultSchema = z.object({
  type: z.literal("ritual.merge_gate_result"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    layer: z.enum(["L1", "L2", "L3", "L4", "L5", "L6", "L7"]),
    status: z.enum(["passed", "failed"]),
    summary: z.string()
  })
});

const RitualCompletedSchema = z.object({
  type: z.literal("ritual.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ finalState: z.enum(["done", "escalated", "aborted"]) })
});

// Plan L: emitted when the engine auto-triggers a refine() in response to
// a chained gate failure (when ATLAS_FF_AUTO_FIX_LOOP is on).
const AutoFixAttemptedSchema = z.object({
  type: z.literal("auto_fix.attempted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    gate: z.string(),
    attemptNumber: z.number().int().positive(),
    parentRitualId: z.string()
  })
});

// Plan L: emitted when the auto-fix budget (MAX_FIX_ATTEMPTS) is hit
// without the gate passing — the chain stops and the ritual stays escalated.
const AutoFixBudgetExhaustedSchema = z.object({
  type: z.literal("auto_fix.budget_exhausted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ gate: z.string(), attempts: z.number().int().nonnegative() })
});

// Plan L: emitted when the auto-fix infrastructure itself fails (LLM error,
// conductor refusal, etc.) — distinct from a gate that failed cleanly.
const AutoFixFailedSchema = z.object({
  type: z.literal("auto_fix.failed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ gate: z.string(), error: z.string() })
});

export const RitualEventSchema = z.discriminatedUnion("type", [
  RitualStartedSchema,
  RitualTransitionedSchema,
  RitualArtifactEmittedSchema,
  RitualApprovedSchema,
  RitualChangesRequestedSchema,
  RitualRiskAcceptedSchema,
  RitualEscalationRequestedSchema,
  RitualMergeGateResultSchema,
  RitualCompletedSchema,
  AutoFixAttemptedSchema,
  AutoFixBudgetExhaustedSchema,
  AutoFixFailedSchema
]);
export type RitualEvent = z.infer<typeof RitualEventSchema>;

export interface EventSink {
  emit(event: RitualEvent): Promise<void>;
}

export class InMemoryEventSink implements EventSink {
  private store: RitualEvent[] = [];
  async emit(event: RitualEvent): Promise<void> {
    this.store.push(event);
  }
  events(): readonly RitualEvent[] {
    return this.store;
  }
  clear(): void {
    this.store = [];
  }
}
