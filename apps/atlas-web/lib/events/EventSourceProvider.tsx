"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { RitualEvent } from "./EventBroker";

/** Stream lifecycle state, surfaced via useEventStream so consumers can
 *  render reconnect indicators / error banners. */
export type EventStreamStatus = "disabled" | "connecting" | "open" | "error" | "closed";

interface EventStreamValue {
  events: RitualEvent[];
  status: EventStreamStatus;
  lastEventId: string | null;
}

const Ctx = createContext<EventStreamValue>({
  events: [],
  status: "disabled",
  lastEventId: null
});

interface ProviderProps {
  projectId: string;
  /** Result of `isFeatureEnabled("live-events")` — pulled in by the parent
   *  layout from feature-flags.ts, NOT read here so the provider stays
   *  pure (test-friendly, no env reads in component code). */
  flagEnabled: boolean;
  /** Bug D17 fix: server-fetched recent events for the project (e.g. from
   *  SpecEventRepo), seeded into state so the UI is not blank on canvas
   *  mount when a ritual already ran. Optional; defaults to []. The flag-off
   *  path still honors this for SSR snapshots even though SSE never opens. */
  initialEvents?: RitualEvent[];
  children: React.ReactNode;
}

/** EventSourceProvider — mounts (or skip-mounts) one EventSource per
 *  projectId. Flag-off path is a literal no-op: renders children, returns
 *  the disabled context value (seeded with initialEvents when provided).
 *  Flag-on path opens the SSE connection, collects messages into state,
 *  and surfaces lifecycle status.
 *
 *  Re-keys on projectId change (the EventSource closes + a fresh one
 *  opens). The browser auto-reconnects with Last-Event-ID per HTML spec
 *  on transient errors; we don't manually reconnect.
 *
 *  Dedupe (bug D17): the broker's in-memory ring buffer is replayed on
 *  first SSE connect; if those events overlap with initialEvents OR if
 *  the same id arrives twice on stream, we skip rather than append. The
 *  seen-id set is initialised from initialEvents on mount. We track by
 *  event.id because (a) the broker assigns stable per-process ids, and
 *  (b) the layout assigns a stable `${projectId}:db-${rowId}` id to
 *  initialEvents so SSE replays of the same logical event collide. */
export function EventSourceProvider({
  projectId,
  flagEnabled,
  initialEvents,
  children
}: ProviderProps) {
  const [events, setEvents] = useState<RitualEvent[]>(() => initialEvents ?? []);
  const [status, setStatus] = useState<EventStreamStatus>(flagEnabled ? "connecting" : "disabled");
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // Track ids we've already surfaced so SSE replays of the same logical
  // event (whether from initialEvents seed OR the broker buffer's first-
  // connect replay) don't duplicate. Ref instead of state because the
  // dedupe check must read the CURRENT value inside the onmessage closure
  // — useState would close over the value at effect creation.
  const seenIds = useRef<Set<string>>(new Set((initialEvents ?? []).map((e) => e.id)));

  useEffect(() => {
    if (!flagEnabled) {
      setStatus("disabled");
      return;
    }
    setStatus("connecting");
    const es = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/events`);
    esRef.current = es;

    es.onopen = () => setStatus("open");
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as RitualEvent;
        // Skip events we've already shown (initialEvents seed OR earlier
        // SSE message with the same id — e.g. broker ring-buffer replay
        // overlapping with the live tail).
        if (parsed.id && seenIds.current.has(parsed.id)) {
          if (ev.lastEventId) setLastEventId(ev.lastEventId);
          return;
        }
        if (parsed.id) seenIds.current.add(parsed.id);
        setEvents((prev) => [...prev, parsed]);
        if (ev.lastEventId) setLastEventId(ev.lastEventId);
      } catch {
        // Malformed frame — drop it. The keepalive comment lines never
        // reach onmessage (they have no `data:` field) so this branch
        // only fires on genuinely broken JSON.
      }
    };
    es.onerror = () => setStatus("error");

    return () => {
      es.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [projectId, flagEnabled]);

  return <Ctx.Provider value={{ events, status, lastEventId }}>{children}</Ctx.Provider>;
}

/** Hook for any descendant — returns the live stream snapshot. Outside
 *  the provider returns the disabled value. Plan E and Plan F consume
 *  this hook for their own derived state (timeline reducer, reload-on-
 *  applied debouncer). */
export function useEventStream(): EventStreamValue {
  return useContext(Ctx);
}
