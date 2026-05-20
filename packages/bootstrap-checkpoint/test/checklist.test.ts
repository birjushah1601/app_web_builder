import { describe, it, expect } from "vitest";
import { CANONICAL_ITEMS, ChecklistItemSchema, ChecklistResultSchema, type ChecklistItem } from "../src/checklist.js";

describe("Bootstrap checklist items", () => {
  it("ships exactly 6 canonical items", () => {
    expect(CANONICAL_ITEMS).toHaveLength(6);
  });

  it("every item has id, key, prompt, kind", () => {
    for (const item of CANONICAL_ITEMS) {
      expect(ChecklistItemSchema.parse(item)).toEqual(item);
    }
  });

  it("items 1-5 are kind=affirm; item 6 is kind=escape_hatch", () => {
    expect(CANONICAL_ITEMS.slice(0, 5).every((i) => i.kind === "affirm")).toBe(true);
    expect(CANONICAL_ITEMS[5].kind).toBe("escape_hatch");
  });

  it("item keys are stable identifiers used in events", () => {
    const keys = CANONICAL_ITEMS.map((i) => i.key);
    expect(keys).toEqual([
      "compliance_class",
      "data_residency_region",
      "auth_provider",
      "db_provider",
      "persona_tier",
      "intuition_check"
    ]);
  });

  it("ChecklistResultSchema accepts a passed result", () => {
    const r = ChecklistResultSchema.parse({
      passed: true,
      itemResults: CANONICAL_ITEMS.map((i) => ({ key: i.key, passed: true }))
    });
    expect(r.passed).toBe(true);
  });

  it("ChecklistResultSchema rejects passed=true with any item failed", () => {
    expect(() => ChecklistResultSchema.parse({
      passed: true,
      itemResults: [{ key: "compliance_class", passed: false, notes: "wrong" }]
    })).toThrow();
  });
});
