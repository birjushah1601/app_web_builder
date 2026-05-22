import { describe, it, expect } from "vitest";
import { SchemaArchitectFailedError } from "../src/errors.js";

describe("SchemaArchitectFailedError", () => {
  it("captures reason + cause", () => {
    const cause = new Error("LLM 503");
    const err = new SchemaArchitectFailedError("LLM call failed", { reason: "llm-error", cause });
    expect(err.reason).toBe("llm-error");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("SchemaArchitectFailedError");
  });

  it("supports all four reason values", () => {
    const reasons: Array<"llm-error" | "schema-mismatch" | "broken-reference" | "duplicate-name"> = [
      "llm-error",
      "schema-mismatch",
      "broken-reference",
      "duplicate-name"
    ];
    for (const r of reasons) {
      const err = new SchemaArchitectFailedError("x", { reason: r });
      expect(err.reason).toBe(r);
    }
  });
});
