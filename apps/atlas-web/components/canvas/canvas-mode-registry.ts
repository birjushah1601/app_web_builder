/**
 * Process-wide CanvasModeRegistry singleton for atlas-web.
 *
 * register-renderers.tsx populates this with the v1 React renderers
 * (DesignerCanvas, RefineWizard, PreviewCanvas, …) on module import.
 * <CanvasShell> looks up renderers here when no override is supplied.
 *
 * Tests can inject their own registry instance via CanvasShell's
 * `registry` prop instead of touching this singleton.
 */
import { CanvasModeRegistry } from "@atlas/canvas-runtime";
import type * as React from "react";

export const canvasModeRegistry = new CanvasModeRegistry<React.ComponentType<unknown>>();
