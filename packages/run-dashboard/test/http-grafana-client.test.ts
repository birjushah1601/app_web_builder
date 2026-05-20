import { describe, it, expect, vi } from "vitest";
import { HttpGrafanaClient, HttpGrafanaClientError } from "../src/http-grafana-client.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })) as unknown as typeof fetch;
}

describe("HttpGrafanaClient.queryInstant", () => {
  it("returns scalar result value as number", async () => {
    const fetchFn = mockFetch(200, {
      status: "success",
      data: { resultType: "scalar", result: [1745327400, "42.5"] }
    });
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    const r = await c.queryInstant({ query: "up" });
    expect(r.value).toBeCloseTo(42.5);
  });

  it("returns first vector sample's value", async () => {
    const fetchFn = mockFetch(200, {
      status: "success",
      data: {
        resultType: "vector",
        result: [
          { metric: { endpoint: "GET /a" }, value: [1745327400, "100"] },
          { metric: { endpoint: "GET /b" }, value: [1745327400, "200"] }
        ]
      }
    });
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    const r = await c.queryInstant({ query: "sum(rate(http_requests_total[5m]))" });
    expect(r.value).toBe(100);
  });

  it("throws HttpGrafanaClientError on empty vector", async () => {
    const fetchFn = mockFetch(200, {
      status: "success",
      data: { resultType: "vector", result: [] }
    });
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    await expect(c.queryInstant({ query: "x" })).rejects.toThrow(HttpGrafanaClientError);
  });

  it("throws HttpGrafanaClientError on Prometheus-level error", async () => {
    const fetchFn = mockFetch(200, {
      status: "error",
      errorType: "bad_data",
      error: "parse error at char 5"
    });
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    await expect(c.queryInstant({ query: "bad syntax" })).rejects.toThrow(/parse error/);
  });

  it("throws HttpGrafanaClientError on non-2xx HTTP", async () => {
    const fetchFn = mockFetch(500, {});
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    await expect(c.queryInstant({ query: "x" })).rejects.toThrow(/HTTP 500/);
  });

  it("sets Authorization: Bearer header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: { resultType: "scalar", result: [0, "1"] }
        })
      };
    }) as unknown as typeof fetch;
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "tok-123", fetchFn });
    await c.queryInstant({ query: "up" });
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer tok-123");
  });
});

describe("HttpGrafanaClient.queryRange", () => {
  it("maps matrix values to { ts, value } points", async () => {
    const fetchFn = mockFetch(200, {
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: {},
            values: [
              [1745327400, "1.0"],
              [1745327460, "1.5"]
            ]
          }
        ]
      }
    });
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    const r = await c.queryRange({
      query: "up",
      fromIso: "2026-04-22T00:00:00.000Z",
      toIso: "2026-04-22T00:10:00.000Z"
    });
    expect(r.points).toHaveLength(2);
    expect(r.points[0]?.value).toBe(1.0);
    expect(r.points[1]?.value).toBe(1.5);
  });

  it("passes start/end/step query params", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: { resultType: "matrix", result: [] }
        })
      };
    }) as unknown as typeof fetch;
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn, defaultStepSec: 30 });
    await c.queryRange({
      query: "up",
      fromIso: "2026-04-22T00:00:00.000Z",
      toIso: "2026-04-22T00:10:00.000Z"
    });
    const url = new URL(calls[0]!);
    expect(url.searchParams.get("step")).toBe("30");
    expect(url.searchParams.get("start")).toBe(String(Math.floor(new Date("2026-04-22T00:00:00.000Z").getTime() / 1000)));
    expect(url.searchParams.get("end")).toBe(String(Math.floor(new Date("2026-04-22T00:10:00.000Z").getTime() / 1000)));
  });

  it("returns empty points when matrix result is empty", async () => {
    const fetchFn = mockFetch(200, {
      status: "success",
      data: { resultType: "matrix", result: [] }
    });
    const c = new HttpGrafanaClient({ baseUrl: "http://x", token: "t", fetchFn });
    const r = await c.queryRange({
      query: "up",
      fromIso: "2026-04-22T00:00:00.000Z",
      toIso: "2026-04-22T00:10:00.000Z"
    });
    expect(r.points).toEqual([]);
  });
});
