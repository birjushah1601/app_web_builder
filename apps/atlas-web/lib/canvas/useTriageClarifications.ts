"use client";
/**
 * useTriageClarifications — Plan U slice 3b.
 *
 * Watches the project's live SSE stream for the engine's triage-pause
 * lifecycle:
 *   - `ritual.triage.awaiting_clarification` → engine paused; surface the
 *     questions to the user via <TriageClarificationsLive>.
 *   - `ritual.triage.clarification_resolved` → pause resolved (user
 *     submitted answers OR the pause timed out); dismiss the form.
 *
 * Returns the latest UNRESOLVED awaiting event's questions + ritualId,
 * or `null` when there's nothing pending. Designed to be safe to render
 * anywhere inside <EventSourceProvider> — outside the provider it returns
 * null and produces no UI.
 */
import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

export interface TriageClarificationQuestion {
  id: string;
  question: string;
  reason?: string;
  widgetKind?: "yes-no" | "single-select" | "text";
  options?: ReadonlyArray<string>;
}

export type UseTriageClarificationsResult =
  | { ritualId: string; questions: ReadonlyArray<TriageClarificationQuestion> }
  | null;

const AWAIT_TYPE = "ritual.triage.awaiting_clarification";
const RESOLVED_TYPE = "ritual.triage.clarification_resolved";

export function useTriageClarifications(): UseTriageClarificationsResult {
  const { events } = useEventStream();

  return useMemo<UseTriageClarificationsResult>(() => {
    // Walk backwards to find the LATEST awaiting event. If a resolved event
    // for the same ritualId appears AFTER that awaiting event, the pause is
    // already done — return null.
    let latestAwaitIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === AWAIT_TYPE) {
        latestAwaitIdx = i;
        break;
      }
    }
    if (latestAwaitIdx === -1) return null;

    const awaitEv = events[latestAwaitIdx]!;
    const ritualId = awaitEv.ritualId;

    // Look for a resolved event for the SAME ritualId at any later index.
    for (let j = latestAwaitIdx + 1; j < events.length; j++) {
      const e = events[j];
      if (e && e.type === RESOLVED_TYPE && e.ritualId === ritualId) {
        return null;
      }
    }

    const payload = awaitEv.payload as { questions?: unknown } | undefined;
    const rawQuestions = Array.isArray(payload?.questions) ? payload!.questions : [];
    const questions: TriageClarificationQuestion[] = [];
    for (const q of rawQuestions) {
      if (!q || typeof q !== "object") continue;
      const r = q as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : undefined;
      const question = typeof r.question === "string" ? r.question : undefined;
      if (!id || !question) continue;
      const out: TriageClarificationQuestion = { id, question };
      if (typeof r.reason === "string") out.reason = r.reason;
      if (r.widgetKind === "yes-no" || r.widgetKind === "single-select" || r.widgetKind === "text") {
        out.widgetKind = r.widgetKind;
      }
      if (Array.isArray(r.options)) {
        const opts = r.options.filter((o): o is string => typeof o === "string");
        if (opts.length > 0) out.options = opts;
      }
      questions.push(out);
    }
    if (questions.length === 0) return null;
    return { ritualId, questions };
  }, [events]);
}
