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
  // Initial state must be deterministic across SSR + first client render to
  // avoid a hydration mismatch on the <details open={...}> attribute — the
  // server has no sessionStorage so SSR sees `null`, but a useState lazy
  // initializer that calls readPersisted would diverge on the client because
  // sessionStorage IS available there. Initialize to `null` everywhere and
  // hydrate the persisted value in an effect.
  const [userChoice, setUserChoice] = useState<boolean | null>(null);

  // Hydrate from sessionStorage after mount, and re-sync when projectId changes.
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
