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
  } else if (t === "security.completed" && p && "report" in p) {
    // Plan I follow-up: capture security gate report on replay.
    snap.securityReport = p.report;
  } else if (t === "accessibility.completed" && p && "report" in p) {
    // Plan I follow-up: capture accessibility gate report on replay.
    snap.accessibilityReport = p.report;
  } else if (t === "ritual.escalation_requested" || t === "ritual.escalated") {
    // Plan I emits ritual.escalation_requested when a chained gate fails;
    // ritual.escalated is the legacy terminal-state event name.
    snap.state = "escalated";
  } else if (t === "ritual.completed") {
    // RitualStateSchema enum value for the "ritual finished" terminal state is "done".
    snap.state = "done";
  } else if (t === "auto_fix.attempted") {
    // Plan P follow-up: fixAttempts increments on each auto-fix attempt.
    // The engine sets fixAttempts on the CHILD ritual when triggering the
    // loop (via _runRitual({ ..., fixAttempts: nextAttempt })), so a single
    // ritual's spec_events stream sees ONE auto_fix.attempted at most. We
    // increment defensively in case of future multi-attempt rituals.
    snap.fixAttempts = (snap.fixAttempts ?? 0) + 1;
  }

  if (
    t.startsWith("role.") ||
    t.startsWith("architect.") ||
    t.startsWith("developer.") ||
    t.startsWith("security.") ||
    t.startsWith("accessibility.") ||
    t.startsWith("auto_fix.")
  ) {
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
