"use client";
/**
 * CanvasShell — polymorphic canvas surface.
 *
 * Owns nothing about the modes themselves; consumes a CanvasManifest
 * (from @atlas/canvas-runtime) + a persona, narrows the modes via
 * personaFilter(), and renders the active mode via the
 * CanvasModeRegistry lookup. When no manifest is supplied (pre-ritual,
 * or hydration failure) it falls back to <EmptyCanvas>.
 *
 * Plan S.4: replaces Plan R's right-pane preview-only canvas when the
 * "canvas-v1" feature flag is on. Flag-off path keeps today's
 * preview-only tree (see app/projects/[projectId]/canvas/page.tsx).
 */
import * as React from "react";
import {
  CanvasModeRegistry,
  personaFilter,
  type CanvasManifest
} from "@atlas/canvas-runtime";
import type { PersonaTier } from "@atlas/ritual-engine";
import EmptyCanvas from "./EmptyCanvas";
import { ModeToggle } from "./ModeToggle";
import { canvasModeRegistry } from "./canvas-mode-registry";
import { useCanvasState } from "@/lib/canvas/use-canvas-state";

export interface CanvasShellProps {
  manifest: CanvasManifest | undefined;
  persona: PersonaTier;
  /** Override registry (tests inject their own). Defaults to the
   *  process-wide singleton populated by register-renderers. */
  registry?: CanvasModeRegistry<React.ComponentType<unknown>>;
  /** Optional per-mode props. Consumers rarely set this directly — the
   *  page wires it. */
  rendererProps?: Record<string, unknown>;
  children?: React.ReactNode;
}

export function CanvasShell({
  manifest,
  persona,
  registry,
  rendererProps,
  children
}: CanvasShellProps) {
  const reg = registry ?? canvasModeRegistry;

  const filtered = React.useMemo(
    () => (manifest ? personaFilter(manifest, persona) : undefined),
    [manifest, persona]
  );

  // useCanvasState owns the mode + auto-switch (designing ←→ preview)
  // driven by SSE events: canvas.options.requested → designing,
  // sandbox.apply.completed → preview. Local useState here would defeat
  // the auto-switch — without this the canvas would stay on "designing"
  // forever after a ritual completes, leaving the user staring at the
  // DesignerCanvas overlay even after the iframe is ready.
  const canvasState = useCanvasState({ manifest: filtered });
  const activeId = canvasState.activeMode;
  const setActiveId = canvasState.setActiveMode;

  if (!manifest || !filtered || filtered.modes.length === 0) {
    return <EmptyCanvas />;
  }

  const activeMode = filtered.modes.find((m) => m.id === activeId) ?? filtered.modes[0]!;
  const Renderer = reg.lookup(activeMode.renderer) as
    | React.ComponentType<Record<string, unknown>>
    | undefined;

  // The designing/preview ModeToggle row was visually redundant with the
  // Agent/Plan/Visual-Edits toolbar above (two mode-toggle rows = chatty).
  // Modes auto-switch via use-canvas-state's event subscription
  // (canvas.options.requested → designing, sandbox.apply.completed → preview),
  // so the manual switcher is rarely useful. Keep ModeToggle imported but
  // gated behind a `?canvas-modes=show` query string for power-users who
  // want to manually flip back without a page refresh.
  const showModeToggle =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("canvas-modes") === "show";

  return (
    <div data-testid="canvas-shell" className="flex h-full w-full flex-col">
      {showModeToggle && (
        <div className="flex justify-end border-b border-slate-200 bg-white px-4 py-2">
          <ModeToggle
            modes={filtered.modes.map((m) => ({ id: m.id, label: m.id }))}
            active={activeMode.id}
            onChange={setActiveId}
          />
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {Renderer ? <Renderer {...(rendererProps ?? {})} /> : children}
      </div>
    </div>
  );
}

export default CanvasShell;
