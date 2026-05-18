import { z } from "zod";

/** What the architect emits to drive Researcher. Lives in architect's pass-2
 *  artifact alongside the existing scope/runnablePlan/etc. fields.
 *  `artifactKind` is optional and mirrors the canvasManifest's enum
 *  (`frontend-app`, `backend-rest-api`, etc.); when present, the Researcher
 *  composes a per-kind skill fragment (Plan T.1). */
export const DesignIntentSchema = z.object({
  category: z.string().min(1),
  audienceCues: z.array(z.string()),
  artifactKind: z.string().min(1).optional()
});
export type DesignIntent = z.infer<typeof DesignIntentSchema>;

/** A single reference inside an InspirationBrief. */
export const ReferenceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  why: z.string().min(1),
  sourceTier: z.enum(["local-catalog", "web"]),
  palettePreview: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).optional(),
  typographyPreview: z
    .object({
      primary: z.string().min(1),
      secondary: z.string().min(1).optional()
    })
    .optional()
});
export type Reference = z.infer<typeof ReferenceSchema>;

/** Researcher's output. Consumed by Designer (Plan S.3). */
export const InspirationBriefSchema = z.object({
  category: z.string().min(1),
  audienceCues: z.array(z.string()),
  references: z.array(ReferenceSchema),
  patternsThatWin: z.array(z.string()),
  patternsThatLose: z.array(z.string())
});
export type InspirationBrief = z.infer<typeof InspirationBriefSchema>;
