import { describe, expect, it } from "vitest";
import { PageSchema } from "../../src/nodes/page.js";

const valid = {
  kind: "page" as const,
  id: "page:home",
  path: "/",
  title: "Home",
  layout: "default",
  renderMode: "ssr",
  metadata: { description: "Landing" },
  authRequired: false
};

describe("PageSchema", () => {
  it("accepts a valid page", () => {
    expect(PageSchema.parse(valid)).toEqual({ ...valid, extensions: undefined, a11yAnnotations: undefined, routeRef: undefined });
  });

  it("requires path", () => {
    expect(() => PageSchema.parse({ ...valid, path: undefined })).toThrow();
  });

  it("requires title", () => {
    expect(() => PageSchema.parse({ ...valid, title: undefined })).toThrow();
  });

  it("rejects unknown renderMode", () => {
    expect(() => PageSchema.parse({ ...valid, renderMode: "magic" })).toThrow();
  });

  it("rejects extra top-level properties (additionalProperties false)", () => {
    expect(() => PageSchema.parse({ ...valid, mystery: 1 })).toThrow();
  });

  it("accepts authRequired true with a routeRef present", () => {
    expect(() =>
      PageSchema.parse({ ...valid, authRequired: true, routeRef: "GET /admin" })
    ).not.toThrow();
  });

  it("preserves extensions (lenient)", () => {
    const out = PageSchema.parse({ ...valid, extensions: { custom: { tag: "marketing" } } });
    expect(out.extensions).toEqual({ custom: { tag: "marketing" } });
  });
});
