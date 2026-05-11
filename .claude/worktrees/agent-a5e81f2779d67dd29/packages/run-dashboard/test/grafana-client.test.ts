import { describe, it, expect } from "vitest";
import { InMemoryGrafanaClient } from "../src/grafana-client.js";

describe("InMemoryGrafanaClient", () => {
  it("queryRange returns whatever was preloaded", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadRange('up{service="x"}', [{ ts: "2026-04-22T00:00:00.000Z", value: 1 }]);
    const result = await c.queryRange({
      query: 'up{service="x"}',
      fromIso: "2026-04-22T00:00:00.000Z",
      toIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.points).toEqual([{ ts: "2026-04-22T00:00:00.000Z", value: 1 }]);
  });

  it("queryInstant returns the preloaded value", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("sum(rate(http_requests_total[5m]))", 42);
    const result = await c.queryInstant({ query: "sum(rate(http_requests_total[5m]))" });
    expect(result.value).toBe(42);
  });

  it("queryInstant throws for unknown query", async () => {
    const c = new InMemoryGrafanaClient();
    await expect(c.queryInstant({ query: "nope" })).rejects.toThrow();
  });
});
