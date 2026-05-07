"use client";
/**
 * register-renderers — wires atlas-web's React renderers into the
 * CanvasModeRegistry singleton at module-import time.
 *
 * Importing this file is the activation step: the page's CanvasShell
 * looks up `mode.renderer` strings against `canvasModeRegistry`, so each
 * renderer must be registered before the shell mounts.
 *
 * Idempotent — guarded by a module-level flag so re-imports during
 * Next.js fast-refresh / vitest re-evaluation don't throw the
 * "already registered" error from CanvasModeRegistry.register.
 */
import type * as React from "react";
import { canvasModeRegistry } from "./canvas-mode-registry";
import { DesignerCanvas } from "./renderers/DesignerCanvas";
import { RefineWizard } from "./renderers/RefineWizard";
import { PreviewCanvas } from "./renderers/PreviewCanvas";

let _registered = false;

function registerOnce() {
  if (_registered) return;
  _registered = true;
  canvasModeRegistry.register("designing", DesignerCanvas as React.ComponentType<unknown>);
  canvasModeRegistry.register("refining", RefineWizard as React.ComponentType<unknown>);
  canvasModeRegistry.register("preview", PreviewCanvas as React.ComponentType<unknown>);
}

registerOnce();

export { canvasModeRegistry };
