import { describe, it, expect } from "vitest";
import { diffGraphs } from "../src/diff.js";

const baseGraph = {
  schemaVersion: "1.0.0", projectId: "p", name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DB" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "t", updatedAt: "t",
  nodes: { "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" } },
  edges: [{ type: "renders", from: "page:home", to: "cmp:header" }]
};

describe("diffGraphs", () => {
  it("empty diff for identical graphs", () => {
    expect(diffGraphs(baseGraph as never, baseGraph as never)).toEqual([]);
  });

  it("modified field on existing node", () => {
    const after = { ...baseGraph, nodes: { ...baseGraph.nodes, "page:home": { ...baseGraph.nodes["page:home"], title: "Welcome" } } };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes).toEqual([{ kind: "modified", nodeId: "page:home", fieldPath: "title", oldValue: "Home", newValue: "Welcome" }]);
  });

  it("added node", () => {
    const after = {
      ...baseGraph,
      nodes: { ...baseGraph.nodes, "page:about": { kind: "page", id: "page:about", path: "/about", title: "About", renderMode: "ssr", routeRef: "GET /about" } }
    };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes.find((c) => c.nodeId === "page:about" && c.kind === "added")).toBeDefined();
  });

  it("removed node", () => {
    const after = { ...baseGraph, nodes: {} };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes.find((c) => c.nodeId === "page:home" && c.kind === "removed")).toBeDefined();
  });

  it("nested field modification (e.g. databaseProvider.region)", () => {
    const after = { ...baseGraph, databaseProvider: { ...baseGraph.databaseProvider, region: "eu-west-1" } };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes.some((c) => c.nodeId === "$root" && c.fieldPath === "databaseProvider.region" && c.kind === "modified")).toBe(true);
  });
});
