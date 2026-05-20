import { describe, expect, it } from "vitest";
import { topoSort, CyclicDependencyError } from "../src/topo.js";

describe("topoSort", () => {
  it("returns a single node with no dependencies as-is", () => {
    const order = topoSort({ leaf: [] });
    expect(order).toEqual(["leaf"]);
  });

  it("returns the correct order for a linear chain (a → b → c)", () => {
    const order = topoSort({ a: ["b"], b: ["c"], c: [] });
    // c must come before b; b before a
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });

  it("handles multiple roots with a shared dependency", () => {
    const order = topoSort({ root1: ["shared"], root2: ["shared"], shared: [] });
    expect(order.indexOf("shared")).toBeLessThan(order.indexOf("root1"));
    expect(order.indexOf("shared")).toBeLessThan(order.indexOf("root2"));
  });

  it("throws CyclicDependencyError for a two-node cycle", () => {
    expect(() => topoSort({ x: ["y"], y: ["x"] })).toThrow(CyclicDependencyError);
  });

  it("CyclicDependencyError carries the cycle node names", () => {
    try {
      topoSort({ x: ["y"], y: ["x"] });
    } catch (err) {
      expect(err).toBeInstanceOf(CyclicDependencyError);
      const cycleErr = err as CyclicDependencyError;
      expect(cycleErr.cycle.length).toBeGreaterThanOrEqual(2);
      expect(cycleErr.cycle).toContain("x");
      expect(cycleErr.cycle).toContain("y");
    }
  });

  it("throws CyclicDependencyError for a self-referential skill", () => {
    expect(() => topoSort({ self: ["self"] })).toThrow(CyclicDependencyError);
  });
});
