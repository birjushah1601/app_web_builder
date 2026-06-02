/**
 * Extracts the typed artifact a role emitted via `ritual.artifact_emitted`
 * from a RoleOutput. Returns undefined when:
 *   - input isn't a RoleOutput-shaped object
 *   - no `ritual.artifact_emitted` event exists
 *   - the event's payload lacks an `artifact` field
 *
 * Used by the conductor's eval gate to bridge the contract gap between
 * `role.run()` returning `{events, diff}` and producer-role rubrics
 * (iac/deployer/tester/backend-artifact) declaring `Rubric<TArtifact>`.
 * The conductor calls this before invoking the rubric's structural/judge;
 * if extraction succeeds, the typed artifact is passed; if not, the
 * original RoleOutput flows through (today's behaviour for non-producer
 * roles like developer).
 */
export function extractEmittedArtifact(output: unknown): unknown | undefined {
  if (!output || typeof output !== "object") return undefined;
  const events = (output as { events?: unknown }).events;
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || typeof ev !== "object") continue;
    if ((ev as { eventType?: unknown }).eventType !== "ritual.artifact_emitted") continue;
    const payload = (ev as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object") continue;
    const artifact = (payload as { artifact?: unknown }).artifact;
    if (artifact !== undefined) return artifact;
  }
  return undefined;
}
