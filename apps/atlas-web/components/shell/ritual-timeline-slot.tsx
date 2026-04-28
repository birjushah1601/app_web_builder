"use client";

import React from "react";

/**
 * RitualTimelineSlot — placeholder until Plan E ships the real
 * `<RitualTimeline />` at `@/components/ritual/RitualTimeline`.
 *
 * Earlier versions of this file used a dynamic `import()` to pick up Plan E
 * at runtime if available. That pattern bundles cleanly under Vitest but
 * trips Next.js's compiler worker pool ("Jest worker encountered N child
 * process exceptions") because webpack/turbopack still try to resolve the
 * path at build time and the `/* @vite-ignore *\/` pragma is Vite-only.
 *
 * Plan E's task list explicitly updates this file to import the real
 * component when the timeline ships. Until then, the rail renders this
 * stable placeholder; the `data-testid="ritual-timeline-host"` contract is
 * what unit + e2e tests target, so callers don't see the swap.
 */
interface SlotProps {
  projectId: string;
}

export function RitualTimelineSlot(_props: SlotProps): React.ReactElement {
  return <div data-testid="ritual-timeline-host" />;
}
