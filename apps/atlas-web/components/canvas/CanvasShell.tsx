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
  children: _children
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

  // Shell is always rendered. When the manifest hasn't arrived (pre-ritual
  // or EventSource missed the event), the toggle row hides but EmptyCanvas
  // still gives the user something visible and reloadable. When manifest
  // is present, the ModeToggle is ALWAYS visible — the auto-switch via
  // use-canvas-state (canvas.options.requested → designing,
  // sandbox.apply.completed → preview) is a happy-path optimization, but
  // EventSource reconnections, missed messages, and hydration races mean
  // it isn't guaranteed. Showing the toggle always gives the user a
  // one-click escape into the right mode without hard-refreshing the page.
  const hasModes = filtered && filtered.modes.length > 0;
  const activeMode = hasModes
    ? (filtered!.modes.find((m) => m.id === activeId) ?? filtered!.modes[0]!)
    : undefined;
  const Renderer = activeMode
    ? (reg.lookup(activeMode.renderer) as
        | React.ComponentType<Record<string, unknown>>
        | undefined)
    : undefined;

  return (
    <div data-testid="canvas-shell" className="flex h-full w-full flex-col">
      {hasModes && activeMode && (
        <div className="flex justify-end border-b border-slate-200 bg-white px-4 py-2">
          <ModeToggle
            modes={filtered!.modes.map((m) => ({ id: m.id, label: m.id }))}
            active={activeMode.id}
            onChange={setActiveId}
          />
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {!hasModes || !Renderer ? (
          <EmptyCanvas />
        ) : (
          <Renderer {...(rendererProps ?? {})} />
        )}
      </div>
    </div>
  );
}

export default CanvasShell;
