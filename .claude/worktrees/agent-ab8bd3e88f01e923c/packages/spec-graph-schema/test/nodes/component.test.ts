import { describe, expect, it } from "vitest";
import { ComponentSchema } from "../../src/nodes/component.js";

const valid = {
  kind: "component" as const,
  id: "component:Button",
  name: "Button",
  propsSchema: { label: { type: "string" } },
  isServerComponent: false,
  styleApproach: "tailwind"
};

describe("ComponentSchema", () => {
  it("accepts valid component", () => {
    expect(() => ComponentSchema.parse(valid)).not.toThrow();
  });
  it("requires name", () => {
    expect(() => ComponentSchema.parse({ ...valid, name: undefined })).toThrow();
  });
  it("rejects unknown styleApproach", () => {
    expect(() => ComponentSchema.parse({ ...valid, styleApproach: "neon" })).toThrow();
  });
  it("isServerComponent defaults to false when omitted", () => {
    const { isServerComponent: _, ...withoutFlag } = valid;
    const parsed = ComponentSchema.parse(withoutFlag);
    expect(parsed.isServerComponent).toBe(false);
  });
  it("accepts a11yAnnotations record", () => {
    expect(() =>
      ComponentSchema.parse({ ...valid, a11yAnnotations: { role: "button" } })
    ).not.toThrow();
  });
});
