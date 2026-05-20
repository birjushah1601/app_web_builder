import { describe, it, expect } from "vitest";
import { DataResidencySchema } from "../../src/nodes/data-residency.js";

describe("DataResidencySchema", () => {
  it("accepts a minimal valid DataResidency", () => {
    expect(
      DataResidencySchema.safeParse({
        kind: "dataresidency",
        id: "dataresidency:eu",
        jurisdiction: "EU"
      }).success
    ).toBe(true);
  });

  it("accepts ISO country codes and notes", () => {
    expect(
      DataResidencySchema.safeParse({
        kind: "dataresidency",
        id: "dataresidency:in",
        jurisdiction: "IN",
        notes: "DPDP Act 2023 applies"
      }).success
    ).toBe(true);
  });

  it("rejects empty jurisdiction", () => {
    expect(
      DataResidencySchema.safeParse({
        kind: "dataresidency",
        id: "dataresidency:x",
        jurisdiction: ""
      }).success
    ).toBe(false);
  });
});
