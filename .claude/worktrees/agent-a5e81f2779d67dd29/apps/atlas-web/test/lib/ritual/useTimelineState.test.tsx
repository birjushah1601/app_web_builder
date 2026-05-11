import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RitualEvent } from "@/lib/events/EventBroker";

// Mock the EventSourceProvider's useEventStream so we can drive the hook
// without spinning up a real EventSource. The hook MUST be the only
// consumer of useEventStream — no direct EventSource access.
const mockUseEventStream = vi.fn<() => { events: RitualEvent[]; status: string; lastEventId: string | null }>();

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => mockUseEventStream()
}));

import { useTimelineState } from "@/lib/ritual/useTimelineState";

const evt = (type: RitualEvent["type"], payload: Record<string, unknown>, ts: number, n = 1): RitualEvent => ({
  id: `p-1:${n}`, projectId: "p-1", ritualId: "r-1", type, payload, ts
});

describe("useTimelineState", () => {
  beforeEach(() => {
    mockUseEventStream.mockReset();
  });

  it("returns initialTimelineState when no events have arrived", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.escalated).toBe(false);
    expect(result.current.rows.architect.status).toBe("pending");
    expect(result.current.rows.developer.status).toBe("pending");
    expect(result.current.rows.sandbox.status).toBe("pending");
  });

  it("folds the events array through the reducer (architect active)", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("role.started", { role: "architect" }, 200, 2)
      ],
      status: "open",
      lastEventId: "p-1:2"
    });
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.rows.architect.status).toBe("active");
    expect(result.current.rows.architect.startedAt).toBe(200);
  });

  it("re-folds when the events array changes (architect → developer)", () => {
    mockUseEventStream.mockReturnValue({
      events: [evt("role.started", { role: "architect" }, 200, 1)],
      status: "open", lastEventId: "p-1:1"
    });
    const { result, rerender } = renderHook(() => useTimelineState());
    expect(result.current.rows.architect.status).toBe("active");

    mockUseEventStream.mockReturnValue({
      events: [
        evt("role.started", { role: "architect" }, 200, 1),
        evt("role.completed", { role: "architect" }, 1_400, 2),
        evt("role.started", { role: "developer" }, 1_500, 3)
      ],
      status: "open", lastEventId: "p-1:3"
    });
    rerender();
    expect(result.current.rows.architect.status).toBe("done");
    expect(result.current.rows.developer.status).toBe("active");
  });

  it("flips escalated to true when ritual.escalated arrives", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", {}, 100, 1),
        evt("role.started", { role: "architect" }, 200, 2),
        evt("ritual.escalated", { gate: "ritual" }, 300, 3)
      ],
      status: "open", lastEventId: "p-1:3"
    });
    const { result } = renderHook(() => useTimelineState());
    expect(result.current.escalated).toBe(true);
  });
});
