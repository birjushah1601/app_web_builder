import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { RitualTimelineSlot } from "@/components/shell/ritual-timeline-slot";

describe("RitualTimelineSlot — placeholder until Plan E ships", () => {
  it("renders <div data-testid='ritual-timeline-host' /> as a stable contract for the rail's footer", () => {
    render(<RitualTimelineSlot projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-host")).toBeInTheDocument();
  });

  it("ignores the projectId prop in the placeholder branch (Plan E will add real per-project rendering)", () => {
    const { container: a } = render(<RitualTimelineSlot projectId="alpha" />);
    const { container: b } = render(<RitualTimelineSlot projectId="beta" />);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
});
