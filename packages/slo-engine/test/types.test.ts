import { describe, it, expect } from "vitest";
import { SloDefinitionSchema, SloSampleSchema } from "../src/types.js";

describe("SloDefinitionSchema", () => {
  it("accepts an availability SLO", () => {
    expect(
      SloDefinitionSchema.safeParse({
        id: "api-availability",
        name: "API availability",
        kind: "availability",
        target: 0.999,
        windowDays: 28
      }).success
    ).toBe(true);
  });

  it("requires latencyThresholdMs when kind=latency", () => {
    expect(
      SloDefinitionSchema.safeParse({
        id: "api-latency",
        name: "API latency",
        kind: "latency",
        target: 0.95,
        windowDays: 7
      }).success
    ).toBe(false);
  });

  it("accepts a latency SLO with threshold", () => {
    expect(
      SloDefinitionSchema.safeParse({
        id: "api-latency",
        name: "API latency",
        kind: "latency",
        target: 0.95,
        windowDays: 7,
        latencyThresholdMs: 500
      }).success
    ).toBe(true);
  });

  it("rejects target > 1", () => {
    expect(
      SloDefinitionSchema.safeParse({
        id: "x",
        name: "x",
        kind: "availability",
        target: 1.5,
        windowDays: 7
      }).success
    ).toBe(false);
  });

  it("rejects availability SLO with latencyThresholdMs", () => {
    expect(
      SloDefinitionSchema.safeParse({
        id: "x",
        name: "x",
        kind: "availability",
        target: 0.99,
        windowDays: 7,
        latencyThresholdMs: 500
      }).success
    ).toBe(false);
  });
});

describe("SloSampleSchema", () => {
  it("accepts a valid sample", () => {
    expect(
      SloSampleSchema.safeParse({
        sloId: "x",
        sliceEndIso: "2026-04-21T12:00:00.000Z",
        totalCount: 100,
        goodCount: 98
      }).success
    ).toBe(true);
  });

  it("rejects goodCount > totalCount", () => {
    expect(
      SloSampleSchema.safeParse({
        sloId: "x",
        sliceEndIso: "2026-04-21T12:00:00.000Z",
        totalCount: 100,
        goodCount: 101
      }).success
    ).toBe(false);
  });
});
