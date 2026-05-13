import { describe, it, expect } from "vitest";
import { annotateAtlasIds } from "../src/annotate.js";

describe("annotateAtlasIds", () => {
  it("inserts data-atlas-id on every JSX opening element that lacks one", () => {
    const src = `export default function Page() {
  return (
    <div>
      <h1>Hello</h1>
      <p>World</p>
    </div>
  );
}`;
    const out = annotateAtlasIds("src/app/page.tsx", src);
    const idMatches = out.match(/data-atlas-id="/g);
    expect(idMatches?.length).toBe(3);
    const out2 = annotateAtlasIds("src/app/page.tsx", src);
    expect(out2).toBe(out);
  });

  it("preserves existing data-atlas-id attributes", () => {
    const src = `export default () => <div data-atlas-id="existing-id">x</div>;`;
    const out = annotateAtlasIds("src/app/page.tsx", src);
    expect(out).toContain('data-atlas-id="existing-id"');
    expect(out.match(/data-atlas-id="/g)?.length).toBe(1);
  });

  it("returns input unchanged when there is no JSX", () => {
    const src = `export const x = 1;`;
    expect(annotateAtlasIds("src/lib/foo.ts", src)).toBe(src);
  });

  it("returns input unchanged on parse error", () => {
    const src = `this is { not valid <jsx`;
    expect(annotateAtlasIds("src/broken.tsx", src)).toBe(src);
  });
});
