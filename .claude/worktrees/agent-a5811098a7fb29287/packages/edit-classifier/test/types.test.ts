import { describe, it, expect } from "vitest";
import { EditClassSchema, FieldChangeSchema, EditClassificationSchema, type EditClassification } from "../src/types.js";

describe("edit-classifier types", () => {
  it("EditClassSchema accepts all 3 tiers", () => {
    for (const c of ["cosmetic", "structural", "security-compliance-touching"]) {
      expect(EditClassSchema.parse(c)).toBe(c);
    }
  });

  it("FieldChangeSchema parses an added field change", () => {
    const c = { kind: "added" as const, nodeId: "page:home", fieldPath: "title", newValue: "Home" };
    expect(FieldChangeSchema.parse(c)).toEqual(c);
  });

  it("FieldChangeSchema parses a modified field change", () => {
    const c = { kind: "modified" as const, nodeId: "page:home", fieldPath: "title", oldValue: "X", newValue: "Y" };
    expect(FieldChangeSchema.parse(c)).toEqual(c);
  });

  it("FieldChangeSchema parses a removed field change", () => {
    const c = { kind: "removed" as const, nodeId: "page:home", fieldPath: "extensions.foo", oldValue: 1 };
    expect(FieldChangeSchema.parse(c)).toEqual(c);
  });

  it("EditClassificationSchema parses a result with reason + drivers", () => {
    const r: EditClassification = {
      class: "structural",
      reason: "node Page:home renderMode changed from ssr to ssg",
      drivers: [{ kind: "modified", nodeId: "page:home", fieldPath: "renderMode", oldValue: "ssr", newValue: "ssg" }]
    };
    expect(EditClassificationSchema.parse(r)).toEqual(r);
  });
});
