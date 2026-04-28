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

export type Phase = "architect" | "developer" | "sandbox";

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
}

/** Frozen so React's strict-mode double-render and accidental mutations in
 *  tests both surface as TypeErrors instead of silent state corruption. */
export const initialTimelineState: TimelineState = Object.freeze({
  escalated: false,
  rows: Object.freeze({
    architect: Object.freeze({ phase: "architect" as const, status: "pending" as const, retries: 0 }),
    developer: Object.freeze({ phase: "developer" as const, status: "pending" as const, retries: 0 }),
    sandbox:   Object.freeze({ phase: "sandbox"   as const, status: "pending" as const, retries: 0 })
  })
}) as TimelineState;

/** Pure reducer. Returns the same reference when no transition applies so
 *  React's `useReducer` skips a re-render. Real transitions land in
 *  Tasks 3 + 4; this stub handles only unknown event types. */
export function timelineReducer(state: TimelineState, event: RitualEvent): TimelineState {
  switch (event.type) {
    default:
      return state;
  }
}
