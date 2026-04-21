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

export const RitualEventSchema = z.discriminatedUnion("type", [
  RitualStartedSchema,
  RitualTransitionedSchema,
  RitualArtifactEmittedSchema,
  RitualApprovedSchema,
  RitualChangesRequestedSchema,
  RitualRiskAcceptedSchema,
  RitualEscalationRequestedSchema,
  RitualMergeGateResultSchema,
  RitualCompletedSchema
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
