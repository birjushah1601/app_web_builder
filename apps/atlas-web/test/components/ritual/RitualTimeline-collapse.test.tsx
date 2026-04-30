import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";

const streamState = {
  events: [] as Array<{ id: string; type: string; payload: Record<string, unknown>; ts: number; projectId: string; ritualId: string }>,
  status: "open" as const,
  lastEventId: null as string | null
};
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => streamState
}));

import { RitualTimeline } from "@/components/ritual/RitualTimeline";

beforeEach(() => { cleanup(); streamState.events = []; sessionStorage.clear(); });

const evt = (type: string, payload: Record<string, unknown> = {}, ts = 1_000) => ({
  id: `e-${ts}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("RitualTimeline — Plan R collapsible wrapper", () => {
  it("renders open by default (no sandbox.apply.completed yet)", () => {
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(true);
  });

  it("auto-collapses after first sandbox.apply.completed", () => {
    streamState.events = [
      evt("sandbox.apply.completed", { ok: true, filesWritten: 1 }, 5_000)
    ];
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(false);
  });

  it("user can manually re-open after auto-collapse and the open state persists in session", () => {
    streamState.events = [evt("sandbox.apply.completed", { ok: true, filesWritten: 1 }, 5_000)];
    const { unmount } = render(<RitualTimeline projectId="p-1" />);
    const summary = screen.getByTestId("ritual-timeline-summary");
    act(() => { summary.click(); });
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(true);
    unmount();
    cleanup();
    // Re-mount: sessionStorage retains the user's open choice
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-timeline-details").hasAttribute("open")).toBe(true);
  });
});
