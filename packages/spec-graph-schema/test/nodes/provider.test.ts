import { describe, it, expect } from "vitest";
import { ProviderSchema } from "../../src/nodes/provider.js";

describe("ProviderSchema", () => {
  it("accepts a hyperscaler with region refs", () => {
    expect(
      ProviderSchema.safeParse({
        kind: "provider",
        id: "provider:aws",
        name: "aws",
        type: "hyperscaler",
        regionRefs: ["region:us-east-1", "region:eu-west-1"]
      }).success
    ).toBe(true);
  });

  it("accepts regional / on-prem / sovereign types", () => {
    for (const type of ["regional", "on-prem", "sovereign"]) {
      expect(
        ProviderSchema.safeParse({
          kind: "provider",
          id: `provider:${type}`,
          name: type,
          type
        }).success
      ).toBe(true);
    }
  });

  it("defaults regionRefs to empty array", () => {
    const parsed = ProviderSchema.parse({
      kind: "provider",
      id: "provider:x",
      name: "x",
      type: "hyperscaler"
    });
    expect(parsed.regionRefs).toEqual([]);
  });

  it("rejects unknown type", () => {
    expect(
      ProviderSchema.safeParse({
        kind: "provider",
        id: "provider:x",
        name: "x",
        type: "mystery"
      }).success
    ).toBe(false);
  });
});
