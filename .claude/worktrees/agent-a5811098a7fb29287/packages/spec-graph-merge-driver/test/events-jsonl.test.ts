import { describe, expect, it } from "vitest";
import { mergeEventsJsonl } from "../src/merge/events-jsonl.js";

const line = (obj: unknown) => JSON.stringify(obj);
const j = (...objs: unknown[]) => objs.map(line).join("\n") + "\n";

describe("mergeEventsJsonl", () => {
  it("returns the base content when ours and theirs both equal base", () => {
    const base = j({ id: "1", createdAt: "2026-01-01T00:00:00Z", type: "a" });
    const merged = mergeEventsJsonl(base, base, base);
    expect(merged).toBe(base);
  });

  it("unions new events from both sides with no base overlap", () => {
    const base = j({ id: "1", createdAt: "2026-01-01T00:00:00Z", type: "a" });
    const ours = base + j({ id: "2", createdAt: "2026-01-02T00:00:00Z", type: "b" });
    const theirs = base + j({ id: "3", createdAt: "2026-01-03T00:00:00Z", type: "c" });
    const merged = mergeEventsJsonl(base, ours, theirs);
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("deduplicates events with the same id", () => {
    const event = { id: "42", createdAt: "2026-03-01T00:00:00Z", type: "x" };
    const base = "";
    const ours = j(event);
    const theirs = j(event);
    const merged = mergeEventsJsonl(base, ours, theirs);
    expect(merged.trim().split("\n")).toHaveLength(1);
  });

  it("sorts by (id asc, createdAt asc) regardless of input order", () => {
    const base = "";
    const ours = j(
      { id: "b", createdAt: "2026-01-02T00:00:00Z" },
      { id: "a", createdAt: "2026-01-03T00:00:00Z" }
    );
    const theirs = j({ id: "c", createdAt: "2026-01-01T00:00:00Z" });
    const merged = mergeEventsJsonl(base, ours, theirs);
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("handles empty base", () => {
    const ours = j({ id: "1", createdAt: "2026-01-01T00:00:00Z" });
    const theirs = j({ id: "2", createdAt: "2026-01-02T00:00:00Z" });
    const merged = mergeEventsJsonl("", ours, theirs);
    expect(merged.trim().split("\n")).toHaveLength(2);
  });

  it("preserves lines missing an id at the end, in insertion order", () => {
    const base = "";
    const ours = j({ id: "1", createdAt: "2026-01-01T00:00:00Z" }) + `{"malformed":true}\n`;
    const theirs = j({ id: "2", createdAt: "2026-01-02T00:00:00Z" });
    const merged = mergeEventsJsonl(base, ours, theirs);
    const lines = merged.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!)).toEqual({ malformed: true });
  });

  it("is commutative: swap(ours, theirs) ⇒ same output", () => {
    const base = j({ id: "1", createdAt: "2026-01-01T00:00:00Z" });
    const ours = base + j({ id: "2", createdAt: "2026-01-02T00:00:00Z" });
    const theirs = base + j({ id: "3", createdAt: "2026-01-03T00:00:00Z" });
    expect(mergeEventsJsonl(base, ours, theirs)).toBe(mergeEventsJsonl(base, theirs, ours));
  });

  it("collapses blank lines and trailing whitespace", () => {
    const input = `{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n\n\n`;
    const merged = mergeEventsJsonl("", input, "");
    expect(merged).toBe(`{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n`);
  });
});
