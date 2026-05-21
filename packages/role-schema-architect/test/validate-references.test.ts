import { describe, it, expect } from "vitest";
import { validateReferences } from "../src/validate-references.js";
import type { DataModel } from "../src/types.js";

const entity = (name: string, fields: Array<{ name: string; type: string; nullable?: boolean; references?: { entity: string; field: string; onDelete: "cascade" } }>) => ({
  name,
  description: "x",
  fields: fields.map((f) => ({ ...f, nullable: f.nullable ?? false })),
  primaryKey: { columns: ["id"], strategy: "uuid" as const },
  indexes: [],
  constraints: [],
  rls: { enabled: false, policies: [] },
  audit: { createdAt: true, updatedAt: true },
  migrationHints: []
});

describe("validateReferences", () => {
  it("returns ok=true when all references resolve", () => {
    const dm: DataModel = {
      entities: [
        entity("user", [{ name: "id", type: "uuid" }]),
        entity("post", [
          { name: "id", type: "uuid" },
          { name: "user_id", type: "uuid", references: { entity: "user", field: "id", onDelete: "cascade" } }
        ])
      ]
    };
    expect(validateReferences(dm)).toEqual({ ok: true });
  });

  it("returns ok=false when reference target entity is missing", () => {
    const dm: DataModel = {
      entities: [
        entity("post", [
          { name: "id", type: "uuid" },
          { name: "user_id", type: "uuid", references: { entity: "user", field: "id", onDelete: "cascade" } }
        ])
      ]
    };
    const result = validateReferences(dm);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("broken-reference");
      expect(result.message).toMatch(/post\.user_id.*user/);
    }
  });

  it("returns ok=false when reference target field is missing", () => {
    const dm: DataModel = {
      entities: [
        entity("user", [{ name: "id", type: "uuid" }]),
        entity("post", [
          { name: "id", type: "uuid" },
          { name: "user_id", type: "uuid", references: { entity: "user", field: "uuid", onDelete: "cascade" } }
        ])
      ]
    };
    const result = validateReferences(dm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("broken-reference");
  });

  it("returns ok=false on duplicate entity names", () => {
    const dm: DataModel = {
      entities: [entity("user", [{ name: "id", type: "uuid" }]), entity("user", [{ name: "id", type: "uuid" }])]
    };
    const result = validateReferences(dm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("duplicate-name");
  });

  it("returns ok=false on duplicate field names within an entity", () => {
    const dm: DataModel = {
      entities: [
        entity("user", [
          { name: "id", type: "uuid" },
          { name: "id", type: "text" }
        ])
      ]
    };
    const result = validateReferences(dm);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("duplicate-name");
  });

  it("returns ok=false when index references a missing column", () => {
    const dm: DataModel = {
      entities: [
        {
          ...entity("post", [{ name: "id", type: "uuid" }]),
          indexes: [{ name: "post_user_id_idx", columns: ["user_id"] }]
        }
      ]
    };
    const result = validateReferences(dm);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("broken-reference");
      expect(result.message).toMatch(/post.*index.*user_id/);
    }
  });
});
