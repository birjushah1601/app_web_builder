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

  const defaultId = React.useMemo(() => {
    if (!filtered || filtered.modes.length === 0) return "";
    return filtered.modes.find((m) => m.default)?.id ?? filtered.modes[0]!.id;
  }, [filtered]);

  const [activeId, setActiveId] = React.useState(defaultId);

  // Keep activeId valid as the manifest / persona narrows or expands the
  // mode list (e.g. persona toggles from diego → ama).
  React.useEffect(() => {
    if (!filtered) return;
    if (!filtered.modes.some((m) => m.id === activeId)) {
      setActiveId(defaultId);
    }
  }, [filtered, defaultId, activeId]);

  if (!manifest || !filtered || filtered.modes.length === 0) {
    return <EmptyCanvas />;
  }

  const activeMode = filtered.modes.find((m) => m.id === activeId) ?? filtered.modes[0]!;
  const Renderer = reg.lookup(activeMode.renderer) as
    | React.ComponentType<Record<string, unknown>>
    | undefined;

  return (
    <div data-testid="canvas-shell" className="flex h-full w-full flex-col">
      <div className="flex justify-end border-b border-slate-200 bg-white px-4 py-2">
        <ModeToggle
          modes={filtered.modes.map((m) => ({ id: m.id, label: m.id }))}
          active={activeMode.id}
          onChange={setActiveId}
        />
      </div>
      <div className="flex-1 overflow-auto">
        {Renderer ? <Renderer {...(rendererProps ?? {})} /> : children}
      </div>
    </div>
  );
}

export default CanvasShell;
