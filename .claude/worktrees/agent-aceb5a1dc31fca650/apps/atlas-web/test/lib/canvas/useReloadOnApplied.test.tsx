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

import type { RitualEvent } from "@/lib/events/EventBroker";

function applyCompleted(id: string, ok: boolean, extra: Record<string, unknown> = {}): RitualEvent {
  return {
    id,
    projectId: "proj-1",
    ritualId: "r-1",
    type: "sandbox.apply.completed",
    payload: { ok, ...extra },
    ts: Date.now()
  };
}

describe("useReloadOnApplied — debounced success", () => {
  it("ok:true event updates cacheBuster after 500ms debounce", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: evts.at(-1)?.id ?? null
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));
      expect(result.current.cacheBuster).toBe("");

      // Push one ok:true event into the mock stream + rerender so the hook sees it.
      evts.push(applyCompleted("proj-1:1", true));
      rerender();

      // Before the debounce fires, cacheBuster has NOT yet updated.
      expect(result.current.cacheBuster).toBe("");

      // Advance to just before the threshold — still empty.
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(result.current.cacheBuster).toBe("");

      // Cross the threshold — cacheBuster now equals the event id.
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.cacheBuster).toBe("proj-1:1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("3 ok:true events within 500ms coalesce into ONE cacheBuster update (debounce)", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: evts.at(-1)?.id ?? null
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

      // Three rapid events — each one resets the debounce timer.
      evts.push(applyCompleted("proj-1:1", true)); rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      evts.push(applyCompleted("proj-1:2", true)); rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      evts.push(applyCompleted("proj-1:3", true)); rerender();

      // Only 200ms have elapsed since the last event — still no update.
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(result.current.cacheBuster).toBe("");

      // Cross the 500ms threshold from the LAST event — single update with the
      // newest event id (the coalesced one).
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.cacheBuster).toBe("proj-1:3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-rendering with the SAME events array does NOT re-trigger the debounce timer", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [applyCompleted("proj-1:1", true)];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: "proj-1:1"
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

      // Fire the initial debounce.
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(result.current.cacheBuster).toBe("proj-1:1");

      // Re-render multiple times with no new events. cacheBuster must not change.
      rerender(); rerender(); rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.cacheBuster).toBe("proj-1:1");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useReloadOnApplied — failure surfaces toast, never reloads", () => {
  it("ok:false with a parseError string sets toast to that string", async () => {
    const evts: RitualEvent[] = [];
    (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      events: [...evts],
      status: "open",
      lastEventId: evts.at(-1)?.id ?? null
    }));

    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

    evts.push(applyCompleted("proj-1:1", false, { parseError: "Could not parse diff at line 4" }));
    rerender();

    expect(result.current.toast).toBe("Could not parse diff at line 4");
    expect(result.current.cacheBuster).toBe(""); // never updated on failure
  });

  it("ok:false with no parseError but a failed file falls back to 'Last apply failed: <path>'", async () => {
    const evts: RitualEvent[] = [];
    (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      events: [...evts],
      status: "open",
      lastEventId: evts.at(-1)?.id ?? null
    }));

    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

    evts.push(applyCompleted("proj-1:1", false, {
      files: [
        { path: "src/ok.ts", status: "written" },
        { path: "src/broken.ts", status: "failed", reason: "hunk did not apply" }
      ]
    }));
    rerender();

    expect(result.current.toast).toBe("Last apply failed: src/broken.ts");
    expect(result.current.cacheBuster).toBe("");
  });

  it("ok:false with neither parseError nor failed files falls back to literal 'Last apply failed.'", async () => {
    const evts: RitualEvent[] = [];
    (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      events: [...evts],
      status: "open",
      lastEventId: evts.at(-1)?.id ?? null
    }));

    const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

    evts.push(applyCompleted("proj-1:1", false, {}));
    rerender();

    expect(result.current.toast).toBe("Last apply failed.");
    expect(result.current.cacheBuster).toBe("");
  });

  it("a successful apply AFTER a failure clears the toast", async () => {
    vi.useFakeTimers();
    try {
      const evts: RitualEvent[] = [];
      (useEventStream as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        events: [...evts],
        status: "open",
        lastEventId: evts.at(-1)?.id ?? null
      }));

      const { result, rerender } = renderHook(() => useReloadOnApplied("proj-1"));

      evts.push(applyCompleted("proj-1:1", false, { parseError: "boom" }));
      rerender();
      expect(result.current.toast).toBe("boom");

      evts.push(applyCompleted("proj-1:2", true));
      rerender();
      // Toast clears synchronously (the success arrival is the trigger);
      // cacheBuster updates after the debounce.
      expect(result.current.toast).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(result.current.cacheBuster).toBe("proj-1:2");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useReloadOnApplied — manualReload (bypasses debounce, works with flag OFF)", () => {
  it("manualReload() updates cacheBuster immediately to a Date.now() string (no debounce)", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });

    const beforeNow = Date.now();
    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    expect(result.current.cacheBuster).toBe("");

    act(() => { result.current.manualReload(); });

    const afterNow = Date.now();
    expect(result.current.cacheBuster).not.toBe("");
    const parsed = Number(result.current.cacheBuster);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(beforeNow);
    expect(parsed).toBeLessThanOrEqual(afterNow);
  });

  it("calling manualReload twice produces two distinct cacheBuster values (each click re-busts)", async () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [], status: "disabled", lastEventId: null
    });

    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    act(() => { result.current.manualReload(); });
    const first = result.current.cacheBuster;
    // Real clock advances even on a fast machine; await one macrotask so Date.now() ticks.
    await new Promise((r) => setTimeout(r, 5));
    act(() => { result.current.manualReload(); });
    expect(result.current.cacheBuster).not.toBe(first);
  });

  it("flag OFF (events array empty, status='disabled'): hook is a no-op for SSE; manualReload still updates cacheBuster", () => {
    (useEventStream as ReturnType<typeof vi.fn>).mockReturnValue({
      events: [],            // disabled provider returns empty
      status: "disabled",
      lastEventId: null
    });

    const { result } = renderHook(() => useReloadOnApplied("proj-1"));
    expect(result.current.cacheBuster).toBe("");
    expect(result.current.toast).toBeNull();

    act(() => { result.current.manualReload(); });
    expect(result.current.cacheBuster).not.toBe("");
  });
});
