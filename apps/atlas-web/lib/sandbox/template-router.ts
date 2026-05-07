import type { ArtifactKind } from "@atlas/canvas-runtime";

const DEFAULT_TEMPLATE = "atlas-next-ts-v2";

/**
 * Map architect's `canvasManifest.artifactKind` to an E2B template name.
 *
 * Coverage after Plan T.1 + T.2.x:
 *   frontend-app     → atlas-next-ts-v2
 *   backend-rest-api → atlas-fastapi (Python). Users wanting Bun+Hono opt in
 *                      per-project via ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-hono-bun.
 *   backend-graphql  → atlas-graphql-yoga
 *   data-pipeline    → atlas-dlt-python
 *   mobile-app       → atlas-expo-rn
 *   cli-tool         → atlas-bun-cli
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
      return "atlas-graphql-yoga";
    case "data-pipeline":
      return "atlas-dlt-python";
    case "mobile-app":
      return "atlas-expo-rn";
    case "cli-tool":
      return "atlas-bun-cli";
  }
}
