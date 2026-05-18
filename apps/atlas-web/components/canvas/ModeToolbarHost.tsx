"use client";
/**
 * Plan UXO change 2 — client host for <ModeToolbar />.
 *
 * The canvas page is a Server Component (it needs `await params` +
 * server-only sandbox provisioning), so it can't call `useCanvasMode`
 * directly. This thin client wrapper owns the mode state via the
 * localStorage-backed hook so the page can mount the toolbar with just
 * a projectId.
 *
 * Consumer wiring (Visual-Edits panel, Plan UI) comes in later UXO
 * slices. For now the toolbar is visible-only — picking a mode persists
 * to localStorage and re-renders this island, but nothing downstream
 * reads the mode yet.
 */
import * as React from "react";
import { ModeToolbar } from "./ModeToolbar";
import { useCanvasMode } from "@/lib/canvas/use-canvas-state";

export interface ModeToolbarHostProps {
  projectId: string;
}

export function ModeToolbarHost({ projectId }: ModeToolbarHostProps) {
  const { mode, setMode } = useCanvasMode(projectId);
  return <ModeToolbar mode={mode} onChange={setMode} />;
}
