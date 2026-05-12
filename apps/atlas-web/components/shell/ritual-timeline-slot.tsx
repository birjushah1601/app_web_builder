"use client";

import React from "react";
import { RitualTimeline } from "@/components/ritual/RitualTimeline";

/**
 * RitualTimelineSlot — delegates to the real `<RitualTimeline />` shipped
 * by Plan E. Kept as a thin indirection so the rail's footer can swap to
 * a different timeline implementation in the future without touching
 * `RailShell.tsx`.
 *
 * The `data-testid="ritual-timeline-host"` wrapper preserves the contract
 * unit + e2e tests target. Plan E's RitualTimeline reads no env-driven
 * flags — flag values arrive via props so this component stays test-friendly.
 */
interface SlotProps {
  projectId: string;
  /** Plan UXO Task 7: forwarded to RitualTimeline so it can render the
   *  CritiqueDisclosure when a designer.critique.completed event lands. */
  editablePlanEnabled?: boolean;
}

export function RitualTimelineSlot({ projectId, editablePlanEnabled = false }: SlotProps): React.ReactElement {
  return (
    <div data-testid="ritual-timeline-host">
      <RitualTimeline projectId={projectId} editablePlanEnabled={editablePlanEnabled} />
    </div>
  );
}
