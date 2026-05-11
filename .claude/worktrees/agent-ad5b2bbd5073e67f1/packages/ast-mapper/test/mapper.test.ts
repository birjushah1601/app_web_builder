import { describe, it, expect } from "vitest";
import { FileBackedAstMapper, NullAstMapper } from "../src/mapper.js";
import type { AstMapFile } from "../src/types.js";

const fixture: AstMapFile = {
  version: 1,
  graphHash: "sha256:" + "1".repeat(64),
  generatedAt: "2026-04-21T00:00:00.000Z",
  mappings: [
    {
      nodeId: "page:home",
      ranges: [{ file: "src/app/page.tsx", startLine: 1, startColumn: 0, endLine: 50, endColumn: 1 }],
      confidence: 1.0,
      producer: "ts-compiler@5.6.3"
    },
    {
      nodeId: "component:Hero",
      ranges: [
        { file: "src/components/Hero.tsx", startLine: 1, startColumn: 0, endLine: 30, endColumn: 1 }
      ],
      confidence: 0.85,
      producer: "ts-compiler@5.6.3"
    }
  ]
};

describe("FileBackedAstMapper", () => {
  it("returns mappings by nodeId", () => {
    const m = new FileBackedAstMapper(fixture);
    expect(m.rangesForNode("page:home")?.confidence).toBe(1.0);
    expect(m.rangesForNode("component:Hero")?.ranges[0]?.file).toBe("src/components/Hero.tsx");
  });

  it("returns undefined for unknown nodeId", () => {
    const m = new FileBackedAstMapper(fixture);
    expect(m.rangesForNode("page:unknown")).toBeUndefined();
  });

  it("list() returns every mapping", () => {
    const m = new FileBackedAstMapper(fixture);
    expect(m.list()).toHaveLength(2);
  });

  it("graphHash() returns the source graph hash", () => {
    const m = new FileBackedAstMapper(fixture);
    expect(m.graphHash()).toBe("sha256:" + "1".repeat(64));
  });
});

describe("NullAstMapper", () => {
  it("returns undefined for every nodeId", () => {
    const m = new NullAstMapper();
    expect(m.rangesForNode("page:home")).toBeUndefined();
    expect(m.list()).toEqual([]);
  });
});
