import { describe, it, expect } from "vitest";
import { applyTextReplace } from "../src/patches/text-replace.js";

describe("applyTextReplace", () => {
  it("replaces the text content of the targeted JSX element", () => {
    const src = `export default () => <h1 data-atlas-id="hero">Hello</h1>;`;
    const result = applyTextReplace(src, {
      kind: "text-replace",
      atlasId: "hero",
      oldText: "Hello",
      newText: "Welcome"
    });
    expect(result.ok).toBe(true);
    expect(result.newContent).toContain("Welcome");
    expect(result.newContent).not.toContain(">Hello<");
  });

  it("returns ok=false with error='not-found' when atlasId missing", () => {
    const src = `export default () => <h1 data-atlas-id="hero">x</h1>;`;
    const result = applyTextReplace(src, {
      kind: "text-replace",
      atlasId: "missing",
      oldText: "x",
      newText: "y"
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not-found");
  });

  it("produces an invert patch that reverses the change", () => {
    const src = `export default () => <h1 data-atlas-id="hero">Hello</h1>;`;
    const result = applyTextReplace(src, {
      kind: "text-replace",
      atlasId: "hero",
      oldText: "Hello",
      newText: "Welcome"
    });
    expect(result.inverse).toEqual({
      kind: "text-replace",
      atlasId: "hero",
      oldText: "Welcome",
      newText: "Hello"
    });
  });
});
