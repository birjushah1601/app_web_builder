import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Plan F's hook reads useEventStream() — mock it for unit tests.
// Each test sets the return value before calling renderHook.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: vi.fn(() => ({ events: [], status: "disabled", lastEventId: null }))
}));

import { useReloadOnApplied, RELOAD_PARAM } from "@/lib/canvas/useReloadOnApplied";
import { useEventStream } from "@/lib/events/EventSourceProvider";

describe("useReloadOnApplied — return shape and initial values", () => {
  it("RELOAD_PARAM is the literal 'atlas-reload' (per spec line 147)", () => {
    expect(RELOAD_PARAM).toBe("atlas-reload");
  });

  it("returns { cacheBuster: '', toast: null, manualReload: function } on first render with no events", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    expect(result.current.cacheBuster).toBe("");
    expect(result.current.toast).toBeNull();
    expect(typeof result.current.manualReload).toBe("function");
  });

  it("manualReload identity is stable across re-renders (useCallback)", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });
    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));
    const first = result.current.manualReload;
    rerender();
    expect(result.current.manualReload).toBe(first);
  });
});
