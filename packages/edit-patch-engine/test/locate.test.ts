import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import { locateByAtlasId } from "../src/locate.js";

function parseTsx(src: string) {
  return parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
}

describe("locateByAtlasId", () => {
  it("returns the JSXOpeningElement matching the given atlasId", () => {
    const ast = parseTsx(`export default () => <h1 data-atlas-id="abc123">x</h1>;`);
    const found = locateByAtlasId(ast, "abc123");
    expect(found).not.toBeNull();
    expect(found?.openingElement.name.type).toBe("JSXIdentifier");
  });

  it("returns null when no element carries that atlasId", () => {
    const ast = parseTsx(`export default () => <h1 data-atlas-id="abc123">x</h1>;`);
    expect(locateByAtlasId(ast, "does-not-exist")).toBeNull();
  });

  it("finds nested elements", () => {
    const ast = parseTsx(`
      export default () => (
        <div data-atlas-id="outer">
          <span data-atlas-id="inner">x</span>
        </div>
      );
    `);
    const inner = locateByAtlasId(ast, "inner");
    expect(inner?.openingElement.attributes.length).toBeGreaterThan(0);
  });
});
