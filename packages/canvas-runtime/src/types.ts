import { z } from "zod";
import { PersonaTierSchema } from "@atlas/ritual-engine";

export const ArtifactKindSchema = z.enum([
  "frontend-app",
  "backend-rest-api",
  "backend-graphql",
  "data-pipeline",
  "mobile-app",
  "cli-tool"
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const CanvasModeSchema = z.object({
  id: z.string().min(1),
  renderer: z.string().min(1),
  audience: z.array(PersonaTierSchema).min(1),
  default: z.boolean().optional(),
  blockingFor: z.enum(["design", "schema"]).nullable().optional()
});
export type CanvasMode = z.infer<typeof CanvasModeSchema>;

export const CanvasManifestSchema = z
  .object({
    artifactKind: ArtifactKindSchema,
    modes: z.array(CanvasModeSchema).min(1)
  })
  .superRefine((m, ctx) => {
    const defaults = m.modes.filter((mm) => mm.default === true);
    if (defaults.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only one default mode allowed (multiple modes marked default)",
        path: ["modes"]
      });
    }
  });
export type CanvasManifest = z.infer<typeof CanvasManifestSchema>;

/** Architect helper — synthesize a sensible default manifest from artifactKind. */
export function defaultManifestForArtifactKind(kind: ArtifactKind): CanvasManifest {
  switch (kind) {
    case "frontend-app":
      return {
        artifactKind: kind,
        modes: [
          { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" },
          { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] }
        ]
      };
    case "backend-rest-api":
    case "backend-graphql":
      return {
        artifactKind: kind,
        modes: [
          { id: "schema", renderer: "schema", audience: ["ama", "diego", "priya"], default: true, blockingFor: "schema" }
        ]
      };
    default:
      return {
        artifactKind: kind,
        modes: [
          { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"], default: true }
        ]
      };
  }
}
