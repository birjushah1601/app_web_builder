import { describe, it, expect } from "vitest";
import { WorkloadTopologySchema } from "../../src/nodes/workload-topology.js";

describe("WorkloadTopologySchema", () => {
  it("accepts a single-region topology", () => {
    expect(
      WorkloadTopologySchema.safeParse({
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:us-east-1"]
      }).success
    ).toBe(true);
  });

  it("accepts all 5 shape values", () => {
    for (const shape of [
      "single-region",
      "multi-region-active-passive",
      "multi-region-active-active",
      "edge-only",
      "hybrid-on-prem-cloud"
    ]) {
      expect(
        WorkloadTopologySchema.safeParse({
          kind: "workloadtopology",
          id: `workloadtopology:${shape}`,
          shape,
          providerRefs: ["provider:x"],
          regionRefs: ["region:x"]
        }).success
      ).toBe(true);
    }
  });

  it("rejects empty providerRefs", () => {
    expect(
      WorkloadTopologySchema.safeParse({
        kind: "workloadtopology",
        id: "workloadtopology:bad",
        shape: "single-region",
        providerRefs: [],
        regionRefs: ["region:x"]
      }).success
    ).toBe(false);
  });

  it("rejects empty regionRefs", () => {
    expect(
      WorkloadTopologySchema.safeParse({
        kind: "workloadtopology",
        id: "workloadtopology:bad",
        shape: "single-region",
        providerRefs: ["provider:x"],
        regionRefs: []
      }).success
    ).toBe(false);
  });
});
