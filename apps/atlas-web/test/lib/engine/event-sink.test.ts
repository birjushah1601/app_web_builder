import { describe, it, expect, vi } from "vitest";
import { SpecEventsSink } from "@/lib/engine/event-sink.js";

describe("SpecEventsSink", () => {
  it("forwards every RitualEvent to spec_events repo via append", async () => {
    const append = vi.fn(async () => {});
    const sink = new SpecEventsSink({ append } as never, "p-1");
    await sink.emit({
      type: "ritual.started", ritualId: "r-1", ts: "t",
      payload: { intent: "x", editClass: "structural", projectId: "p-1", userId: "u-1" }
    });
    expect(append).toHaveBeenCalledOnce();
    const call = append.mock.calls[0];
    expect(call[0]).toBe("p-1");
    expect(call[1]).toMatchObject({ eventType: "ritual.started" });
  });
});
