"use client";

import { useCallback, useEffect, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

const KEY = (projectId: string) => `atlas:timelineOpen:${projectId}`;

function readPersisted(projectId: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY(projectId));
    if (raw === null) return null;
    return raw === "true";
  } catch {
    return null;
  }
}

/** Manages the open/closed state of <RitualTimeline>'s <details> wrapper.
 *  Default: open. Auto-flips to closed on the first sandbox.apply.completed
 *  event we observe (the strip now carries the trust load). User toggles
 *  persist in sessionStorage so a manual expand sticks until the tab is
 *  closed; reload on a fresh tab returns to the default+auto-close logic. */
export function useTimelineCollapse(projectId: string) {
  const { events } = useEventStream();
  // Lazy initializer: reads sessionStorage synchronously on mount so that
  // the very first render already reflects a persisted user choice.
  // readPersisted guards against SSR (returns null when window is undefined).
  const [userChoice, setUserChoice] = useState<boolean | null>(() =>
    readPersisted(projectId)
  );

  // Re-sync when projectId changes (e.g. navigating between projects).
  useEffect(() => {
    setUserChoice(readPersisted(projectId));
  }, [projectId]);

  const setOpen = useCallback(
    (next: boolean) => {
      setUserChoice(next);
      try {
        window.sessionStorage.setItem(KEY(projectId), String(next));
      } catch {
        /* sessionStorage disabled — drop persistence */
      }
    },
    [projectId]
  );

  const sawApply = events.some((e) => e.type === "sandbox.apply.completed");
  const open = userChoice !== null ? userChoice : !sawApply;

  return { open, setOpen };
}
