// test/dag.test.ts
import { describe, it, expect } from "vitest";
import { detectCycle, topoSort, findReadyNodes } from "../src/dag.js";
import type { WorkflowNode } from "../src/types.js";
import { chain, fanOut, fanIn, diamond, withCycle } from "./fixtures/dags.js";

describe("detectCycle", () => {
  it("returns null for an acyclic DAG", () => {
    expect(detectCycle(chain())).toBeNull();
    expect(detectCycle(diamond())).toBeNull();
  });
  it("returns the cycle path when there is one", () => {
    const cycle = detectCycle(withCycle());
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThan(0);
  });
});

describe("topoSort", () => {
  it("returns a valid topological order for a chain", () => {
    const order = topoSort(chain());
    expect(order.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
  it("returns parents before children for a diamond", () => {
    const order = topoSort(diamond()).map((n) => n.id);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("a")).toBeLessThan(idx("b"));
    expect(idx("a")).toBeLessThan(idx("c"));
    expect(idx("b")).toBeLessThan(idx("d"));
    expect(idx("c")).toBeLessThan(idx("d"));
  });
  it("throws on a cyclic graph", () => {
    expect(() => topoSort(withCycle())).toThrow(/cycle/i);
  });
});

describe("findReadyNodes", () => {
  it("a fresh chain returns only the root", () => {
    const ready = findReadyNodes(chain());
    expect(ready.map((n) => n.id)).toEqual(["a"]);
  });
  it("after root done, returns the next node", () => {
    const nodes = chain();
    nodes[0]!.status = "done";
    const ready = findReadyNodes(nodes);
    expect(ready.map((n) => n.id)).toEqual(["b"]);
  });
  it("returns multiple ready nodes when fan-out", () => {
    const nodes = fanOut();
    nodes[0]!.status = "done";
    const ready = findReadyNodes(nodes);
    expect(ready.map((n) => n.id).sort()).toEqual(["b", "c"]);
  });
  it("skips deferred nodes", () => {
    const nodes = chain();
    nodes[0]!.policy.runMode = "deferred";
    const ready = findReadyNodes(nodes);
    expect(ready).toEqual([]);
  });
  it("blocks nodes whose dependency failed", () => {
    const nodes = chain();
    nodes[0]!.status = "failed";
    const ready = findReadyNodes(nodes);
    expect(ready).toEqual([]);
  });
});
