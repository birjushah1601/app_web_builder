import { describe, it, expect } from "vitest";
import { StoresDataInEdgeSchema } from "../../src/edges/stores-data-in.js";

describe("StoresDataInEdgeSchema", () => {
  it("accepts model → region", () => {
    expect(
      StoresDataInEdgeSchema.safeParse({
        type: "storesDataIn",
        from: "model:user",
        to: "region:eu-west-1"
      }).success
    ).toBe(true);
  });

  it("accepts model → dataresidency", () => {
    expect(
      StoresDataInEdgeSchema.safeParse({
        type: "storesDataIn",
        from: "model:user",
        to: "dataresidency:eu"
      }).success
    ).toBe(true);
  });
});
