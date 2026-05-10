import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CanvasManifest } from "@atlas/canvas-runtime";

type FakeEvent = { id: string; projectId: string; ritualId: string; type: string; payload: unknown; ts: number };
const eventsHolder: { current: FakeEvent[] } = { current: [] };

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => ({ events: eventsHolder.current, status: "disabled", lastEventId: null })
}));

import { useCanvasManifest } from "@/lib/canvas/useCanvasManifest";

const MANIFEST_A: CanvasManifest = {
  artifactKind: "frontend-app",
  modes: [
    { id: "designing", renderer: "designing", audience: ["ama"], default: true },
    { id: "preview", renderer: "preview", audience: ["ama"] }
  ]
};

const MANIFEST_B: CanvasManifest = {
  artifactKind: "backend-rest-api",
  modes: [{ id: "schema", renderer: "schema", audience: ["diego"], default: true }]
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

describe("useCanvasManifest", () => {
  it("returns undefined when no architect.canvas_manifest.emitted has arrived", () => {
    reset();
    const { result } = renderHook(() => useCanvasManifest("p-1"));
    expect(result.current.manifest).toBeUndefined();
  });

  it("ignores unrelated event types", () => {
    reset();
    pushEvent("ritual.started", { intent: "hello" });
    pushEvent("role.completed", { role: "architect" });
    const { result } = renderHook(() => useCanvasManifest("p-1"));
    expect(result.current.manifest).toBeUndefined();
  });

  it("extracts the manifest from the latest emitted event", () => {
    reset();
    pushEvent("architect.canvas_manifest.emitted", { manifest: MANIFEST_A });
    const { result } = renderHook(() => useCanvasManifest("p-1"));
    expect(result.current.manifest).toEqual(MANIFEST_A);
  });

  it("the most recent manifest wins when multiple are emitted", () => {
    reset();
    pushEvent("architect.canvas_manifest.emitted", { manifest: MANIFEST_A });
    pushEvent("architect.canvas_manifest.emitted", { manifest: MANIFEST_B });
    const { result } = renderHook(() => useCanvasManifest("p-1"));
    expect(result.current.manifest).toEqual(MANIFEST_B);
  });

  it("stays undefined on a malformed payload (failure-safe)", () => {
    reset();
    pushEvent("architect.canvas_manifest.emitted", { manifest: "not-an-object" });
    pushEvent("architect.canvas_manifest.emitted", { wrongShape: true });
    const { result } = renderHook(() => useCanvasManifest("p-1"));
    expect(result.current.manifest).toBeUndefined();
  });
});
