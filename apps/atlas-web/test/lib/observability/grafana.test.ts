import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getGrafanaClient — flag + env gating (Plan J Task 2)", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    delete process.env.ATLAS_FF_RUN_GRAFANA;
    delete process.env.ATLAS_GRAFANA_URL;
    delete process.env.ATLAS_GRAFANA_TOKEN;
  });

  it("returns undefined when ATLAS_FF_RUN_GRAFANA is unset (default)", async () => {
    process.env.ATLAS_GRAFANA_URL = "https://g.example/api/datasources/proxy/1";
    process.env.ATLAS_GRAFANA_TOKEN = "glsa_test";
    const { getGrafanaClient } = await import("@/lib/observability/grafana");
    expect(getGrafanaClient()).toBeUndefined();
  });

  it("returns undefined when flag is on but ATLAS_GRAFANA_URL is missing", async () => {
    process.env.ATLAS_FF_RUN_GRAFANA = "true";
    process.env.ATLAS_GRAFANA_TOKEN = "glsa_test";
    const { getGrafanaClient } = await import("@/lib/observability/grafana");
    expect(getGrafanaClient()).toBeUndefined();
  });

  it("returns undefined when flag is on but ATLAS_GRAFANA_TOKEN is missing", async () => {
    process.env.ATLAS_FF_RUN_GRAFANA = "true";
    process.env.ATLAS_GRAFANA_URL = "https://g.example/api/datasources/proxy/1";
    const { getGrafanaClient } = await import("@/lib/observability/grafana");
    expect(getGrafanaClient()).toBeUndefined();
  });

  it("returns an HttpGrafanaClient when flag + both env vars are set", async () => {
    process.env.ATLAS_FF_RUN_GRAFANA = "true";
    process.env.ATLAS_GRAFANA_URL = "https://g.example/api/datasources/proxy/1";
    process.env.ATLAS_GRAFANA_TOKEN = "glsa_test";
    const { getGrafanaClient } = await import("@/lib/observability/grafana");
    const client = getGrafanaClient();
    expect(client).toBeDefined();
    expect(client?.constructor.name).toBe("HttpGrafanaClient");
  });
});
