"use client";
/**
 * useCanvasState — owns the canvas's active mode for one ritual.
 *
 * - Initial mode comes from the manifest's `default: true` mode (or the
 *   first mode if no default is set).
 * - Two events from the broker auto-switch the active mode:
 *     • `canvas.options.requested` → switch to "designing"
 *     • `sandbox.apply.completed`  → switch to "preview"
 *   This means the user sees the right canvas surface as the ritual
 *   progresses without lifting a finger.
 * - Manual override (setActiveMode) is sticky for the lifetime of the
 *   hook — once the user picks a mode, no auto-switch overrides them.
 *
 * Pure-ish: the hook listens to `useEventStream()` from
 * EventSourceProvider but takes no other side effects.
 */
import { useEffect, useRef, useState } from "react";
import type { CanvasManifest } from "@atlas/canvas-runtime";
import { useEventStream } from "@/lib/events/EventSourceProvider";

export interface UseCanvasStateInput {
  manifest: CanvasManifest | undefined;
}

export interface UseCanvasStateResult {
  activeMode: string;
  setActiveMode: (id: string) => void;
}

const EVENT_TO_MODE: Record<string, string> = {
  "canvas.options.requested": "designing",
  "sandbox.apply.completed": "preview"
};

function defaultModeFor(manifest: CanvasManifest | undefined): string {
  if (!manifest || manifest.modes.length === 0) return "";
  return manifest.modes.find((m) => m.default)?.id ?? manifest.modes[0]!.id;
}

export function useCanvasState({ manifest }: UseCanvasStateInput): UseCanvasStateResult {
  const initial = defaultModeFor(manifest);
  const [activeMode, setActiveModeState] = useState<string>(initial);
  const overrideRef = useRef<boolean>(false);
  const lastSeenIdRef = useRef<string | null>(null);

  const { events } = useEventStream();

  useEffect(() => {
    if (events.length === 0) return;
    // Walk only newly-arrived events since the last time we ran. For the
    // disabled / mocked stream we re-derive on every render which is cheap
    // (the events array is stable when the broker is disabled).
    let lastConsumed = lastSeenIdRef.current;
    let nextActive: string | undefined;
    for (const e of events) {
      if (lastConsumed !== null && e.id === lastConsumed) {
        // skip until we pass the last-consumed marker
        lastConsumed = null;
        continue;
      }
      if (lastConsumed !== null) continue;
      const target = EVENT_TO_MODE[e.type as string];
      if (target) nextActive = target;
    }
    lastSeenIdRef.current = events[events.length - 1]!.id;

    if (nextActive && !overrideRef.current) {
      // Only auto-switch when the manifest actually has the target mode —
      // otherwise we'd render an empty <CanvasShell>.
      const targetExists = manifest?.modes.some((m) => m.id === nextActive);
      if (targetExists) setActiveModeState(nextActive);
    }
  }, [events, manifest]);

  return {
    activeMode,
    setActiveMode: (id: string) => {
      overrideRef.current = true;
      setActiveModeState(id);
    }
  };
}
