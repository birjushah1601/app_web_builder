import { describe, it, expect } from "vitest";
import { renderItemForPersona, type ItemContext } from "../src/persona-views.js";
import { CANONICAL_ITEMS } from "../src/checklist.js";

const ctx: ItemContext = {
  graphNodeId: "compliance:hipaa",
  fieldPath: "complianceClasses[0]",
  rawValue: "hipaa"
};

describe("renderItemForPersona", () => {
  it("Ama view contains plain prompt + Yes/No/Ask buttons (no graph node id)", () => {
    const v = renderItemForPersona(CANONICAL_ITEMS[0], "ama", ctx);
    expect(v.prompt).toBe("Is the compliance class correct?");
    expect(v.actions).toEqual(["Yes", "No", "Ask"]);
    expect(JSON.stringify(v)).not.toContain("compliance:hipaa");
  });

  it("Diego view shows the graph node + field path", () => {
    const v = renderItemForPersona(CANONICAL_ITEMS[0], "diego", ctx);
    expect(v.detail).toContain("compliance:hipaa");
    expect(v.detail).toContain("complianceClasses[0]");
    expect(v.actions).toContain("Approve");
    expect(v.actions).toContain("Reject");
  });

  it("Priya view includes raw JSON value + 'view event' link", () => {
    const v = renderItemForPersona(CANONICAL_ITEMS[0], "priya", ctx);
    expect(v.detail).toContain("\"hipaa\"");
    expect(v.actions).toContain("View event");
  });

  it("escape_hatch (item 6) renders a free-text field for all personas", () => {
    for (const persona of ["ama", "diego", "priya"] as const) {
      const v = renderItemForPersona(CANONICAL_ITEMS[5], persona, { graphNodeId: "", fieldPath: "", rawValue: null });
      expect(v.inputKind).toBe("free_text");
    }
  });
});
