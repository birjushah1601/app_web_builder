import { describe, expect, it } from "vitest";
import { NodeSchema, nodeRegistry } from "../../src/nodes/index.js";

describe("nodes index", () => {
  it("discriminated union narrows on kind", () => {
    const parsed = NodeSchema.parse({
      kind: "page",
      id: "page:home",
      path: "/",
      title: "Home",
      renderMode: "ssr"
    });
    if (parsed.kind === "page") {
      expect(parsed.path).toBe("/");
    } else {
      throw new Error("expected page");
    }
  });

  it("registry contains every node kind", () => {
    expect(Object.keys(nodeRegistry).sort()).toEqual([
      "aifeature", "authboundary", "clientstate", "compliance", "component",
      "dataresidency", "dependency", "designtoken", "endpoint", "flow",
      "mediaasset", "model", "page", "provider", "region", "route",
      "runtime", "test", "workloadtopology"
    ]);
  });

  it("union-level refinement catches AuthBoundary type=role with empty roles", () => {
    expect(() =>
      NodeSchema.parse({
        kind: "authboundary",
        id: "authboundary:admin",
        name: "AdminOnly",
        type: "role",
        roles: [],
        permissions: [],
        bypassConditions: []
      })
    ).toThrow();
  });
});
