import { describe, it, expect } from "vitest";
import {
  FieldSchema,
  IndexSchema,
  ConstraintSchema,
  RlsConfigSchema,
  AuditConfigSchema,
  EntitySchema,
  DataModelSchema,
  ContractSchema,
  SchemaDirectionSchema,
  SchemaProposalSchema
} from "../src/types.js";

describe("FieldSchema", () => {
  const validField = {
    name: "id",
    type: "uuid",
    nullable: false,
    default: "gen_random_uuid()"
  };

  it("accepts a minimal uuid PK field", () => {
    expect(() => FieldSchema.parse(validField)).not.toThrow();
  });

  it("requires snake_case-friendly name (non-empty)", () => {
    expect(() => FieldSchema.parse({ ...validField, name: "" })).toThrow();
  });

  it("requires `nullable` to be explicit (boolean)", () => {
    const { nullable: _n, ...missing } = validField;
    expect(() => FieldSchema.parse(missing)).toThrow();
  });

  it("accepts a FK reference shape", () => {
    expect(() =>
      FieldSchema.parse({
        name: "user_id",
        type: "uuid",
        nullable: false,
        references: { entity: "user", field: "id", onDelete: "cascade" }
      })
    ).not.toThrow();
  });

  it("rejects FK reference missing onDelete", () => {
    expect(() =>
      FieldSchema.parse({
        name: "user_id",
        type: "uuid",
        nullable: false,
        references: { entity: "user", field: "id" }
      })
    ).toThrow();
  });
});

describe("IndexSchema", () => {
  it("accepts a btree index on one column", () => {
    expect(() =>
      IndexSchema.parse({
        name: "post_user_id_idx",
        columns: ["user_id"]
      })
    ).not.toThrow();
  });

  it("accepts a partial unique gin index", () => {
    expect(() =>
      IndexSchema.parse({
        name: "post_active_title_idx",
        columns: ["title"],
        unique: true,
        where: "deleted_at IS NULL",
        method: "gin"
      })
    ).not.toThrow();
  });

  it("rejects empty columns array", () => {
    expect(() =>
      IndexSchema.parse({ name: "x", columns: [] })
    ).toThrow();
  });
});

describe("RlsConfigSchema", () => {
  it("accepts disabled config", () => {
    expect(() => RlsConfigSchema.parse({ enabled: false, policies: [] })).not.toThrow();
  });

  it("requires policies array even when disabled", () => {
    expect(() => RlsConfigSchema.parse({ enabled: false })).toThrow();
  });

  it("accepts a select-only tenant policy", () => {
    expect(() =>
      RlsConfigSchema.parse({
        enabled: true,
        policies: [
          {
            name: "post_select_tenant",
            applyTo: "select",
            using: "tenant_id = current_setting('app.tenant_id')::uuid"
          }
        ]
      })
    ).not.toThrow();
  });
});

describe("EntitySchema", () => {
  const baseEntity = {
    name: "user",
    description: "Authenticated account",
    fields: [
      { name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" },
      { name: "email", type: "citext", nullable: false }
    ],
    primaryKey: { columns: ["id"], strategy: "uuid" },
    indexes: [],
    constraints: [],
    rls: { enabled: false, policies: [] },
    audit: { createdAt: true, updatedAt: true },
    migrationHints: []
  };

  it("accepts a minimal entity", () => {
    expect(() => EntitySchema.parse(baseEntity)).not.toThrow();
  });

  it("rejects entity missing primaryKey", () => {
    const { primaryKey: _pk, ...missing } = baseEntity;
    expect(() => EntitySchema.parse(missing)).toThrow();
  });

  it("accepts composite PK strategy", () => {
    expect(() =>
      EntitySchema.parse({
        ...baseEntity,
        primaryKey: { columns: ["tenant_id", "id"], strategy: "composite" },
        fields: [
          ...baseEntity.fields,
          { name: "tenant_id", type: "uuid", nullable: false }
        ]
      })
    ).not.toThrow();
  });

  it("accepts optional partitioning", () => {
    expect(() =>
      EntitySchema.parse({
        ...baseEntity,
        partitioning: { kind: "range", on: "created_at" }
      })
    ).not.toThrow();
  });
});

describe("ContractSchema", () => {
  it("accepts a REST contract", () => {
    expect(() =>
      ContractSchema.parse({
        style: "rest",
        operations: [
          {
            method: "GET",
            path: "/users",
            summary: "List users",
            statusCodes: [200, 401]
          }
        ]
      })
    ).not.toThrow();
  });

  it("accepts a GraphQL contract", () => {
    expect(() =>
      ContractSchema.parse({
        style: "graphql",
        operations: [
          {
            kind: "query",
            name: "users",
            summary: "List users",
            args: [],
            returnType: "[User]"
          }
        ]
      })
    ).not.toThrow();
  });

  it("rejects mixed-style operations", () => {
    expect(() =>
      ContractSchema.parse({
        style: "rest",
        operations: [{ kind: "query", name: "users", summary: "x", args: [], returnType: "[User]" }]
      })
    ).toThrow();
  });
});

describe("SchemaProposalSchema — top-level shape", () => {
  // Minimal valid entity so DataModelSchema's .min(1) is satisfied;
  // cross-entity validation (broken-reference, duplicate-name) lives in
  // validate-references.test.ts and is wired via superRefine separately.
  const minimalEntity = {
    name: "user",
    description: "x",
    fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
    primaryKey: { columns: ["id"], strategy: "uuid" as const },
    indexes: [],
    constraints: [],
    rls: { enabled: false, policies: [] },
    audit: { createdAt: true, updatedAt: true },
    migrationHints: []
  };
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest" as const, operations: [] },
    dataModel: { entities: [minimalEntity] }
  });

  it("requires exactly 2 alternates", () => {
    expect(() =>
      SchemaProposalSchema.parse({
        recommended: direction("rec"),
        alternates: [direction("a"), direction("b")],
        reasoning: "because"
      })
    ).not.toThrow();
  });

  it("rejects 1 alternate", () => {
    expect(() =>
      SchemaProposalSchema.parse({
        recommended: direction("rec"),
        alternates: [direction("a")],
        reasoning: "because"
      })
    ).toThrow();
  });

  it("rejects 3 alternates", () => {
    expect(() =>
      SchemaProposalSchema.parse({
        recommended: direction("rec"),
        alternates: [direction("a"), direction("b"), direction("c")],
        reasoning: "because"
      })
    ).toThrow();
  });
});
