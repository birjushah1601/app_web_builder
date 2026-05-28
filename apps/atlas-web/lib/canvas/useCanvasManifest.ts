"use client";
/**
 * useCanvasManifest — keeps the latest CanvasManifest emitted by the
 * architect on this project's SSE stream.
 *
 * Subscribes (transitively, via useEventStream) to the EventSourceProvider
 * mounted by the project layout. Filters incoming events for
 * `architect.canvas_manifest.emitted`; the most recent one wins so a
 * subsequent ritual's manifest replaces an older one in-place.
 *
 * Failure-safe: if SSE is disabled (flag off) or no event ever arrives,
 * `manifest` stays `undefined`. The hook never throws on a malformed
 * payload — it logs and ignores.
 *
 * The `projectId` parameter is currently unused at runtime (the
 * EventSourceProvider already scopes the stream by project) but is part
 * of the contract so callers see the expected per-project subscription
 * surface and so a future broker that fans out across projects can use it
 * without a signature change.
 */
import { useMemo } from "react";
import type { CanvasManifest } from "@atlas/canvas-runtime";
import { useEventStream } from "@/lib/events/EventSourceProvider";

export interface UseCanvasManifestResult {
  manifest: CanvasManifest | undefined;
}

const EVENT_TYPE = "architect.canvas_manifest.emitted";

export function useCanvasManifest(
  _projectId: string,
  ritualId?: string
): UseCanvasManifestResult {
  const { events } = useEventStream();

  const manifest = useMemo<CanvasManifest | undefined>(() => {
    // Walk newest-first; the latest emitted manifest wins. When ritualId
    // is provided (workflow drill-in), only consider events for that
    // specific ritual — otherwise any newer ritual on the project would
    // bleed into the per-node view.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (!e || e.type !== EVENT_TYPE) continue;
      if (ritualId !== undefined && e.ritualId !== ritualId) continue;
      try {
        const payload = e.payload as { manifest?: unknown } | undefined;
        const candidate = payload?.manifest;
        if (
          candidate &&
          typeof candidate === "object" &&
          "artifactKind" in candidate &&
          "modes" in candidate &&
          Array.isArray((candidate as { modes: unknown }).modes)
        ) {
          return candidate as CanvasManifest;
        }
      } catch {
        // Malformed payload — fall through and try the next-older event.
      }
    }
    return undefined;
  }, [events, ritualId]);

  return { manifest };
}
