import { describe, it, expect } from "vitest";
import { computeHealthSummary } from "../src/compute-health.js";
import { InMemoryGrafanaClient } from "../src/grafana-client.js";

describe("computeHealthSummary", () => {
  it("returns green when availability >= 0.999 and openAlerts=0", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("atlas_availability_ratio", 0.9995);
    c.preloadInstant("atlas_open_burn_alerts", 0);
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("green");
    expect(result.availabilityRatio).toBeCloseTo(0.9995);
    expect(result.openAlerts).toBe(0);
  });

  it("returns amber when availability >= 0.99 but < 0.999 OR openAlerts > 0", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("atlas_availability_ratio", 0.995);
    c.preloadInstant("atlas_open_burn_alerts", 0);
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("amber");
  });

  it("returns red when availability < 0.99", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("atlas_availability_ratio", 0.95);
    c.preloadInstant("atlas_open_burn_alerts", 1);
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("red");
  });

  it("returns unknown when queries throw", async () => {
    const c = new InMemoryGrafanaClient();
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("unknown");
  });
});
