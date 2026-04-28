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
 * unit + e2e tests target. Plan E's RitualTimeline reads no props — it
 * subscribes to the ambient `EventSourceProvider` for events.
 */
interface SlotProps {
  projectId: string;
}

export function RitualTimelineSlot(_props: SlotProps): React.ReactElement {
  return (
    <div data-testid="ritual-timeline-host">
      <RitualTimeline />
    </div>
  );
}
