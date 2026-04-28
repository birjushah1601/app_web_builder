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
  const [toast] = useState<string | null>(null);

  // Tracks how many events from the cumulative `events` array we have
  // already folded into our state. Re-renders without new events are
  // a no-op (start === events.length means the slice is empty).
  const processedCountRef = useRef<number>(0);
  // The pending debounce timer. We cancel-and-reschedule on every new
  // success event so a burst coalesces into one trailing reload.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The id of the most recent ok:true event in the current debounce
  // window. The timer's callback writes this into cacheBuster.
  const pendingEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (events.length <= processedCountRef.current) return;

    const newEvents = events.slice(processedCountRef.current);
    processedCountRef.current = events.length;

    for (const ev of newEvents) {
      if (!isApplyCompleted(ev)) continue;
      const ok = (ev.payload as { ok?: unknown }).ok === true;
      if (ok) {
        // Schedule (or reschedule) the debounced cacheBuster update.
        pendingEventIdRef.current = ev.id;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          const id = pendingEventIdRef.current;
          if (id !== null) setCacheBuster(id);
          debounceTimerRef.current = null;
          pendingEventIdRef.current = null;
        }, DEBOUNCE_MS);
      }
    }
  }, [events]);

  // Unmount cleanup — clear any pending debounce so it does not fire after
  // the consumer has gone away.
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
