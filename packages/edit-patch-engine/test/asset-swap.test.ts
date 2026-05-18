import { describe, it, expect } from "vitest";
import { applyAssetSwap } from "../src/patches/asset-swap.js";

describe("applyAssetSwap", () => {
  it("swaps src and optional alt on an img element", () => {
    const src = `export default () => <img data-atlas-id="hero" src="/old.jpg" alt="old" />;`;
    const r = applyAssetSwap(src, {
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/old.jpg",
      newUrl: "/new.jpg",
      oldAlt: "old",
      newAlt: "new"
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('src="/new.jpg"');
    expect(r.newContent).toContain('alt="new"');
  });

  it("leaves alt unchanged when newAlt is undefined", () => {
    const src = `export default () => <img data-atlas-id="hero" src="/old.jpg" alt="old" />;`;
    const r = applyAssetSwap(src, {
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/old.jpg",
      newUrl: "/new.jpg"
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('alt="old"');
  });

  it("inverse swaps urls and alts", () => {
    const src = `export default () => <img data-atlas-id="hero" src="/a.jpg" alt="A" />;`;
    const r = applyAssetSwap(src, {
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/a.jpg",
      newUrl: "/b.jpg",
      oldAlt: "A",
      newAlt: "B"
    });
    expect(r.inverse).toMatchObject({
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/b.jpg",
      newUrl: "/a.jpg",
      oldAlt: "B",
      newAlt: "A"
    });
  });
});
