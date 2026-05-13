import { describe, it, expect } from "vitest";
import { applyPatch } from "../src/apply-patch.js";

describe("dom-mutation patches", () => {
  it("delete removes the targeted JSX element from its parent", () => {
    const src = `export default () => <div><h1 data-atlas-id="a">x</h1><p>y</p></div>;`;
    const r = applyPatch(src, { kind: "dom-mutation", atlasId: "a", op: { kind: "delete" } });
    expect(r.ok).toBe(true);
    expect(r.newContent).not.toContain("data-atlas-id=\"a\"");
    expect(r.newContent).toContain("<p>y</p>");
  });

  it("duplicate inserts a clone of the element adjacent to itself", () => {
    const src = `export default () => <div><h1 data-atlas-id="a">x</h1></div>;`;
    const r = applyPatch(src, { kind: "dom-mutation", atlasId: "a", op: { kind: "duplicate" } });
    expect(r.ok).toBe(true);
    const matches = r.newContent!.match(/<h1[^>]*>x<\/h1>/g);
    expect(matches?.length).toBe(2);
  });

  it("delete invert restores the deleted subtree", () => {
    const src = `export default () => <div><h1 data-atlas-id="a">x</h1></div>;`;
    const r = applyPatch(src, { kind: "dom-mutation", atlasId: "a", op: { kind: "delete" } });
    expect(r.inverse?.kind).toBe("dom-mutation");
    expect((r.inverse as { capturedSubtree?: string }).capturedSubtree).toBeDefined();
  });
});
