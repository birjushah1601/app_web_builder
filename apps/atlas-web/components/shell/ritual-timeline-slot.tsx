"use client";

import React, { lazy, Suspense } from "react";

/**
 * RitualTimelineSlot — encapsulates the "is Plan E shipped yet?" decision.
 *
 * Plan G ships in parallel with Plan E; either order is merge-safe. To
 * avoid a hard dependency, the slot dynamic-imports the Plan E component
 * and falls back to a stable placeholder DOM element when the import
 * rejects. After Plan E lands, the placeholder is silently replaced by
 * the real timeline on next render — no edits to the slot needed.
 *
 * The fallback (`<div data-testid="ritual-timeline-host" />`) is the
 * stable contract: e2e tests + unit tests for the rail target this id
 * regardless of which plan landed first.
 */

interface SlotProps {
  projectId: string;
}

function PlaceholderTimeline(_props: SlotProps): React.ReactElement {
  return <div data-testid="ritual-timeline-host" />;
}

// Use a string variable so the bundler cannot statically analyze the import
// path. Plan E ships this module; until it does, the runtime import rejects
// and the .catch yields the placeholder. The /* @vite-ignore */ pragma
// suppresses Vite's parse-time resolution check.
const LAZY_TIMELINE_PATH = "@/components/ritual/RitualTimeline";

const LazyRitualTimeline = lazy<React.ComponentType<SlotProps>>(() =>
  import(/* @vite-ignore */ LAZY_TIMELINE_PATH)
    .then((mod: { RitualTimeline?: React.ComponentType<SlotProps> }) => {
      if (!mod.RitualTimeline) {
        return { default: PlaceholderTimeline };
      }
      return { default: mod.RitualTimeline };
    })
    .catch(() => ({ default: PlaceholderTimeline }))
);

export function RitualTimelineSlot({ projectId }: SlotProps): React.ReactElement {
  return (
    <Suspense fallback={<div data-testid="ritual-timeline-host" />}>
      <LazyRitualTimeline projectId={projectId} />
    </Suspense>
  );
}
