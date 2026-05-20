"use client";

import { useEffect, useState } from "react";

export interface ThreadRitual {
  ritualId?: string;
  parentRitualId?: string;
  artifact?: unknown;
  developerOutput?: { diff: string; summary?: string };
  state?: string;
}

export interface UseRefinementThreadResult {
  thread: ThreadRitual[];
  loading: boolean;
  error: Error | null;
  /** Manual re-fetch (call after a successful refineRitual). */
  refresh: () => void;
}

export function useRefinementThread(
  projectId: string,
  ritualId: string | null
): UseRefinementThreadResult {
  const [thread, setThread] = useState<ThreadRitual[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ritualId) {
      setThread([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/ritual/${encodeURIComponent(ritualId)}/thread`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = await res.json();
        if (!cancelled) setThread(body.thread ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, ritualId, tick]);

  return { thread, loading, error, refresh: () => setTick((t) => t + 1) };
}
