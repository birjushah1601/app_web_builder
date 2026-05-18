import { describe, it, expect } from "vitest";
import { renderFocusedRefineUserTurn } from "../src/render-focused-refine.js";

describe("renderFocusedRefineUserTurn", () => {
  it("surfaces target file path, atlasId, source slice, and instruction prominently", () => {
    const out = renderFocusedRefineUserTurn({
      instruction: "make this 3 columns",
      targetFile: "src/app/page.tsx",
      targetAtlasId: "abc123",
      sourceSlice: `<section className="grid grid-cols-1">...</section>`
    });
    expect(out).toContain("make this 3 columns");
    expect(out).toContain("src/app/page.tsx");
    expect(out).toContain("abc123");
    expect(out).toContain("grid-cols-1");
    expect(out).toContain("Edit ONLY this element");
  });
});
