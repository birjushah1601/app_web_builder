"use client";

/**
 * Plan UXO Task 7 — collapsed disclosure of the designer's critique pass.
 *
 * `findings` come from the `designer.critique.completed` event the engine
 * emits during the three-pass designer flow (draft → critique → revise).
 * Each finding is a per-axis score + an actionable suggestion. The
 * disclosure starts collapsed and toggles open on user click — keeps the
 * timeline quiet by default while making the data accessible on demand.
 *
 * We avoid the native `<details>` open behavior for two reasons:
 *   1. Programmatic state lets parents reset open=false on ritual change.
 *   2. The summary's preventDefault keeps focus from jumping when the
 *      element is keyboard-toggled inside a wider component (matches the
 *      RitualTimeline summary pattern).
 */

import * as React from "react";

export interface CritiqueFinding {
  axis: string;
  score: number;
  suggestion: string;
}

export interface CritiqueDisclosureProps {
  findings: ReadonlyArray<CritiqueFinding>;
}

export function CritiqueDisclosure({ findings }: CritiqueDisclosureProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <details data-testid="critique-disclosure" className="px-3 py-2 text-xs" open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className="cursor-pointer text-slate-600"
      >
        ▶ Critique ({findings.length} findings)
      </summary>
      <ul className="mt-2 space-y-1">
        {findings.map((f, i) => (
          <li key={i}>
            <strong>
              {f.axis} ({f.score}/5):
            </strong>{" "}
            {f.suggestion}
          </li>
        ))}
      </ul>
    </details>
  );
}
