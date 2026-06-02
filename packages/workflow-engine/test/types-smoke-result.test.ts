import { describe, it, expect } from "vitest";
import { SmokeTestResultSchema, DeployResultSchema, type SmokeTestResult } from "../src/types.js";

describe("SmokeTestResultSchema (Plan F.3)", () => {
  const valid: SmokeTestResult = {
    url: "/health",
    method: "get",
    status: 200,
    ok: true,
    latencyMs: 42,
    expectStatus: 200,
    bodyExcerpt: '{"status":"ok"}'
  };

  it("accepts a passed smoke result", () => {
    expect(SmokeTestResultSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a failed smoke result with error message", () => {
    const r = SmokeTestResultSchema.safeParse({
      ...valid, ok: false, status: 0, error: "ECONNREFUSED"
    });
    expect(r.success).toBe(true);
  });

  it("rejects status > 599 or < 0", () => {
    expect(SmokeTestResultSchema.safeParse({ ...valid, status: 600 }).success).toBe(false);
    expect(SmokeTestResultSchema.safeParse({ ...valid, status: -1 }).success).toBe(false);
  });

  it("rejects negative latency", () => {
    expect(SmokeTestResultSchema.safeParse({ ...valid, latencyMs: -1 }).success).toBe(false);
  });

  it("accepts optional expectBodyContains", () => {
    expect(SmokeTestResultSchema.safeParse({ ...valid, expectBodyContains: "ok" }).success).toBe(true);
  });
});

describe("DeployResultSchema.smokeResults (Plan F.3)", () => {
  const baseResult = {
    deployId: "d-1",
    publicUrl: "https://x.atlas.dev",
    argoApplicationName: "x",
    branchSchemaName: "main",
    appliedManifests: [],
    phase: "healthy" as const,
    startedAt: "x"
  };

  it("accepts omitted smokeResults", () => {
    expect(DeployResultSchema.safeParse(baseResult).success).toBe(true);
  });

  it("accepts an empty smokeResults array", () => {
    expect(DeployResultSchema.safeParse({ ...baseResult, smokeResults: [] }).success).toBe(true);
  });

  it("accepts a populated smokeResults array", () => {
    expect(DeployResultSchema.safeParse({
      ...baseResult,
      smokeResults: [{
        url: "/health", method: "get", status: 200, ok: true,
        latencyMs: 42, expectStatus: 200
      }]
    }).success).toBe(true);
  });
});
