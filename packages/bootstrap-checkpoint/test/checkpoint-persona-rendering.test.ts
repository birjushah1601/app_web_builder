import { describe, it, expect } from "vitest";
import { CANONICAL_ITEMS } from "../src/checklist.js";
import { renderItemForPersona } from "../src/persona-views.js";

describe("Persona rendering for the canonical 6 items", () => {
  it("each item renders distinctly for ama/diego/priya", () => {
    for (const item of CANONICAL_ITEMS.filter((i) => i.kind === "affirm")) {
      const ama = renderItemForPersona(item, "ama", { graphNodeId: "n", fieldPath: "f", rawValue: "v" });
      const diego = renderItemForPersona(item, "diego", { graphNodeId: "n", fieldPath: "f", rawValue: "v" });
      const priya = renderItemForPersona(item, "priya", { graphNodeId: "n", fieldPath: "f", rawValue: "v" });

      expect(ama.actions).not.toContain("Approve");
      expect(diego.actions).toContain("Approve");
      expect(priya.actions).toContain("View event");
    }
  });
});
