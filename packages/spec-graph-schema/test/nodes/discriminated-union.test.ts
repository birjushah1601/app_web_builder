import { describe, it, expect } from "vitest";
import { NodeSchema, nodeRegistry } from "../../src/nodes/index.js";

describe("NodeSchema discriminated union — v1.1", () => {
  it("accepts all 5 new infra kinds through the union", () => {
    const samples: unknown[] = [
      { kind: "region", id: "region:r", code: "r" },
      { kind: "dataresidency", id: "dataresidency:eu", jurisdiction: "EU" },
      { kind: "runtime", id: "runtime:node", language: "node", version: "22" },
      { kind: "provider", id: "provider:aws", name: "aws", type: "hyperscaler" },
      {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:r"]
      }
    ];
    for (const s of samples) {
      const result = NodeSchema.safeParse(s);
      expect(result.success).toBe(true);
    }
  });

  it("nodeRegistry contains all 19 kinds", () => {
    expect(Object.keys(nodeRegistry).sort()).toEqual(
      [
        "aifeature",
        "authboundary",
        "clientstate",
        "compliance",
        "component",
        "dataresidency",
        "dependency",
        "designtoken",
        "endpoint",
        "flow",
        "mediaasset",
        "model",
        "page",
        "provider",
        "region",
        "route",
        "runtime",
        "test",
        "workloadtopology"
      ].sort()
    );
  });
});
