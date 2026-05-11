import { describe, it, expect } from "vitest";
import { i16ModelResidencyRequiresStoresDataIn } from "../../src/invariants/i16-model-residency-requires-stores-data-in.js";

function mkGraph(nodes: Record<string, unknown>, edges: unknown[] = []): never {
  return { nodes, edges } as never;
}

describe("I16_PII_MODEL_MISSING_STORES_DATA_IN", () => {
  it("passes when graph has no region/residency nodes (v1.0-shaped)", () => {
    const graph = mkGraph({
      "model:user": { kind: "model", id: "model:user", piiClassification: "direct" }
    });
    expect(i16ModelResidencyRequiresStoresDataIn(graph)).toEqual([]);
  });

  it("passes when PII model has storesDataIn to a region", () => {
    const graph = mkGraph(
      {
        "region:eu": { kind: "region", id: "region:eu", code: "eu" },
        "model:user": { kind: "model", id: "model:user", piiClassification: "direct" }
      },
      [{ type: "storesDataIn", from: "model:user", to: "region:eu" }]
    );
    expect(i16ModelResidencyRequiresStoresDataIn(graph)).toEqual([]);
  });

  it("fails when PII model lacks storesDataIn but graph has region", () => {
    const graph = mkGraph(
      {
        "region:eu": { kind: "region", id: "region:eu", code: "eu" },
        "model:user": { kind: "model", id: "model:user", piiClassification: "direct" }
      },
      []
    );
    const issues = i16ModelResidencyRequiresStoresDataIn(graph);
    expect(issues.length).toBe(1);
    expect(issues[0]?.code).toBe("I16_PII_MODEL_MISSING_STORES_DATA_IN");
  });

  it("ignores non-PII models (piiClassification=none)", () => {
    const graph = mkGraph(
      {
        "region:eu": { kind: "region", id: "region:eu", code: "eu" },
        "model:log": { kind: "model", id: "model:log", piiClassification: "none" }
      },
      []
    );
    expect(i16ModelResidencyRequiresStoresDataIn(graph)).toEqual([]);
  });
});
