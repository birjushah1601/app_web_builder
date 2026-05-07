import type { ArtifactKind } from "@atlas/canvas-runtime";

const DEFAULT_TEMPLATE = "atlas-next-ts-v2";

/**
 * Map architect's `canvasManifest.artifactKind` to an E2B template name.
 *
 * Coverage as of 2026-05-07:
 *   frontend-app     → atlas-next-ts-v2  (live)
 *   backend-rest-api → atlas-fastapi     (live)
 *   data-pipeline    → atlas-dlt-python  (live)
 *   backend-graphql  → atlas-next-ts-v2  (fallback; atlas-graphql-yoga template
 *                       authored but its E2B build hits a Bun port-3000 EADDRINUSE
 *                       conflict with e2bdev base. Tracked for repair.)
 *   mobile-app       → atlas-next-ts-v2  (fallback; atlas-expo-rn template
 *                       authored but its build hits ENOSPC during pnpm install
 *                       of Expo's deep dep tree. Needs a slimmer template or
 *                       larger E2B rootfs. Tracked for repair.)
 *   cli-tool         → atlas-next-ts-v2  (fallback; atlas-bun-cli template
 *                       authored but build would hit the same Bun port issue.)
 *
 * When multiStackFlagOn=false, returns DEFAULT_TEMPLATE regardless of kind.
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
    case "data-pipeline":
      return "atlas-dlt-python";
    case "backend-graphql":
    case "mobile-app":
    case "cli-tool":
      // Templates authored but E2B builds blocked (Bun port conflict / Expo
      // disk space). Falls back to default until repaired.
      return DEFAULT_TEMPLATE;
  }
}
