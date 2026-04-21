import { describe, it, expect } from "vitest";
import { RunsOnEdgeSchema } from "../../src/edges/runs-on.js";

describe("RunsOnEdgeSchema", () => {
  it("accepts a valid runsOn edge", () => {
    expect(
      RunsOnEdgeSchema.safeParse({
        type: "runsOn",
        from: "component:header",
        to: "runtime:node-22"
      }).success
    ).toBe(true);
  });

  it("rejects wrong type discriminator", () => {
    expect(
      RunsOnEdgeSchema.safeParse({
        type: "dependsOn",
        from: "component:x",
        to: "runtime:y"
      }).success
    ).toBe(false);
  });
});
