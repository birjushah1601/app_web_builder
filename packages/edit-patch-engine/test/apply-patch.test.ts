import { describe, it, expect } from "vitest";
import { applyPatch } from "../src/apply-patch.js";

describe("applyPatch dispatcher", () => {
  it("routes text-replace to applyTextReplace", () => {
    const src = `export default () => <h1 data-atlas-id="h">Hello</h1>;`;
    const r = applyPatch(src, {
      kind: "text-replace",
      atlasId: "h",
      oldText: "Hello",
      newText: "Hi"
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain("Hi");
  });

  it("routes style-class-patch", () => {
    const src = `export default () => <h1 data-atlas-id="h">x</h1>;`;
    const r = applyPatch(src, {
      kind: "style-class-patch",
      atlasId: "h",
      addClasses: ["a"],
      removeClasses: []
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('className="a"');
  });

  it("returns unsupported for dom-mutation in Phase 1", () => {
    const src = `export default () => <h1 data-atlas-id="h">x</h1>;`;
    const r = applyPatch(src, {
      kind: "dom-mutation",
      atlasId: "h",
      op: { kind: "delete" }
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("unsupported");
  });
});
