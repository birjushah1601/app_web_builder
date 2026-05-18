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
  children: React.ReactNode;
}

/** EventSourceProvider — mounts (or skip-mounts) one EventSource per
 *  projectId. Flag-off path is a literal no-op: renders children, returns
 *  the disabled context value. Flag-on path opens the SSE connection,
 *  collects messages into state, and surfaces lifecycle status.
 *
 *  Re-keys on projectId change (the EventSource closes + a fresh one
 *  opens). The browser auto-reconnects with Last-Event-ID per HTML spec
 *  on transient errors; we don't manually reconnect. */
export function EventSourceProvider({ projectId, flagEnabled, children }: ProviderProps) {
  const [events, setEvents] = useState<RitualEvent[]>([]);
  const [status, setStatus] = useState<EventStreamStatus>(flagEnabled ? "connecting" : "disabled");
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

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
