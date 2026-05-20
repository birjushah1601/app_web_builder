import { describe, it, expect, vi } from "vitest";
import { Sampler, type LatencySample } from "../src/sampler.js";
import type { RitualEvent } from "@atlas/ritual-engine";

describe("Sampler", () => {
  it("computes elapsed-ms between started and completed for the same ritualId", async () => {
    const samples: LatencySample[] = [];
    const sampler = new Sampler({ onSample: async (s) => { samples.push(s); } });

    const started: RitualEvent = {
      type: "ritual.started", ritualId: "r-1", ts: "2026-04-20T00:00:00.000Z",
      payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" }
    };
    const completed: RitualEvent = {
      type: "ritual.completed", ritualId: "r-1", ts: "2026-04-20T00:00:00.150Z",
      payload: { finalState: "done" }
    };
    await sampler.onEvent(started);
    await sampler.onEvent(completed);

    expect(samples).toHaveLength(1);
    expect(samples[0].ritualId).toBe("r-1");
    expect(samples[0].editClass).toBe("cosmetic");
    expect(samples[0].outcome).toBe("done");
    expect(samples[0].elapsedMs).toBe(150);
  });

  it("ignores completed without preceding started", async () => {
    const samples: LatencySample[] = [];
    const sampler = new Sampler({ onSample: async (s) => { samples.push(s); } });
    await sampler.onEvent({
      type: "ritual.completed", ritualId: "ghost", ts: "t",
      payload: { finalState: "done" }
    });
    expect(samples).toEqual([]);
  });

  it("releases the started entry after completion (no leak)", async () => {
    const samples: LatencySample[] = [];
    const sampler = new Sampler({ onSample: async (s) => { samples.push(s); } });
    await sampler.onEvent({
      type: "ritual.started", ritualId: "r", ts: "2026-04-20T00:00:00.000Z",
      payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" }
    });
    await sampler.onEvent({
      type: "ritual.completed", ritualId: "r", ts: "2026-04-20T00:00:00.100Z",
      payload: { finalState: "done" }
    });
    expect(sampler.activeRituals()).toBe(0);
  });
});
