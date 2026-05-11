import { describe, it, expect } from "vitest";
import { DesignerFailedError, RefineAxisError } from "../src/errors.js";

describe("DesignerFailedError", () => {
  it("captures cause + reason", () => {
    const cause = new Error("LLM 503");
    const err = new DesignerFailedError("proposal assembly failed", { cause, reason: "llm-timeout" });
    expect(err.message).toMatch(/proposal assembly failed/);
    expect(err.cause).toBe(cause);
    expect(err.reason).toBe("llm-timeout");
    expect(err.name).toBe("DesignerFailedError");
  });

  it("supports schema-mismatch reason", () => {
    const err = new DesignerFailedError("tool-use payload mismatch", { reason: "schema-mismatch" });
    expect(err.reason).toBe("schema-mismatch");
  });
});

describe("RefineAxisError", () => {
  it("captures axis + value details", () => {
    const err = new RefineAxisError("unknown axis", { axis: "vibes" });
    expect(err.axis).toBe("vibes");
    expect(err.name).toBe("RefineAxisError");
  });
});
