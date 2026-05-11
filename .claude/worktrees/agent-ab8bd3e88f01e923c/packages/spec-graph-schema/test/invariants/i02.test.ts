import { describe, expect, it } from "vitest";
import { i02EndpointRouteRef } from "../../src/invariants/i02-endpoint-routeref.js";
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

describe("i02: every Endpoint must carry a routeRef", () => {
  it("ok when no endpoints", () => {
    expect(i02EndpointRouteRef(baseGraph())).toEqual([]);
  });
  it("ok when endpoint has routeRef", () => {
    const g = baseGraph({
      nodes: {
        "endpoint:createUser": {
          kind: "endpoint",
          id: "endpoint:createUser",
          name: "createUser",
          routeRef: "POST /api/users",
          method: "POST"
        }
      } as never
    });
    expect(i02EndpointRouteRef(g)).toEqual([]);
  });
  it("flags endpoint missing routeRef", () => {
    const g = baseGraph({
      nodes: {
        "endpoint:createUser": {
          kind: "endpoint",
          id: "endpoint:createUser",
          name: "createUser",
          method: "POST"
        }
      } as never
    });
    const issues = i02EndpointRouteRef(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I02_ENDPOINT_MISSING_ROUTEREF");
    expect(issues[0]?.nodeId).toBe("endpoint:createUser");
  });
});
