import { describe, it, expect } from "vitest";
import { classifyEdit, diffGraphs, rateField, EditClassSchema } from "../src/index.js";

describe("public API barrel", () => {
  it("classifyEdit is exported", () => {
    expect(typeof classifyEdit).toBe("function");
  });
  it("diffGraphs is exported", () => {
    expect(typeof diffGraphs).toBe("function");
  });
  it("rateField is exported", () => {
    expect(typeof rateField).toBe("function");
  });
  it("EditClassSchema is exported", () => {
    expect(EditClassSchema.parse("cosmetic")).toBe("cosmetic");
  });
});
