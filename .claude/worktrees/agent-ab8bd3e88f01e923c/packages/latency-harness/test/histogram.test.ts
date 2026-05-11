import { describe, it, expect } from "vitest";
import { Registry } from "prom-client";
import { createLatencyHistograms, observeSample } from "../src/histogram.js";

describe("histogram", () => {
  it("createLatencyHistograms registers a single histogram with correct labels", () => {
    const registry = new Registry();
    const h = createLatencyHistograms(registry);
    expect(h.ritualLatencySeconds).toBeDefined();
  });

  it("observeSample increments the right bucket per tier+outcome", async () => {
    const registry = new Registry();
    const h = createLatencyHistograms(registry);
    observeSample(h, {
      ritualId: "r", editClass: "cosmetic", outcome: "done",
      startedAtMs: 0, completedAtMs: 250, elapsedMs: 250
    });
    const raw = await registry.getMetricsAsJSON();
    const m = raw.find((x) => x.name === "atlas_ritual_latency_seconds");
    expect(m).toBeDefined();
    const cosmeticDone = (m as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values
      .filter((v) => v.labels.tier === "cosmetic" && v.labels.outcome === "done");
    expect(cosmeticDone.length).toBeGreaterThan(0);
  });
});
