import { describe, it, expect, vi } from "vitest";
import { BackendArtifactRole } from "../../src/backend-artifact/role.js";

const OPENAPI = {
  openapi: "3.1.0",
  paths: { "/health": { get: { operationId: "h", responses: { "200": { description: "ok" } } } } }
};

function makeFetcher(map: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const m = map[url];
    if (!m) throw new Error(`unmocked fetch: ${url}`);
    return new Response(JSON.stringify(m.body), { status: m.status });
  });
}

describe("BackendArtifactRole", () => {
  it("emits a ritual.artifact_emitted event with a validated BackendArtifact", async () => {
    const fetcher = makeFetcher({
      "https://sb-1.preview/health": { status: 200, body: { status: "ok" } },
      "https://sb-1.preview/openapi.json": { status: 200, body: OPENAPI }
    });
    const role = new BackendArtifactRole({ fetcher, readinessTimeoutMs: 50, readinessPollMs: 5 });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: { sandboxId: "sb-1", previewUrl: "https://sb-1.preview" }
    });
    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    expect(ev).toBeDefined();
    const artifact = (ev?.payload as { artifact: { kind: string; routes: unknown[] } }).artifact;
    expect(artifact.kind).toBe("backend-rest-api");
    expect(artifact.routes).toHaveLength(1);
    expect(out.diff.kind).toBe("none");
  });

  it("retries /health until it returns 200", async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        calls++;
        if (calls < 3) return new Response("", { status: 502 });
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response(JSON.stringify(OPENAPI), { status: 200 });
    });
    const role = new BackendArtifactRole({ fetcher, readinessTimeoutMs: 200, readinessPollMs: 5 });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: { sandboxId: "sb-1", previewUrl: "https://sb-1.preview" }
    });
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("emits a failure event when previewUrl is missing", async () => {
    const fetcher = vi.fn();
    const role = new BackendArtifactRole({ fetcher, readinessTimeoutMs: 50, readinessPollMs: 5 });
    const out = await role.run({
      ritualId: "r-1",
      intent: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "",
      priorArtifact: { sandboxId: "sb-1" }
    });
    expect(out.events.some((e) => e.eventType === "backend-artifact.failed")).toBe(true);
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
