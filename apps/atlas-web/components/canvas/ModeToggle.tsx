"use client";
/**
 * ModeToggle — top-right segmented control for switching between canvas
 * modes (e.g. designing | preview).
 *
 * Pure presentation: caller owns the active mode state and the onChange
 * callback. The active button is filled; inactive buttons are ghosted.
 */
import * as React from "react";

export interface ModeToggleMode {
  id: string;
  label: string;
}

export interface ModeToggleProps {
  modes: ModeToggleMode[];
  active: string;
  onChange: (id: string) => void;
}

export function ModeToggle({ modes, active, onChange }: ModeToggleProps) {
  if (modes.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Canvas modes"
      data-testid="canvas-mode-toggle"
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 text-sm"
    >
      {modes.map((m) => {
        const isActive = m.id === active;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`canvas-mode-${m.id}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => onChange(m.id)}
            className={
              isActive
                ? "rounded px-3 py-1.5 bg-slate-900 text-white"
                : "rounded px-3 py-1.5 text-slate-700 hover:bg-slate-100"
            }
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
