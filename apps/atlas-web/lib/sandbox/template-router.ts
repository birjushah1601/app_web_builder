import type { ArtifactKind } from "@atlas/canvas-runtime";

const DEFAULT_TEMPLATE = "atlas-next-ts-v2";

/**
 * Map architect's `canvasManifest.artifactKind` to an E2B template name.
 *
 * v1: ships atlas-next-ts-v2 (frontend) + atlas-fastapi (backend-rest-api).
 * Other kinds fall back to atlas-next-ts-v2 as a safe default; v2 sub-plans
 * (T.2.1, T.2.2, ...) replace the fallbacks with dedicated templates.
 *
 * When multiStackFlagOn=false, returns DEFAULT_TEMPLATE regardless of kind
 * — preserves today's exact behavior under flag-OFF.
 */
export function templateForArtifactKind(
  kind: ArtifactKind | undefined,
  opts: { multiStackFlagOn: boolean }
): string {
  if (!opts.multiStackFlagOn) return DEFAULT_TEMPLATE;
  if (!kind) return DEFAULT_TEMPLATE;
  switch (kind) {
    case "frontend-app":
      return "atlas-next-ts-v2";
    case "backend-rest-api":
      return "atlas-fastapi";
    case "backend-graphql":
    case "data-pipeline":
    case "mobile-app":
    case "cli-tool":
      // v2 sub-plans (T.2.x) replace these fallbacks.
      return DEFAULT_TEMPLATE;
  }
}
