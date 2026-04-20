import { describe, it, expect } from "vitest";
import { serializeSlice, hashSlice } from "../src/graph-slice.js";

const graph = {
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DB" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-20T00:00:00.000Z",
  updatedAt: "2026-04-20T00:00:00.000Z",
  nodes: {
    "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" },
    "page:about": { kind: "page", id: "page:about", path: "/about", title: "About", renderMode: "ssr", routeRef: "GET /about" }
  },
  edges: [
    { type: "renders", from: "page:about", to: "cmp:footer" },
    { type: "renders", from: "page:home", to: "cmp:header" }
  ]
};

describe("serializeSlice / hashSlice", () => {
  it("sorts nodes by id", () => {
    const slice = serializeSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    // After canonicalization, keys are alphabetical: id < kind, so "id" appears before "kind"
    const order = slice.bytes.match(/"id":"(page:[^"]+)","kind":"page"/g) ?? [];
    expect(order).toHaveLength(2);
    expect(order[0]).toContain("page:about"); // lexicographic first
    expect(order[1]).toContain("page:home");
  });

  it("sorts edges by (from, to, type)", () => {
    const slice = serializeSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const renders = slice.bytes.match(/"from":"page:[^"]+","to":"cmp:[^"]+","type":"renders"/g) ?? [];
    expect(renders[0]).toContain('"from":"page:about"'); // page:about < page:home
    expect(renders[1]).toContain('"from":"page:home"');
  });

  it("hashSlice is deterministic across runs", () => {
    const a = hashSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const b = hashSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("different graphs produce different hashes", () => {
    const mutated = { ...graph, nodes: { ...graph.nodes, "page:home": { ...graph.nodes["page:home"], title: "Changed" } } };
    const a = hashSlice(graph as never, { includeAllNodes: true, includeAllEdges: true });
    const b = hashSlice(mutated as never, { includeAllNodes: true, includeAllEdges: true });
    expect(a).not.toBe(b);
  });
});
