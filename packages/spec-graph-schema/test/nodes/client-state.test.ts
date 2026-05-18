import { describe, expect, it } from "vitest";
import { ClientStateSchema } from "../../src/nodes/client-state.js";

const valid = {
  kind: "clientstate" as const,
  id: "clientstate:cart",
  name: "ShoppingCart",
  stateKind: "zustand-store",
  schema: { items: "array" },
  persistence: "localStorage",
  scope: "app",
  piiClassification: "none"
};

describe("ClientStateSchema", () => {
  it("accepts valid client state", () => {
    expect(() => ClientStateSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown stateKind", () => {
    expect(() => ClientStateSchema.parse({ ...valid, stateKind: "magic" })).toThrow();
  });
  it("rejects unknown persistence", () => {
    expect(() => ClientStateSchema.parse({ ...valid, persistence: "tape" })).toThrow();
  });
  it("rejects unknown scope", () => {
    expect(() => ClientStateSchema.parse({ ...valid, scope: "universe" })).toThrow();
  });
  it("piiClassification defaults to none when omitted", () => {
    const { piiClassification: _, ...withoutPii } = valid;
    expect(ClientStateSchema.parse(withoutPii).piiClassification).toBe("none");
  });
});
