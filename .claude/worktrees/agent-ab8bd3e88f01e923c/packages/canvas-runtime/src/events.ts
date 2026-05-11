import { z } from "zod";
import { CanvasManifestSchema } from "./types.js";

const TsField = z.string();
const RitualIdField = z.string().min(1);

export const ArchitectCanvasManifestEmittedSchema = z.object({
  type: z.literal("architect.canvas_manifest.emitted"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    manifest: CanvasManifestSchema
  })
});

export const ResearcherBriefCompletedSchema = z.object({
  type: z.literal("researcher.brief.completed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    sourceTier: z.enum(["local-only", "local+web"]),
    referenceCount: z.number().int().nonnegative()
  })
});

export const ResearcherBriefFailedSchema = z.object({
  type: z.literal("researcher.brief.failed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({ error: z.string() })
});

export const DesignerProposalEmittedSchema = z.object({
  type: z.literal("designer.proposal.emitted"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    recommendedId: z.string().min(1),
    alternateIds: z.array(z.string()).length(2)
  })
});

export const DesignerProposalFailedSchema = z.object({
  type: z.literal("designer.proposal.failed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({ error: z.string() })
});

export const CanvasOptionsRequestedSchema = z.object({
  type: z.literal("canvas.options.requested"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    proposal: z.unknown(),
    manifest: CanvasManifestSchema
  })
});

export const CanvasOptionSelectedSchema = z.object({
  type: z.literal("canvas.option.selected"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    directionId: z.string().min(1),
    tokens: z.unknown(),
    autoSelected: z.boolean()
  })
});

export const CanvasRefinementStartedSchema = z.object({
  type: z.literal("canvas.refinement.started"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    fromDirectionId: z.string().min(1),
    axes: z.array(z.string()).min(1)
  })
});

export const CanvasRefinementCompletedSchema = z.object({
  type: z.literal("canvas.refinement.completed"),
  ritualId: RitualIdField,
  ts: TsField,
  payload: z.object({
    fromDirectionId: z.string().min(1),
    refinedTokens: z.unknown()
  })
});

export const CanvasEventSchema = z.discriminatedUnion("type", [
  ArchitectCanvasManifestEmittedSchema,
  ResearcherBriefCompletedSchema,
  ResearcherBriefFailedSchema,
  DesignerProposalEmittedSchema,
  DesignerProposalFailedSchema,
  CanvasOptionsRequestedSchema,
  CanvasOptionSelectedSchema,
  CanvasRefinementStartedSchema,
  CanvasRefinementCompletedSchema
]);
export type CanvasEvent = z.infer<typeof CanvasEventSchema>;
