import type { RoleEventRecord, DeveloperOutputRecord } from "./engine.js";

/** Plan K: snapshot-derived context the architect role consumes when
 *  the user submits a refinement. The discriminator (`kind: "priorRitual"`)
 *  lets consumers distinguish this shape from other priorArtifact payloads
 *  flowing through Conductor.dispatch. */
export interface PriorRitualContext {
  readonly kind: "priorRitual";
  parentRitualId: string;
  parentArtifact?: unknown;
  parentDeveloperOutput?: DeveloperOutputRecord;
  parentRoleEvents?: RoleEventRecord[];
}

const DIFF_TRUNCATE_MAX = 8000;

/** Construct a PriorRitualContext from a parent ritual's snapshot fields.
 *  Truncates the parent diff to DIFF_TRUNCATE_MAX chars (head 4k + tail 4k
 *  with elision marker) so the architect's prompt budget stays manageable
 *  even for large diffs. */
export function buildPriorRitualContext(input: {
  ritualId: string;
  artifact?: unknown;
  developerOutput?: DeveloperOutputRecord;
  roleEvents?: RoleEventRecord[];
}): PriorRitualContext {
  let parentDeveloperOutput = input.developerOutput;
  if (parentDeveloperOutput && parentDeveloperOutput.diff.length > DIFF_TRUNCATE_MAX) {
    const head = parentDeveloperOutput.diff.slice(0, DIFF_TRUNCATE_MAX / 2);
    const tail = parentDeveloperOutput.diff.slice(-DIFF_TRUNCATE_MAX / 2);
    const elided = parentDeveloperOutput.diff.length - DIFF_TRUNCATE_MAX;
    parentDeveloperOutput = {
      diff: `${head}\n... [${elided} chars elided] ...\n${tail}`,
      summary: parentDeveloperOutput.summary
    };
  }
  return {
    kind: "priorRitual",
    parentRitualId: input.ritualId,
    parentArtifact: input.artifact,
    parentDeveloperOutput,
    parentRoleEvents: input.roleEvents
  };
}

export function isPriorRitualContext(value: unknown): value is PriorRitualContext {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).kind === "priorRitual"
  );
}
