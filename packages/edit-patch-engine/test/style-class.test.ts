import { describe, it, expect } from "vitest";
import { applyStyleClass } from "../src/patches/style-class.js";

describe("applyStyleClass", () => {
  it("appends new Tailwind classes to className", () => {
    const src = `export default () => <h1 data-atlas-id="hero" className="text-xl">x</h1>;`;
    const r = applyStyleClass(src, {
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["text-3xl", "font-bold"],
      removeClasses: ["text-xl"]
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('className="text-3xl font-bold"');
    expect(r.newContent).not.toContain("text-xl");
  });

  it("adds className attribute when element has none", () => {
    const src = `export default () => <h1 data-atlas-id="hero">x</h1>;`;
    const r = applyStyleClass(src, {
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["bg-red-500"],
      removeClasses: []
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('className="bg-red-500"');
  });

  it("inverse swaps add and remove", () => {
    const src = `export default () => <h1 data-atlas-id="hero" className="a">x</h1>;`;
    const r = applyStyleClass(src, {
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["b"],
      removeClasses: ["a"]
    });
    expect(r.inverse).toEqual({
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["a"],
      removeClasses: ["b"]
    });
  });
});
