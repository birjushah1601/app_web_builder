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
import { SchemaCanvas } from "./renderers/SchemaCanvas";
import { BackendCanvas } from "./renderers/BackendCanvas";
import { TestsCanvas } from "./renderers/TestsCanvas";
import { IacStubCanvas } from "./renderers/IacStubCanvas";
import { DeployStubCanvas } from "./renderers/DeployStubCanvas";

let _registered = false;

function registerOnce() {
  if (_registered) return;
  _registered = true;
  canvasModeRegistry.register("designing", DesignerCanvas as React.ComponentType<unknown>);
  canvasModeRegistry.register("refining", RefineWizard as React.ComponentType<unknown>);
  canvasModeRegistry.register("preview", PreviewCanvas as React.ComponentType<unknown>);
  canvasModeRegistry.register("schema", SchemaCanvas as React.ComponentType<unknown>);
  // Plan C Task 11 — placeholder renderers for non-frontend artifact kinds.
  // Plans D-F replace these with real Swagger / test-results / topology /
  // deploy-status panels. Registering them now so a workflow that produces
  // a backend/tests/iac/deploy node's manifest doesn't crash the canvas
  // shell with "renderer not found".
  canvasModeRegistry.register("swagger", BackendCanvas as React.ComponentType<unknown>);
  canvasModeRegistry.register("test-results", TestsCanvas as React.ComponentType<unknown>);
  canvasModeRegistry.register("topology", IacStubCanvas as React.ComponentType<unknown>);
  canvasModeRegistry.register("deploy-status", DeployStubCanvas as React.ComponentType<unknown>);
}

registerOnce();

export { canvasModeRegistry };
