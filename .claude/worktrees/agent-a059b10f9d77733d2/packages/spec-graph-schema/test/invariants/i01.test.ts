import { describe, expect, it } from "vitest";
import { i01PageRouteRef } from "../../src/invariants/i01-page-routeref.js";
import type { SpecGraph } from "../../src/graph.js";

const baseGraph = (extras: Partial<SpecGraph> = {}): SpecGraph => ({
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: [],
  ...extras
});

describe("i01: every Page must carry a routeRef", () => {
  it("ok when no pages", () => {
    expect(i01PageRouteRef(baseGraph())).toEqual([]);
  });
  it("ok when page has routeRef", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" }
      } as never
    });
    expect(i01PageRouteRef(g)).toEqual([]);
  });
  it("flags page missing routeRef", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr" }
      } as never
    });
    const issues = i01PageRouteRef(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I01_PAGE_MISSING_ROUTEREF");
    expect(issues[0]?.nodeId).toBe("page:home");
  });
});
