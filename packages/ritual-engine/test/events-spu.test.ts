import { describe, it, expect } from "vitest";
import { RitualEventSchema, type RitualEvent } from "../src/events.js";

// Plan SPU — new event schemas for designer three-pass + asset generation.
// These are loose mirror schemas (payload typed as z.unknown()) participating
// in RitualEventSchema's discriminated union — same shape as the canvas
// mirror schemas already in events.ts.

describe("Plan SPU event schemas", () => {
  it("parses designer.draft.completed", () => {
    const e: RitualEvent = {
      type: "designer.draft.completed",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: { proposal: { recommended: { id: "draft-1" } } }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses designer.critique.started", () => {
    const e: RitualEvent = {
      type: "designer.critique.started",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: {}
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses designer.critique.completed", () => {
    const e: RitualEvent = {
      type: "designer.critique.completed",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: { critique: { findings: [] } }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses designer.revise.started", () => {
    const e: RitualEvent = {
      type: "designer.revise.started",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: {}
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses designer.revise.completed", () => {
    const e: RitualEvent = {
      type: "designer.revise.completed",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: { proposal: { recommended: { id: "final-1" } } }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses asset.gen.started", () => {
    const e: RitualEvent = {
      type: "asset.gen.started",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: {}
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses asset.gen.completed", () => {
    const e: RitualEvent = {
      type: "asset.gen.completed",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: { manifest: { hero: { slot: "hero", url: "/atlas-assets/x.jpg", alt: "h" }, sections: [] } }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("parses asset.gen.failed", () => {
    const e: RitualEvent = {
      type: "asset.gen.failed",
      ritualId: "r-1",
      ts: "2026-05-12T00:00:00.000Z",
      payload: { error: "kaboom" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });
});
