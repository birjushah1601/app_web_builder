import { describe, expect, it } from "vitest";
import { mergeSpecGraphJsonFallback } from "../src/merge/spec-graph-json.js";

const graph = (nodes: unknown[] = [], edges: unknown[] = [], extras: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, nodes, edges, metadata: {}, ...extras });

describe("mergeSpecGraphJsonFallback", () => {
  it("returns base content when ours and theirs equal base", () => {
    const b = graph([{ id: "n1" }]);
    const merged = mergeSpecGraphJsonFallback(b, b, b);
    const parsed = JSON.parse(merged);
    expect(parsed.nodes).toEqual([{ id: "n1" }]);
    expect(parsed.__atlas_merge_note__).toBeUndefined();
  });

  it("unions nodes by id with no overlap", () => {
    const base = graph([]);
    const ours = graph([{ id: "n1", label: "A" }]);
    const theirs = graph([{ id: "n2", label: "B" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.nodes).toHaveLength(2);
    expect(merged.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("deduplicates nodes by id when both sides add the same id (theirs wins on fields)", () => {
    const base = graph([]);
    const ours = graph([{ id: "n1", label: "ours" }]);
    const theirs = graph([{ id: "n1", label: "theirs" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0].label).toBe("theirs");
  });

  it("unions edges by id", () => {
    const base = graph([], [{ id: "e1", from: "n1", to: "n2" }]);
    const ours = graph([], [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }]);
    const theirs = graph([], [{ id: "e1", from: "n1", to: "n2" }, { id: "e3", from: "n3", to: "n4" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.edges.map((e: { id: string }) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("uses theirs-wins for scalar conflicts and prepends the conflict marker", () => {
    const base = graph([], [], { schemaVersion: 1 });
    const ours = graph([], [], { schemaVersion: 2 });
    const theirs = graph([], [], { schemaVersion: 3 });
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.schemaVersion).toBe(3);
    expect(merged.__atlas_merge_note__).toMatch(/theirs-wins/);
  });

  it("does not add the marker when no scalar conflict occurred", () => {
    const base = graph([{ id: "n1" }]);
    const ours = graph([{ id: "n1" }, { id: "n2" }]);
    const theirs = graph([{ id: "n1" }, { id: "n3" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.__atlas_merge_note__).toBeUndefined();
  });

  it("merges nested metadata as theirs-wins object merge", () => {
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId: "p" } });
    const ours = JSON.stringify({
      schemaVersion: 1,
      nodes: [],
      edges: [],
      metadata: { projectId: "p", name: "ours" }
    });
    const theirs = JSON.stringify({
      schemaVersion: 1,
      nodes: [],
      edges: [],
      metadata: { projectId: "p", name: "theirs", extra: true }
    });
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.metadata.name).toBe("theirs");
    expect(merged.metadata.extra).toBe(true);
  });
});
