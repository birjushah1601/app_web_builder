import type { ArtifactKind } from "@atlas/canvas-runtime";

const DEFAULT_TEMPLATE = "atlas-next-ts-v2";

/**
 * Map architect's `canvasManifest.artifactKind` to an E2B template name.
 *
 * Coverage as of 2026-05-08:
 *   frontend-app     → atlas-next-ts-v2  (live, :3000)
 *   backend-rest-api → atlas-fastapi     (live, :3000)
 *   data-pipeline    → atlas-dlt-python  (live, :3000)
 *   backend-graphql  → atlas-graphql-yoga (live after port fix, :3001 — Bun.serve
 *                       would EADDRINUSE on :3000 because the e2bdev base image
 *                       already binds it; templates patched to :3001 in
 *                       fix(sandbox): swap Bun templates off port 3000 …)
 *   mobile-app       → atlas-expo-rn     (live; pnpm install runs at sandbox
 *                       boot via e2b.toml start_cmd because Expo's >2 GB
 *                       unpacked dep tree ENOSPCs during template build.
 *                       Cold-start adds ~2-3 min before :3000 responds.)
 *   cli-tool         → atlas-bun-cli     (live after port fix, :3001 — same
 *                       Bun port story as graphql-yoga.)
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
      return "atlas-graphql-yoga";
    case "cli-tool":
      return "atlas-bun-cli";
    case "mobile-app":
      // atlas-expo-rn template not currently published — its start_cmd-deferred
      // pnpm install collides with E2B's build-time start_cmd validation
      // (build fails before sandbox boots). Routing back to next-ts-v2 until
      // the build incompatibility is resolved. See TEMPLATE-EXPO-RN.md (TBD).
      return DEFAULT_TEMPLATE;
  }
}

/**
 * Per-template HTTP port the sandboxed app listens on.
 *
 * Most Atlas templates use :3000, matching every Atlas web app's local-dev
 * port and what the canvas iframe expects by default. The Bun trio
 * (atlas-bun-cli, atlas-graphql-yoga, atlas-hono-bun) bind :3001 instead
 * because the e2bdev/code-interpreter base image already holds :3000 and
 * Bun.serve EADDRINUSEs synchronously on collision. (The Python templates
 * tolerate the conflict because uvicorn binds late enough that the base
 * image's process has released :3000 by then; Bun.serve does not.)
 *
 * The factory falls back to ATLAS_DEFAULT_SANDBOX_PORT (env), then to 3000,
 * for unknown templates. Returns `undefined` for unknown templates so the
 * factory can apply its own defaults.
 */
export function portForTemplate(template: string): number | undefined {
  switch (template) {
    case "atlas-bun-cli":
    case "atlas-graphql-yoga":
    case "atlas-hono-bun":
      return 3001;
    case "atlas-next-ts":
    case "atlas-next-ts-v2":
    case "atlas-fastapi":
    case "atlas-dlt-python":
    case "atlas-expo-rn":
      return 3000;
    default:
      return undefined;
  }
}
