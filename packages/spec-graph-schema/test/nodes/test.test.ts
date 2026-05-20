import { describe, expect, it } from "vitest";
import { TestSchema } from "../../src/nodes/test.js";

const valid = {
  kind: "test" as const,
  id: "test:Login.e2e",
  name: "Login.e2e",
  layer: "L3",
  source: "generated",
  filepath: "tests/e2e/login.spec.ts",
  coversRef: ["page:login", "endpoint:loginUser"]
};

describe("TestSchema", () => {
  it("accepts valid test", () => {
    expect(() => TestSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown layer", () => {
    expect(() => TestSchema.parse({ ...valid, layer: "L99" })).toThrow();
  });
  it("rejects unknown source", () => {
    expect(() => TestSchema.parse({ ...valid, source: "magic" })).toThrow();
  });
  it("source=baseline is allowed (immutable human-authored)", () => {
    expect(() => TestSchema.parse({ ...valid, source: "baseline" })).not.toThrow();
  });
  it("requires non-empty coversRef", () => {
    expect(() => TestSchema.parse({ ...valid, coversRef: [] })).toThrow();
  });
});
