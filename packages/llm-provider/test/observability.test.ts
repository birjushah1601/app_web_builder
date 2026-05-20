import { describe, it, expect } from "vitest";
import { Registry } from "prom-client";
import { createProviderMetrics, instrumentCall } from "../src/observability.js";
import { NetworkError } from "../src/errors.js";

describe("observability", () => {
  it("createProviderMetrics registers counter + histogram", () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);
    expect(metrics.requestsTotal).toBeDefined();
    expect(metrics.latencySeconds).toBeDefined();
  });

  it("instrumentCall increments success counter on resolve", async () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);
    const result = await instrumentCall(
      { provider: "anthropic", model: "sonnet-4-6", metrics },
      async () => "ok"
    );
    expect(result).toBe("ok");
    const raw = await registry.getMetricsAsJSON();
    const reqMetric = raw.find((m) => m.name === "atlas_llm_provider_requests_total");
    expect(reqMetric).toBeDefined();
    const val = (reqMetric as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values
      .find((v) => v.labels.status === "success");
    expect(val?.value).toBe(1);
  });

  it("instrumentCall labels error status", async () => {
    const registry = new Registry();
    const metrics = createProviderMetrics(registry);
    await expect(instrumentCall(
      { provider: "anthropic", model: "sonnet-4-6", metrics },
      async () => { throw new NetworkError("x"); }
    )).rejects.toThrow();
    const raw = await registry.getMetricsAsJSON();
    const reqMetric = raw.find((m) => m.name === "atlas_llm_provider_requests_total");
    const val = (reqMetric as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values
      .find((v) => v.labels.status === "error");
    expect(val?.value).toBe(1);
  });
});
