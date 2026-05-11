import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { LatencyHarness } from "../src/harness.js";
import { BUDGETS } from "../src/budgets.js";
import type { RitualEvent } from "@atlas/ritual-engine";

describe("LatencyHarness end-to-end", () => {
  it("samples → histogram + sliding window + alert when budget violated", async () => {
    const registry = new Registry();
    const alerts: unknown[] = [];
    const h = new LatencyHarness({
      registry,
      budgets: BUDGETS,
      windowSize: 5,
      consecutiveExceeded: 2,
      alertSink: { emit: async (a) => { alerts.push(a); } }
    });

    // Push 7 cosmetic rituals all 300ms (exceeds cosmetic p50 budget 200ms)
    for (let i = 0; i < 7; i++) {
      const id = `r-${i}`;
      const t0 = `2026-04-20T00:00:0${i}.000Z`;
      const t1 = `2026-04-20T00:00:0${i}.300Z`;
      await h.onEvent({ type: "ritual.started", ritualId: id, ts: t0,
        payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" } });
      await h.onEvent({ type: "ritual.completed", ritualId: id, ts: t1, payload: { finalState: "done" } });
    }

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const a = alerts[0] as { tier: string; metric: string };
    expect(a.tier).toBe("cosmetic");
    expect(a.metric).toBe("p50");

    const metrics = await registry.getMetricsAsJSON();
    const lat = metrics.find((m) => m.name === "atlas_ritual_latency_seconds");
    expect(lat).toBeDefined();
  });

  it("windowReport returns per-tier P50/P95 snapshot", async () => {
    const registry = new Registry();
    const h = new LatencyHarness({
      registry, budgets: BUDGETS, windowSize: 100, consecutiveExceeded: 3,
      alertSink: { emit: async () => {} }
    });
    for (let i = 0; i < 10; i++) {
      const id = `r-${i}`;
      const t0 = `2026-04-20T00:00:00.000Z`;
      const t1 = `2026-04-20T00:00:00.${100 + i * 10}Z`;
      await h.onEvent({ type: "ritual.started", ritualId: id, ts: t0,
        payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" } });
      await h.onEvent({ type: "ritual.completed", ritualId: id, ts: t1, payload: { finalState: "done" } });
    }
    const report = h.windowReport();
    expect(report.cosmetic).toBeDefined();
    expect(report.cosmetic!.sampleCount).toBe(10);
    expect(report.cosmetic!.windowP50Ms).toBeGreaterThan(100);
  });
});
