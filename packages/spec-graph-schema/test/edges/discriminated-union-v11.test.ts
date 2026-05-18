import { describe, it, expect } from "vitest";
import { EdgeSchema, EDGE_TYPES, edgeRegistry } from "../../src/edges/index.js";

describe("EdgeSchema discriminated union — v1.1", () => {
  it("EDGE_TYPES includes 3 new infra edges", () => {
    expect(EDGE_TYPES).toContain("runsOn");
    expect(EDGE_TYPES).toContain("storesDataIn");
    expect(EDGE_TYPES).toContain("migratesTo");
  });

  it("accepts runsOn / storesDataIn / migratesTo through the union", () => {
    for (const type of ["runsOn", "storesDataIn", "migratesTo"] as const) {
      expect(
        EdgeSchema.safeParse({ type, from: "component:x", to: "runtime:y" }).success
      ).toBe(true);
    }
  });

  it("edgeRegistry exposes the new edges", () => {
    expect(edgeRegistry.runsOn).toBeDefined();
    expect(edgeRegistry.storesDataIn).toBeDefined();
    expect(edgeRegistry.migratesTo).toBeDefined();
  });
});
