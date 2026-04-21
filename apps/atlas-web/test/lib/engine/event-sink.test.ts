import { describe, it, expect, vi } from "vitest";
import { SpecEventsSink } from "@/lib/engine/event-sink.js";

describe("SpecEventsSink", () => {
  it("forwards every RitualEvent to spec_events repo via append", async () => {
    const append = vi.fn(async (..._args: unknown[]) => {});
    const sink = new SpecEventsSink({ append } as never, "p-1");
    await sink.emit({
      type: "ritual.started", ritualId: "r-1", ts: "t",
      payload: { intent: "x", editClass: "structural", projectId: "p-1", userId: "u-1" }
    });
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith("p-1", expect.objectContaining({ eventType: "ritual.started" }));
  });
});
