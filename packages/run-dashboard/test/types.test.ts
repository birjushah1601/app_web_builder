import { describe, it, expect } from "vitest";
import {
  PersonaTierSchema,
  HealthSummarySchema,
  EndpointStatSchema,
  TraceLinkSchema
} from "../src/types.js";

describe("PersonaTierSchema", () => {
  it("accepts ama / diego / priya", () => {
    for (const p of ["ama", "diego", "priya"]) {
      expect(PersonaTierSchema.safeParse(p).success).toBe(true);
    }
  });
  it("rejects unknown personas", () => {
    expect(PersonaTierSchema.safeParse("admin").success).toBe(false);
  });
});

describe("HealthSummarySchema", () => {
  it("accepts a green summary", () => {
    expect(
      HealthSummarySchema.safeParse({
        light: "green",
        availabilityRatio: 0.999,
        openAlerts: 0,
        windowFromIso: "2026-04-22T00:00:00.000Z",
        windowToIso: "2026-04-22T01:00:00.000Z"
      }).success
    ).toBe(true);
  });
  it("rejects availabilityRatio > 1", () => {
    expect(
      HealthSummarySchema.safeParse({
        light: "green",
        availabilityRatio: 1.5,
        openAlerts: 0,
        windowFromIso: "2026-04-22T00:00:00.000Z",
        windowToIso: "2026-04-22T01:00:00.000Z"
      }).success
    ).toBe(false);
  });
});

describe("EndpointStatSchema", () => {
  it("accepts a valid endpoint stat", () => {
    expect(
      EndpointStatSchema.safeParse({
        endpointId: "GET /api/users",
        requestCount: 1000,
        errorCount: 3,
        p50Ms: 80,
        p95Ms: 400,
        p99Ms: 800
      }).success
    ).toBe(true);
  });
  it("rejects negative latency", () => {
    expect(
      EndpointStatSchema.safeParse({
        endpointId: "x",
        requestCount: 0,
        errorCount: 0,
        p50Ms: -1,
        p95Ms: 0,
        p99Ms: 0
      }).success
    ).toBe(false);
  });
});

describe("TraceLinkSchema", () => {
  it("requires a 32-char hex traceId", () => {
    expect(
      TraceLinkSchema.safeParse({
        traceId: "0".repeat(32),
        rootEndpoint: "GET /",
        durationMs: 100,
        errorOccurred: false,
        startedAtIso: "2026-04-22T00:00:00.000Z"
      }).success
    ).toBe(true);
    expect(
      TraceLinkSchema.safeParse({
        traceId: "abc",
        rootEndpoint: "GET /",
        durationMs: 100,
        errorOccurred: false,
        startedAtIso: "2026-04-22T00:00:00.000Z"
      }).success
    ).toBe(false);
  });
});
