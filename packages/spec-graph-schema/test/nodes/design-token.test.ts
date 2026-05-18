import { describe, expect, it } from "vitest";
import { DesignTokenSchema } from "../../src/nodes/design-token.js";

const valid = {
  kind: "designtoken" as const,
  id: "designtoken:color-primary-500",
  name: "color.primary.500",
  category: "color",
  value: "#3B82F6",
  scale: "light"
};

describe("DesignTokenSchema", () => {
  it("accepts valid token", () => {
    expect(() => DesignTokenSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown category", () => {
    expect(() => DesignTokenSchema.parse({ ...valid, category: "fragrance" })).toThrow();
  });
  it("scale defaults to undefined when omitted", () => {
    const { scale: _, ...rest } = valid;
    const parsed = DesignTokenSchema.parse(rest);
    expect(parsed.scale).toBeUndefined();
  });
  it("contrastGroup is optional", () => {
    expect(() =>
      DesignTokenSchema.parse({ ...valid, contrastGroup: "AAA" })
    ).not.toThrow();
  });
});
