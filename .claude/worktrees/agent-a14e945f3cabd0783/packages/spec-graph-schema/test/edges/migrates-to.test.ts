import { describe, it, expect } from "vitest";
import { MigratesToEdgeSchema } from "../../src/edges/migrates-to.js";

describe("MigratesToEdgeSchema", () => {
  it("accepts source → target topology", () => {
    expect(
      MigratesToEdgeSchema.safeParse({
        type: "migratesTo",
        from: "workloadtopology:aws-us",
        to: "workloadtopology:ovh-eu"
      }).success
    ).toBe(true);
  });
});
