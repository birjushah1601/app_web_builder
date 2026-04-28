"use client";

/**
 * RitualTimelineRow — single row of the RitualTimeline. Pure presentational:
 * takes a RowState (from the reducer) and a human-readable title, renders
 * status glyph + title + optional duration badge, and (Task 7) a chevron
 * that toggles a detail panel showing retries / lastError / meta.
 *
 * No business logic here — every transition lives in timelineReducer.
 */

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
  return (
    <div data-testid={`ritual-row-${row.phase}`} className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className={STATUS_COLOR[row.status]} aria-label={`status ${row.status}`}>
        {STATUS_GLYPH[row.status]}
      </span>
      <span className="flex-1 text-slate-800">{title}</span>
      {row.durationMs !== undefined && (
        <span data-testid="ritual-row-duration" className="text-slate-500">
          {(row.durationMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}
