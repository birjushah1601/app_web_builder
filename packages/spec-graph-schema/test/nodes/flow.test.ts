import { describe, expect, it } from "vitest";
import { FlowSchema } from "../../src/nodes/flow.js";

const valid = {
  kind: "flow" as const,
  id: "flow:checkout",
  name: "Checkout",
  steps: [
    { id: "cart", label: "Review cart" },
    { id: "address", label: "Enter address" },
    { id: "payment", label: "Pay" },
    { id: "confirmation", label: "Confirmation" }
  ],
  entryPoints: ["page:cart"],
  successCriteria: "page:checkout-confirmation reached",
  failurePaths: ["page:checkout-error"]
};

describe("FlowSchema", () => {
  it("accepts valid flow", () => {
    expect(() => FlowSchema.parse(valid)).not.toThrow();
  });
  it("requires non-empty steps", () => {
    expect(() => FlowSchema.parse({ ...valid, steps: [] })).toThrow();
  });
  it("requires non-empty entryPoints", () => {
    expect(() => FlowSchema.parse({ ...valid, entryPoints: [] })).toThrow();
  });
  it("step ids must be non-empty", () => {
    expect(() =>
      FlowSchema.parse({ ...valid, steps: [{ id: "", label: "x" }] })
    ).toThrow();
  });
});
