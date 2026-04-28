import type { RitualSnapshot, RoleEventRecord } from "./engine.js";

/** Minimal shape we depend on from spec_events rows — keeps the package
 *  free of a hard import on @atlas/spec-graph-data. */
export interface SpecEventRowLike {
  id: bigint;
  eventType: string;
  payload: unknown;
  actor: string | null;
}

/**
 * Folds a list of spec_events rows back into a RitualSnapshot. Pure
 * function — no I/O. Caller (typically a RitualHydrator) is responsible
 * for fetching and ordering the rows by id ASC.
 *
 * Returns null when:
 *  - rows is empty, OR
 *  - the first row is NOT a ritual.started event (corruption / partial truncation), OR
 *  - the ritual.started payload lacks projectId / userId
 */
export function replayEventsToSnapshot(rows: SpecEventRowLike[]): RitualSnapshot | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  if (first.eventType !== "ritual.started") return null;
  const startPayload = first.payload as { projectId?: string; userId?: string };
  if (!startPayload.projectId || !startPayload.userId) return null;

  const snapshot: RitualSnapshot = {
    state: "visualize",
    projectId: startPayload.projectId,
    userId: startPayload.userId,
    roleEvents: []
  };

  for (let i = 1; i < rows.length; i++) {
    applyOne(snapshot, rows[i]!);
  }
  return snapshot;
}

function applyOne(snap: RitualSnapshot, r: SpecEventRowLike): void {
  const t = r.eventType;
  const p = r.payload as Record<string, unknown> | undefined;

  if (t.endsWith(".pass2.completed") && p && "artifact" in p) {
    snap.artifact = p.artifact;
  } else if (t === "developer.completed" && p) {
    snap.developerOutput = {
      diff: typeof p.diff === "string" ? p.diff : "",
      summary: typeof p.summary === "string" ? p.summary : undefined
    };
  } else if (t === "sandbox.apply.completed" && p) {
    snap.sandboxApplyResult = {
      ok: Boolean(p.ok),
      parsed:  Number(p.parsed  ?? 0),
      written: Number(p.written ?? 0),
      failed:  Number(p.failed  ?? 0),
      skipped: Number(p.skipped ?? 0),
      files:  Array.isArray(p.files) ? (p.files as never[]) : [],
      parseError: typeof p.parseError === "string" ? p.parseError : undefined
    };
  } else if (t === "ritual.escalated") {
    snap.state = "escalated";
  } else if (t === "ritual.completed") {
    // RitualStateSchema enum value for the "ritual finished" terminal state is "done".
    snap.state = "done";
  }

  if (t.startsWith("role.") || t.startsWith("architect.") || t.startsWith("developer.")) {
    const rec: RoleEventRecord = { eventType: t, payload: r.payload };
    snap.roleEvents.push(rec);
  }
}

/** Atlas-web (or any consumer) wires this implementation against its
 *  storage to give the engine a fallback for getRitual on in-memory miss.
 *  When omitted, getRitual returns undefined for unknown ritualIds (today's
 *  in-memory-only behavior). */
export interface RitualHydrator {
  /** Returns the snapshot for ritualId by replaying historical events.
   *  Returns null when the ritualId is unknown OR when replay fails — the
   *  implementation logs and swallows so callers can treat this as a clean
   *  "not found". */
  hydrate(ritualId: string): Promise<RitualSnapshot | null>;
}
