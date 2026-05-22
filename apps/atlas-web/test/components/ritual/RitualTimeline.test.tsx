import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RitualEvent } from "@/lib/events/EventBroker";

const mockUseEventStream = vi.fn<() => { events: RitualEvent[]; status: string; lastEventId: string | null }>();

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => mockUseEventStream()
}));

import { RitualTimeline } from "@/components/ritual/RitualTimeline";

const evt = (type: RitualEvent["type"], payload: Record<string, unknown>, ts: number, n = 1): RitualEvent => ({
  id: `p-1:${n}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("RitualTimeline", () => {
  beforeEach(() => mockUseEventStream.mockReset());

  it("renders all three rows on first mount (all pending)", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("ritual-row-architect")).toBeInTheDocument();
    expect(screen.getByTestId("ritual-row-developer")).toBeInTheDocument();
    expect(screen.getByTestId("ritual-row-sandbox")).toBeInTheDocument();
    // Three pending glyphs
    expect(screen.getAllByText("○")).toHaveLength(3);
  });

  it("after architect.completed + developer.started, architect=✓ + developer=●", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("role.started", { role: "architect" }, 200, 2),
        evt("role.completed", { role: "architect" }, 1_400, 3),
        evt("role.started", { role: "developer" }, 1_500, 4)
      ],
      status: "open", lastEventId: "p-1:4"
    });
    render(<RitualTimeline projectId="p-1" />);
    const architect = screen.getByTestId("ritual-row-architect");
    const developer = screen.getByTestId("ritual-row-developer");
    expect(architect).toHaveTextContent("✓");
    expect(developer).toHaveTextContent("●");
  });

  it("renders the standard human-readable titles in row order", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByText("Architect planning")).toBeInTheDocument();
    expect(screen.getByText("Developer writing")).toBeInTheDocument();
    expect(screen.getByText("Applying to sandbox")).toBeInTheDocument();
  });

  it("mounts EscalationCallout when ritual.escalated arrives", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("ritual.escalated", { gate: "ritual" }, 200, 2)
      ],
      status: "open", lastEventId: "p-1:2"
    });
    render(<RitualTimeline projectId="p-1" />);
    // Multiple components in the timeline now expose role="alert" (escalation
    // callout + maybe another). Assert at least one and the specific message.
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/not authorised/i)).toBeInTheDocument();
  });

  it("does NOT mount EscalationCallout when escalated is false", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
