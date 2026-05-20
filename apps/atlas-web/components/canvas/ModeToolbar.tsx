"use client";
/**
 * Plan UXO change 2 — three-mode toolbar.
 *
 * A radiogroup that lets the user pick between Agent (today's
 * conversation-driven workflow), Plan (manifest/checkpoint review), and
 * Visual Edits (click-to-edit on the preview iframe).
 *
 * This component is intentionally presentational — it does NOT own the
 * mode state. The canvas page owns it via `use-canvas-state` so the mode
 * persists across remounts (e.g. live-events reload, refine flow) and
 * survives navigation back to the same project. Consumer wiring (which
 * panels react to which mode) lands in later UXO slices; for this commit
 * the toolbar is purely visible.
 *
 * Accessibility: explicit `role="radiogroup"` + `role="radio"` with
 * `aria-checked` so screen readers announce the active mode correctly.
 * Keyboard semantics (arrow keys to move between radios) are deferred —
 * the buttons are tab-stops and Enter/Space activates them, which is the
 * baseline a11y contract.
 */
import * as React from "react";

export type CanvasMode = "agent" | "plan" | "visual-edits";

export interface ModeToolbarProps {
  mode: CanvasMode;
  onChange: (m: CanvasMode) => void;
}

export function ModeToolbar({ mode, onChange }: ModeToolbarProps) {
  const items: Array<[CanvasMode, string]> = [
    ["agent", "Agent"],
    ["plan", "Plan"],
    ["visual-edits", "Visual Edits"]
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Canvas mode"
      className="inline-flex rounded-md border border-slate-200 bg-white"
    >
      {items.map(([id, label]) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={`px-3 py-1.5 text-sm font-medium ${
              active
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
