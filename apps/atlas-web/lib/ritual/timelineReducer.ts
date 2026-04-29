/**
 * timelineReducer — pure fold of one RitualEvent into TimelineState.
 *
 * Plan E owns this reducer. The hook (useTimelineState.ts) is a thin
 * React adapter over Plan E.0's useEventStream(); the components in
 * components/ritual/ render TimelineState. ALL business logic lives in
 * this file. No React imports here, no Date.now(), no fetch — only the
 * RitualEvent type from Plan E.0.
 *
 * Design: see Plan E header §Design Decisions.
 *   - Pure (state, event) => state, not (state, events[]) => state.
 *   - Unknown event types return state unchanged (default arm).
 *   - durationMs is computed at completion using event.ts - row.startedAt.
 *   - retries bumped only on role.retrying.
 */

import type { RitualEvent } from "@/lib/events/EventBroker";

export type Phase = "architect" | "developer" | "sandbox" | "security" | "accessibility";

export interface RowState {
  phase: Phase;
  status: "pending" | "active" | "done" | "failed";
  retries: number;
  lastError?: string;
  durationMs?: number;
  /** Wall-clock ms when the row entered "active". Used to compute
   *  durationMs at completion. Not surfaced in the rendered UI. */
  startedAt?: number;
  meta?: { winner?: string; filesWritten?: number };
}

export interface TimelineState {
  rows: Record<Phase, RowState>;
  escalated: boolean;
  /** Plan P: counter incremented on auto_fix.attempted; rendered as a
   *  "(auto-fix #N)" indicator in <RitualTimeline />. Reset by ritual.started. */
  autoFixAttempts: number;
  /** Plan P: true after auto_fix.budget_exhausted (MAX_FIX_ATTEMPTS reached). */
  autoFixExhausted: boolean;
  /** Plan P: error string from auto_fix.failed (LLM/conductor error during fix). */
  autoFixFailed?: string;
}

/** Frozen so React's strict-mode double-render and accidental mutations in
 *  tests both surface as TypeErrors instead of silent state corruption. */
export const initialTimelineState: TimelineState = Object.freeze({
  escalated: false,
  autoFixAttempts: 0,
  autoFixExhausted: false,
  rows: Object.freeze({
    architect:     Object.freeze({ phase: "architect"     as const, status: "pending" as const, retries: 0 }),
    developer:     Object.freeze({ phase: "developer"     as const, status: "pending" as const, retries: 0 }),
    sandbox:       Object.freeze({ phase: "sandbox"       as const, status: "pending" as const, retries: 0 }),
    security:      Object.freeze({ phase: "security"      as const, status: "pending" as const, retries: 0 }),
    accessibility: Object.freeze({ phase: "accessibility" as const, status: "pending" as const, retries: 0 })
  })
}) as TimelineState;

export function timelineReducer(state: TimelineState, event: RitualEvent): TimelineState {
  switch (event.type) {
    case "ritual.started":
      return initialTimelineState;

    case "ritual.escalated":
      if (state.escalated) return state;
      return { ...state, escalated: true };

    case "ritual.completed": {
      const newRows = { ...state.rows };
      let mutated = false;
      // For the 3 core phases, preserve the original behavior: flip ANY
      // non-failed/non-done row to done at completion (whether pending or
      // active). Cosmetic edits skip the developer + sandbox phases without
      // emitting started/completed for them — the ritual.completed terminal
      // event was the original signal to mark them done.
      for (const phase of ["architect", "developer", "sandbox"] as Phase[]) {
        const row = newRows[phase];
        if (row.status === "failed" || row.status === "done") continue;
        const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
        newRows[phase] = { ...row, status: "done", durationMs };
        mutated = true;
      }
      // For Plan I gate phases, only flip rows that actually saw an *.started
      // event (status === "active"). Pending rows mean the flag was off and
      // the gate didn't run — leave them pending so the UI hides them.
      for (const phase of ["security", "accessibility"] as Phase[]) {
        const row = newRows[phase];
        if (row.status !== "active") continue;
        const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
        newRows[phase] = { ...row, status: "done", durationMs };
        mutated = true;
      }
      return mutated ? { ...state, rows: newRows } : state;
    }

    case "role.started": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const next: RowState = { ...row, status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "role.completed": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const meta = extractMeta(event.payload);
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      const next: RowState = {
        ...row,
        status: "done",
        durationMs,
        ...(meta ? { meta } : {})
      };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "role.failed": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const errorVal = event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      const next: RowState = { ...row, status: "failed", lastError, durationMs };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "role.retrying": {
      const phase = phaseFromPayload(event.payload);
      if (phase === null) return state;
      const row = state.rows[phase];
      const errorVal = event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const next: RowState = { ...row, retries: row.retries + 1, lastError };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "sandbox.provisioning": {
      const row = state.rows.sandbox;
      const next: RowState = { ...row, status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "sandbox.provisioned": {
      // Provisioned is a milestone, not a finish — the row stays active until
      // sandbox.apply.completed. We keep startedAt sticky so duration covers
      // the full provision-to-apply window.
      const row = state.rows.sandbox;
      if (row.status === "active") return state; // no transition; preserve reference
      const next: RowState = { ...row, status: "active" };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "sandbox.apply.started": {
      const row = state.rows.sandbox;
      // Activate only if not already active. If active (e.g. from provisioning)
      // keep the original startedAt so duration covers the entire window.
      if (row.status === "active") return state;
      const next: RowState = { ...row, status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "sandbox.apply.completed": {
      const row = state.rows.sandbox;
      const ok = event.payload.ok === true;
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      if (ok) {
        const filesWrittenVal = event.payload.filesWritten;
        const meta = typeof filesWrittenVal === "number" ? { filesWritten: filesWrittenVal } : row.meta;
        const next: RowState = {
          ...row,
          status: "done",
          durationMs,
          ...(meta ? { meta } : {})
        };
        return { ...state, rows: { ...state.rows, sandbox: next } };
      }
      const errorVal = event.payload.parseError ?? event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const next: RowState = { ...row, status: "failed", lastError, durationMs };
      return { ...state, rows: { ...state.rows, sandbox: next } };
    }

    case "security.started":
    case "accessibility.started": {
      const phase = (event.type === "security.started" ? "security" : "accessibility") as Phase;
      const next: RowState = { ...state.rows[phase], status: "active", startedAt: event.ts };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "security.completed":
    case "accessibility.completed": {
      const phase = (event.type === "security.completed" ? "security" : "accessibility") as Phase;
      const row = state.rows[phase];
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      const next: RowState = { ...row, status: "done", durationMs };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "security.failed":
    case "accessibility.failed": {
      const phase = (event.type === "security.failed" ? "security" : "accessibility") as Phase;
      const row = state.rows[phase];
      const errorVal = event.payload.error;
      const lastError = typeof errorVal === "string" ? errorVal : row.lastError;
      const durationMs = row.startedAt !== undefined ? event.ts - row.startedAt : row.durationMs;
      const next: RowState = { ...row, status: "failed", lastError, durationMs };
      return { ...state, rows: { ...state.rows, [phase]: next } };
    }

    case "ritual.escalation_requested":
      // Plan I emits this on gate failure; treat as escalation for the rail.
      if (state.escalated) return state;
      return { ...state, escalated: true };

    case "auto_fix.attempted":
      return { ...state, autoFixAttempts: state.autoFixAttempts + 1 };

    case "auto_fix.budget_exhausted":
      return { ...state, autoFixExhausted: true };

    case "auto_fix.failed": {
      const error = (event.payload.error as string | undefined) ?? "unknown";
      return { ...state, autoFixFailed: error };
    }

    default:
      return state;
  }
}

/** Read payload.role and narrow it to "architect" | "developer". Sandbox
 *  events come in via the sandbox.* type prefixes, never as role.* with
 *  role=sandbox, so this returns null for "sandbox" or any other value. */
function phaseFromPayload(payload: Record<string, unknown>): "architect" | "developer" | null {
  const r = payload.role;
  if (r === "architect" || r === "developer") return r;
  return null;
}

/** Pluck the spec-listed meta fields (winner, filesWritten) out of the
 *  event payload. Returns undefined when neither is present so the
 *  reducer can skip writing a meta key. */
function extractMeta(payload: Record<string, unknown>): RowState["meta"] | undefined {
  const winner = typeof payload.winner === "string" ? payload.winner : undefined;
  const filesWritten = typeof payload.filesWritten === "number" ? payload.filesWritten : undefined;
  if (winner === undefined && filesWritten === undefined) return undefined;
  return { ...(winner !== undefined ? { winner } : {}), ...(filesWritten !== undefined ? { filesWritten } : {}) };
}
