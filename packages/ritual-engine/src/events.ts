import { z } from "zod";
import { RitualStateSchema } from "./state.js";

// Plan S.4 — canvas + researcher + designer events.
// NOTE on duplication: the authoritative Zod schemas for these events live in
// @atlas/canvas-runtime (re-exported for atlas-web's EventBroker). We keep
// loose mirror schemas here (payload typed as z.unknown()) to participate in
// `RitualEventSchema`'s discriminated union WITHOUT importing canvas-runtime.
// Why: canvas-runtime's types.ts depends on PersonaTierSchema from this
// package (ritual-engine), and importing canvas-runtime here creates a
// circular ESM cycle that fails at runtime ("Cannot read properties of
// undefined (reading 'shape')") because canvas-runtime/types.js is mid-eval
// when its dependent canvas-runtime/events.js gets re-imported via this
// package's dist/index.js. Duplication is the pragmatic break: the engine's
// runtime never re-validates emitted events against this union (it relies on
// TS types), and the broker schema is the canonical wire contract.

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

// Plan S.4 — see top-of-file comment for why these are local mirrors.
const ArchitectCanvasManifestEmittedSchema = z.object({
  type: z.literal("architect.canvas_manifest.emitted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ manifest: z.unknown() })
});
const ResearcherBriefCompletedSchema = z.object({
  type: z.literal("researcher.brief.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const ResearcherBriefFailedSchema = z.object({
  type: z.literal("researcher.brief.failed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ error: z.string() })
});
const DesignerProposalEmittedSchema = z.object({
  type: z.literal("designer.proposal.emitted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerProposalFailedSchema = z.object({
  type: z.literal("designer.proposal.failed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ error: z.string() })
});
const CanvasOptionsRequestedSchema = z.object({
  type: z.literal("canvas.options.requested"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const CanvasOptionSelectedSchema = z.object({
  type: z.literal("canvas.option.selected"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    directionId: z.string().min(1),
    tokens: z.unknown(),
    autoSelected: z.boolean()
  })
});
const CanvasRefinementStartedSchema = z.object({
  type: z.literal("canvas.refinement.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const CanvasRefinementCompletedSchema = z.object({
  type: z.literal("canvas.refinement.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
// Plan C — sandbox apply lifecycle events. use-canvas-state listens for
// sandbox.apply.completed and auto-switches the canvas to preview mode.
const SandboxApplyStartedSchema = z.object({
  type: z.literal("sandbox.apply.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const SandboxApplyCompletedSchema = z.object({
  type: z.literal("sandbox.apply.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const SandboxApplyFailedSchema = z.object({
  type: z.literal("sandbox.apply.failed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});

// Plan SPU — Designer three-pass (draft → critique → revise) lifecycle.
// Loose mirror schemas (payload typed as z.unknown()) following the same
// pattern as the canvas mirror schemas above. See top-of-file comment for why.
const DesignerDraftCompletedSchema = z.object({
  type: z.literal("designer.draft.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerCritiqueStartedSchema = z.object({
  type: z.literal("designer.critique.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerCritiqueCompletedSchema = z.object({
  type: z.literal("designer.critique.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerReviseStartedSchema = z.object({
  type: z.literal("designer.revise.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const DesignerReviseCompletedSchema = z.object({
  type: z.literal("designer.revise.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});

// Plan U slice 3b — triage clarification pause lifecycle. Emitted by the
// engine when architect pass-1 returns blocker questions; the engine pauses
// `_runRitual` on the canvas-pause registry's `triage-clarifications` kind
// and resumes when the user submits answers (or on timeout).
const RitualTriageAwaitingClarificationSchema = z.object({
  type: z.literal("ritual.triage.awaiting_clarification"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    questions: z.array(
      z.object({
        id: z.string(),
        question: z.string(),
        reason: z.string().optional(),
        widgetKind: z.enum(["yes-no", "single-select", "text"]).optional(),
        options: z.array(z.string()).optional()
      })
    )
  })
});
const RitualTriageClarificationResolvedSchema = z.object({
  type: z.literal("ritual.triage.clarification_resolved"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    answers: z.record(z.string()),
    autoResolved: z.boolean()
  })
});

// Plan SPU — AssetGenerator role lifecycle. started/completed/failed land
// on the rail timeline as their own row once the broker mapping ships.
const AssetGenStartedSchema = z.object({
  type: z.literal("asset.gen.started"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const AssetGenCompletedSchema = z.object({
  type: z.literal("asset.gen.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
});
const AssetGenFailedSchema = z.object({
  type: z.literal("asset.gen.failed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.unknown()
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
  AutoFixFailedSchema,
  // Plan S.4 — canvas + researcher + designer events
  ArchitectCanvasManifestEmittedSchema,
  ResearcherBriefCompletedSchema,
  ResearcherBriefFailedSchema,
  DesignerProposalEmittedSchema,
  DesignerProposalFailedSchema,
  CanvasOptionsRequestedSchema,
  CanvasOptionSelectedSchema,
  CanvasRefinementStartedSchema,
  CanvasRefinementCompletedSchema,
  SandboxApplyStartedSchema,
  SandboxApplyCompletedSchema,
  SandboxApplyFailedSchema,
  // Plan SPU — designer three-pass + asset generation events
  DesignerDraftCompletedSchema,
  DesignerCritiqueStartedSchema,
  DesignerCritiqueCompletedSchema,
  DesignerReviseStartedSchema,
  DesignerReviseCompletedSchema,
  AssetGenStartedSchema,
  AssetGenCompletedSchema,
  AssetGenFailedSchema,
  // Plan U slice 3b — triage clarification pause lifecycle.
  RitualTriageAwaitingClarificationSchema,
  RitualTriageClarificationResolvedSchema
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
