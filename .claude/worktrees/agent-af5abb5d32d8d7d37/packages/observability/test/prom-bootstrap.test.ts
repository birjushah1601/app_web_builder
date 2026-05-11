import { beforeEach, describe, it, expect } from "vitest";
import { initPromRegistry, getPromRegistry, resetPromRegistry } from "../src/prom-bootstrap.js";

describe("initPromRegistry", () => {
  beforeEach(() => resetPromRegistry());

  it("returns a registry with at least the default metrics", async () => {
    initPromRegistry({ serviceName: "atlas-test", serviceVersion: "0.0.0" });
    const reg = getPromRegistry();
    const metrics = await reg.getMetricsAsArray();
    expect(metrics.length).toBeGreaterThan(0);
  });

  it("is idempotent — second init reuses the same registry", () => {
    initPromRegistry({ serviceName: "x", serviceVersion: "0" });
    const a = getPromRegistry();
    initPromRegistry({ serviceName: "x", serviceVersion: "0" });
    const b = getPromRegistry();
    expect(a).toBe(b);
  });

  it("getPromRegistry throws if init never ran", () => {
    expect(() => getPromRegistry()).toThrow(/initPromRegistry/);
  });
});
