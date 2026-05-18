import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Drive the strip via a programmable mock of useEventStream.
const streamState = {
  events: [] as Array<{ id: string; type: string; payload: Record<string, unknown>; ts: number; projectId: string; ritualId: string }>,
  status: "open" as "open" | "error" | "disabled" | "connecting" | "closed",
  lastEventId: null as string | null
};
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => streamState
}));

import { RitualStatusStrip } from "@/components/ritual/RitualStatusStrip";

beforeEach(() => {
  cleanup();
  streamState.events = [];
  streamState.status = "open";
});

const evt = (type: string, payload: Record<string, unknown> = {}, ts = 1_000) => ({
  id: `e-${ts}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("RitualStatusStrip", () => {
  it("renders 'Idle · ready' when no ritual events have arrived", () => {
    render(<RitualStatusStrip />);
    expect(screen.getByTestId("ritual-status-strip").textContent).toMatch(/idle/i);
  });

  it("renders the active phase + duration when a role is in flight", () => {
    streamState.events = [
      evt("ritual.started", {}, 1_000),
      evt("role.started", { role: "developer" }, 2_000)
    ];
    render(<RitualStatusStrip nowMs={() => 5_000} />);
    const text = screen.getByTestId("ritual-status-strip").textContent ?? "";
    expect(text.toLowerCase()).toContain("developer");
    expect(text).toMatch(/3s|3\s*s/);
  });

  it("prefixes 'Auto-fix #N · ' when an auto_fix.attempted event has fired", () => {
    streamState.events = [
      evt("ritual.started", {}, 1_000),
      evt("auto_fix.attempted", {}, 1_500),
      evt("role.started", { role: "developer" }, 2_000)
    ];
    render(<RitualStatusStrip nowMs={() => 5_000} />);
    expect(screen.getByTestId("ritual-status-strip").textContent).toMatch(/auto-fix #1/i);
  });

  it("renders 'Escalated · …' in red on ritual.escalation_requested", () => {
    streamState.events = [
      evt("ritual.started", {}, 1_000),
      evt("ritual.escalation_requested", { reason: "accessibility" }, 3_000)
    ];
    render(<RitualStatusStrip nowMs={() => 4_000} />);
    const strip = screen.getByTestId("ritual-status-strip");
    expect(strip.textContent).toMatch(/escalated/i);
    expect(strip.className).toMatch(/red/);
  });

  it("renders 'Disconnected · retrying' when SSE status is error", () => {
    streamState.status = "error";
    render(<RitualStatusStrip />);
    expect(screen.getByTestId("ritual-status-strip").textContent).toMatch(/disconnected/i);
  });

  it("uses font-mono on the strip text container", () => {
    render(<RitualStatusStrip />);
    expect(screen.getByTestId("ritual-status-strip").className).toMatch(/font-mono/);
  });
});
