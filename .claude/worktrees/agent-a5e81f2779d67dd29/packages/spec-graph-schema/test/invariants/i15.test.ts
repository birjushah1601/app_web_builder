import { describe, it, expect } from "vitest";
import { i15WorkloadTopologyReferences } from "../../src/invariants/i15-workload-topology-references.js";

function makeGraph(nodes: Record<string, unknown>, edges: unknown[] = []): never {
  return { nodes, edges } as never;
}

describe("I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID", () => {
  it("passes when all refs resolve", () => {
    const graph = makeGraph({
      "provider:aws": {
        kind: "provider",
        id: "provider:aws",
        name: "aws",
        type: "hyperscaler",
        regionRefs: []
      },
      "region:us-east-1": { kind: "region", id: "region:us-east-1", code: "us-east-1" },
      "workloadtopology:main": {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:us-east-1"]
      }
    });
    expect(i15WorkloadTopologyReferences(graph)).toEqual([]);
  });

  it("fails when providerRef is missing", () => {
    const graph = makeGraph({
      "region:us-east-1": { kind: "region", id: "region:us-east-1", code: "us-east-1" },
      "workloadtopology:main": {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:ghost"],
        regionRefs: ["region:us-east-1"]
      }
    });
    const issues = i15WorkloadTopologyReferences(graph);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.code).toBe("I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID");
  });

  it("fails when regionRef is missing", () => {
    const graph = makeGraph({
      "provider:aws": {
        kind: "provider",
        id: "provider:aws",
        name: "aws",
        type: "hyperscaler",
        regionRefs: []
      },
      "workloadtopology:main": {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:ghost"]
      }
    });
    const issues = i15WorkloadTopologyReferences(graph);
    expect(issues.some((i) => i.code === "I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID")).toBe(true);
  });
});
