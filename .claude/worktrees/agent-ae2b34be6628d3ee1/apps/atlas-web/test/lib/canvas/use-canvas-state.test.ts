import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CanvasManifest } from "@atlas/canvas-runtime";

type FakeEvent = { id: string; projectId: string; ritualId: string; type: string; payload: unknown; ts: number };
const eventsHolder: { current: FakeEvent[] } = { current: [] };

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => ({ events: eventsHolder.current, status: "disabled", lastEventId: null })
}));

import { useCanvasState } from "@/lib/canvas/use-canvas-state";

const MANIFEST: CanvasManifest = {
  artifactKind: "frontend-app",
  modes: [
    { id: "designing", renderer: "designing", audience: ["ama", "diego"], default: true },
    { id: "preview", renderer: "preview", audience: ["ama", "diego"] }
  ]
};

function pushEvent(type: string) {
  eventsHolder.current = [
    ...eventsHolder.current,
    {
      id: `evt-${eventsHolder.current.length + 1}`,
      projectId: "p-1",
      ritualId: "r-1",
      type,
      payload: {},
      ts: Date.now()
    }
  ];
}

function resetEvents() {
  eventsHolder.current = [];
}

describe("useCanvasState", () => {
  it("initial activeMode is the manifest's default", () => {
    resetEvents();
    const { result } = renderHook(() => useCanvasState({ manifest: MANIFEST }));
    expect(result.current.activeMode).toBe("designing");
  });

  it("auto-switches activeMode on a recognised broker event", () => {
    resetEvents();
    const { result, rerender } = renderHook(() => useCanvasState({ manifest: MANIFEST }));
    expect(result.current.activeMode).toBe("designing");
    act(() => {
      pushEvent("sandbox.apply.completed");
    });
    rerender();
    expect(result.current.activeMode).toBe("preview");
  });

  it("manual override (setActiveMode) is sticky against later auto-switch events", () => {
    resetEvents();
    const { result, rerender } = renderHook(() => useCanvasState({ manifest: MANIFEST }));
    act(() => {
      result.current.setActiveMode("preview");
    });
    expect(result.current.activeMode).toBe("preview");
    act(() => {
      pushEvent("canvas.options.requested");
    });
    rerender();
    // canvas.options.requested would normally switch to "designing" — but the
    // manual override sticks.
    expect(result.current.activeMode).toBe("preview");
  });
});
