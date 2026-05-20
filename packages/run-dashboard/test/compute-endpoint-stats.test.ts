import { describe, it, expect } from "vitest";
import { computeEndpointStats, parsePromEndpointSeries } from "../src/compute-endpoint-stats.js";

describe("parsePromEndpointSeries", () => {
  it("parses a series with endpoint label", () => {
    const series = [
      { metric: { endpoint: "GET /a" }, value: 100 },
      { metric: { endpoint: "POST /b" }, value: 50 }
    ];
    expect(parsePromEndpointSeries(series, "value")).toEqual({
      "GET /a": 100,
      "POST /b": 50
    });
  });
});

describe("computeEndpointStats", () => {
  it("merges per-endpoint metrics into EndpointStat[] sorted by requestCount desc", () => {
    const stats = computeEndpointStats({
      requests: { "GET /a": 1000, "POST /b": 50 },
      errors: { "GET /a": 3, "POST /b": 0 },
      p50: { "GET /a": 80, "POST /b": 20 },
      p95: { "GET /a": 400, "POST /b": 60 },
      p99: { "GET /a": 800, "POST /b": 100 }
    });
    expect(stats[0]?.endpointId).toBe("GET /a");
    expect(stats[0]?.requestCount).toBe(1000);
    expect(stats[0]?.errorCount).toBe(3);
    expect(stats[0]?.p95Ms).toBe(400);
    expect(stats[1]?.endpointId).toBe("POST /b");
  });

  it("uses 0 for missing per-endpoint values", () => {
    const stats = computeEndpointStats({
      requests: { "GET /x": 10 },
      errors: {},
      p50: {},
      p95: {},
      p99: {}
    });
    expect(stats[0]?.errorCount).toBe(0);
    expect(stats[0]?.p50Ms).toBe(0);
  });
});
