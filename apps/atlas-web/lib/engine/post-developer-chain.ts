/**
 * Plan D Task 6 — Tail-only helper that decides whether the typed-artifact
 * emitter (`backend-artifact`) joins the postDeveloperChain.
 *
 * Returns ONLY the backend-artifact tail (or an empty array). The caller
 * (factory.ts) is responsible for appending this AFTER every gate flag
 * (build-gate, security, accessibility, visual-quality) has been pushed,
 * so that gate failures escalate-and-stop the chain BEFORE artifact
 * emission. ritual-engine's contract (`EngineOptions.postDeveloperChain`,
 * around lines 36-41 of `packages/ritual-engine/src/engine.ts`) is: "A
 * gate-failing role (report.passed === false) escalates the ritual and
 * stops the chain." If we emitted backend-artifact before the gates ran,
 * we could end up with a typed BackendArtifact attached to a node that's
 * about to be marked failed — artifact-emitted ≠ ritual-succeeded.
 *
 * The chain remains template-conditional rather than artifactKind-conditional
 * because the sandbox template is what determines whether the running app
 * actually exposes the HTTP surface BackendArtifactRole probes (i.e.
 * /health). Mixing in any non-FastAPI template would make the role fail at
 * dispatch — see role.ts.
 *
 * Emission is INDEPENDENT of `ATLAS_FF_BUILD_GATE`. If operators disable
 * every gate flag, the chain for an atlas-fastapi ritual becomes simply
 * `["backend-artifact"]`, which is correct — artifacts are emitted from
 * raw developer output and don't depend on the compiler having run first.
 */
export function backendArtifactChainTail(targetTemplate: string | undefined): string[] {
  return targetTemplate === "atlas-fastapi" ? ["backend-artifact"] : [];
}
