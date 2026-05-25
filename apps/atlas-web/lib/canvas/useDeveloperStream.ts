"use client";
/**
 * useDeveloperStream — accumulates the streaming developer-candidate text
 * from SSE `developer.candidate.delta` events. The proxy sends a JSON
 * document as content (because it drops the `tools` array), so the
 * accumulated text is the in-progress JSON. We don't try to parse it
 * here — the consuming component just renders the raw growing text, which
 * gives the user immediate "code is being typed" feedback even though
 * the text is technically JSON-wrapped.
 *
 * State resets every time a new ritualId starts emitting deltas — so a
 * fresh ritual doesn't render leftover bytes from the previous one.
 *
 * Returns `null` when no deltas have arrived for the current ritual yet
 * (component renders nothing). Once any delta arrives, returns the
 * accumulated text + the source ritualId.
 */
import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

const DELTA_TYPE = "developer.candidate.delta";
const COMPLETED_TYPE = "developer.completed";

export type UseDeveloperStreamResult = { ritualId: string; text: string } | null;

export function useDeveloperStream(): UseDeveloperStreamResult {
  const { events } = useEventStream();

  return useMemo<UseDeveloperStreamResult>(() => {
    // Find the most recent ritualId that has at least one delta event.
    let activeRitualId: string | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === DELTA_TYPE) {
        activeRitualId = events[i]!.ritualId;
        break;
      }
    }
    if (!activeRitualId) return null;

    // If developer.completed for this ritual has landed AFTER the latest
    // delta, the stream is done — hide the streaming card so the chat's
    // final developer-output card takes over.
    let latestDeltaIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e && e.type === DELTA_TYPE && e.ritualId === activeRitualId) {
        latestDeltaIdx = i;
        break;
      }
    }
    for (let j = latestDeltaIdx + 1; j < events.length; j++) {
      const e = events[j];
      if (e && e.type === COMPLETED_TYPE && e.ritualId === activeRitualId) {
        return null;
      }
    }

    // Accumulate all deltas for this ritual in order.
    let text = "";
    for (const e of events) {
      if (!e || e.type !== DELTA_TYPE || e.ritualId !== activeRitualId) continue;
      const payload = e.payload as { chunk?: unknown } | undefined;
      if (typeof payload?.chunk === "string") text += payload.chunk;
    }
    if (text.length === 0) return null;
    return { ritualId: activeRitualId, text };
  }, [events]);
}
