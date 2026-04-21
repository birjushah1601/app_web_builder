import { describe, it, expect } from "vitest";
import { RegionSchema } from "../../src/nodes/region.js";

describe("RegionSchema", () => {
  it("accepts a minimal valid Region", () => {
    expect(
      RegionSchema.safeParse({
        kind: "region",
        id: "region:us-east-1",
        code: "us-east-1"
      }).success
    ).toBe(true);
  });

  it("accepts a Region with provider + jurisdiction refs", () => {
    expect(
      RegionSchema.safeParse({
        kind: "region",
        id: "region:eu-west-1",
        code: "eu-west-1",
        cloudProviderRef: "provider:aws",
        jurisdictionRef: "dataresidency:eu"
      }).success
    ).toBe(true);
  });

  it("rejects empty code", () => {
    expect(
      RegionSchema.safeParse({ kind: "region", id: "region:x", code: "" }).success
    ).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(
      RegionSchema.safeParse({
        kind: "region",
        id: "region:x",
        code: "x",
        extra: "y"
      }).success
    ).toBe(false);
  });
});
