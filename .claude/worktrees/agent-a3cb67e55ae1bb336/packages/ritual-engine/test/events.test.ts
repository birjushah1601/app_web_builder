import { describe, it, expect, vi } from "vitest";
import {
  RitualEventSchema,
  InMemoryEventSink,
  type RitualEvent,
  type EventSink
} from "../src/events.js";

describe("RitualEvent + EventSink", () => {
  it("RitualEventSchema parses ritual.started", () => {
    const e: RitualEvent = {
      type: "ritual.started",
      ritualId: "r-1",
      ts: "2026-04-20T00:00:00.000Z",
      payload: { intent: "add forgot-password", editClass: "structural", projectId: "p-1", userId: "u-1" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("RitualEventSchema parses ritual.transitioned", () => {
    const e: RitualEvent = {
      type: "ritual.transitioned",
      ritualId: "r-1",
      ts: "2026-04-20T00:00:00.000Z",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("RitualEventSchema parses ritual.escalation_requested", () => {
    const e: RitualEvent = {
      type: "ritual.escalation_requested",
      ritualId: "r-1",
      ts: "2026-04-20T00:00:00.000Z",
      payload: { reason: "ama-blocked-from-L4-security", requestedBy: "u-1" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("InMemoryEventSink stores events in order", async () => {
    const sink = new InMemoryEventSink();
    await sink.emit({
      type: "ritual.started", ritualId: "r-1", ts: "t1",
      payload: { intent: "i", editClass: "structural", projectId: "p", userId: "u" }
    });
    await sink.emit({
      type: "ritual.transitioned", ritualId: "r-1", ts: "t2",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    });
    expect(sink.events()).toHaveLength(2);
    expect(sink.events()[0].type).toBe("ritual.started");
    expect(sink.events()[1].type).toBe("ritual.transitioned");
  });

  it("EventSink interface accepts custom implementations", async () => {
    const captured: RitualEvent[] = [];
    const sink: EventSink = { emit: async (e) => { captured.push(e); } };
    await sink.emit({
      type: "ritual.started", ritualId: "r", ts: "t",
      payload: { intent: "i", editClass: "cosmetic", projectId: "p", userId: "u" }
    });
    expect(captured).toHaveLength(1);
  });
});
