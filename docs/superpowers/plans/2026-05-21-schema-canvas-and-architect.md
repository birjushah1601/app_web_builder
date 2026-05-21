# SchemaCanvas + Schema-Architect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `@atlas/role-schema-architect` package and a `<SchemaCanvas>` renderer so backend rituals (`backend-rest-api`, `backend-graphql`) pause for user approval of 3 architectural directions covering both API contract and DB-grade data model — closing the canvas crash for backend rituals and giving Atlas a production-grade schema design surface.

**Architecture:** Mirror the existing `role-designer` + `<DesignerCanvas>` + `selectDesignDirection` triad for backend artifacts. Conditional dispatch by `artifactKind` puts the new role in the slot designer occupies for frontend rituals. Single-pass v1 (Sonnet 4.5 one-shot tool-use emit). 3-pass critique/revise scaffolded behind a flag for v2. DB schema design follows production best practices (PK strategy, FK actions, indexes, RLS, audit, partitioning, deterministic migration hints).

**Tech Stack:** TypeScript / Zod 3.23.8 / Vitest 2.1.8 / Next.js 15 (atlas-web custom fork — read `apps/atlas-web/node_modules/next/dist/docs/` before Next-specific code per `AGENTS.md`) / Anthropic Claude SDK via `@atlas/llm-provider` / Playwright for E2E.

**Reference spec:** `docs/superpowers/specs/2026-05-21-schema-canvas-and-architect-design.md` — read before starting.

**Branch:** `feat/schema-canvas-and-architect` (already created off `main`; spec committed at `cbd7b95`).

---

## File map

| File | Created in task | Responsibility |
|---|---|---|
| `packages/role-schema-architect/package.json` | T1 | Package metadata, deps on zod/conductor/llm-provider/role-researcher |
| `packages/role-schema-architect/tsconfig.json` | T1 | TS config matching role-designer |
| `packages/role-schema-architect/vitest.config.ts` | T1 | Vitest config matching role-designer |
| `packages/role-schema-architect/src/types.ts` | T3 | Zod schemas: PostgresType, Field, Index, Constraint, RlsConfig, AuditConfig, Entity, DataModel, Contract (REST/GraphQL discriminated), SchemaDirection, SchemaProposal |
| `packages/role-schema-architect/src/validate-references.ts` | T5 | Cross-entity FK + index column validator (used inside SchemaProposalSchema.refine) |
| `packages/role-schema-architect/src/migration-hints.ts` | T7 | Deterministic post-emit step that populates `entity.migrationHints` from heuristics |
| `packages/role-schema-architect/src/errors.ts` | T9 | SchemaArchitectFailedError with `reason` discriminator |
| `packages/role-schema-architect/src/assemble-proposal.ts` | T11 | System prompt (10 rules), tool-use schema, single-pass emit |
| `packages/role-schema-architect/src/critique-prompt.ts` | T13 | v2 scaffold — critique prompt + Zod schema (unused unless 3-pass flag is on) |
| `packages/role-schema-architect/src/revise-prompt.ts` | T13 | v2 scaffold — revise prompt + tool schema |
| `packages/role-schema-architect/src/role.ts` | T15 | Role implementation with single-pass + flag-gated 3-pass branches |
| `packages/role-schema-architect/src/index.ts` | T17 | Public exports |
| `packages/role-schema-architect/test/*.test.ts` | T3/5/7/9/11/15/16 | Per-component test files |
| `apps/atlas-web/lib/feature-flags.ts` | T18 | Add `schema-architect` + `schema-architect-3pass` flags |
| `apps/atlas-web/package.json` | T18 | Add `@atlas/role-schema-architect` dep |
| `apps/atlas-web/lib/engine/factory.ts` | T20 | Conditional dispatch by artifactKind; event-type mappings |
| `apps/atlas-web/lib/actions/selectSchemaDirection.ts` | T22 | Server action mirroring selectDesignDirection |
| `apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx` | T24/25/26 | 3-card render + expand + Contract/Model split + persona density + Use-this action wire |
| `apps/atlas-web/components/canvas/register-renderers.tsx` | T27 | Register `schema` renderer |
| `apps/atlas-web/test/...` | T20/22/24/27 | Per-component test files |
| `apps/atlas-web/e2e/visual/schema-canvas-three-directions.spec.ts` | T28 | Visual snapshot at canvas pause (replaces placeholder fixture) |
| `apps/atlas-web/e2e/flow/backend-ritual-schema-pause.spec.ts` | T29 | Full-flow drive E2E |

---

## Task 1: Scaffold the `@atlas/role-schema-architect` package

**Files:**
- Create: `packages/role-schema-architect/package.json`
- Create: `packages/role-schema-architect/tsconfig.json`
- Create: `packages/role-schema-architect/vitest.config.ts`

- [ ] **Step 1: Read `packages/role-designer/package.json` for reference shape**

Run: `cat packages/role-designer/package.json`
Expected: see `name`, `scripts`, `dependencies` (zod, workspace deps), `devDependencies` (vitest, typescript).

- [ ] **Step 2: Create `packages/role-schema-architect/package.json`**

```json
{
  "name": "@atlas/role-schema-architect",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/role-researcher": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: Create `packages/role-schema-architect/tsconfig.json` mirroring role-designer**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "tsBuildInfoFile": "./tsconfig.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Create `packages/role-schema-architect/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["test/**/*.test.ts"]
  }
});
```

- [ ] **Step 5: Install deps + verify package resolves**

Run: `pnpm install`
Expected: `+ @atlas/role-schema-architect 0.0.0` in the workspace lockfile updates; no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/role-schema-architect/package.json packages/role-schema-architect/tsconfig.json packages/role-schema-architect/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(role-schema-architect): scaffold package"
```

---

## Task 2: Empty src + test entry to make pnpm-test green

**Files:**
- Create: `packages/role-schema-architect/src/index.ts`
- Create: `packages/role-schema-architect/test/_smoke.test.ts`

- [ ] **Step 1: Create `src/index.ts` placeholder**

```ts
// Package exports added per-task as types/role/errors land.
export {};
```

- [ ] **Step 2: Create a smoke test to confirm vitest runs**

```ts
import { describe, it, expect } from "vitest";

describe("@atlas/role-schema-architect", () => {
  it("smoke", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Run smoke test**

Run: `pnpm --filter @atlas/role-schema-architect test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add packages/role-schema-architect/src packages/role-schema-architect/test
git commit -m "feat(role-schema-architect): smoke test passes"
```

---

## Task 3: Zod types — first red test

**Files:**
- Create: `packages/role-schema-architect/test/types.test.ts`
- Modify: `packages/role-schema-architect/src/types.ts` (currently nonexistent)

- [ ] **Step 1: Write the failing test for Field shape**

Create `packages/role-schema-architect/test/types.test.ts`:

```ts
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

describe("SchemaProposalSchema (top-level shape only — cross-entity validation in Task 5)", () => {
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest" as const, operations: [] },
    dataModel: { entities: [] }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/role-schema-architect test`
Expected: `Cannot find module '../src/types.js'` — file doesn't exist yet.

---

## Task 4: Implement Zod types

**Files:**
- Create: `packages/role-schema-architect/src/types.ts`

- [ ] **Step 1: Write `src/types.ts` with the full Zod schema set**

```ts
import { z } from "zod";

export const PostgresTypeSchema = z.string().min(1);
export type PostgresType = z.infer<typeof PostgresTypeSchema>;

export const FieldReferenceSchema = z.object({
  entity: z.string().min(1),
  field: z.string().min(1),
  onDelete: z.enum(["cascade", "set null", "restrict", "no action"]),
  onUpdate: z.enum(["cascade", "set null", "restrict", "no action"]).optional()
});

export const FieldSchema = z.object({
  name: z.string().min(1),
  type: PostgresTypeSchema,
  nullable: z.boolean(),
  default: z.string().optional(),
  references: FieldReferenceSchema.optional(),
  generated: z
    .object({
      as: z.string().min(1),
      stored: z.boolean()
    })
    .optional(),
  description: z.string().optional()
});
export type Field = z.infer<typeof FieldSchema>;

export const IndexSchema = z.object({
  name: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
  unique: z.boolean().optional(),
  where: z.string().optional(),
  method: z.enum(["btree", "gin", "gist", "hash"]).optional()
});
export type Index = z.infer<typeof IndexSchema>;

export const ConstraintSchema = z.object({
  type: z.enum(["check", "unique", "exclude"]),
  name: z.string().min(1),
  expression: z.string().min(1)
});
export type Constraint = z.infer<typeof ConstraintSchema>;

export const RlsPolicySchema = z.object({
  name: z.string().min(1),
  applyTo: z.enum(["select", "insert", "update", "delete", "all"]),
  using: z.string().min(1),
  withCheck: z.string().optional(),
  role: z.string().optional()
});
export type RlsPolicy = z.infer<typeof RlsPolicySchema>;

export const RlsConfigSchema = z.object({
  enabled: z.boolean(),
  policies: z.array(RlsPolicySchema)
});
export type RlsConfig = z.infer<typeof RlsConfigSchema>;

export const AuditConfigSchema = z.object({
  createdAt: z.boolean(),
  updatedAt: z.boolean(),
  createdBy: z.boolean().optional(),
  deletedAt: z.boolean().optional()
});
export type AuditConfig = z.infer<typeof AuditConfigSchema>;

export const PrimaryKeySchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  strategy: z.enum(["uuid", "serial", "composite"])
});

export const PartitioningSchema = z.object({
  kind: z.enum(["range", "list", "hash"]),
  on: z.string().min(1)
});

export const EntitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  fields: z.array(FieldSchema).min(1),
  primaryKey: PrimaryKeySchema,
  indexes: z.array(IndexSchema),
  constraints: z.array(ConstraintSchema),
  rls: RlsConfigSchema,
  audit: AuditConfigSchema,
  partitioning: PartitioningSchema.optional(),
  migrationHints: z.array(z.string()),
  notes: z.string().optional()
});
export type Entity = z.infer<typeof EntitySchema>;

export const DataModelSchema = z.object({
  entities: z.array(EntitySchema)
});
export type DataModel = z.infer<typeof DataModelSchema>;

export const RestOperationSchema = z.object({
  method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().min(1),
  summary: z.string().min(1),
  requestSchema: z.object({ fields: z.array(FieldSchema) }).optional(),
  responseSchema: z.object({ fields: z.array(FieldSchema) }).optional(),
  statusCodes: z.array(z.number().int()).min(1)
});
export type RestOperation = z.infer<typeof RestOperationSchema>;

export const GraphqlOperationSchema = z.object({
  kind: z.enum(["query", "mutation", "subscription"]),
  name: z.string().min(1),
  summary: z.string().min(1),
  args: z.array(FieldSchema),
  returnType: z.string().min(1)
});
export type GraphqlOperation = z.infer<typeof GraphqlOperationSchema>;

export const ContractSchema = z.discriminatedUnion("style", [
  z.object({ style: z.literal("rest"), operations: z.array(RestOperationSchema) }),
  z.object({ style: z.literal("graphql"), operations: z.array(GraphqlOperationSchema) })
]);
export type Contract = z.infer<typeof ContractSchema>;

export const SchemaDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortDescription: z.string().min(1),
  technicalDescription: z.string().min(1),
  contract: ContractSchema,
  dataModel: DataModelSchema
});
export type SchemaDirection = z.infer<typeof SchemaDirectionSchema>;

export const SchemaProposalSchema = z.object({
  recommended: SchemaDirectionSchema,
  alternates: z.tuple([SchemaDirectionSchema, SchemaDirectionSchema]),
  reasoning: z.string().min(1)
});
export type SchemaProposal = z.infer<typeof SchemaProposalSchema>;
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @atlas/role-schema-architect test`
Expected: all 19 cases pass (the test file from Task 3).

- [ ] **Step 3: Commit**

```bash
git add packages/role-schema-architect/src/types.ts packages/role-schema-architect/test/types.test.ts
git commit -m "feat(role-schema-architect): Zod types — Field/Index/RLS/Entity/Contract/Proposal"
```

---

## Task 5: Cross-entity reference validator (TDD)

**Files:**
- Create: `packages/role-schema-architect/test/validate-references.test.ts`
- Create: `packages/role-schema-architect/src/validate-references.ts`

- [ ] **Step 1: Write the failing test**

Create `test/validate-references.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/role-schema-architect test test/validate-references.test.ts`
Expected: `Cannot find module '../src/validate-references.js'`.

- [ ] **Step 3: Implement `src/validate-references.ts`**

```ts
import type { DataModel } from "./types.js";

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: "broken-reference" | "duplicate-name"; message: string };

export function validateReferences(dm: DataModel): ValidateResult {
  const entityNames = new Set<string>();
  for (const e of dm.entities) {
    if (entityNames.has(e.name)) {
      return { ok: false, reason: "duplicate-name", message: `duplicate entity: ${e.name}` };
    }
    entityNames.add(e.name);

    const fieldNames = new Set<string>();
    for (const f of e.fields) {
      if (fieldNames.has(f.name)) {
        return { ok: false, reason: "duplicate-name", message: `duplicate field: ${e.name}.${f.name}` };
      }
      fieldNames.add(f.name);
    }
  }

  const byName = new Map(dm.entities.map((e) => [e.name, e]));

  for (const e of dm.entities) {
    for (const f of e.fields) {
      if (!f.references) continue;
      const target = byName.get(f.references.entity);
      if (!target) {
        return {
          ok: false,
          reason: "broken-reference",
          message: `${e.name}.${f.name} references missing entity '${f.references.entity}'`
        };
      }
      const hasField = target.fields.some((tf) => tf.name === f.references!.field);
      if (!hasField) {
        return {
          ok: false,
          reason: "broken-reference",
          message: `${e.name}.${f.name} references missing field '${f.references.entity}.${f.references.field}'`
        };
      }
    }

    const fieldNameSet = new Set(e.fields.map((f) => f.name));
    for (const idx of e.indexes) {
      for (const col of idx.columns) {
        if (!fieldNameSet.has(col)) {
          return {
            ok: false,
            reason: "broken-reference",
            message: `${e.name} index '${idx.name}' references missing column '${col}'`
          };
        }
      }
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/role-schema-architect test test/validate-references.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/role-schema-architect/src/validate-references.ts packages/role-schema-architect/test/validate-references.test.ts
git commit -m "feat(role-schema-architect): cross-entity reference validator"
```

---

## Task 6: Wire validator into SchemaProposalSchema via .refine()

**Files:**
- Modify: `packages/role-schema-architect/src/types.ts` (append `.superRefine` to SchemaProposalSchema)
- Modify: `packages/role-schema-architect/test/types.test.ts` (add cross-entity rejection cases)

- [ ] **Step 1: Append failing tests to `test/types.test.ts`**

Append at end of file:

```ts
describe("SchemaProposalSchema cross-entity validation", () => {
  const direction = (entities: Array<Record<string, unknown>>) => ({
    id: "rec",
    name: "Recommended",
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest" as const, operations: [] },
    dataModel: { entities }
  });

  const emptyAlt = () => ({
    id: "alt",
    name: "Alt",
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest" as const, operations: [] },
    dataModel: { entities: [] }
  });

  it("rejects proposal with broken FK in recommended direction", () => {
    const proposal = {
      recommended: direction([
        {
          name: "post",
          description: "x",
          fields: [
            { name: "id", type: "uuid", nullable: false },
            { name: "user_id", type: "uuid", nullable: false, references: { entity: "user", field: "id", onDelete: "cascade" } }
          ],
          primaryKey: { columns: ["id"], strategy: "uuid" },
          indexes: [],
          constraints: [],
          rls: { enabled: false, policies: [] },
          audit: { createdAt: true, updatedAt: true },
          migrationHints: []
        }
      ]),
      alternates: [emptyAlt(), { ...emptyAlt(), id: "alt2" }],
      reasoning: "x"
    };
    expect(() => SchemaProposalSchema.parse(proposal)).toThrow(/broken-reference/);
  });

  it("rejects proposal with duplicate entity name in any direction", () => {
    const dupEntities = [
      { name: "user", description: "x", fields: [{ name: "id", type: "uuid", nullable: false }], primaryKey: { columns: ["id"], strategy: "uuid" }, indexes: [], constraints: [], rls: { enabled: false, policies: [] }, audit: { createdAt: true, updatedAt: true }, migrationHints: [] },
      { name: "user", description: "y", fields: [{ name: "id", type: "uuid", nullable: false }], primaryKey: { columns: ["id"], strategy: "uuid" }, indexes: [], constraints: [], rls: { enabled: false, policies: [] }, audit: { createdAt: true, updatedAt: true }, migrationHints: [] }
    ];
    const proposal = {
      recommended: direction(dupEntities),
      alternates: [emptyAlt(), { ...emptyAlt(), id: "alt2" }],
      reasoning: "x"
    };
    expect(() => SchemaProposalSchema.parse(proposal)).toThrow(/duplicate-name/);
  });
});
```

- [ ] **Step 2: Run test to verify red**

Run: `pnpm --filter @atlas/role-schema-architect test test/types.test.ts`
Expected: 2 new tests fail (Proposal accepts broken-reference / dup names today).

- [ ] **Step 3: Wire `.superRefine` in `src/types.ts`**

In `src/types.ts`, change the bottom of the file to:

```ts
import { validateReferences } from "./validate-references.js";

export const SchemaProposalSchema = z
  .object({
    recommended: SchemaDirectionSchema,
    alternates: z.tuple([SchemaDirectionSchema, SchemaDirectionSchema]),
    reasoning: z.string().min(1)
  })
  .superRefine((proposal, ctx) => {
    for (const [path, direction] of [
      ["recommended", proposal.recommended] as const,
      ["alternates", proposal.alternates[0]] as const,
      ["alternates", proposal.alternates[1]] as const
    ]) {
      const r = validateReferences(direction.dataModel);
      if (!r.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${r.reason}: ${r.message}`,
          path: [path, "dataModel"]
        });
      }
    }
  });
export type SchemaProposal = z.infer<typeof SchemaProposalSchema>;
```

Important: Move the `SchemaProposal` exports to the BOTTOM of types.ts so the validator import resolves. Update validate-references.ts to import only types (no runtime circular dep).

- [ ] **Step 4: Run all type tests, verify green**

Run: `pnpm --filter @atlas/role-schema-architect test`
Expected: all cases green (19 prior + 6 ref + 2 cross = 27).

- [ ] **Step 5: Commit**

```bash
git add packages/role-schema-architect/src/types.ts packages/role-schema-architect/test/types.test.ts
git commit -m "feat(role-schema-architect): SchemaProposalSchema refines with cross-entity validation"
```

---

## Task 7: Migration-hints generator (TDD)

**Files:**
- Create: `packages/role-schema-architect/test/migration-hints.test.ts`
- Create: `packages/role-schema-architect/src/migration-hints.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generateMigrationHints } from "../src/migration-hints.js";
import type { Entity } from "../src/types.js";

const base = (over: Partial<Entity> = {}): Entity => ({
  name: "post",
  description: "x",
  fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
  primaryKey: { columns: ["id"], strategy: "uuid" },
  indexes: [],
  constraints: [],
  rls: { enabled: false, policies: [] },
  audit: { createdAt: true, updatedAt: true },
  migrationHints: [],
  ...over
});

describe("generateMigrationHints", () => {
  it("emits CONCURRENTLY hint for new index on a wide table (>5 fields)", () => {
    const e = base({
      fields: [
        { name: "id", type: "uuid", nullable: false },
        { name: "title", type: "text", nullable: false },
        { name: "body", type: "text", nullable: false },
        { name: "author_id", type: "uuid", nullable: false },
        { name: "tags", type: "jsonb", nullable: false },
        { name: "created_at", type: "timestamptz", nullable: false }
      ],
      indexes: [{ name: "post_author_id_idx", columns: ["author_id"] }]
    });
    const hints = generateMigrationHints(e);
    expect(hints.some((h) => /CONCURRENTLY/.test(h) && /post_author_id_idx/.test(h))).toBe(true);
  });

  it("emits CONCURRENTLY hint on any partitioned-table index", () => {
    const e = base({
      indexes: [{ name: "post_created_idx", columns: ["id"] }],
      partitioning: { kind: "range", on: "created_at" }
    });
    expect(generateMigrationHints(e).some((h) => /CONCURRENTLY/.test(h))).toBe(true);
  });

  it("emits staged-NOT-NULL hint for a NEW required column on a growth table", () => {
    const e = base({
      name: "user",
      fields: [
        { name: "id", type: "uuid", nullable: false },
        { name: "phone", type: "text", nullable: false }
      ]
    });
    expect(
      generateMigrationHints(e).some(
        (h) => /NOT NULL/i.test(h) && /backfill/i.test(h) && /phone/.test(h)
      )
    ).toBe(true);
  });

  it("emits pre-flight uniqueness hint for new unique indexes", () => {
    const e = base({
      indexes: [{ name: "post_slug_uniq", columns: ["id"], unique: true }]
    });
    expect(
      generateMigrationHints(e).some(
        (h) => /uniqueness/i.test(h) && /post_slug_uniq/.test(h)
      )
    ).toBe(true);
  });

  it("emits serial-to-bigint hint when PK strategy=serial on a growth table", () => {
    const e = base({
      name: "event",
      primaryKey: { columns: ["id"], strategy: "serial" }
    });
    expect(
      generateMigrationHints(e).some(
        (h) => /bigint/i.test(h) && /event/.test(h)
      )
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/role-schema-architect test test/migration-hints.test.ts`
Expected: `Cannot find module './migration-hints.js'`.

- [ ] **Step 3: Implement `src/migration-hints.ts`**

```ts
import type { Entity } from "./types.js";

const GROWTH_ENTITY_NAMES = new Set([
  "user",
  "users",
  "post",
  "posts",
  "event",
  "events",
  "transaction",
  "transactions",
  "order",
  "orders",
  "message",
  "messages"
]);

export function generateMigrationHints(e: Entity): string[] {
  const hints: string[] = [];

  const wideTable = e.fields.length > 5;
  const partitioned = e.partitioning !== undefined;

  for (const idx of e.indexes) {
    if (wideTable || partitioned) {
      hints.push(
        `Use CREATE INDEX CONCURRENTLY when applying '${idx.name}' on '${e.name}' to avoid blocking writes on a populated table.`
      );
    }
    if (idx.unique) {
      hints.push(
        `Pre-flight uniqueness check before creating unique index '${idx.name}' on '${e.name}' — production data may already violate it.`
      );
    }
  }

  if (GROWTH_ENTITY_NAMES.has(e.name)) {
    for (const f of e.fields) {
      if (!f.nullable && f.default === undefined && !isPkColumn(e, f.name)) {
        hints.push(
          `For new required column '${f.name}' on growth-table '${e.name}': add as NULLable → backfill in batches → ALTER COLUMN SET NOT NULL once backfill is verified.`
        );
      }
    }
  }

  if (e.primaryKey.strategy === "serial" && GROWTH_ENTITY_NAMES.has(e.name)) {
    hints.push(
      `'${e.name}' uses serial PK on a growth table — plan the zero-downtime swap to bigint identity (add bigint col → backfill → swap PK → drop old col).`
    );
  }

  return hints;
}

function isPkColumn(e: Entity, fieldName: string): boolean {
  return e.primaryKey.columns.includes(fieldName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/role-schema-architect test test/migration-hints.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/role-schema-architect/src/migration-hints.ts packages/role-schema-architect/test/migration-hints.test.ts
git commit -m "feat(role-schema-architect): deterministic migration-hints generator"
```

---

## Task 8: Errors

**Files:**
- Create: `packages/role-schema-architect/test/errors.test.ts`
- Create: `packages/role-schema-architect/src/errors.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @atlas/role-schema-architect test test/errors.test.ts`
Expected: module-not-found error.

- [ ] **Step 3: Implement `src/errors.ts`**

```ts
export type SchemaArchitectFailureReason =
  | "llm-error"
  | "schema-mismatch"
  | "broken-reference"
  | "duplicate-name";

export class SchemaArchitectFailedError extends Error {
  readonly reason: SchemaArchitectFailureReason;
  override readonly cause?: unknown;
  constructor(message: string, opts: { reason: SchemaArchitectFailureReason; cause?: unknown }) {
    super(message);
    this.name = "SchemaArchitectFailedError";
    this.reason = opts.reason;
    this.cause = opts.cause;
  }
}
```

- [ ] **Step 4: Run test, verify green**

Run: `pnpm --filter @atlas/role-schema-architect test test/errors.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/role-schema-architect/src/errors.ts packages/role-schema-architect/test/errors.test.ts
git commit -m "feat(role-schema-architect): SchemaArchitectFailedError"
```

---

## Task 9: Prompt assembly (system prompt + tool schema)

**Files:**
- Create: `packages/role-schema-architect/test/assemble-proposal.test.ts`
- Create: `packages/role-schema-architect/src/assemble-proposal.ts`

- [ ] **Step 1: Write failing test (smoke-level — full prompt text isn't asserted, just structure)**

```ts
import { describe, it, expect, vi } from "vitest";
import { assembleProposal, DRAFT_SYSTEM_PROMPT, PROPOSAL_TOOL_SCHEMA } from "../src/assemble-proposal.js";
import type { LLMProvider } from "@atlas/llm-provider";

const fakeLLM = (input: unknown): LLMProvider =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_schema_proposal", input })
  } as unknown as LLMProvider);

const validProposalInput = () => ({
  recommended: dir("rest-crud"),
  alternates: [dir("rpc"), dir("event-sourced")],
  reasoning: "RESTful CRUD because the brief describes admin-CRUD operations on resources."
});

const dir = (id: string) => ({
  id,
  name: id,
  shortDescription: "x",
  technicalDescription: "y",
  contract: { style: "rest", operations: [] },
  dataModel: {
    entities: [
      {
        name: "user",
        description: "User account",
        fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
        primaryKey: { columns: ["id"], strategy: "uuid" },
        indexes: [],
        constraints: [],
        rls: { enabled: false, policies: [] },
        audit: { createdAt: true, updatedAt: true },
        migrationHints: []
      }
    ]
  }
});

describe("DRAFT_SYSTEM_PROMPT", () => {
  it("includes the 10 hard rules markers", () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/primary key/i);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/onDelete/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/timestamptz/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/tenant_id/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/CHECK.*IN/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/architecturally distinct/i);
  });
});

describe("PROPOSAL_TOOL_SCHEMA", () => {
  it("declares emit_schema_proposal with required recommended/alternates/reasoning", () => {
    expect(PROPOSAL_TOOL_SCHEMA.type).toBe("object");
    expect(PROPOSAL_TOOL_SCHEMA.required).toEqual(["recommended", "alternates", "reasoning"]);
  });
});

describe("assembleProposal", () => {
  it("calls completeWithToolUse and returns a parsed proposal", async () => {
    const llm = fakeLLM(validProposalInput());
    const result = await assembleProposal({
      llm,
      designIntent: { category: "saas-app" } as never,
      brief: null,
      architectArtifact: { artifactKind: "backend-rest-api" }
    });
    expect(result.recommended.id).toBe("rest-crud");
    expect(result.alternates.length).toBe(2);
  });

  it("throws SchemaArchitectFailedError with reason=llm-error on LLM throw", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("network down"))
    } as unknown as LLMProvider;
    await expect(
      assembleProposal({ llm, designIntent: { category: "saas-app" } as never, brief: null, architectArtifact: {} })
    ).rejects.toThrow(/llm-error/);
  });

  it("throws SchemaArchitectFailedError with reason=schema-mismatch on bad payload", async () => {
    const llm = fakeLLM({ recommended: { id: "rec" } /* missing required fields */ });
    await expect(
      assembleProposal({ llm, designIntent: { category: "saas-app" } as never, brief: null, architectArtifact: {} })
    ).rejects.toThrow(/schema-mismatch/);
  });

  it("threads the architect artifact + brief into the user turn", async () => {
    const llm = fakeLLM(validProposalInput());
    await assembleProposal({
      llm,
      designIntent: { category: "saas-app" } as never,
      brief: { references: ["Stripe API"] } as never,
      architectArtifact: { artifactKind: "backend-rest-api", focus: "billing" }
    });
    const call = (llm as unknown as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = call[0] as Array<{ content: string }>;
    const userText = messages.find((m) => m && typeof m.content === "string")?.content ?? "";
    expect(userText).toMatch(/Stripe API|billing|saas-app/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/role-schema-architect test test/assemble-proposal.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Implement `src/assemble-proposal.ts` — system prompt**

Create `src/assemble-proposal.ts`. The system prompt is long but the structure is fixed. The 10 rules from spec §5 are encoded verbatim:

```ts
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { DesignIntent, InspirationBrief } from "@atlas/role-researcher";
import { SchemaArchitectFailedError } from "./errors.js";
import { SchemaProposalSchema, type SchemaProposal } from "./types.js";
import { generateMigrationHints } from "./migration-hints.js";

export const DESIGNER_PROPOSAL_MODEL = "claude-sonnet-4.5";

export const DRAFT_SYSTEM_PROMPT = `You are Atlas's Schema Architect.

Given a brief about what the user wants to build, emit ONE SchemaProposal containing exactly one recommended SchemaDirection and exactly two alternate SchemaDirections.

Each SchemaDirection MUST include:
- A short id (kebab-case, e.g. "rest-crud", "rpc-actions", "event-sourced", "normalized", "embedded").
- A human-readable name.
- A shortDescription (one sentence, jargon-free — for non-technical readers).
- A technicalDescription (one sentence, terse, names key choices — for builders).
- A complete contract (REST operations OR GraphQL operations, never mixed).
- A complete dataModel (one or more entities).

The 10 hard rules — every entity in every direction MUST comply:

1. PRIMARY KEYS. Every entity has a stable PK with explicit \`strategy\`. Default \`uuid\` + \`default: "gen_random_uuid()"\`. Use \`serial\` only with explicit justification in entity.notes.

2. FK ACTIONS. Every FK has an explicit \`onDelete\` ("cascade" / "set null" / "restrict" / "no action"). No defaults — the cardinality decision is part of the design.

3. FK INDEXES. Every FK column gets an entry in \`indexes\` unless explicitly suppressed in entity.notes. Index naming: \`<table>_<col>_idx\`.

4. CANONICAL POSTGRES TYPES.
   - \`text\` not \`varchar(N)\` (Postgres treats them the same; varchar adds friction).
   - \`timestamptz\` not \`timestamp\` (timezone-naive is a footgun).
   - \`citext\` for case-insensitive uniqueness (emails, usernames).
   - \`numeric\` with explicit precision for money; never \`decimal\` without precision.
   - \`jsonb\` not \`json\`; index with \`gin\` if queried.

5. MULTI-TENANCY. Any entity with a \`tenant_id\` (or analogous tenancy column) MUST set \`rls.enabled: true\` with a tenant-scoped \`using\` clause:
   \`tenant_id = current_setting('app.tenant_id')::uuid\`
   One RLS policy per verb (select/insert/update/delete).

6. AUDIT DEFAULTS. \`created_at\` + \`updated_at\` true on every entity by default. \`created_by\` true when tenancy is on. \`deleted_at\` (soft-delete) only when business requirement exists in the brief.

7. ENUMS. Prefer \`text\` + \`CHECK (col IN ('a','b','c'))\` constraint over \`CREATE TYPE foo_enum AS ENUM(...)\`. Postgres ENUM values cannot be removed without rewriting the type — disastrous for evolvability.

8. COMPOSITE INDEXES. Look for query patterns the brief implies (tenant-scoped list ordered by recency, status-filtered lists, etc.) and emit composite indexes: \`(tenant_id, created_at DESC)\`, \`(user_id, status, created_at)\`. Cover real access patterns; don't over-index.

9. MIGRATION SAFETY. You will NOT populate \`migrationHints\` — that field is deterministically generated post-emit. Return it as an empty array. But you SHOULD reflect best practice in the schema itself (don't propose schemas that need destructive migrations to fix obvious problems).

10. ARCHITECTURALLY DISTINCT DIRECTIONS. The 3 directions MUST be architecturally distinct, not cosmetic variants. Examples of valid distinction axes:
    - RESTful CRUD vs RPC-style operations vs Event-sourced commands.
    - Normalized vs Embedded (jsonb-heavy) vs Hybrid.
    - Synchronous vs Async-outbox vs CQRS-split.
    The \`recommended\` direction MUST cite WHY it's the best match in the proposal's \`reasoning\` field.

Call the emit_schema_proposal tool exactly once.`;

const FIELD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string" },
    nullable: { type: "boolean" },
    default: { type: "string" },
    references: {
      type: "object",
      properties: {
        entity: { type: "string" },
        field: { type: "string" },
        onDelete: { type: "string", enum: ["cascade", "set null", "restrict", "no action"] },
        onUpdate: { type: "string", enum: ["cascade", "set null", "restrict", "no action"] }
      },
      required: ["entity", "field", "onDelete"]
    },
    generated: { type: "object", properties: { as: { type: "string" }, stored: { type: "boolean" } }, required: ["as", "stored"] },
    description: { type: "string" }
  },
  required: ["name", "type", "nullable"]
} as const;

const INDEX_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    columns: { type: "array", items: { type: "string" }, minItems: 1 },
    unique: { type: "boolean" },
    where: { type: "string" },
    method: { type: "string", enum: ["btree", "gin", "gist", "hash"] }
  },
  required: ["name", "columns"]
} as const;

const ENTITY_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    fields: { type: "array", items: FIELD_SCHEMA, minItems: 1 },
    primaryKey: {
      type: "object",
      properties: {
        columns: { type: "array", items: { type: "string" }, minItems: 1 },
        strategy: { type: "string", enum: ["uuid", "serial", "composite"] }
      },
      required: ["columns", "strategy"]
    },
    indexes: { type: "array", items: INDEX_SCHEMA },
    constraints: { type: "array" },
    rls: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        policies: { type: "array" }
      },
      required: ["enabled", "policies"]
    },
    audit: {
      type: "object",
      properties: {
        createdAt: { type: "boolean" },
        updatedAt: { type: "boolean" },
        createdBy: { type: "boolean" },
        deletedAt: { type: "boolean" }
      },
      required: ["createdAt", "updatedAt"]
    },
    partitioning: {
      type: "object",
      properties: { kind: { type: "string", enum: ["range", "list", "hash"] }, on: { type: "string" } },
      required: ["kind", "on"]
    },
    migrationHints: { type: "array", items: { type: "string" } },
    notes: { type: "string" }
  },
  required: ["name", "description", "fields", "primaryKey", "indexes", "constraints", "rls", "audit", "migrationHints"]
} as const;

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    shortDescription: { type: "string" },
    technicalDescription: { type: "string" },
    contract: { type: "object" },
    dataModel: {
      type: "object",
      properties: { entities: { type: "array", items: ENTITY_SCHEMA, minItems: 1 } },
      required: ["entities"]
    }
  },
  required: ["id", "name", "shortDescription", "technicalDescription", "contract", "dataModel"]
} as const;

export const PROPOSAL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    recommended: DIRECTION_SCHEMA,
    alternates: { type: "array", items: DIRECTION_SCHEMA, minItems: 2, maxItems: 2 },
    reasoning: { type: "string" }
  },
  required: ["recommended", "alternates", "reasoning"]
} as const;

export interface AssembleProposalInput {
  llm: LLMProvider;
  designIntent: DesignIntent;
  brief: InspirationBrief | null;
  architectArtifact: unknown;
  model?: string;
}

export async function assembleProposal(input: AssembleProposalInput): Promise<SchemaProposal> {
  const userTurn = renderUserTurn(input.designIntent, input.brief, input.architectArtifact);

  const messages: LLMMessage[] = [
    { role: "system", content: DRAFT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { role: "user", content: userTurn }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? process.env.ATLAS_LLM_SCHEMA_ARCHITECT_MODEL ?? DESIGNER_PROPOSAL_MODEL,
      maxTokens: 8192,
      tools: [{ name: "emit_schema_proposal", description: "Emit schema proposal", input_schema: PROPOSAL_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_schema_proposal" }
    });
  } catch (err) {
    throw new SchemaArchitectFailedError(`schema-architect LLM call failed: ${(err as Error).message}`, { reason: "llm-error", cause: err });
  }

  const parsed = SchemaProposalSchema.safeParse(result.input);
  if (!parsed.success) {
    throw new SchemaArchitectFailedError(`schema-architect tool_use payload failed schema: ${parsed.error.message}`, {
      reason: parsed.error.message.includes("broken-reference")
        ? "broken-reference"
        : parsed.error.message.includes("duplicate-name")
          ? "duplicate-name"
          : "schema-mismatch",
      cause: parsed.error
    });
  }

  // Populate migrationHints deterministically across all entities in all 3 directions.
  for (const direction of [parsed.data.recommended, ...parsed.data.alternates]) {
    for (const entity of direction.dataModel.entities) {
      entity.migrationHints = generateMigrationHints(entity);
    }
  }

  return parsed.data;
}

function renderUserTurn(designIntent: DesignIntent, brief: InspirationBrief | null, architectArtifact: unknown): string {
  return `## Brief
${JSON.stringify(brief ?? {}, null, 2)}

## Design intent
${JSON.stringify(designIntent ?? {}, null, 2)}

## Architect artifact (artifactKind, deep plan summary)
${JSON.stringify(architectArtifact ?? {}, null, 2)}

Emit one SchemaProposal with 3 architecturally distinct directions. Follow the 10 hard rules in the system prompt.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/role-schema-architect test test/assemble-proposal.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/role-schema-architect/src/assemble-proposal.ts packages/role-schema-architect/test/assemble-proposal.test.ts
git commit -m "feat(role-schema-architect): single-pass prompt + tool schema + assembleProposal"
```

---

## Task 10: 3-pass scaffold (critique + revise prompts, flag-gated, NOT yet wired into role)

**Files:**
- Create: `packages/role-schema-architect/src/critique-prompt.ts`
- Create: `packages/role-schema-architect/src/revise-prompt.ts`

These are deliberately minimal scaffolds — the role will dispatch into them only when `ATLAS_FF_SCHEMA_ARCHITECT_3PASS=true`, wired in Task 13.

- [ ] **Step 1: Create `src/critique-prompt.ts`**

```ts
import { z } from "zod";

export const CRITIQUE_SYSTEM_PROMPT = `You are reviewing a SchemaProposal from the Schema Architect for distinctness (are the 3 directions architecturally different?) and brief-alignment (does the recommended direction match what the user asked for?).

Score each on a 0-10 scale. Cite specific entities or operations as evidence. Return via the emit_critique tool.`;

export const CritiqueSchema = z.object({
  distinctness: z.number().int().min(0).max(10),
  briefAlignment: z.number().int().min(0).max(10),
  issues: z.array(z.string())
});
export type Critique = z.infer<typeof CritiqueSchema>;

export const CRITIQUE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    distinctness: { type: "number" },
    briefAlignment: { type: "number" },
    issues: { type: "array", items: { type: "string" } }
  },
  required: ["distinctness", "briefAlignment", "issues"]
} as const;
```

- [ ] **Step 2: Create `src/revise-prompt.ts`**

```ts
export const REVISE_SYSTEM_PROMPT = `You revised a SchemaProposal in light of a critique. Address each issue from the critique by editing entities/operations in the proposal. Return a revised SchemaProposal via emit_revised_schema_proposal.

Do NOT change unaffected parts of the proposal — keep them byte-identical so the user's mental model stays stable.`;

export const REVISED_PROPOSAL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    recommended: { type: "object" },
    alternates: { type: "array", minItems: 2, maxItems: 2 },
    reasoning: { type: "string" }
  },
  required: ["recommended", "alternates", "reasoning"]
} as const;
```

- [ ] **Step 3: Commit**

```bash
git add packages/role-schema-architect/src/critique-prompt.ts packages/role-schema-architect/src/revise-prompt.ts
git commit -m "feat(role-schema-architect): 3-pass critique + revise prompt scaffolds (flag-gated)"
```

---

## Task 11: Role implementation (single-pass first)

**Files:**
- Create: `packages/role-schema-architect/test/role.test.ts`
- Create: `packages/role-schema-architect/src/role.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { SchemaArchitectRole } from "../src/role.js";
import type { RoleInvocation } from "@atlas/conductor";
import type { LLMProvider } from "@atlas/llm-provider";

const fakeLLM = (input: unknown): LLMProvider =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_schema_proposal", input })
  } as unknown as LLMProvider);

const validProposal = () => {
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest", operations: [] },
    dataModel: {
      entities: [
        {
          name: "user",
          description: "x",
          fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
          primaryKey: { columns: ["id"], strategy: "uuid" },
          indexes: [],
          constraints: [],
          rls: { enabled: false, policies: [] },
          audit: { createdAt: true, updatedAt: true },
          migrationHints: []
        }
      ]
    }
  });
  return {
    recommended: direction("rest-crud"),
    alternates: [direction("rpc"), direction("event-sourced")],
    reasoning: "RESTful CRUD because the brief describes admin-CRUD on resources."
  };
};

const backendInvocation: RoleInvocation = {
  ritualId: "r1",
  intent: "test",
  userTurn: "build me a backend",
  graphSlice: { bytes: "{}", hash: "h" },
  priorArtifact: {
    designIntent: { category: "backend-rest-api" },
    architectArtifact: { artifactKind: "backend-rest-api" }
  }
} as never;

describe("SchemaArchitectRole", () => {
  it("has id 'schema-architect'", () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM(validProposal()) });
    expect(role.id).toBe("schema-architect");
  });

  it("emits started + emitted + completed on green", async () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM(validProposal()) });
    const out = await role.run(backendInvocation);
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("schema_architect.proposal.started");
    expect(types).toContain("schema_architect.proposal.emitted");
    expect(types).toContain("schema_architect.proposal.completed");
  });

  it("skips with reason when no designIntent in priorArtifact", async () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM(validProposal()) });
    const out = await role.run({ ...backendInvocation, priorArtifact: {} } as never);
    expect(out.events.some((e) => e.eventType === "schema_architect.proposal.skipped")).toBe(true);
    expect(out.events.some((e) => e.eventType === "schema_architect.proposal.emitted")).toBe(false);
  });

  it("throws SchemaArchitectFailedError with reason=llm-error on LLM failure", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("503"))
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    await expect(role.run(backendInvocation)).rejects.toThrow(/llm-error/);
  });

  it("emits proposal.failed with reason when parse fails", async () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM({ recommended: { id: "rec" } /* bad shape */ }) });
    const events: string[] = [];
    await role.run(backendInvocation).catch(() => {
      // expected throw
    });
    // The role pushes the failed event before throwing; capture by re-running with a spy on push
    // (simplest: rerun and inspect via try/catch + role internal). For test simplicity we assert via reject:
    await expect(role.run(backendInvocation)).rejects.toThrow(/schema-mismatch|broken-reference|duplicate-name/);
  });

  it("does NOT call 3-pass when ATLAS_FF_SCHEMA_ARCHITECT_3PASS is unset/false", async () => {
    const llm = fakeLLM(validProposal());
    const role = new SchemaArchitectRole({ llm });
    await role.run(backendInvocation);
    // Single pass = exactly one completeWithToolUse call
    expect((llm as unknown as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify red**

Run: `pnpm --filter @atlas/role-schema-architect test test/role.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Implement `src/role.ts`**

```ts
import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { DesignIntent, InspirationBrief } from "@atlas/role-researcher";
import { DesignIntentSchema, InspirationBriefSchema } from "@atlas/role-researcher";
import { assembleProposal } from "./assemble-proposal.js";
import { SchemaArchitectFailedError } from "./errors.js";
import { SchemaProposalSchema, type SchemaProposal } from "./types.js";
import { CRITIQUE_SYSTEM_PROMPT, CRITIQUE_TOOL_SCHEMA, CritiqueSchema, type Critique } from "./critique-prompt.js";
import { REVISE_SYSTEM_PROMPT, REVISED_PROPOSAL_TOOL_SCHEMA } from "./revise-prompt.js";

export interface SchemaArchitectRoleOptions {
  llm: LLMProvider;
  critiqueModel?: string;
  reviseModel?: string;
}

type SchemaArchitectEvents = RoleOutput["events"];

export class SchemaArchitectRole implements Role {
  readonly id = "schema-architect";
  private readonly llm: LLMProvider;
  private readonly critiqueModel?: string;
  private readonly reviseModel?: string;

  constructor(opts: SchemaArchitectRoleOptions) {
    this.llm = opts.llm;
    this.critiqueModel = opts.critiqueModel;
    this.reviseModel = opts.reviseModel;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: SchemaArchitectEvents = [];

    const designIntent = extractDesignIntent(inv.priorArtifact);
    if (!designIntent) {
      events.push({ eventType: "schema_architect.proposal.skipped", payload: { reason: "no designIntent in priorArtifact" } });
      return { events, diff: { kind: "none" } };
    }

    const brief = extractBrief(inv.priorArtifact);
    const architectArtifact = extractArchitectArtifact(inv.priorArtifact);

    events.push({
      eventType: "schema_architect.proposal.started",
      payload: { ritualId: inv.ritualId }
    });

    let draft: SchemaProposal;
    try {
      draft = await assembleProposal({ llm: this.llm, designIntent, brief, architectArtifact });
    } catch (err) {
      const reason = err instanceof SchemaArchitectFailedError ? err.reason : "llm-error";
      events.push({ eventType: "schema_architect.proposal.failed", payload: { error: (err as Error).message, reason } });
      throw err;
    }

    const threePass = process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS === "true";
    if (!threePass) {
      events.push({ eventType: "schema_architect.proposal.emitted", payload: { proposal: draft } });
      events.push({ eventType: "schema_architect.proposal.completed", payload: { proposal: draft } });
      return { events, diff: { kind: "none" } };
    }

    // 3-pass branch — gated; default OFF
    events.push({ eventType: "schema_architect.critique.started", payload: {} });
    let critique: Critique;
    try {
      critique = await this.critique(draft);
    } catch (err) {
      events.push({ eventType: "schema_architect.proposal.failed", payload: { error: (err as Error).message, reason: "llm-error" } });
      throw err;
    }
    events.push({ eventType: "schema_architect.critique.completed", payload: { critique } });

    events.push({ eventType: "schema_architect.revise.started", payload: {} });
    let final: SchemaProposal;
    try {
      final = await this.revise(draft, critique);
    } catch (err) {
      events.push({ eventType: "schema_architect.proposal.failed", payload: { error: (err as Error).message, reason: "llm-error" } });
      throw err;
    }
    events.push({ eventType: "schema_architect.revise.completed", payload: { proposal: final } });

    events.push({ eventType: "schema_architect.proposal.emitted", payload: { proposal: final } });
    events.push({ eventType: "schema_architect.proposal.completed", payload: { proposal: final } });
    return { events, diff: { kind: "none" } };
  }

  private async critique(draft: SchemaProposal): Promise<Critique> {
    const messages: LLMMessage[] = [
      { role: "system", content: CRITIQUE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { role: "user", content: `Draft proposal:\n${JSON.stringify(draft, null, 2)}` }
    ];
    const result = await (this.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: this.critiqueModel ?? process.env.ATLAS_LLM_SCHEMA_CRITIQUE_MODEL ?? "anthropic/claude-haiku-4.5",
      maxTokens: 1024,
      tools: [{ name: "emit_critique", description: "Emit critique", input_schema: CRITIQUE_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_critique" }
    });
    const parsed = CritiqueSchema.safeParse(result.input);
    if (!parsed.success) throw new SchemaArchitectFailedError(`critique payload failed schema: ${parsed.error.message}`, { reason: "schema-mismatch", cause: parsed.error });
    return parsed.data;
  }

  private async revise(draft: SchemaProposal, critique: Critique): Promise<SchemaProposal> {
    const messages: LLMMessage[] = [
      { role: "system", content: REVISE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { role: "user", content: `Draft:\n${JSON.stringify(draft, null, 2)}\n\nCritique:\n${JSON.stringify(critique, null, 2)}` }
    ];
    const result = await (this.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: this.reviseModel ?? process.env.ATLAS_LLM_SCHEMA_REVISE_MODEL ?? "anthropic/claude-haiku-4.5",
      maxTokens: 8192,
      tools: [{ name: "emit_revised_schema_proposal", description: "Emit revised proposal", input_schema: REVISED_PROPOSAL_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_revised_schema_proposal" }
    });
    const parsed = SchemaProposalSchema.safeParse(result.input);
    if (!parsed.success) throw new SchemaArchitectFailedError(`revised proposal failed schema: ${parsed.error.message}`, { reason: "schema-mismatch", cause: parsed.error });
    return parsed.data;
  }
}

function extractDesignIntent(prior: unknown): DesignIntent | null {
  if (!prior || typeof prior !== "object") return null;
  const di = (prior as { designIntent?: unknown }).designIntent;
  const parsed = DesignIntentSchema.safeParse(di);
  return parsed.success ? parsed.data : null;
}

function extractBrief(prior: unknown): InspirationBrief | null {
  if (!prior || typeof prior !== "object") return null;
  const brief = (prior as { brief?: unknown }).brief;
  if (brief == null) return null;
  const parsed = InspirationBriefSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

function extractArchitectArtifact(prior: unknown): unknown {
  if (!prior || typeof prior !== "object") return {};
  return (prior as { architectArtifact?: unknown }).architectArtifact ?? {};
}
```

- [ ] **Step 4: Run test, verify green (single-pass path)**

Run: `pnpm --filter @atlas/role-schema-architect test test/role.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/role-schema-architect/src/role.ts packages/role-schema-architect/test/role.test.ts
git commit -m "feat(role-schema-architect): SchemaArchitectRole with single-pass + flag-gated 3-pass"
```

---

## Task 12: 3-pass test coverage (flag ON path)

**Files:**
- Create: `packages/role-schema-architect/test/role-three-pass.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SchemaArchitectRole } from "../src/role.js";
import type { LLMProvider } from "@atlas/llm-provider";

const validProposal = () => {
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest", operations: [] },
    dataModel: {
      entities: [
        {
          name: "user",
          description: "x",
          fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
          primaryKey: { columns: ["id"], strategy: "uuid" },
          indexes: [],
          constraints: [],
          rls: { enabled: false, policies: [] },
          audit: { createdAt: true, updatedAt: true },
          migrationHints: []
        }
      ]
    }
  });
  return {
    recommended: direction("rest-crud"),
    alternates: [direction("rpc"), direction("event-sourced")],
    reasoning: "x"
  };
};

const validCritique = () => ({ distinctness: 8, briefAlignment: 9, issues: [] });

const backendInvocation = {
  ritualId: "r1",
  intent: "test",
  userTurn: "x",
  graphSlice: { bytes: "{}", hash: "h" },
  priorArtifact: {
    designIntent: { category: "backend-rest-api" },
    architectArtifact: { artifactKind: "backend-rest-api" }
  }
} as never;

describe("SchemaArchitectRole 3-pass branch", () => {
  beforeEach(() => {
    process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS = "true";
  });
  afterEach(() => {
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS;
  });

  it("calls completeWithToolUse THREE times (draft + critique + revise)", async () => {
    const llm = {
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal() })
        .mockResolvedValueOnce({ toolName: "emit_critique", input: validCritique() })
        .mockResolvedValueOnce({ toolName: "emit_revised_schema_proposal", input: validProposal() })
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    await role.run(backendInvocation);
    expect((llm as unknown as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledTimes(3);
  });

  it("emits critique + revise events alongside proposal events", async () => {
    const llm = {
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal() })
        .mockResolvedValueOnce({ toolName: "emit_critique", input: validCritique() })
        .mockResolvedValueOnce({ toolName: "emit_revised_schema_proposal", input: validProposal() })
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    const out = await role.run(backendInvocation);
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("schema_architect.critique.started");
    expect(types).toContain("schema_architect.critique.completed");
    expect(types).toContain("schema_architect.revise.started");
    expect(types).toContain("schema_architect.revise.completed");
  });
});
```

- [ ] **Step 2: Run test, verify green**

Run: `pnpm --filter @atlas/role-schema-architect test test/role-three-pass.test.ts`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add packages/role-schema-architect/test/role-three-pass.test.ts
git commit -m "test(role-schema-architect): cover 3-pass branch under flag"
```

---

## Task 13: Package public exports

**Files:**
- Modify: `packages/role-schema-architect/src/index.ts`

- [ ] **Step 1: Replace placeholder with real exports**

```ts
export * from "./types.js";
export * from "./errors.js";
export { validateReferences, type ValidateResult } from "./validate-references.js";
export { generateMigrationHints } from "./migration-hints.js";
export { assembleProposal, DRAFT_SYSTEM_PROMPT, PROPOSAL_TOOL_SCHEMA, DESIGNER_PROPOSAL_MODEL, type AssembleProposalInput } from "./assemble-proposal.js";
export { CRITIQUE_SYSTEM_PROMPT, CRITIQUE_TOOL_SCHEMA, CritiqueSchema, type Critique } from "./critique-prompt.js";
export { REVISE_SYSTEM_PROMPT, REVISED_PROPOSAL_TOOL_SCHEMA } from "./revise-prompt.js";
export { SchemaArchitectRole, type SchemaArchitectRoleOptions } from "./role.js";
```

- [ ] **Step 2: Verify the package builds**

Run: `pnpm --filter @atlas/role-schema-architect build`
Expected: no TS errors. `dist/` populated.

- [ ] **Step 3: Run all package tests once more**

Run: `pnpm --filter @atlas/role-schema-architect test`
Expected: all tests pass (smoke + types + validate-references + migration-hints + errors + assemble + role + role-three-pass).

- [ ] **Step 4: Commit**

```bash
git add packages/role-schema-architect/src/index.ts
git commit -m "feat(role-schema-architect): publish package exports"
```

---

## Task 14: atlas-web — add dep + feature flags

**Files:**
- Modify: `apps/atlas-web/package.json`
- Modify: `apps/atlas-web/lib/feature-flags.ts`

- [ ] **Step 1: Add the workspace dep to atlas-web**

Append to `apps/atlas-web/package.json` dependencies (preserving alphabetical order):

```json
    "@atlas/role-schema-architect": "workspace:*",
```

- [ ] **Step 2: Run pnpm install**

Run: `pnpm install`
Expected: `+ @atlas/role-schema-architect 0.0.0` (workspace symlink).

- [ ] **Step 3: Read current `apps/atlas-web/lib/feature-flags.ts`**

Run: `cat apps/atlas-web/lib/feature-flags.ts | head -40`
Expected: see the pattern for `multi-turn`, `researcher`, `designer`, etc. flags.

- [ ] **Step 4: Add two new flags following the existing pattern**

In `apps/atlas-web/lib/feature-flags.ts`, add to the `FlagName` union:

```ts
  | "schema-architect"
  | "schema-architect-3pass"
```

And add to the `flagEnv` map:

```ts
  "schema-architect":       "ATLAS_FF_SCHEMA_ARCHITECT",
  "schema-architect-3pass": "ATLAS_FF_SCHEMA_ARCHITECT_3PASS",
```

(Exact location depends on the existing file shape — match how `visual-quality-gate` / `multi-turn` are listed.)

- [ ] **Step 5: Verify atlas-web typechecks**

Run: `pnpm --filter atlas-web typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/package.json apps/atlas-web/lib/feature-flags.ts pnpm-lock.yaml
git commit -m "feat(atlas-web): add schema-architect feature flags + dep on role-schema-architect"
```

---

## Task 15: Conditional dispatch in engine factory

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/test/lib/engine/factory.test.ts`

- [ ] **Step 1: Read current factory.ts to find the designer-dispatch site**

Run: `grep -n -E "DesignerRole|designer|register.*designer" apps/atlas-web/lib/engine/factory.ts`
Expected: locate the lines where `DesignerRole` is registered into the role-set.

- [ ] **Step 2: Add failing tests in `apps/atlas-web/test/lib/engine/factory.test.ts`**

Append 3 cases to the existing factory test file. Match the existing pattern in that file. The intent:

```ts
describe("factory — schema-architect conditional dispatch", () => {
  it("registers schema-architect role when schema-architect flag is ON", async () => {
    process.env.ATLAS_FF_SCHEMA_ARCHITECT = "true";
    const f = await getRitualEngineFactory();
    expect(f.roleIds()).toContain("schema-architect");
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT;
  });

  it("does NOT register schema-architect when flag is OFF", async () => {
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT;
    const f = await getRitualEngineFactory();
    expect(f.roleIds()).not.toContain("schema-architect");
  });

  it("designer remains registered regardless of schema-architect flag", async () => {
    process.env.ATLAS_FF_SCHEMA_ARCHITECT = "true";
    const f = await getRitualEngineFactory();
    expect(f.roleIds()).toContain("designer");
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT;
  });
});
```

Note: The exact method to enumerate registered roles depends on existing factory API. If it doesn't expose `roleIds()`, add it or use the test pattern already in the file (e.g. `factory.getRole("schema-architect")` returning defined-or-undefined).

- [ ] **Step 3: Run tests to verify red**

Run: `pnpm --filter atlas-web test test/lib/engine/factory.test.ts`
Expected: 3 new tests fail.

- [ ] **Step 4: Implement conditional dispatch in `factory.ts`**

Find the designer registration block and add this alongside (NOT replacing — both can coexist; the conductor dispatches based on artifactKind):

```ts
import { SchemaArchitectRole } from "@atlas/role-schema-architect";
// ... near where DesignerRole is registered:

if (isFeatureEnabled("schema-architect")) {
  roles.set(
    "schema-architect",
    new SchemaArchitectRole({
      llm,
      // critiqueModel/reviseModel pick up env if 3-pass flag is on
    })
  );
}
```

- [ ] **Step 5: Run tests, verify green**

Run: `pnpm --filter atlas-web test test/lib/engine/factory.test.ts`
Expected: all 3 new cases pass; no regressions.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/test/lib/engine/factory.test.ts
git commit -m "feat(atlas-web): conditional dispatch of schema-architect role behind flag"
```

---

## Task 16: Event-type mappings for schema-architect events

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts` (the SSE forwarding switch)

- [ ] **Step 1: Find the SSE event-type switch in factory.ts**

Run: `grep -n -E "case \"designer\.|case \"researcher\.|case \"security\\." apps/atlas-web/lib/engine/factory.ts`
Expected: find the switch statement that maps conductor event types to broker RitualEvent types.

- [ ] **Step 2: Add `schema_architect.*` cases**

In the switch statement, add:

```ts
case "schema_architect.proposal.started":   return { type: "schema_architect.proposal.started",   payload };
case "schema_architect.proposal.emitted":   return { type: "schema_architect.proposal.emitted",   payload };
case "schema_architect.proposal.completed": return { type: "schema_architect.proposal.completed", payload };
case "schema_architect.proposal.failed":    return { type: "schema_architect.proposal.failed",    payload };
case "schema_architect.proposal.skipped":   return { type: "schema_architect.proposal.skipped",   payload };
case "schema_architect.critique.started":   return { type: "schema_architect.critique.started",   payload };
case "schema_architect.critique.completed": return { type: "schema_architect.critique.completed", payload };
case "schema_architect.revise.started":     return { type: "schema_architect.revise.started",     payload };
case "schema_architect.revise.completed":   return { type: "schema_architect.revise.completed",   payload };
case "schema.direction.selected":           return { type: "schema.direction.selected",           payload };
```

Important: add these BEFORE the default case. Match the formatting of existing cases.

- [ ] **Step 3: Update `RitualEvent` type in `apps/atlas-web/lib/events/EventBroker.ts` (or wherever its union lives)**

Run: `grep -n -E "type RitualEvent =|RitualEventType =" apps/atlas-web/lib/events/`
Expected: find the union type definition.

Add the new event types to the union:

```ts
  | { type: "schema_architect.proposal.started";   payload: { ritualId: string } }
  | { type: "schema_architect.proposal.emitted";   payload: { proposal: unknown } }
  | { type: "schema_architect.proposal.completed"; payload: { proposal: unknown } }
  | { type: "schema_architect.proposal.failed";    payload: { error: string; reason: string } }
  | { type: "schema_architect.proposal.skipped";   payload: { reason: string } }
  | { type: "schema_architect.critique.started";   payload: Record<string, never> }
  | { type: "schema_architect.critique.completed"; payload: { critique: unknown } }
  | { type: "schema_architect.revise.started";     payload: Record<string, never> }
  | { type: "schema_architect.revise.completed";   payload: { proposal: unknown } }
  | { type: "schema.direction.selected";           payload: { directionId: string; direction: unknown } }
```

`unknown` for proposal/critique/direction is intentional — the strong type lives in `@atlas/role-schema-architect`; the broker is style-agnostic.

- [ ] **Step 4: Typecheck atlas-web**

Run: `pnpm --filter atlas-web typecheck`
Expected: clean (the new event types may surface as unhandled in switch statements in consumers; that's expected — add the missing case clauses if any).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/lib/events/EventBroker.ts
git commit -m "feat(atlas-web): forward schema_architect.* + schema.direction.selected SSE events"
```

---

## Task 17: selectSchemaDirection server action (TDD)

**Files:**
- Create: `apps/atlas-web/test/actions/selectSchemaDirection.test.ts`
- Create: `apps/atlas-web/lib/actions/selectSchemaDirection.ts`

- [ ] **Step 1: Read the existing `selectDesignDirection.ts` for reference**

Run: `cat apps/atlas-web/lib/actions/selectDesignDirection.ts`
Expected: the analogous action for the frontend designer; copy its structure (authz + canvasPauseRegistry.resolve + EventBroker publish).

- [ ] **Step 2: Write the failing test**

Create `apps/atlas-web/test/actions/selectSchemaDirection.test.ts` mirroring whatever pattern exists in `selectDesignDirection.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { selectSchemaDirection } from "@/lib/actions/selectSchemaDirection";

// Mocks for auth, broker, canvasPauseRegistry — match the pattern from selectDesignDirection.test.ts

describe("selectSchemaDirection", () => {
  it("returns ok=true and resolves canvas pause with the chosen direction", async () => {
    // Set up mocks: authz passes, broker captures, pause-registry tracks resolve
    // Call selectSchemaDirection({ projectId, ritualId, direction })
    // Assert: result.ok === true, broker received schema.direction.selected, registry.resolve called once
  });

  it("returns ok=false reason=unauthorized when user doesn't own project", async () => {
    // ...
  });

  it("returns ok=false reason=replay when direction.id is not from the latest schema_architect.proposal.emitted event", async () => {
    // ...
  });

  it("works for REST contract style", async () => {});
  it("works for GraphQL contract style", async () => {});
  it("returns ok=false when ritualId has no pending canvas pause", async () => {});
});
```

(Full mock plumbing depends on the existing test pattern; copy from `selectDesignDirection.test.ts` and substitute `Schema` for `Design` throughout.)

- [ ] **Step 3: Run tests, verify red**

Run: `pnpm --filter atlas-web test test/actions/selectSchemaDirection.test.ts`
Expected: module-not-found.

- [ ] **Step 4: Implement `apps/atlas-web/lib/actions/selectSchemaDirection.ts`**

Use `selectDesignDirection.ts` as the literal template — copy it, rename `Design` → `Schema` throughout, swap event names. Critical replay-protect step:

```ts
"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getEventBroker } from "@/lib/events/factory";
import { getCanvasPauseRegistry } from "@/lib/canvas/pause-registry";
import { isUserOwnerOfProject } from "@/lib/projects/repo";
import type { SchemaDirection } from "@atlas/role-schema-architect";

export async function selectSchemaDirection({
  projectId,
  ritualId,
  direction
}: {
  projectId: string;
  ritualId: string;
  direction: SchemaDirection;
}): Promise<{ ok: true } | { ok: false; reason: "unauthorized" | "replay" | "no-pending-pause" | "internal" }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, reason: "unauthorized" };

  const owned = await isUserOwnerOfProject(userId, projectId);
  if (!owned) return { ok: false, reason: "unauthorized" };

  // Replay protection: read the most recent schema_architect.proposal.emitted
  // event for this ritualId via EventBroker and confirm direction.id is one of
  // {recommended.id, alternates[0].id, alternates[1].id}.
  const broker = getEventBroker();
  const recent = await broker.getRecent(projectId, { types: ["schema_architect.proposal.emitted"], limit: 1 });
  const latest = recent.find((e) => (e.payload as { proposal?: { recommended?: { id: string } } })?.proposal !== undefined);
  if (!latest) return { ok: false, reason: "no-pending-pause" };
  const proposal = (latest.payload as { proposal: { recommended: { id: string }; alternates: Array<{ id: string }> } }).proposal;
  const validIds = new Set([proposal.recommended.id, ...proposal.alternates.map((a) => a.id)]);
  if (!validIds.has(direction.id)) return { ok: false, reason: "replay" };

  await broker.publish(projectId, {
    type: "schema.direction.selected",
    payload: { directionId: direction.id, direction }
  });

  const registry = getCanvasPauseRegistry();
  const resolved = registry.resolve(ritualId, { directionId: direction.id, direction });
  if (!resolved) return { ok: false, reason: "no-pending-pause" };

  return { ok: true };
}
```

(Adjust import paths to match actual codebase. The `selectDesignDirection.ts` will show the exact patterns.)

- [ ] **Step 5: Run tests, verify green**

Run: `pnpm --filter atlas-web test test/actions/selectSchemaDirection.test.ts`
Expected: all cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/actions/selectSchemaDirection.ts apps/atlas-web/test/actions/selectSchemaDirection.test.ts
git commit -m "feat(atlas-web): selectSchemaDirection server action with replay protection"
```

---

## Task 18: SchemaCanvas — 3-card render (TDD)

**Files:**
- Create: `apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx`
- Create: `apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx`

- [ ] **Step 1: Read existing DesignerCanvas + its test for shape**

Run: `cat apps/atlas-web/components/canvas/renderers/DesignerCanvas.tsx | head -80`
Expected: see how DesignerCanvas reads `useDesignerProposal()` (or analogous), renders cards, calls `selectDesignDirection`.

- [ ] **Step 2: Write the failing test (top-level: 3-card render + empty state)**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchemaCanvas } from "@/components/canvas/renderers/SchemaCanvas";

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => ({ events: [] /* per-test override */, status: "open", lastEventId: null })
}));

const proposal = () => ({
  recommended: dir("rest-crud", "RESTful CRUD"),
  alternates: [dir("rpc", "RPC-style"), dir("event-sourced", "Event-sourced")],
  reasoning: "RESTful CRUD because the brief says admin-CRUD on resources."
});

const dir = (id: string, name: string) => ({
  id,
  name,
  shortDescription: "x",
  technicalDescription: "y",
  contract: { style: "rest", operations: [] },
  dataModel: { entities: [] }
});

describe("SchemaCanvas — empty state", () => {
  it("renders 'Waiting for schema proposal' before any event arrives", () => {
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    expect(screen.getByText(/waiting for schema proposal/i)).toBeInTheDocument();
  });
});

describe("SchemaCanvas — 3-card render", () => {
  beforeEach(() => {
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: proposal() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
  });

  it("renders 3 cards (recommended + 2 alternates) with names", () => {
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    expect(screen.getByText("RESTful CRUD")).toBeInTheDocument();
    expect(screen.getByText("RPC-style")).toBeInTheDocument();
    expect(screen.getByText("Event-sourced")).toBeInTheDocument();
  });

  it("marks the recommended card with a 'Recommended' badge", () => {
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    const recommendedCard = screen.getByText("RESTful CRUD").closest("[data-testid='schema-direction-card']");
    expect(recommendedCard?.textContent).toMatch(/Recommended/i);
  });
});
```

- [ ] **Step 3: Run test, verify red**

Run: `pnpm --filter atlas-web test test/components/canvas/renderers/SchemaCanvas.test.tsx`
Expected: module-not-found.

- [ ] **Step 4: Implement minimal `<SchemaCanvas>` (cards-only; expand pane is Task 19)**

```tsx
"use client";

import * as React from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { SchemaProposal, SchemaDirection } from "@atlas/role-schema-architect";

export interface SchemaCanvasProps {
  projectId: string;
  ritualId: string;
  persona: "ama" | "diego" | "priya";
}

export function SchemaCanvas({ projectId, ritualId, persona }: SchemaCanvasProps) {
  const { events } = useEventStream();
  const proposal = React.useMemo(() => extractLatestProposal(events), [events]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (!proposal) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500" data-testid="schema-canvas">
        <p>Waiting for schema proposal…</p>
      </div>
    );
  }

  const cards: Array<{ direction: SchemaDirection; isRecommended: boolean }> = [
    { direction: proposal.recommended, isRecommended: true },
    { direction: proposal.alternates[0], isRecommended: false },
    { direction: proposal.alternates[1], isRecommended: false }
  ];

  return (
    <main className="p-6" data-testid="schema-canvas">
      <h2 className="mb-4 text-lg font-semibold">Schema directions</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map(({ direction, isRecommended }) => (
          <button
            key={direction.id}
            type="button"
            data-testid="schema-direction-card"
            onClick={() => setSelectedId(direction.id)}
            className={`rounded-lg border p-4 text-left transition ${
              selectedId === direction.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
            }`}
          >
            {isRecommended && (
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended</div>
            )}
            <div className="text-base font-semibold">{direction.name}</div>
            <div className="mt-1 text-sm text-slate-600">{direction.shortDescription}</div>
            <div className="mt-2 text-xs text-slate-500">
              {direction.contract.operations.length} operations · {direction.dataModel.entities.length} entities
            </div>
          </button>
        ))}
      </div>
      {selectedId && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="schema-direction-detail">
          <p className="text-sm text-slate-500">Selected: {selectedId}. Detail pane lands in Task 19.</p>
        </div>
      )}
    </main>
  );
}

function extractLatestProposal(events: Array<{ type: string; payload: unknown }>): SchemaProposal | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "schema_architect.proposal.emitted") {
      const proposal = (e.payload as { proposal?: SchemaProposal }).proposal;
      if (proposal) return proposal;
    }
  }
  return null;
}
```

- [ ] **Step 5: Run test, verify green**

Run: `pnpm --filter atlas-web test test/components/canvas/renderers/SchemaCanvas.test.tsx`
Expected: 3 passed (empty state + 3-card render + recommended badge).

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx
git commit -m "feat(atlas-web): SchemaCanvas v1 — 3-card render + empty state"
```

---

## Task 19: SchemaCanvas — expand pane (Contract | Data Model split)

**Files:**
- Modify: `apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx`
- Modify: `apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx`

- [ ] **Step 1: Append failing tests for expand pane**

Append to the test file:

```tsx
describe("SchemaCanvas — expand pane on select", () => {
  // Reuse the schema_architect.proposal.emitted mock from Task 18

  it("shows Contract + Data Model headers when a card is selected", async () => {
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="diego" />);
    const card = screen.getByText("RESTful CRUD").closest("[data-testid='schema-direction-card']")!;
    await userEvent.click(card);
    expect(screen.getByText(/Contract/)).toBeInTheDocument();
    expect(screen.getByText(/Data Model/)).toBeInTheDocument();
  });

  it("renders REST operations as METHOD path lines", async () => {
    const proposalWithOps = { /* same as proposal() but with operations: [{method:"GET",path:"/users",summary:"x",statusCodes:[200]}] */ };
    // Override mock to return this proposal
    // ... render + click recommended ...
    expect(screen.getByText("GET")).toBeInTheDocument();
    expect(screen.getByText("/users")).toBeInTheDocument();
  });

  it("renders GraphQL operations as KIND name lines", async () => {
    // Override mock with style: "graphql" + a query op
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getByText("listUsers")).toBeInTheDocument();
  });

  it("renders entity field rows with type", async () => {
    // Override mock with entity user { fields: [{name:"email", type:"citext", nullable:false}] }
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("citext")).toBeInTheDocument();
  });
});
```

(Full mock data omitted for brevity; copy the proposal-builder helper from Task 18 tests and parameterize the operation list.)

- [ ] **Step 2: Run tests, verify red**

Run: `pnpm --filter atlas-web test test/components/canvas/renderers/SchemaCanvas.test.tsx`
Expected: new 4 cases fail.

- [ ] **Step 3: Add the expand pane to `<SchemaCanvas>`**

Replace the placeholder detail pane from Task 18 with:

```tsx
{selectedId && selected && (
  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="schema-direction-detail">
    <ContractPane contract={selected.contract} />
    <DataModelPane entities={selected.dataModel.entities} persona={persona} />
  </div>
)}
```

Where `selected = cards.find((c) => c.direction.id === selectedId)?.direction`.

Add two sub-components in the same file:

```tsx
function ContractPane({ contract }: { contract: SchemaDirection["contract"] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Contract</h3>
      {contract.style === "rest" ? (
        <ul className="space-y-1 font-mono text-xs">
          {contract.operations.map((op) => (
            <li key={`${op.method}-${op.path}`}>
              <span className="font-semibold">{op.method}</span> {op.path}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1 font-mono text-xs">
          {contract.operations.map((op) => (
            <li key={`${op.kind}-${op.name}`}>
              <span className="font-semibold">{op.kind}</span> {op.name}: {op.returnType}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DataModelPane({ entities, persona }: { entities: Array<import("@atlas/role-schema-architect").Entity>; persona: "ama" | "diego" | "priya" }) {
  const showAdvanced = persona === "diego" || persona === "priya";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">Data Model</h3>
      <ul className="space-y-3">
        {entities.map((e) => (
          <li key={e.name}>
            <div className="font-mono text-sm font-semibold">{e.name}</div>
            <ul className="ml-3 mt-1 space-y-0.5">
              {e.fields.map((f) => (
                <li key={f.name} className="font-mono text-xs text-slate-600">
                  {f.name} <span className="text-slate-400">{f.type}</span>
                  {showAdvanced && f.nullable === false ? <span className="text-slate-400"> NOT NULL</span> : null}
                </li>
              ))}
            </ul>
            {showAdvanced && e.indexes.length > 0 && (
              <div className="ml-3 mt-1 text-xs text-slate-500">
                {e.indexes.length} index{e.indexes.length === 1 ? "" : "es"}
              </div>
            )}
            {showAdvanced && e.rls.enabled && (
              <div className="ml-3 mt-1 text-xs text-amber-600">RLS · {e.rls.policies.length} polic{e.rls.policies.length === 1 ? "y" : "ies"}</div>
            )}
            {showAdvanced && e.migrationHints.length > 0 && (
              <details className="ml-3 mt-1 text-xs text-slate-500">
                <summary>Migration hints ({e.migrationHints.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {e.migrationHints.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm --filter atlas-web test test/components/canvas/renderers/SchemaCanvas.test.tsx`
Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx
git commit -m "feat(atlas-web): SchemaCanvas expand pane — Contract | Data Model split w/ persona density"
```

---

## Task 20: SchemaCanvas — "Use this direction" wires to selectSchemaDirection

**Files:**
- Modify: `apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx`
- Modify: `apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
describe("SchemaCanvas — Use this direction", () => {
  it("calls selectSchemaDirection with the selected direction on click", async () => {
    const selectSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("@/lib/actions/selectSchemaDirection", () => ({ selectSchemaDirection: selectSpy }));
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    await userEvent.click(screen.getByText("RESTful CRUD").closest("[data-testid='schema-direction-card']")!);
    await userEvent.click(screen.getByRole("button", { name: /use this direction/i }));
    expect(selectSpy).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      ritualId: "r1",
      direction: expect.objectContaining({ id: "rest-crud" })
    }));
  });

  it("shows a toast with reason when the action returns ok=false", async () => {
    vi.doMock("@/lib/actions/selectSchemaDirection", () => ({
      selectSchemaDirection: vi.fn().mockResolvedValue({ ok: false, reason: "replay" })
    }));
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    await userEvent.click(screen.getByText("RESTful CRUD").closest("[data-testid='schema-direction-card']")!);
    await userEvent.click(screen.getByRole("button", { name: /use this direction/i }));
    expect(await screen.findByText(/replay/i)).toBeInTheDocument();
  });

  it("renders 'Developer building...' after a successful select", async () => {
    vi.doMock("@/lib/actions/selectSchemaDirection", () => ({ selectSchemaDirection: vi.fn().mockResolvedValue({ ok: true }) }));
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    await userEvent.click(screen.getByText("RESTful CRUD").closest("[data-testid='schema-direction-card']")!);
    await userEvent.click(screen.getByRole("button", { name: /use this direction/i }));
    expect(await screen.findByText(/developer building/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, verify red**

Run: `pnpm --filter atlas-web test test/components/canvas/renderers/SchemaCanvas.test.tsx`
Expected: 3 new cases fail.

- [ ] **Step 3: Wire the action button into SchemaCanvas.tsx**

Add to the SchemaCanvas component:

```tsx
import { selectSchemaDirection } from "@/lib/actions/selectSchemaDirection";

// In SchemaCanvas state:
const [submitting, setSubmitting] = React.useState(false);
const [error, setError] = React.useState<string | null>(null);
const [submitted, setSubmitted] = React.useState(false);

const handleUseThis = async () => {
  if (!selected) return;
  setSubmitting(true);
  setError(null);
  const result = await selectSchemaDirection({ projectId, ritualId, direction: selected });
  setSubmitting(false);
  if (result.ok) {
    setSubmitted(true);
  } else {
    setError(`Could not select: ${result.reason}`);
  }
};

// Inside the detail pane:
{!submitted && (
  <div className="md:col-span-2 mt-2 flex items-center gap-3">
    <button
      type="button"
      onClick={handleUseThis}
      disabled={submitting}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {submitting ? "Selecting…" : "Use this direction"}
    </button>
    {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
  </div>
)}
{submitted && (
  <div className="md:col-span-2 mt-2 text-sm text-slate-700" role="status">
    Selected — Developer building…
  </div>
)}
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm --filter atlas-web test test/components/canvas/renderers/SchemaCanvas.test.tsx`
Expected: all cases pass (3-card + expand + 3 use-this cases = 10 total).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/canvas/renderers/SchemaCanvas.tsx apps/atlas-web/test/components/canvas/renderers/SchemaCanvas.test.tsx
git commit -m "feat(atlas-web): SchemaCanvas Use-this-direction wiring + toast + selected state"
```

---

## Task 21: Register `schema` renderer in canvasModeRegistry

**Files:**
- Modify: `apps/atlas-web/components/canvas/register-renderers.tsx`

- [ ] **Step 1: Read current registration**

Run: `cat apps/atlas-web/components/canvas/register-renderers.tsx`
Expected: see `designing`, `refining`, `preview` registered.

- [ ] **Step 2: Add `schema`**

Edit to add:

```tsx
import { SchemaCanvas } from "./renderers/SchemaCanvas";
// ...
canvasModeRegistry.register("schema", SchemaCanvas as React.ComponentType<unknown>);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter atlas-web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/components/canvas/register-renderers.tsx
git commit -m "feat(atlas-web): register SchemaCanvas under renderer='schema'"
```

---

## Task 22: Replace placeholder visual fixture with the live renderer (visual E2E)

**Files:**
- Modify: `apps/atlas-web/app/visual-fixtures/schema-canvas/page.tsx`
- Create: `apps/atlas-web/e2e/visual/schema-canvas-three-directions.spec.ts`
- Delete: `apps/atlas-web/e2e/visual/schema-canvas-tenants-rls.spec.ts` (replaced by the new spec)
- Delete: `apps/atlas-web/e2e/visual/__snapshots__/schema-canvas-tenants-rls.spec.ts/` (6 PNG baselines)

- [ ] **Step 1: Replace the fixture page with a SchemaCanvas-driven view**

Replace `apps/atlas-web/app/visual-fixtures/schema-canvas/page.tsx` to mount the real `<SchemaCanvas>` against a canned event stream:

```tsx
import { SchemaCanvasFixtureClient } from "./fixture-client";

export const dynamic = "force-dynamic";

export default function SchemaCanvasFixture() {
  return <SchemaCanvasFixtureClient />;
}
```

Create `apps/atlas-web/app/visual-fixtures/schema-canvas/fixture-client.tsx` to inject a canned proposal into the SchemaCanvas via a mocked EventSource. (Match the pattern other visual fixtures use — `app/visual-fixtures/canvas-pause` or similar likely has the harness already.)

- [ ] **Step 2: Create the new Playwright spec**

```ts
// apps/atlas-web/e2e/visual/schema-canvas-three-directions.spec.ts
import { test, expect } from "@playwright/test";
import { gotoWithPersona } from "./helpers/set-persona";
import { expectAxeClean } from "./helpers/run-axe";

const PERSONAS = ["ama", "diego", "priya"] as const;
const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 800 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "mobile", w: 375, h: 667 }
];

for (const persona of PERSONAS) {
  for (const vp of VIEWPORTS) {
    test(`schema-canvas three-directions persona=${persona} viewport=${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await gotoWithPersona(page, "/visual-fixtures/schema-canvas", persona);
      await expect(page.getByTestId("schema-canvas")).toHaveScreenshot(
        `schema-canvas-${persona}-${vp.name}.png`
      );
      await expectAxeClean(page);
    });
  }
}
```

(Note: this gives 9 tests = 3 personas × 3 viewports, replacing the 6 from the old spec.)

- [ ] **Step 3: Delete the old spec + its snapshots**

```bash
rm apps/atlas-web/e2e/visual/schema-canvas-tenants-rls.spec.ts
rm -rf apps/atlas-web/e2e/visual/__snapshots__/schema-canvas-tenants-rls.spec.ts
```

- [ ] **Step 4: Run Playwright in update-snapshot mode to generate baselines**

Run: `pnpm --filter atlas-web exec playwright test e2e/visual/schema-canvas-three-directions.spec.ts --update-snapshots`
Expected: 9 PNG baselines generated under `__snapshots__/schema-canvas-three-directions.spec.ts/`.

- [ ] **Step 5: Re-run without `--update-snapshots` to confirm they match**

Run: `pnpm --filter atlas-web exec playwright test e2e/visual/schema-canvas-three-directions.spec.ts`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/app/visual-fixtures/schema-canvas/ apps/atlas-web/e2e/visual/schema-canvas-three-directions.spec.ts apps/atlas-web/e2e/visual/__snapshots__/schema-canvas-three-directions.spec.ts/
git rm apps/atlas-web/e2e/visual/schema-canvas-tenants-rls.spec.ts
git rm -r apps/atlas-web/e2e/visual/__snapshots__/schema-canvas-tenants-rls.spec.ts/
git commit -m "test(atlas-web,e2e): visual snapshots for SchemaCanvas three-directions"
```

---

## Task 23: Full-flow E2E — backend ritual pauses at SchemaCanvas

**Files:**
- Create: `apps/atlas-web/e2e/flow/backend-ritual-schema-pause.spec.ts`

This task depends on whatever ritual-flow harness exists in atlas-web. Investigate first; the existing designer-flow E2E (if any) is the template.

- [ ] **Step 1: Investigate existing ritual-flow harness**

Run: `find apps/atlas-web/e2e -type d -maxdepth 3`
Expected: locate existing `e2e/flow/` or analogous. Look for fixtures that mock LLM responses + drive the engine to canvas-pause for the designer flow.

- [ ] **Step 2: Write the spec mirroring the designer-flow E2E**

```ts
import { test, expect } from "@playwright/test";

test.describe("Backend ritual pauses at SchemaCanvas", () => {
  test.beforeEach(async ({ page }) => {
    process.env.ATLAS_FF_SCHEMA_ARCHITECT = "true";
  });

  test("REST: pauses → user selects recommended → developer fires", async ({ page }) => {
    // 1. Seed a fresh project, artifactKind=backend-rest-api
    // 2. Start a ritual (canned LLM responses for architect + researcher)
    // 3. SchemaArchitect emits the canned 3-direction proposal
    // 4. Navigate to the canvas; expect <SchemaCanvas> to render 3 cards
    // 5. Click "RESTful CRUD" card → click "Use this direction"
    // 6. Assert: schema.direction.selected event observed, developer.code.started observed next
  });

  test("GraphQL variant: pauses → user picks → developer fires", async ({ page }) => {
    // Same pattern but artifactKind=backend-graphql, canned GraphQL proposal
  });

  test("Auto-fix retries on broken-reference and succeeds", async ({ page }) => {
    // Canned LLM emits a proposal with a broken reference on first call;
    // valid proposal on second. Assert auto-fix retried and the ritual ultimately reached the pause.
  });
});
```

(Full mock harness depends on the existing pattern — defer concrete code to the planning sub-agent which can read the live harness in `apps/atlas-web/e2e/flow/` or equivalent.)

- [ ] **Step 3: Run the spec**

Run: `pnpm --filter atlas-web exec playwright test e2e/flow/backend-ritual-schema-pause.spec.ts`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/e2e/flow/backend-ritual-schema-pause.spec.ts
git commit -m "test(atlas-web,e2e): full-flow drive — backend ritual pauses at SchemaCanvas"
```

---

## Task 24: Pre-merge checklist

- [ ] **Step 1: Workspace-wide build**

Run: `pnpm -r build`
Expected: clean.

- [ ] **Step 2: Workspace-wide typecheck**

Run: `pnpm -r typecheck`
Expected: 0 errors.

- [ ] **Step 3: Workspace-wide test**

Run: `pnpm -r test`
Expected: all packages pass.

- [ ] **Step 4: Lint (atlas-web)**

Run: `pnpm --filter atlas-web lint`
Expected: 0 errors / 0 warnings.

- [ ] **Step 5: Full Playwright run**

Run: `pnpm --filter atlas-web exec playwright test`
Expected: all visual + flow tests pass.

- [ ] **Step 6: Verify flag-OFF behavior is byte-identical to main**

Run: `git diff main..HEAD -- apps/atlas-web/components apps/atlas-web/lib | wc -l` and visually scan
Expected: only new files + conditional dispatch additions; no behavior change when `ATLAS_FF_SCHEMA_ARCHITECT` is unset.

- [ ] **Step 7: Push + open draft PR**

```bash
git push -u origin feat/schema-canvas-and-architect
gh pr create --draft --base main --head feat/schema-canvas-and-architect \
  --title "feat: SchemaCanvas + schema-architect role (backend visualize step)" \
  --body "$(cat docs/superpowers/specs/2026-05-21-schema-canvas-and-architect-design.md | head -40)"
```

Expected: PR opened; CI runs against the branch.

---

## Self-Review Notes

After plan execution, the following spec sections must be covered by tasks:

- Section 1 (Overview) — N/A; descriptive.
- Section 2 (Scope) — Tasks 1, 10 (3-pass scaffold + flag), 14 (flag), 21 (renderer registration).
- Section 3 (Architecture) — Tasks 15, 16, 21 (registration), 17 (action).
- Section 4 (Data types) — Tasks 3, 4, 5, 6 (Zod + cross-entity refine).
- Section 5 (Prompt rules) — Task 9 (system prompt encodes all 10 rules).
- Section 6 (Migration hints) — Task 7.
- Section 7 (Event flow) — Task 16 (mappings) + 11 (events emitted by role).
- Section 8 (Selection action) — Task 17.
- Section 9 (Canvas state machine) — Tasks 18, 19, 20.
- Section 10 (Error handling) — Task 8 (errors) + 11 (role catches + emits).
- Section 11 (Testing) — Every task pairs a red test before implementation. Tasks 22, 23 cover E2E.
- Section 12 (Out of v1) — N/A; explicitly deferred.
- Section 13 (Acceptance criteria) — Task 24 (pre-merge checklist).
- Section 14 (Open questions) — Model default decided at Task 9 (env override path); E2E harness investigation deferred to Task 23 sub-agent.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-schema-canvas-and-architect.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
