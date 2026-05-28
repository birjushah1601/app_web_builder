"use client";
/**
 * useDesignerProposal — keeps the latest DesignProposal + ritualId emitted
 * via `canvas.options.requested` on this project's SSE stream.
 *
 * The engine's canvas pause path emits `canvas.options.requested` with
 * `{ proposal, manifest }`; this hook hands the proposal back to
 * CanvasShellWired which routes it into <DesignerCanvas> as the
 * `designing`-mode renderer prop. A user click on a card triggers the
 * `selectDesignDirection` Server Action with `{ ritualId, directionId }`
 * — that's why we need ritualId paired with the proposal.
 *
 * Failure-safe: if the SSE stream is disabled or the event never arrives,
 * the hook returns `{ ritualId: null, proposal: null }`.
 *
 * `projectId` is unused at runtime today (EventSourceProvider scopes the
 * stream); kept in the signature to match useCanvasManifest and to leave
 * room for a future cross-project broker.
 */
import { useMemo } from "react";
import type { DesignProposal } from "@atlas/role-designer";
import { useEventStream } from "@/lib/events/EventSourceProvider";

export type UseDesignerProposalResult =
  | { ritualId: string; proposal: DesignProposal }
  | { ritualId: null; proposal: null };

const EVENT_TYPE = "canvas.options.requested";

export function useDesignerProposal(
  _projectId: string,
  ritualId?: string
): UseDesignerProposalResult {
  const { events } = useEventStream();

  return useMemo<UseDesignerProposalResult>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (!e || e.type !== EVENT_TYPE) continue;
      // When ritualId is provided (workflow drill-in), only surface
      // proposals for that specific ritual.
      if (ritualId !== undefined && e.ritualId !== ritualId) continue;
      try {
        const payload = e.payload as { proposal?: unknown } | undefined;
        const candidate = payload?.proposal;
        if (
          candidate &&
          typeof candidate === "object" &&
          "recommended" in candidate &&
          "alternates" in candidate
        ) {
          return {
            ritualId: e.ritualId,
            proposal: candidate as DesignProposal
          };
        }
      } catch {
        // Malformed payload — try the next-older event.
      }
    }
    return { ritualId: null, proposal: null };
  }, [events, ritualId]);
}
