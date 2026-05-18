import { describe, it, expect } from "vitest";
import { computeBurnRate } from "../src/burn-rate.js";
import type { SloDefinition, SloSample } from "../src/types.js";

const slo: SloDefinition = {
  id: "api-avail",
  name: "API",
  kind: "availability",
  target: 0.99,
  windowDays: 7
};

const mkSample = (good: number, total: number): SloSample => ({
  sloId: "api-avail",
  sliceEndIso: "2026-04-21T00:00:00.000Z",
  totalCount: total,
  goodCount: good
});

describe("computeBurnRate", () => {
  it("returns burnRate=0 for empty samples", () => {
    const r = computeBurnRate(slo, []);
    expect(r.burnRate).toBe(0);
    expect(r.alarming).toBe(false);
    expect(r.sampleCount).toBe(0);
  });

  it("returns burnRate=0 when SLO is fully met (1.0 ratio)", () => {
    const r = computeBurnRate(slo, [mkSample(1000, 1000)]);
    expect(r.burnRate).toBe(0);
    expect(r.errorBudgetConsumed).toBe(0);
  });

  it("returns burnRate=1 when error rate exactly equals error budget", () => {
    // target 0.99 → error budget 0.01. 99 good of 100 = 1% error rate.
    const r = computeBurnRate(slo, [mkSample(99, 100)]);
    expect(r.burnRate).toBeCloseTo(1, 5);
    expect(r.errorBudgetConsumed).toBeCloseTo(1, 5);
    expect(r.alarming).toBe(false);
  });

  it("flags alarming=true when burnRate >= default threshold (14)", () => {
    // target 0.99 → error budget 0.01. 80 good of 100 = 20% error rate = 20× burn (well above 14×).
    const r = computeBurnRate(slo, [mkSample(80, 100)]);
    expect(r.burnRate).toBeCloseTo(20, 5);
    expect(r.alarming).toBe(true);
  });

  it("respects custom alarmingThreshold", () => {
    // 5% error rate = 5× burn.
    const r = computeBurnRate(slo, [mkSample(95, 100)], { alarmingThreshold: 5 });
    expect(r.burnRate).toBeCloseTo(5, 5);
    expect(r.alarming).toBe(true);
  });

  it("aggregates multiple samples", () => {
    const r = computeBurnRate(slo, [mkSample(99, 100), mkSample(99, 100)]);
    expect(r.sampleCount).toBe(2);
    expect(r.achievedRatio).toBeCloseTo(0.99, 5);
  });

  it("throws if a sample's sloId mismatches", () => {
    expect(() =>
      computeBurnRate(slo, [{ ...mkSample(99, 100), sloId: "wrong" }])
    ).toThrow(/sloId/);
  });

  it("handles target=1.0 (zero error budget) — any error → burnRate Infinity, alarming", () => {
    const strict: SloDefinition = { ...slo, id: "strict", target: 1.0 };
    const sample: SloSample = { ...mkSample(99, 100), sloId: "strict" };
    const r = computeBurnRate(strict, [sample]);
    expect(r.burnRate).toBe(Infinity);
    expect(r.errorBudgetConsumed).toBe(1);
    expect(r.alarming).toBe(true);
  });
});
