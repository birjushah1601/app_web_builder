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
 *
 * NOTE: this hook owns the *manifest mode* dimension (designing/preview).
 * Plan UXO change 2 introduces a separate top-level workspace mode
 * (agent/plan/visual-edits) via `useCanvasMode` below — orthogonal axis,
 * persisted to localStorage per-project.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasManifest } from "@atlas/canvas-runtime";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { CanvasMode } from "@/components/canvas/ModeToolbar";

export type { CanvasMode };

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

/* -----------------------------------------------------------------------
 * Plan UXO change 2 — three-mode workspace toolbar.
 *
 * `useCanvasMode` owns the Agent/Plan/Visual-Edits dimension for one
 * project. Persisted to `localStorage["atlas-canvas-mode:" + projectId]`
 * so the user's last choice survives reloads and SSR transitions.
 *
 * Defaults to "agent" — that's today's behavior (conversation-driven).
 * Consumer wiring (which panels react to which mode) lands in later UXO
 * slices; for this commit the only consumer is <ModeToolbar /> itself.
 *
 * SSR-safe: `localStorage` is read inside a `useEffect`, so the initial
 * render returns the default and we hydrate the persisted value on the
 * client. Anything else trips React 19's hydration mismatch guard.
 * --------------------------------------------------------------------- */

export const DEFAULT_CANVAS_MODE: CanvasMode = "agent";
const VALID_MODES: ReadonlySet<CanvasMode> = new Set(["agent", "plan", "visual-edits"]);

export function canvasModeStorageKey(projectId: string): string {
  return `atlas-canvas-mode:${projectId}`;
}

export interface UseCanvasModeResult {
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
}

// Custom window event broadcast — every useCanvasMode consumer in the
// page listens for this and re-reads localStorage on fire. Without it,
// ModeToolbarHost's setMode call only updates its own useState; sibling
// consumers like CanvasPreviewClient (which gate the inspector + overlay
// on mode === "visual-edits") keep their stale local copy, so the
// inspector panel can stay visible after the user clicks "Agent". Window
// `storage` event only fires across tabs — same-window writes need a
// manual broadcast.
const CANVAS_MODE_EVENT = "atlas:canvas-mode-changed";

export function useCanvasMode(projectId: string): UseCanvasModeResult {
  const [mode, setModeState] = useState<CanvasMode>(DEFAULT_CANVAS_MODE);

  // Hydrate from localStorage on mount AND any time another consumer
  // (sibling component, ModeToolbarHost) writes a new value.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      try {
        const raw = window.localStorage.getItem(canvasModeStorageKey(projectId));
        if (raw && VALID_MODES.has(raw as CanvasMode)) {
          setModeState(raw as CanvasMode);
        }
      } catch {
        // localStorage can throw (private mode, quota, disabled). Silently
        // fall back to the default — the toolbar still works, it just won't
        // persist this session.
      }
    };
    sync();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (detail?.projectId === projectId) sync();
    };
    window.addEventListener(CANVAS_MODE_EVENT, handler);
    return () => window.removeEventListener(CANVAS_MODE_EVENT, handler);
  }, [projectId]);

  const setMode = useCallback(
    (next: CanvasMode) => {
      setModeState(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(canvasModeStorageKey(projectId), next);
        window.dispatchEvent(
          new CustomEvent(CANVAS_MODE_EVENT, { detail: { projectId } })
        );
      } catch {
        // Same swallow as above.
      }
    },
    [projectId]
  );

  return { mode, setMode };
}
