import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type FakeEvent = { id: string; projectId: string; ritualId: string; type: string; payload: unknown; ts: number };
const eventsHolder: { current: FakeEvent[] } = { current: [] };

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => ({ events: eventsHolder.current, status: "disabled", lastEventId: null })
}));

import { useDesignerProposal } from "@/lib/canvas/useDesignerProposal";

const PROPOSAL_A = {
  recommended: { id: "dir-a", name: "A", shortDescription: "", technicalDescription: "", citedReferences: [], tokens: {} },
  alternates: [
    { id: "dir-b", name: "B", shortDescription: "", technicalDescription: "", citedReferences: [], tokens: {} },
    { id: "dir-c", name: "C", shortDescription: "", technicalDescription: "", citedReferences: [], tokens: {} }
  ],
  reasoning: "because"
};

const PROPOSAL_B = {
  recommended: { id: "dir-x", name: "X", shortDescription: "", technicalDescription: "", citedReferences: [], tokens: {} },
  alternates: [
    { id: "dir-y", name: "Y", shortDescription: "", technicalDescription: "", citedReferences: [], tokens: {} },
    { id: "dir-z", name: "Z", shortDescription: "", technicalDescription: "", citedReferences: [], tokens: {} }
  ],
  reasoning: "different"
};

function pushEvent(type: string, payload: unknown, ritualId = "r-1") {
  eventsHolder.current = [
    ...eventsHolder.current,
    {
      id: `evt-${eventsHolder.current.length + 1}`,
      projectId: "p-1",
      ritualId,
      type,
      payload,
      ts: Date.now()
    }
  ];
}

function reset() {
  eventsHolder.current = [];
}

describe("useDesignerProposal", () => {
  it("returns null pair when no canvas.options.requested has arrived", () => {
    reset();
    const { result } = renderHook(() => useDesignerProposal("p-1"));
    expect(result.current).toEqual({ ritualId: null, proposal: null });
  });

  it("ignores unrelated event types", () => {
    reset();
    pushEvent("ritual.started", { intent: "hello" });
    pushEvent("designer.proposal.emitted", { proposal: PROPOSAL_A });
    const { result } = renderHook(() => useDesignerProposal("p-1"));
    // designer.proposal.emitted is NOT canvas.options.requested — must stay null.
    expect(result.current).toEqual({ ritualId: null, proposal: null });
  });

  it("extracts proposal + ritualId from canvas.options.requested", () => {
    reset();
    pushEvent("canvas.options.requested", { proposal: PROPOSAL_A }, "ritual-42");
    const { result } = renderHook(() => useDesignerProposal("p-1"));
    expect(result.current.ritualId).toBe("ritual-42");
    expect(result.current.proposal).toEqual(PROPOSAL_A);
  });

  it("the most recent canvas.options.requested wins", () => {
    reset();
    pushEvent("canvas.options.requested", { proposal: PROPOSAL_A }, "ritual-1");
    pushEvent("canvas.options.requested", { proposal: PROPOSAL_B }, "ritual-2");
    const { result } = renderHook(() => useDesignerProposal("p-1"));
    expect(result.current.ritualId).toBe("ritual-2");
    expect(result.current.proposal).toEqual(PROPOSAL_B);
  });

  it("stays null on a malformed payload (failure-safe)", () => {
    reset();
    pushEvent("canvas.options.requested", { proposal: "not-an-object" });
    pushEvent("canvas.options.requested", { wrongShape: true });
    const { result } = renderHook(() => useDesignerProposal("p-1"));
    expect(result.current).toEqual({ ritualId: null, proposal: null });
  });

  it("filters by ritualId when provided (workflow drill-in)", () => {
    reset();
    pushEvent("canvas.options.requested", { proposal: PROPOSAL_A }, "r-1");
    pushEvent("canvas.options.requested", { proposal: PROPOSAL_B }, "r-2");

    // No filter: newest wins → PROPOSAL_B / r-2
    const { result: noFilter } = renderHook(() => useDesignerProposal("p-1"));
    expect(noFilter.current.ritualId).toBe("r-2");

    // Filter to r-1: we want PROPOSAL_A even though r-2 came later
    const { result: filtered } = renderHook(() => useDesignerProposal("p-1", "r-1"));
    expect(filtered.current.ritualId).toBe("r-1");
    expect(filtered.current.proposal).toEqual(PROPOSAL_A);
  });

  it("returns null pair when ritualId filter matches no events", () => {
    reset();
    pushEvent("canvas.options.requested", { proposal: PROPOSAL_A }, "r-1");
    const { result } = renderHook(() => useDesignerProposal("p-1", "r-unknown"));
    expect(result.current).toEqual({ ritualId: null, proposal: null });
  });
});
