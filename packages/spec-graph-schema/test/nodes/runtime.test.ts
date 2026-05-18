import { describe, it, expect } from "vitest";
import { RuntimeSchema } from "../../src/nodes/runtime.js";

describe("RuntimeSchema", () => {
  it("accepts node runtime", () => {
    expect(
      RuntimeSchema.safeParse({
        kind: "runtime",
        id: "runtime:node-22",
        language: "node",
        version: "22.0.0"
      }).success
    ).toBe(true);
  });

  it("accepts python + rust + go + java + ruby + other", () => {
    for (const language of ["python", "rust", "go", "java", "ruby", "other"]) {
      expect(
        RuntimeSchema.safeParse({
          kind: "runtime",
          id: `runtime:${language}`,
          language,
          version: "1.0"
        }).success
      ).toBe(true);
    }
  });

  it("rejects unknown language", () => {
    expect(
      RuntimeSchema.safeParse({
        kind: "runtime",
        id: "runtime:erlang",
        language: "erlang",
        version: "27"
      }).success
    ).toBe(false);
  });

  it("rejects empty version", () => {
    expect(
      RuntimeSchema.safeParse({
        kind: "runtime",
        id: "runtime:node",
        language: "node",
        version: ""
      }).success
    ).toBe(false);
  });
});
