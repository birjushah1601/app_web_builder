"use client";

/**
 * RitualTimelineRow — single row of the RitualTimeline. Pure presentational.
 * Owns one piece of local state: whether the detail panel is expanded.
 *
 * Layout (collapsed):  [glyph] [title]                [duration] [▸]
 * Layout (expanded):   [glyph] [title]                [duration] [▾]
 *                      [─── detail panel ───]
 *
 * No business logic here — every state transition lives in timelineReducer.
 */

import { useState } from "react";
import type { RowState } from "@/lib/ritual/timelineReducer";

const STATUS_GLYPH: Record<RowState["status"], string> = {
  pending: "○",
  active:  "●",
  done:    "✓",
  failed:  "✗"
};

const STATUS_COLOR: Record<RowState["status"], string> = {
  pending: "text-slate-400",
  active:  "text-indigo-600",
  done:    "text-emerald-600",
  failed:  "text-red-600"
};

export interface RitualTimelineRowProps {
  row: RowState;
  /** Human-readable label for the row, e.g. "Architect planning". The
   *  orchestrator (RitualTimeline) supplies these so the row component
   *  stays free of phase-name → english-string mappings. */
  title: string;
}

export function RitualTimelineRow({ row, title }: RitualTimelineRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`ritual-row-${row.phase}`} className="border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 px-2 py-1 text-xs">
        <span className={STATUS_COLOR[row.status]} aria-label={`status ${row.status}`}>
          {STATUS_GLYPH[row.status]}
        </span>
        <span className="flex-1 text-slate-800">{title}</span>
        {row.durationMs !== undefined && (
          <span data-testid="ritual-row-duration" className="text-slate-500">
            {(row.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "collapse details" : "expand details"}
          className="text-slate-500 hover:text-slate-800"
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && (
        <div data-testid="ritual-row-detail" className="bg-slate-50 px-6 py-1 text-[11px] text-slate-700">
          {renderDetailLines(row)}
        </div>
      )}
    </div>
  );
}

/** Render the detail panel body. Returns one or more lines describing
 *  retries, lastError, and meta. When none of these are present we render
 *  a single "No additional detail." line so the panel is never empty. */
function renderDetailLines(row: RowState): React.ReactNode {
  const lines: string[] = [];
  if (row.retries > 0) lines.push(`retried ${row.retries}×`);
  if (row.lastError) lines.push(row.lastError);
  if (row.meta?.winner) lines.push(`winner: ${row.meta.winner}`);
  if (row.meta?.filesWritten !== undefined) lines.push(`files: ${row.meta.filesWritten}`);
  if (lines.length === 0) return <span>No additional detail.</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {lines.map((line, i) => (<li key={i}>{line}</li>))}
    </ul>
  );
}
