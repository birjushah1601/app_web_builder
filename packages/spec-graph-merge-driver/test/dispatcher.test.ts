import { describe, expect, it } from "vitest";
import { dispatchMerge, UnknownPatternError } from "../src/merge/dispatcher.js";

describe("dispatchMerge", () => {
  it("routes `.atlas/events.jsonl` to the events merger", async () => {
    const merged = await dispatchMerge({
      pathname: ".atlas/events.jsonl",
      base: "",
      ours: '{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n',
      theirs: '{"id":"2","createdAt":"2026-01-02T00:00:00Z"}\n',
      databaseUrl: undefined
    });
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("routes `.atlas/spec.graph.json` to the spec-graph merger", async () => {
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: {} });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "n1" }], edges: [], metadata: {} });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "n2" }], edges: [], metadata: {} });
    const merged = await dispatchMerge({
      pathname: ".atlas/spec.graph.json",
      base,
      ours,
      theirs,
      databaseUrl: undefined // force fallback
    });
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("tolerates forward vs backslash separators on Windows-style paths", async () => {
    const merged = await dispatchMerge({
      pathname: ".atlas\\events.jsonl",
      base: "",
      ours: '{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n',
      theirs: "",
      databaseUrl: undefined
    });
    expect(merged.trim().split("\n")).toHaveLength(1);
  });

  it("throws UnknownPatternError for unhandled paths", async () => {
    await expect(
      dispatchMerge({
        pathname: "src/index.ts",
        base: "",
        ours: "",
        theirs: "",
        databaseUrl: undefined
      })
    ).rejects.toBeInstanceOf(UnknownPatternError);
  });

  it("UnknownPatternError carries the offending pathname", async () => {
    try {
      await dispatchMerge({ pathname: "foo.bar", base: "", ours: "", theirs: "", databaseUrl: undefined });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as UnknownPatternError).pathname).toBe("foo.bar");
    }
  });
});
