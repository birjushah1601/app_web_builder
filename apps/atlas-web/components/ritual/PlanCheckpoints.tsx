"use client";

/**
 * Plan UXO Task 7 — editable plan checkpoints.
 *
 * Renders the architect's plan as a list of inline-editable steps with a
 * per-row delete affordance and an Approve button at the foot. Calling
 * `onApprove(items)` is the contract the parent (RitualTimeline + a
 * future server-action wrapper around resolvePlanApproval) uses to close
 * the plan-approval pause.
 *
 * Stateful — the parent passes the initial plan; the component owns the
 * working copy until approved. This matches the pattern used by other
 * Atlas form-style components (e.g. RefinementInputBar).
 */

import * as React from "react";
import type { PlanCheckpoint } from "@atlas/ritual-engine";

export interface PlanCheckpointsProps {
  plan: ReadonlyArray<PlanCheckpoint>;
  onApprove: (final: ReadonlyArray<PlanCheckpoint>) => void;
}

export function PlanCheckpoints({ plan, onApprove }: PlanCheckpointsProps) {
  const [items, setItems] = React.useState<ReadonlyArray<PlanCheckpoint>>(plan);

  return (
    <div data-testid="plan-checkpoints" className="space-y-2">
      {items.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <input
            aria-label={`Plan step ${i + 1}`}
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            value={step.text}
            onChange={(e) => {
              const next = e.target.value;
              setItems((cur) =>
                cur.map((s, j) => (j === i ? { ...s, text: next } : s))
              );
            }}
          />
          <button
            type="button"
            aria-label={`Delete step ${i + 1}`}
            onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
            className="text-xs text-red-600"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onApprove(items)}
        className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
      >
        Approve plan
      </button>
    </div>
  );
}
