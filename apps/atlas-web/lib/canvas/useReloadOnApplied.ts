"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { RitualEvent } from "@/lib/events/EventBroker";

/** Query-string key used to bust the iframe's HTTP cache. Namespaced so it
 *  cannot collide with a query param the user's preview app cares about.
 *  Mandated by spec line 147 of 2026-04-28-live-events-and-preview-reload-design.md. */
export const RELOAD_PARAM = "atlas-reload";

/** Debounce window for successful applies. A burst of N apply.completed
 *  events within this window coalesces into ONE iframe reload — chosen
 *  empirically: under 500ms the iframe sees too many redundant reloads;
 *  over 500ms the user starts to feel the lag. */
const DEBOUNCE_MS = 500;

export interface ReloadOnAppliedValue {
  cacheBuster: string;
  toast: string | null;
  manualReload: () => void;
}

export function useReloadOnApplied(_projectId: string): ReloadOnAppliedValue {
  const { events } = useEventStream();

  const [cacheBuster, setCacheBuster] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  const processedCountRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (events.length <= processedCountRef.current) return;

    const newEvents = events.slice(processedCountRef.current);
    processedCountRef.current = events.length;

    for (const ev of newEvents) {
      if (!isApplyCompleted(ev)) continue;
      const ok = (ev.payload as { ok?: unknown }).ok === true;
      if (ok) {
        // Success: clear any prior failure toast immediately + schedule a
        // debounced cacheBuster update. Burst-coalescing comes from
        // cancel-and-reschedule.
        setToast(null);
        pendingEventIdRef.current = ev.id;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          const id = pendingEventIdRef.current;
          if (id !== null) setCacheBuster(id);
          debounceTimerRef.current = null;
          pendingEventIdRef.current = null;
        }, DEBOUNCE_MS);
      } else {
        // Failure: surface the toast NOW (no debounce — the user wants to
        // see the failure immediately) and CRUCIALLY do not touch
        // cacheBuster, so the iframe keeps showing the last working page.
        setToast(deriveToastText(ev.payload));
      }
    }
  }, [events]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const manualReload = useCallback(() => {
    setCacheBuster(String(Date.now()));
  }, []);

  return { cacheBuster, toast, manualReload };
}

function isApplyCompleted(ev: RitualEvent): boolean {
  return ev.type === "sandbox.apply.completed";
}

/** Pick the most-informative human-readable string from an ok:false
 *  apply payload. Order: parseError (set when the diff itself was
 *  malformed), then "Last apply failed: <first-failed-file-path>" (set
 *  when one or more file ops failed during apply), then a flat
 *  "Last apply failed." fallback so the toast is never an empty string. */
function deriveToastText(payload: Record<string, unknown>): string {
  const parseError = payload.parseError;
  if (typeof parseError === "string" && parseError.length > 0) return parseError;
  const files = payload.files;
  if (Array.isArray(files)) {
    const failed = files.find(
      (f): f is { path: string; status: string } =>
        typeof f === "object" && f !== null &&
        typeof (f as { path?: unknown }).path === "string" &&
        (f as { status?: unknown }).status === "failed"
    );
    if (failed) return `Last apply failed: ${failed.path}`;
  }
  return "Last apply failed.";
}
