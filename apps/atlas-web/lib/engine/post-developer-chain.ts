/**
 * Plan D Task 6 — Build the ritual-engine's `postDeveloperChain` (ordered
 * list of role IDs dispatched after a successful developer pass) based on
 * the active sandbox template.
 *
 * For atlas-fastapi rituals we append `backend-artifact` so the
 * BackendArtifactRole runs after the build gate succeeds and produces the
 * typed backend artifact the workflow engine consumes downstream. Other
 * templates (atlas-next-ts-v2, anything unknown / undefined) keep the
 * base chain unchanged.
 *
 * The chain is intentionally kept template-conditional rather than
 * artifactKind-conditional because the sandbox template is what determines
 * whether the running app actually exposes the HTTP surface
 * BackendArtifactRole probes (i.e. /health). Mixing in any non-FastAPI
 * template would make the role fail at dispatch — see role.ts.
 *
 * NOTE: this helper composes WITH the feature-flag-driven gates in the
 * factory (security / a11y / visual-quality). Callers append those flag
 * results after invoking this. Keeping the helper minimal (just build-gate
 * + backend-artifact) makes it pure + trivially unit-testable; the factory
 * remains the single place where flags are read.
 */
export function buildPostDeveloperChain(targetTemplate: string | undefined): string[] {
  const chain = ["build-gate"];
  if (targetTemplate === "atlas-fastapi") chain.push("backend-artifact");
  return chain;
}
