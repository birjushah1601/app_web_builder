/**
 * EmptyCanvas — pre-ritual placeholder for the canvas shell.
 *
 * Rendered by `<CanvasShell>` when no manifest is available yet (e.g., the
 * user is on the canvas page but hasn't started a ritual). Geist-style
 * empty state — minimal, monochromatic, communicates "ritual not started"
 * without overwhelming pre-ritual UI.
 */
import * as React from "react";

export default function EmptyCanvas() {
  return (
    <div
      role="region"
      aria-label="Empty canvas"
      data-testid="empty-canvas"
      className="flex h-full w-full items-center justify-center bg-slate-50 p-8"
    >
      <div className="max-w-sm text-center">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Canvas
        </div>
        <h2 className="mb-2 text-lg font-semibold text-slate-900">
          Ritual not started
        </h2>
        <p className="text-sm text-slate-600">
          Describe what you want to build in the chat to get started. The
          canvas updates as the ritual progresses.
        </p>
      </div>
    </div>
  );
}
