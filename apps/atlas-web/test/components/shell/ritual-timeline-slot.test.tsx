import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/components/ritual/RitualTimeline", () => ({
  RitualTimeline: () => <div data-testid="ritual-timeline-real">real timeline</div>
}));

import { RitualTimelineSlot } from "@/components/shell/ritual-timeline-slot";

describe("RitualTimelineSlot — wires the real RitualTimeline", () => {
  it("renders the data-testid='ritual-timeline-host' wrapper (rail-footer contract)", () => {
    render(<RitualTimelineSlot projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-host")).toBeInTheDocument();
  });

  it("delegates to <RitualTimeline /> from @/components/ritual/RitualTimeline", () => {
    render(<RitualTimelineSlot projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-real")).toBeInTheDocument();
  });
});
