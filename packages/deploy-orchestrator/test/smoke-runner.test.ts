import { describe, it, expect, vi } from "vitest";
import { runSmokeTests } from "../src/smoke-runner.js";
import type { DeployArtifact } from "@atlas/workflow-engine";

const DEPLOY: DeployArtifact = {
  schemaVersion: "1",
  kind: "deploy",
  target: "k8s",
  argoApplication: { file: "x", name: "x", repoUrl: "x", path: "x", content: "x" },
  imageBuilds: [],
  smokeTests: [
    { url: "/health", expectStatus: 200 },
    { url: "/api/v1/status", method: "post", expectStatus: 201, expectBodyContains: "ok" }
  ]
};

describe("runSmokeTests", () => {
  it("returns empty array when artifact has no smoke tests", async () => {
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [] },
      publicUrl: "https://x.atlas.dev",
      fetcher: vi.fn()
    });
    expect(r).toEqual([]);
  });

  it("returns ok=true when status matches expectStatus", async () => {
    const fetcher = vi.fn(async () =>
      new Response('{"status":"ok"}', { status: 200 })
    );
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.ok).toBe(true);
    expect(r[0]?.status).toBe(200);
    expect(r[0]?.bodyExcerpt).toContain("ok");
    expect(r[0]?.error).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("https://x.atlas.dev/health", expect.objectContaining({ method: "GET" }));
  });

  it("returns ok=false when status doesn't match expectStatus", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.status).toBe(500);
    expect(r[0]?.error).toMatch(/status 500.*expected 200/i);
  });

  it("returns ok=false with status=0 when fetch throws", async () => {
    const fetcher = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/health", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.status).toBe(0);
    expect(r[0]?.error).toMatch(/ECONNREFUSED/);
  });

  it("checks expectBodyContains when set", async () => {
    const fetcher = vi.fn(async () => new Response("hello world", { status: 200 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/x", expectStatus: 200, expectBodyContains: "missing" }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/body did not contain "missing"/i);
  });

  it("uses the method specified on the smoke test (default GET)", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 201 }));
    await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [
        { url: "/x", method: "post", expectStatus: 201 },
        { url: "/y", expectStatus: 201 }
      ]},
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://x.atlas.dev/x", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://x.atlas.dev/y", expect.objectContaining({ method: "GET" }));
  });

  it("caps bodyExcerpt at 200 chars", async () => {
    const longBody = "x".repeat(500);
    const fetcher = vi.fn(async () => new Response(longBody, { status: 200 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/x", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.bodyExcerpt?.length).toBeLessThanOrEqual(200);
  });

  it("records latencyMs as a non-negative integer", async () => {
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await runSmokeTests({
      deployArtifact: { ...DEPLOY, smokeTests: [{ url: "/x", expectStatus: 200 }] },
      publicUrl: "https://x.atlas.dev",
      fetcher
    });
    expect(r[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(r[0]?.latencyMs)).toBe(true);
  });
});
