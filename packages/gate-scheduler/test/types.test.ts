import { describe, it, expect } from "vitest";
import { GateLayerSchema, GateResultSchema, type GateRunner } from "../src/types.js";

describe("gate-scheduler types", () => {
  it("GateLayerSchema accepts L1-L7", () => {
    for (const l of ["L1", "L2", "L3", "L4", "L5", "L6", "L7"]) {
      expect(GateLayerSchema.parse(l)).toBe(l);
    }
  });

  it("GateResultSchema parses a passed result", () => {
    const r = { layer: "L4", status: "passed", summary: "no issues" };
    expect(GateResultSchema.parse(r)).toEqual(r);
  });

  it("GateResultSchema parses a failed result with issues", () => {
    const r = {
      layer: "L4",
      status: "failed",
      summary: "missing RLS",
      issues: [{ severity: "critical", message: "Model:user lacks rlsPolicies.select" }]
    };
    expect(GateResultSchema.parse(r)).toEqual(r);
  });

  it("GateRunner interface accepts a stub implementation", async () => {
    const stub: GateRunner = {
      layer: "L4",
      async run() {
        return { layer: "L4", status: "passed", summary: "ok" };
      }
    };
    expect((await stub.run({} as never)).status).toBe("passed");
  });
});
