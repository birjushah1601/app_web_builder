"use client";

/**
 * useTimelineState — React adapter that subscribes to Plan E.0's
 * EventSourceProvider via useEventStream() and folds the cumulative event
 * array through timelineReducer with useMemo.
 *
 * Why fold-from-scratch (not delta dispatch): useEventStream() owns the
 * event array; tracking a cursor here would duplicate that bookkeeping
 * and risk drift. Re-folding is O(events) per render and events is
 * bounded by the broker's 200-event ring buffer (Plan E.0). React batches
 * the renders. Cheaper than the alternative.
 *
 * The hook reads no props — the projectId is encoded in which provider
 * instance is in scope. Mount the right EventSourceProvider above this
 * hook (the canvas page does so when the live-events flag is on).
 */

import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { initialTimelineState, timelineReducer, type TimelineState, type Phase } from "@/lib/ritual/timelineReducer";

export type { Phase };

export function useTimelineState(): TimelineState {
  const { events } = useEventStream();
  return useMemo(() => events.reduce(timelineReducer, initialTimelineState), [events]);
}
