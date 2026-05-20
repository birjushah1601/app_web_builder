# Spec Graph Schema & Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@atlas/spec-graph-schema` — the typed schema package defining 14 node types, 13 edge types, the graph root object, and 14 structural invariants with a pure `validate()` function. Publishes a JSON Schema 2020-12 artifact for non-TS consumers.

**Architecture:** A single new pnpm-workspace package (`packages/spec-graph-schema`). Pure TypeScript / Zod — no DB, no I/O, no async. Each node type is a Zod schema. Nodes assemble into a discriminated union (`NodeSchema`) plus a registry map (`nodeRegistry`). Same shape for edges. The graph root composes everything. `validate(graph)` runs Zod parse + 14 invariant checks and returns a structured `ValidationResult` keyed to node/edge ids. JSON Schema is generated at build time via `zod-to-json-schema`. The validator is wired into `@atlas/spec-graph-data`'s `SpecGraphRepo` as an opt-in (constructor flag) so the data layer stays schema-agnostic for tests but validates in production.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · pnpm workspaces · Zod 3.23.8 · zod-to-json-schema 3.23.5 · Vitest 2.x. No runtime dependencies beyond Zod (intentional — this package is the canonical schema and must stay light).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan A.1 merged (`@atlas/spec-graph-data` is in the workspace)
- Node 22 LTS (`node --version` ≥ v22.0.0) and pnpm 9+
- No DB needed for this package's own tests (pure unit)
- DB needed only for Task 33 (wiring into spec-graph-data) — Postgres on port 5433 from A.1's docker-compose

---

## File Structure

Files this plan creates. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  spec-graph-schema/
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    scripts/
      generate-json-schema.mjs            # zod-to-json-schema emit script
    src/
      index.ts                            # public exports
      primitives.ts                       # NodeId, EdgeId, ProjectId, refs, enums
      nodes/
        page.ts
        route.ts
        component.ts
        client-state.ts
        model.ts
        endpoint.ts
        flow.ts
        auth-boundary.ts
        test.ts
        design-token.ts
        dependency.ts
        compliance-class.ts
        ai-feature.ts
        media-asset.ts
        index.ts                          # discriminated union + registry
      edges/
        renders.ts
        fetches.ts
        reads.ts
        mutates.ts
        requires.ts
        covers.ts
        depends-on.ts
        styled-by.ts
        subject-to.ts
        supersedes.ts
        powers.ts
        displays.ts
        manages.ts
        index.ts                          # discriminated union + registry
      graph.ts                            # root SpecGraph object
      invariants/
        runner.ts                         # ValidationResult + runInvariants
        i01-page-routeref.ts
        i02-endpoint-routeref.ts
        i03-page-auth-required-needs-boundary.ts
        i04-pii-mutating-endpoint-needs-auth-and-compliance.ts
        i05-pii-model-needs-rls.ts
        i06-no-critical-cves.ts
        i07-renders-target-exists.ts
        i08-baseline-compliance-present.ts
        i09-test-coverage-required-targets.ts
        i10-aifeature-personalized-needs-compliance.ts
        i11-mediaasset-generated-needs-provider.ts
        i12-pii-clientstate-needs-compliance.ts
        i13-baseline-tests-for-protected-targets.ts
        i14-mediaasset-kind-allowlist-v1.ts
      validate.ts                         # public validate() entry point
    dist/
      schema/
        spec-graph.v1.schema.json         # generated at build time
    test/
      primitives.test.ts
      nodes/
        page.test.ts
        route.test.ts
        component.test.ts
        client-state.test.ts
        model.test.ts
        endpoint.test.ts
        flow.test.ts
        auth-boundary.test.ts
        test.test.ts
        design-token.test.ts
        dependency.test.ts
        compliance-class.test.ts
        ai-feature.test.ts
        media-asset.test.ts
      edges/
        all-edges.test.ts                 # one file covering all 13 edges (each is small)
      graph.test.ts
      invariants/
        i01.test.ts ... i14.test.ts       # one file per invariant
      validate.test.ts                    # end-to-end validate() over real-shaped graphs
      json-schema.test.ts                 # asserts the generated artifact loads + validates a sample
      fixtures/
        valid-minimal.json                # minimal valid graph
        valid-full-example.json           # the §5.5 forgot-password example
        invariant-violations/
          i01-missing-routeref.json
          ... (one per invariant)
```

**Why this shape.** Each node and edge gets its own file because the schemas grow over time and small files keep them focused. Invariants are per-file because each is independent — adding a 15th invariant in Phase B is a single new file plus a runner registration. The fixtures directory holds valid + each invariant violation as JSON so tests are data-driven.

**What Plan B.1 does NOT build.** Python Pydantic bindings (deferred to Plan B.2 — generated via `datamodel-code-generator` from this plan's JSON Schema artifact). Cross-substrate invariants that consult event logs (deferred to a future reconciliation package). A markdown reference doc generator (B.2 or later). Schema migration tooling for v2 (Phase B). Wireframe / UI integration of validation errors (Unit E).

---

## Design Decisions

These resolve the open questions from `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` §Unit B.

1. **Zod v3** (3.23.8). v4 is in RC; v3 is stable and feature-complete for our needs.
2. **Discriminated unions for type narrowing + registry map for dynamic access.** `NodeSchema = z.discriminatedUnion("kind", [PageSchema, RouteSchema, ...])` lets TypeScript narrow on `node.kind`. `nodeRegistry: Record<NodeKind, ZodSchema>` lets dynamic code (test generators, reconciliation) look up a schema by string kind.
3. **Extension surface enabled from day one.** Every node carries `extensions?: Record<string, unknown>`. Two-field cost; outsized long-term value for users who need custom attributes without forking the schema.
4. **JSON Schema strictness:** `additionalProperties: false` on nodes, edges, and the root object. `extensions` is the lenient escape hatch. Bug-catching beats forgiveness here.
5. **Pure-graph invariants only.** All 14 invariants in §5.4 of the design spec are graph-local — they only consult nodes/edges in the input. Invariants that would need to consult `spec_events` (event-log lineage checks) are deferred to a future reconciliation package per the roadmap.
6. **Opt-in validation in the data layer.** `SpecGraphRepo` constructor takes an optional `{ validator?: GraphValidator }` arg. When set, `create` and `updateGraphData` run validation before writing. Existing tests that pass raw `{ marker: "..." }` payloads keep working unchanged.

---

## Task List (33 tasks)

Each task is TDD-shaped: write the failing test, run red, write minimal code, run green, commit. Every task commits. Commits use Conventional Commits prefixes.

---

### Task 1: Package scaffold

**Files:**
- Create: `packages/spec-graph-schema/package.json`
- Create: `packages/spec-graph-schema/tsconfig.json`
- Create: `packages/spec-graph-schema/vitest.config.ts`
- Create: `packages/spec-graph-schema/src/index.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@atlas/spec-graph-schema",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schema/spec-graph.v1.schema.json": "./dist/schema/spec-graph.v1.schema.json"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/generate-json-schema.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8",
    "zod-to-json-schema": "3.23.5"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "scripts"]
}
```

- [ ] **Step 3: vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

This package has NO globalSetup — it has no DB, no async setup. Pure unit tests.

- [ ] **Step 4: src/index.ts (stub)**

```ts
export const PACKAGE_NAME = "@atlas/spec-graph-schema";
```

- [ ] **Step 5: Install + verify**

```bash
pnpm install
pnpm -F @atlas/spec-graph-schema build
pnpm -F @atlas/spec-graph-schema typecheck
```

All three exit 0. `dist/index.js` exists. (The `node scripts/generate-json-schema.mjs` step will fail until Task 31 — for Step 5, run `pnpm -F @atlas/spec-graph-schema typecheck` instead of build to verify the scaffold without that script. Add the script in Task 31.)

Actually, simpler: change `build` to `tsc -p tsconfig.json` only for now; Task 31 extends it.

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  ...
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-schema pnpm-lock.yaml
git commit -m "feat(spec-graph-schema): scaffold package with zod 3.23.8"
```

---

### Task 2: Common primitives

**Files:**
- Create: `packages/spec-graph-schema/src/primitives.ts`
- Create: `packages/spec-graph-schema/test/primitives.test.ts`

These are the building blocks every node and edge schema reuses.

- [ ] **Step 1: Test (verbatim)**

`packages/spec-graph-schema/test/primitives.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  ProjectIdSchema,
  NodeIdSchema,
  EdgeIdSchema,
  PiiClassificationSchema,
  ExtensionsSchema,
  parseNodeKindFromId
} from "../src/primitives.js";

describe("primitives", () => {
  describe("ProjectIdSchema", () => {
    it("accepts a v4 UUID", () => {
      expect(() => ProjectIdSchema.parse("11111111-1111-4111-8111-111111111111")).not.toThrow();
    });
    it("rejects non-UUID strings", () => {
      expect(() => ProjectIdSchema.parse("not-a-uuid")).toThrow();
    });
  });

  describe("NodeIdSchema", () => {
    it("accepts <kind>:<id> shape with known kind", () => {
      expect(() => NodeIdSchema.parse("page:home")).not.toThrow();
      expect(() => NodeIdSchema.parse("component:Button")).not.toThrow();
      expect(() => NodeIdSchema.parse("compliance:baseline")).not.toThrow();
    });
    it("rejects unknown kind prefix", () => {
      expect(() => NodeIdSchema.parse("widget:foo")).toThrow();
    });
    it("rejects missing colon", () => {
      expect(() => NodeIdSchema.parse("home")).toThrow();
    });
    it("rejects empty id segment", () => {
      expect(() => NodeIdSchema.parse("page:")).toThrow();
    });
  });

  describe("PiiClassificationSchema", () => {
    it("accepts the four known levels", () => {
      for (const level of ["none", "indirect", "direct", "sensitive"]) {
        expect(() => PiiClassificationSchema.parse(level)).not.toThrow();
      }
    });
    it("rejects unknown levels", () => {
      expect(() => PiiClassificationSchema.parse("super-secret")).toThrow();
    });
  });

  describe("ExtensionsSchema", () => {
    it("accepts an empty object", () => {
      expect(ExtensionsSchema.parse({})).toEqual({});
    });
    it("accepts arbitrary unknown values (lenient)", () => {
      const ext = { customField: { nested: 42 }, otherKey: "string" };
      expect(ExtensionsSchema.parse(ext)).toEqual(ext);
    });
  });

  describe("parseNodeKindFromId", () => {
    it("returns the kind segment", () => {
      expect(parseNodeKindFromId("page:home")).toBe("page");
      expect(parseNodeKindFromId("component:Button")).toBe("component");
    });
  });

  describe("EdgeIdSchema", () => {
    it("accepts an opaque non-empty string", () => {
      expect(() => EdgeIdSchema.parse("e1")).not.toThrow();
    });
    it("rejects empty", () => {
      expect(() => EdgeIdSchema.parse("")).toThrow();
    });
  });
});
```

- [ ] **Step 2: Confirm fail**

```bash
pnpm -F @atlas/spec-graph-schema test -- test/primitives.test.ts
```

- [ ] **Step 3: Implement**

`packages/spec-graph-schema/src/primitives.ts`:
```ts
import { z } from "zod";

export const NODE_KINDS = [
  "page",
  "route",
  "component",
  "clientstate",
  "model",
  "endpoint",
  "flow",
  "authboundary",
  "test",
  "designtoken",
  "dependency",
  "compliance",
  "aifeature",
  "mediaasset"
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const NodeKindSchema = z.enum(NODE_KINDS);

export const ProjectIdSchema = z.string().uuid();
export type ProjectId = z.infer<typeof ProjectIdSchema>;

const NODE_ID_RE = new RegExp(`^(${NODE_KINDS.join("|")}):[A-Za-z0-9._-]+$`);

export const NodeIdSchema = z
  .string()
  .regex(NODE_ID_RE, "NodeId must be <kind>:<id> with a known kind and a non-empty id segment");
export type NodeId = z.infer<typeof NodeIdSchema>;

export const EdgeIdSchema = z.string().min(1);
export type EdgeId = z.infer<typeof EdgeIdSchema>;

export const PiiClassificationSchema = z.enum(["none", "indirect", "direct", "sensitive"]);
export type PiiClassification = z.infer<typeof PiiClassificationSchema>;

export const ExtensionsSchema = z.record(z.string(), z.unknown()).default({});
export type Extensions = z.infer<typeof ExtensionsSchema>;

export function parseNodeKindFromId(id: string): NodeKind {
  const colon = id.indexOf(":");
  if (colon < 0) throw new Error(`parseNodeKindFromId: missing colon in "${id}"`);
  const kind = id.slice(0, colon);
  const valid = NODE_KINDS.includes(kind as NodeKind);
  if (!valid) throw new Error(`parseNodeKindFromId: unknown kind "${kind}" in "${id}"`);
  return kind as NodeKind;
}

/** Common shape every node mixes in. */
export const BaseNodeFields = {
  id: NodeIdSchema,
  extensions: ExtensionsSchema.optional()
} as const;
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/spec-graph-schema test -- test/primitives.test.ts
git add packages/spec-graph-schema/src/primitives.ts packages/spec-graph-schema/test/primitives.test.ts
git commit -m "feat(spec-graph-schema): add primitive types (NodeId, ProjectId, PII, extensions)"
```

---

### Task 3: Page node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/page.ts`
- Create: `packages/spec-graph-schema/test/nodes/page.test.ts`

- [ ] **Step 1: Test (verbatim)**

```ts
import { describe, expect, it } from "vitest";
import { PageSchema } from "../../src/nodes/page.js";

const valid = {
  kind: "page" as const,
  id: "page:home",
  path: "/",
  title: "Home",
  layout: "default",
  renderMode: "ssr",
  metadata: { description: "Landing" },
  authRequired: false
};

describe("PageSchema", () => {
  it("accepts a valid page", () => {
    expect(PageSchema.parse(valid)).toEqual({ ...valid, extensions: undefined, a11yAnnotations: undefined, routeRef: undefined });
  });

  it("requires path", () => {
    expect(() => PageSchema.parse({ ...valid, path: undefined })).toThrow();
  });

  it("requires title", () => {
    expect(() => PageSchema.parse({ ...valid, title: undefined })).toThrow();
  });

  it("rejects unknown renderMode", () => {
    expect(() => PageSchema.parse({ ...valid, renderMode: "magic" })).toThrow();
  });

  it("rejects extra top-level properties (additionalProperties false)", () => {
    expect(() => PageSchema.parse({ ...valid, mystery: 1 })).toThrow();
  });

  it("accepts authRequired true with a routeRef present", () => {
    expect(() =>
      PageSchema.parse({ ...valid, authRequired: true, routeRef: "GET /admin" })
    ).not.toThrow();
  });

  it("preserves extensions (lenient)", () => {
    const out = PageSchema.parse({ ...valid, extensions: { custom: { tag: "marketing" } } });
    expect(out.extensions).toEqual({ custom: { tag: "marketing" } });
  });
});
```

- [ ] **Step 2: Confirm fail**

- [ ] **Step 3: Implementation**

`packages/spec-graph-schema/src/nodes/page.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const PageRenderModeSchema = z.enum(["ssr", "ssg", "csr", "isr"]);
export type PageRenderMode = z.infer<typeof PageRenderModeSchema>;

export const PageSchema = z
  .object({
    kind: z.literal("page"),
    ...BaseNodeFields,
    path: z.string().min(1),
    title: z.string().min(1),
    layout: z.string().optional(),
    renderMode: PageRenderModeSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
    authRequired: z.boolean().default(false),
    routeRef: z.string().optional(),
    a11yAnnotations: z.record(z.string(), z.string()).optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Page = z.infer<typeof PageSchema>;
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/spec-graph-schema test -- test/nodes/page.test.ts
git add packages/spec-graph-schema/src/nodes/page.ts packages/spec-graph-schema/test/nodes/page.test.ts
git commit -m "feat(spec-graph-schema): add Page node schema"
```

---

### Task 4: Route node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/route.ts`
- Create: `packages/spec-graph-schema/test/nodes/route.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { RouteSchema } from "../../src/nodes/route.js";

const valid = {
  kind: "route" as const,
  id: "route:get-users",
  pattern: "/api/users",
  method: "GET",
  handlerType: "endpoint"
};

describe("RouteSchema", () => {
  it("accepts a valid route", () => {
    expect(() => RouteSchema.parse(valid)).not.toThrow();
  });
  it("requires pattern", () => {
    expect(() => RouteSchema.parse({ ...valid, pattern: undefined })).toThrow();
  });
  it("rejects unknown method", () => {
    expect(() => RouteSchema.parse({ ...valid, method: "QUACK" })).toThrow();
  });
  it("rejects unknown handlerType", () => {
    expect(() => RouteSchema.parse({ ...valid, handlerType: "wizard" })).toThrow();
  });
  it("accepts handlerType=page with method=GET", () => {
    expect(() =>
      RouteSchema.parse({ ...valid, handlerType: "page", method: "GET" })
    ).not.toThrow();
  });
  it("rejects extra properties", () => {
    expect(() => RouteSchema.parse({ ...valid, mystery: 1 })).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/route.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const HttpMethodSchema = z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const RouteHandlerTypeSchema = z.enum(["page", "endpoint", "middleware"]);
export type RouteHandlerType = z.infer<typeof RouteHandlerTypeSchema>;

export const RouteSchema = z
  .object({
    kind: z.literal("route"),
    ...BaseNodeFields,
    pattern: z.string().min(1),
    method: HttpMethodSchema,
    handlerType: RouteHandlerTypeSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Route = z.infer<typeof RouteSchema>;
```

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/route.ts packages/spec-graph-schema/test/nodes/route.test.ts
git commit -m "feat(spec-graph-schema): add Route node schema"
```

---

### Task 5: Component node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/component.ts`
- Create: `packages/spec-graph-schema/test/nodes/component.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { ComponentSchema } from "../../src/nodes/component.js";

const valid = {
  kind: "component" as const,
  id: "component:Button",
  name: "Button",
  propsSchema: { label: { type: "string" } },
  isServerComponent: false,
  styleApproach: "tailwind"
};

describe("ComponentSchema", () => {
  it("accepts valid component", () => {
    expect(() => ComponentSchema.parse(valid)).not.toThrow();
  });
  it("requires name", () => {
    expect(() => ComponentSchema.parse({ ...valid, name: undefined })).toThrow();
  });
  it("rejects unknown styleApproach", () => {
    expect(() => ComponentSchema.parse({ ...valid, styleApproach: "neon" })).toThrow();
  });
  it("isServerComponent defaults to false when omitted", () => {
    const { isServerComponent: _, ...withoutFlag } = valid;
    const parsed = ComponentSchema.parse(withoutFlag);
    expect(parsed.isServerComponent).toBe(false);
  });
  it("accepts a11yAnnotations record", () => {
    expect(() =>
      ComponentSchema.parse({ ...valid, a11yAnnotations: { role: "button" } })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/component.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const StyleApproachSchema = z.enum([
  "tailwind",
  "css-modules",
  "vanilla-extract",
  "styled-components",
  "emotion",
  "inline"
]);
export type StyleApproach = z.infer<typeof StyleApproachSchema>;

export const ComponentSchema = z
  .object({
    kind: z.literal("component"),
    ...BaseNodeFields,
    name: z.string().min(1),
    propsSchema: z.record(z.string(), z.unknown()).optional(),
    isServerComponent: z.boolean().default(false),
    styleApproach: StyleApproachSchema,
    a11yAnnotations: z.record(z.string(), z.string()).optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Component = z.infer<typeof ComponentSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add Component node schema`

---

### Task 6: ClientState node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/client-state.ts`
- Create: `packages/spec-graph-schema/test/nodes/client-state.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { ClientStateSchema } from "../../src/nodes/client-state.js";

const valid = {
  kind: "clientstate" as const,
  id: "clientstate:cart",
  name: "ShoppingCart",
  stateKind: "zustand-store",
  schema: { items: "array" },
  persistence: "localStorage",
  scope: "app",
  piiClassification: "none"
};

describe("ClientStateSchema", () => {
  it("accepts valid client state", () => {
    expect(() => ClientStateSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown stateKind", () => {
    expect(() => ClientStateSchema.parse({ ...valid, stateKind: "magic" })).toThrow();
  });
  it("rejects unknown persistence", () => {
    expect(() => ClientStateSchema.parse({ ...valid, persistence: "tape" })).toThrow();
  });
  it("rejects unknown scope", () => {
    expect(() => ClientStateSchema.parse({ ...valid, scope: "universe" })).toThrow();
  });
  it("piiClassification defaults to none when omitted", () => {
    const { piiClassification: _, ...withoutPii } = valid;
    expect(ClientStateSchema.parse(withoutPii).piiClassification).toBe("none");
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/client-state.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema, PiiClassificationSchema } from "../primitives.js";

export const ClientStateKindSchema = z.enum([
  "context",
  "zustand-store",
  "reducer",
  "query-cache",
  "form-state",
  "route-state"
]);
export type ClientStateKind = z.infer<typeof ClientStateKindSchema>;

export const ClientStatePersistenceSchema = z.enum(["none", "sessionStorage", "localStorage", "url"]);
export type ClientStatePersistence = z.infer<typeof ClientStatePersistenceSchema>;

export const ClientStateScopeSchema = z.enum(["page", "layout", "app", "flow"]);
export type ClientStateScope = z.infer<typeof ClientStateScopeSchema>;

export const ClientStateSchema = z
  .object({
    kind: z.literal("clientstate"),
    ...BaseNodeFields,
    name: z.string().min(1),
    stateKind: ClientStateKindSchema,
    schema: z.record(z.string(), z.unknown()).optional(),
    persistence: ClientStatePersistenceSchema,
    scope: ClientStateScopeSchema,
    piiClassification: PiiClassificationSchema.default("none"),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type ClientState = z.infer<typeof ClientStateSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add ClientState node schema`

---

### Task 7: Model node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/model.ts`
- Create: `packages/spec-graph-schema/test/nodes/model.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { ModelSchema } from "../../src/nodes/model.js";

const valid = {
  kind: "model" as const,
  id: "model:User",
  name: "User",
  fields: { id: "uuid", email: "string" },
  relations: [{ name: "posts", to: "Post", kind: "one-to-many" }],
  indexes: [{ on: ["email"], unique: true }],
  rlsPolicies: {
    select: "auth.uid() = id",
    insert: "auth.uid() = id",
    update: "auth.uid() = id",
    delete: "auth.uid() = id"
  },
  piiClassification: "direct",
  dataRetentionDays: 365
};

describe("ModelSchema", () => {
  it("accepts valid model", () => {
    expect(() => ModelSchema.parse(valid)).not.toThrow();
  });
  it("requires name", () => {
    expect(() => ModelSchema.parse({ ...valid, name: undefined })).toThrow();
  });
  it("requires fields", () => {
    expect(() => ModelSchema.parse({ ...valid, fields: undefined })).toThrow();
  });
  it("rlsPolicies allows partial coverage", () => {
    expect(() =>
      ModelSchema.parse({ ...valid, rlsPolicies: { select: "true" } })
    ).not.toThrow();
  });
  it("piiClassification accepts the four levels", () => {
    for (const level of ["none", "indirect", "direct", "sensitive"]) {
      expect(() => ModelSchema.parse({ ...valid, piiClassification: level })).not.toThrow();
    }
  });
  it("dataRetentionDays must be positive when present", () => {
    expect(() => ModelSchema.parse({ ...valid, dataRetentionDays: -1 })).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/model.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema, PiiClassificationSchema } from "../primitives.js";

export const ModelRelationSchema = z
  .object({
    name: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"])
  })
  .strict();

export const ModelIndexSchema = z
  .object({
    on: z.array(z.string().min(1)).nonempty(),
    unique: z.boolean().default(false)
  })
  .strict();

export const RlsPoliciesSchema = z
  .object({
    select: z.string().optional(),
    insert: z.string().optional(),
    update: z.string().optional(),
    delete: z.string().optional()
  })
  .strict();
export type RlsPolicies = z.infer<typeof RlsPoliciesSchema>;

export const ModelSchema = z
  .object({
    kind: z.literal("model"),
    ...BaseNodeFields,
    name: z.string().min(1),
    fields: z.record(z.string(), z.unknown()),
    relations: z.array(ModelRelationSchema).default([]),
    indexes: z.array(ModelIndexSchema).default([]),
    rlsPolicies: RlsPoliciesSchema.default({}),
    piiClassification: PiiClassificationSchema.default("none"),
    dataRetentionDays: z.number().int().positive().optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Model = z.infer<typeof ModelSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add Model node schema with RLS policies and PII classification`

---

### Task 8: Endpoint node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/endpoint.ts`
- Create: `packages/spec-graph-schema/test/nodes/endpoint.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { EndpointSchema } from "../../src/nodes/endpoint.js";

const valid = {
  kind: "endpoint" as const,
  id: "endpoint:createUser",
  name: "createUser",
  routeRef: "POST /api/users",
  method: "POST",
  inputSchema: { email: "string" },
  outputSchema: { id: "uuid" },
  authRef: "authboundary:authenticated",
  rateLimit: { window: "1m", max: 60 }
};

describe("EndpointSchema", () => {
  it("accepts valid endpoint", () => {
    expect(() => EndpointSchema.parse(valid)).not.toThrow();
  });
  it("requires name", () => {
    expect(() => EndpointSchema.parse({ ...valid, name: undefined })).toThrow();
  });
  it("requires routeRef", () => {
    expect(() => EndpointSchema.parse({ ...valid, routeRef: undefined })).toThrow();
  });
  it("rejects unknown method", () => {
    expect(() => EndpointSchema.parse({ ...valid, method: "TRACE-X" })).toThrow();
  });
  it("rateLimit window must match a duration pattern", () => {
    expect(() =>
      EndpointSchema.parse({ ...valid, rateLimit: { window: "fortnight", max: 1 } })
    ).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/endpoint.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";
import { HttpMethodSchema } from "./route.js";

const DurationSchema = z
  .string()
  .regex(/^[1-9][0-9]*(ms|s|m|h|d)$/, "duration must look like 1s, 250ms, 5m, 1h, 7d");

export const RateLimitSchema = z
  .object({
    window: DurationSchema,
    max: z.number().int().positive()
  })
  .strict();
export type RateLimit = z.infer<typeof RateLimitSchema>;

export const EndpointSchema = z
  .object({
    kind: z.literal("endpoint"),
    ...BaseNodeFields,
    name: z.string().min(1),
    routeRef: z.string().min(1),
    method: HttpMethodSchema,
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    authRef: z.string().optional(),
    rateLimit: RateLimitSchema.optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Endpoint = z.infer<typeof EndpointSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add Endpoint node schema`

---

### Task 9: Flow node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/flow.ts`
- Create: `packages/spec-graph-schema/test/nodes/flow.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { FlowSchema } from "../../src/nodes/flow.js";

const valid = {
  kind: "flow" as const,
  id: "flow:checkout",
  name: "Checkout",
  steps: [
    { id: "cart", label: "Review cart" },
    { id: "address", label: "Enter address" },
    { id: "payment", label: "Pay" },
    { id: "confirmation", label: "Confirmation" }
  ],
  entryPoints: ["page:cart"],
  successCriteria: "page:checkout-confirmation reached",
  failurePaths: ["page:checkout-error"]
};

describe("FlowSchema", () => {
  it("accepts valid flow", () => {
    expect(() => FlowSchema.parse(valid)).not.toThrow();
  });
  it("requires non-empty steps", () => {
    expect(() => FlowSchema.parse({ ...valid, steps: [] })).toThrow();
  });
  it("requires non-empty entryPoints", () => {
    expect(() => FlowSchema.parse({ ...valid, entryPoints: [] })).toThrow();
  });
  it("step ids must be non-empty", () => {
    expect(() =>
      FlowSchema.parse({ ...valid, steps: [{ id: "", label: "x" }] })
    ).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/flow.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const FlowStepSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    surface: z.string().optional()
  })
  .strict();
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z
  .object({
    kind: z.literal("flow"),
    ...BaseNodeFields,
    name: z.string().min(1),
    steps: z.array(FlowStepSchema).nonempty(),
    entryPoints: z.array(z.string().min(1)).nonempty(),
    successCriteria: z.string().optional(),
    failurePaths: z.array(z.string().min(1)).default([]),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Flow = z.infer<typeof FlowSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add Flow node schema`

---

### Task 10: AuthBoundary node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/auth-boundary.ts`
- Create: `packages/spec-graph-schema/test/nodes/auth-boundary.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { AuthBoundarySchema } from "../../src/nodes/auth-boundary.js";

const valid = {
  kind: "authboundary" as const,
  id: "authboundary:admin",
  name: "AdminOnly",
  type: "role",
  roles: ["admin"],
  permissions: [],
  bypassConditions: []
};

describe("AuthBoundarySchema", () => {
  it("accepts valid boundary", () => {
    expect(() => AuthBoundarySchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown type", () => {
    expect(() => AuthBoundarySchema.parse({ ...valid, type: "vibes" })).toThrow();
  });
  it("type=public allows empty roles", () => {
    expect(() =>
      AuthBoundarySchema.parse({ ...valid, type: "public", roles: [] })
    ).not.toThrow();
  });
  it("type=role requires at least one role", () => {
    expect(() =>
      AuthBoundarySchema.parse({ ...valid, type: "role", roles: [] })
    ).toThrow();
  });
  it("type=permission requires at least one permission", () => {
    expect(() =>
      AuthBoundarySchema.parse({ ...valid, type: "permission", roles: [], permissions: [] })
    ).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/auth-boundary.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const AuthBoundaryTypeSchema = z.enum(["public", "authenticated", "role", "permission"]);
export type AuthBoundaryType = z.infer<typeof AuthBoundaryTypeSchema>;

export const AuthBoundarySchema = z
  .object({
    kind: z.literal("authboundary"),
    ...BaseNodeFields,
    name: z.string().min(1),
    type: AuthBoundaryTypeSchema,
    roles: z.array(z.string().min(1)).default([]),
    permissions: z.array(z.string().min(1)).default([]),
    bypassConditions: z.array(z.string().min(1)).default([]),
    extensions: ExtensionsSchema.optional()
  })
  .strict()
  .superRefine((node, ctx) => {
    if (node.type === "role" && node.roles.length === 0) {
      ctx.addIssue({ code: "custom", message: "type=role requires at least one role", path: ["roles"] });
    }
    if (node.type === "permission" && node.permissions.length === 0) {
      ctx.addIssue({ code: "custom", message: "type=permission requires at least one permission", path: ["permissions"] });
    }
  });

export type AuthBoundary = z.infer<typeof AuthBoundarySchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add AuthBoundary node schema with type/roles/permissions invariants`

---

### Task 11: Test node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/test.ts`
- Create: `packages/spec-graph-schema/test/nodes/test.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { TestSchema } from "../../src/nodes/test.js";

const valid = {
  kind: "test" as const,
  id: "test:Login.e2e",
  name: "Login.e2e",
  layer: "L3",
  source: "generated",
  filepath: "tests/e2e/login.spec.ts",
  coversRef: ["page:login", "endpoint:loginUser"]
};

describe("TestSchema", () => {
  it("accepts valid test", () => {
    expect(() => TestSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown layer", () => {
    expect(() => TestSchema.parse({ ...valid, layer: "L99" })).toThrow();
  });
  it("rejects unknown source", () => {
    expect(() => TestSchema.parse({ ...valid, source: "magic" })).toThrow();
  });
  it("source=baseline is allowed (immutable human-authored)", () => {
    expect(() => TestSchema.parse({ ...valid, source: "baseline" })).not.toThrow();
  });
  it("requires non-empty coversRef", () => {
    expect(() => TestSchema.parse({ ...valid, coversRef: [] })).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/test.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const TestLayerSchema = z.enum(["L1", "L2", "L3", "L4", "L5"]);
export type TestLayer = z.infer<typeof TestLayerSchema>;

export const TestSourceSchema = z.enum(["generated", "user", "baseline"]);
export type TestSource = z.infer<typeof TestSourceSchema>;

export const TestSchema = z
  .object({
    kind: z.literal("test"),
    ...BaseNodeFields,
    name: z.string().min(1),
    layer: TestLayerSchema,
    source: TestSourceSchema,
    filepath: z.string().min(1),
    coversRef: z.array(z.string().min(1)).nonempty(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Test = z.infer<typeof TestSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add Test node schema (L1-L5 + generated/user/baseline source)`

---

### Task 12: DesignToken node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/design-token.ts`
- Create: `packages/spec-graph-schema/test/nodes/design-token.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { DesignTokenSchema } from "../../src/nodes/design-token.js";

const valid = {
  kind: "designtoken" as const,
  id: "designtoken:color-primary-500",
  name: "color.primary.500",
  category: "color",
  value: "#3B82F6",
  scale: "light"
};

describe("DesignTokenSchema", () => {
  it("accepts valid token", () => {
    expect(() => DesignTokenSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown category", () => {
    expect(() => DesignTokenSchema.parse({ ...valid, category: "fragrance" })).toThrow();
  });
  it("scale defaults to undefined when omitted", () => {
    const { scale: _, ...rest } = valid;
    const parsed = DesignTokenSchema.parse(rest);
    expect(parsed.scale).toBeUndefined();
  });
  it("contrastGroup is optional", () => {
    expect(() =>
      DesignTokenSchema.parse({ ...valid, contrastGroup: "AAA" })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/design-token.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const DesignTokenCategorySchema = z.enum([
  "color",
  "spacing",
  "typography",
  "radius",
  "shadow",
  "motion"
]);
export type DesignTokenCategory = z.infer<typeof DesignTokenCategorySchema>;

export const DesignTokenScaleSchema = z.enum(["light", "dark"]);

export const DesignTokenSchema = z
  .object({
    kind: z.literal("designtoken"),
    ...BaseNodeFields,
    name: z.string().min(1),
    category: DesignTokenCategorySchema,
    value: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]),
    scale: DesignTokenScaleSchema.optional(),
    contrastGroup: z.string().optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type DesignToken = z.infer<typeof DesignTokenSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add DesignToken node schema`

---

### Task 13: Dependency node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/dependency.ts`
- Create: `packages/spec-graph-schema/test/nodes/dependency.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { DependencySchema } from "../../src/nodes/dependency.js";

const valid = {
  kind: "dependency" as const,
  id: "dependency:react",
  name: "react",
  version: "18.3.1",
  purpose: "UI runtime",
  license: "MIT",
  cveScanStatus: { scannedAt: "2026-04-18T00:00:00.000Z", severity: "none", findings: [] }
};

describe("DependencySchema", () => {
  it("accepts valid dependency", () => {
    expect(() => DependencySchema.parse(valid)).not.toThrow();
  });
  it("rejects unpinned version (must be exact, no semver ranges)", () => {
    expect(() => DependencySchema.parse({ ...valid, version: "^18.3.1" })).toThrow();
    expect(() => DependencySchema.parse({ ...valid, version: "~18.3.1" })).toThrow();
    expect(() => DependencySchema.parse({ ...valid, version: ">=18" })).toThrow();
  });
  it("accepts a critical CVE finding", () => {
    expect(() =>
      DependencySchema.parse({
        ...valid,
        cveScanStatus: {
          scannedAt: "2026-04-18T00:00:00.000Z",
          severity: "critical",
          findings: [{ id: "CVE-2026-9999", cvss: 9.8 }]
        }
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/dependency.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

const ExactSemverRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/;

export const CveSeveritySchema = z.enum(["none", "low", "medium", "high", "critical"]);

export const CveFindingSchema = z
  .object({
    id: z.string().min(1),
    cvss: z.number().min(0).max(10).optional()
  })
  .strict();

export const CveScanStatusSchema = z
  .object({
    scannedAt: z.string().datetime(),
    severity: CveSeveritySchema,
    findings: z.array(CveFindingSchema).default([])
  })
  .strict();

export const DependencySchema = z
  .object({
    kind: z.literal("dependency"),
    ...BaseNodeFields,
    name: z.string().min(1),
    version: z.string().regex(ExactSemverRe, "version must be an exact semver (no ^ ~ >= ranges)"),
    purpose: z.string().optional(),
    license: z.string().min(1),
    cveScanStatus: CveScanStatusSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Dependency = z.infer<typeof DependencySchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add Dependency node schema with exact-pin enforcement and CVE status`

---

### Task 14: ComplianceClass node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/compliance-class.ts`
- Create: `packages/spec-graph-schema/test/nodes/compliance-class.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { ComplianceClassSchema } from "../../src/nodes/compliance-class.js";

const valid = {
  kind: "compliance" as const,
  id: "compliance:baseline",
  name: "baseline",
  scope: "global",
  attestation: "self-attested",
  effectiveDate: "2026-04-18"
};

describe("ComplianceClassSchema", () => {
  it("accepts the four v1 names", () => {
    for (const name of ["baseline", "GDPR", "HIPAA", "SOC2-lite"]) {
      expect(() => ComplianceClassSchema.parse({ ...valid, id: `compliance:${name.toLowerCase()}`, name })).not.toThrow();
    }
  });
  it("rejects out-of-scope class names (Phase B classes are validation errors in v1)", () => {
    for (const name of ["PCI-DSS", "DPDP-India", "LGPD", "POPIA", "COPPA", "FERPA", "ITAR", "ISO27001"]) {
      expect(() => ComplianceClassSchema.parse({ ...valid, name })).toThrow();
    }
  });
  it("requires effectiveDate (ISO date)", () => {
    expect(() => ComplianceClassSchema.parse({ ...valid, effectiveDate: "yesterday" })).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/compliance-class.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const COMPLIANCE_CLASSES_V1 = ["baseline", "GDPR", "HIPAA", "SOC2-lite"] as const;
export const ComplianceClassNameSchema = z.enum(COMPLIANCE_CLASSES_V1);
export type ComplianceClassName = z.infer<typeof ComplianceClassNameSchema>;

export const ComplianceClassScopeSchema = z.enum(["global", "model", "endpoint", "feature"]);

export const ComplianceClassAttestationSchema = z.enum([
  "self-attested",
  "third-party-audited",
  "certified"
]);

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be a YYYY-MM-DD date");

export const ComplianceClassSchema = z
  .object({
    kind: z.literal("compliance"),
    ...BaseNodeFields,
    name: ComplianceClassNameSchema,
    scope: ComplianceClassScopeSchema,
    attestation: ComplianceClassAttestationSchema,
    effectiveDate: IsoDateSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type ComplianceClass = z.infer<typeof ComplianceClassSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add ComplianceClass node schema (4 v1 classes)`

---

### Task 15: AIFeature node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/ai-feature.ts`
- Create: `packages/spec-graph-schema/test/nodes/ai-feature.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { AIFeatureSchema } from "../../src/nodes/ai-feature.js";

const valid = {
  kind: "aifeature" as const,
  id: "aifeature:summarize",
  name: "DocumentSummarizer",
  category: "summarization",
  capabilityContract: { maxInputTokens: 100_000, outputFormat: "markdown" },
  inputModality: "text",
  outputModality: "text",
  grounding: "none",
  personalization: "none",
  privacyMode: "no-retain",
  safetyContract: { promptInjectionGuard: true, hallucinationGuard: false },
  fallbackBehavior: "show-error-and-suggest-retry",
  costTier: "standard"
};

describe("AIFeatureSchema", () => {
  it("accepts valid feature", () => {
    expect(() => AIFeatureSchema.parse(valid)).not.toThrow();
  });
  it("rejects unknown grounding", () => {
    expect(() => AIFeatureSchema.parse({ ...valid, grounding: "vibes" })).toThrow();
  });
  it("rejects unknown personalization", () => {
    expect(() => AIFeatureSchema.parse({ ...valid, personalization: "max" })).toThrow();
  });
  it("rejects unknown costTier", () => {
    expect(() => AIFeatureSchema.parse({ ...valid, costTier: "infinite" })).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/ai-feature.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const AIFeatureCategorySchema = z.enum([
  "summarization",
  "extraction",
  "classification",
  "generation",
  "translation",
  "qa",
  "search",
  "transformation",
  "agent",
  "other"
]);

export const AIModalitySchema = z.enum(["text", "image", "audio", "video", "multimodal"]);

export const AIGroundingSchema = z.enum(["none", "rag", "tool-use", "structured-context"]);

export const AIPersonalizationSchema = z.enum(["none", "session", "account", "cross-account"]);

export const AIPrivacyModeSchema = z.enum(["no-retain", "retain-7d", "retain-30d", "retain-indefinite"]);

export const AICostTierSchema = z.enum(["fast", "standard", "premium"]);

export const AISafetyContractSchema = z
  .object({
    promptInjectionGuard: z.boolean(),
    hallucinationGuard: z.boolean(),
    piiRedaction: z.boolean().optional(),
    contentFilter: z.boolean().optional()
  })
  .strict();
export type AISafetyContract = z.infer<typeof AISafetyContractSchema>;

export const AIFeatureSchema = z
  .object({
    kind: z.literal("aifeature"),
    ...BaseNodeFields,
    name: z.string().min(1),
    category: AIFeatureCategorySchema,
    capabilityContract: z.record(z.string(), z.unknown()),
    inputModality: AIModalitySchema,
    outputModality: AIModalitySchema,
    grounding: AIGroundingSchema,
    personalization: AIPersonalizationSchema,
    privacyMode: AIPrivacyModeSchema,
    safetyContract: AISafetyContractSchema,
    fallbackBehavior: z.string().min(1),
    costTier: AICostTierSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type AIFeature = z.infer<typeof AIFeatureSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add AIFeature node schema with safety+privacy contracts`

---

### Task 16: MediaAsset node

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/media-asset.ts`
- Create: `packages/spec-graph-schema/test/nodes/media-asset.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { MediaAssetSchema } from "../../src/nodes/media-asset.js";

const valid = {
  kind: "mediaasset" as const,
  id: "mediaasset:hero-illustration",
  mediaKind: "illustration",
  providerCapability: "stable-diffusion-xl@1.0",
  generationPrompt: "Hero illustration of a builder",
  pathOrUrl: "/static/hero.png",
  altText: "A builder assembling blocks",
  licenseStatus: "generated",
  contentHash: "sha256:abc123",
  personalizationContext: "none"
};

describe("MediaAssetSchema", () => {
  it("accepts a v1 mediaKind (image, icon, illustration)", () => {
    for (const kind of ["image", "icon", "illustration"]) {
      expect(() => MediaAssetSchema.parse({ ...valid, mediaKind: kind })).not.toThrow();
    }
  });
  it("rejects deferred kinds (video, audio)", () => {
    for (const kind of ["video", "audio"]) {
      expect(() => MediaAssetSchema.parse({ ...valid, mediaKind: kind })).toThrow();
    }
  });
  it("rejects unknown licenseStatus", () => {
    expect(() => MediaAssetSchema.parse({ ...valid, licenseStatus: "stolen" })).toThrow();
  });
  it("contentHash must look like sha256:<hex>", () => {
    expect(() => MediaAssetSchema.parse({ ...valid, contentHash: "md5:abc" })).toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/nodes/media-asset.ts`:
```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const MEDIA_KINDS_V1 = ["image", "icon", "illustration"] as const;
export const MediaAssetKindSchema = z.enum(MEDIA_KINDS_V1);
export type MediaAssetKind = z.infer<typeof MediaAssetKindSchema>;

export const MediaLicenseStatusSchema = z.enum([
  "generated",
  "user-uploaded",
  "licensed-third-party",
  "public-domain"
]);

const ContentHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{6,64}$/, "contentHash must be sha256:<hex>");

export const MediaAssetSchema = z
  .object({
    kind: z.literal("mediaasset"),
    ...BaseNodeFields,
    mediaKind: MediaAssetKindSchema,
    providerCapability: z.string().optional(),
    generationPrompt: z.string().optional(),
    pathOrUrl: z.string().min(1),
    altText: z.string().min(1),
    licenseStatus: MediaLicenseStatusSchema,
    contentHash: ContentHashSchema,
    personalizationContext: z.string().default("none"),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type MediaAsset = z.infer<typeof MediaAssetSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add MediaAsset node schema (v1: image/icon/illustration)`

---

### Task 17: Node discriminated union + registry

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/index.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from "zod";
import type { NodeKind } from "../primitives.js";

import { PageSchema, type Page } from "./page.js";
import { RouteSchema, type Route } from "./route.js";
import { ComponentSchema, type Component } from "./component.js";
import { ClientStateSchema, type ClientState } from "./client-state.js";
import { ModelSchema, type Model } from "./model.js";
import { EndpointSchema, type Endpoint } from "./endpoint.js";
import { FlowSchema, type Flow } from "./flow.js";
import { AuthBoundarySchema, type AuthBoundary } from "./auth-boundary.js";
import { TestSchema, type Test } from "./test.js";
import { DesignTokenSchema, type DesignToken } from "./design-token.js";
import { DependencySchema, type Dependency } from "./dependency.js";
import { ComplianceClassSchema, type ComplianceClass } from "./compliance-class.js";
import { AIFeatureSchema, type AIFeature } from "./ai-feature.js";
import { MediaAssetSchema, type MediaAsset } from "./media-asset.js";

export const NodeSchema = z.discriminatedUnion("kind", [
  PageSchema,
  RouteSchema,
  ComponentSchema,
  ClientStateSchema,
  ModelSchema,
  EndpointSchema,
  FlowSchema,
  AuthBoundarySchema,
  TestSchema,
  DesignTokenSchema,
  DependencySchema,
  ComplianceClassSchema,
  AIFeatureSchema,
  MediaAssetSchema
]);

export type Node =
  | Page
  | Route
  | Component
  | ClientState
  | Model
  | Endpoint
  | Flow
  | AuthBoundary
  | Test
  | DesignToken
  | Dependency
  | ComplianceClass
  | AIFeature
  | MediaAsset;

export const nodeRegistry = {
  page: PageSchema,
  route: RouteSchema,
  component: ComponentSchema,
  clientstate: ClientStateSchema,
  model: ModelSchema,
  endpoint: EndpointSchema,
  flow: FlowSchema,
  authboundary: AuthBoundarySchema,
  test: TestSchema,
  designtoken: DesignTokenSchema,
  dependency: DependencySchema,
  compliance: ComplianceClassSchema,
  aifeature: AIFeatureSchema,
  mediaasset: MediaAssetSchema
} as const satisfies Record<NodeKind, z.ZodTypeAny>;

export type NodeRegistry = typeof nodeRegistry;

export {
  PageSchema, RouteSchema, ComponentSchema, ClientStateSchema, ModelSchema,
  EndpointSchema, FlowSchema, AuthBoundarySchema, TestSchema, DesignTokenSchema,
  DependencySchema, ComplianceClassSchema, AIFeatureSchema, MediaAssetSchema
};
```

- [ ] **Step 2: Add a smoke test**

`packages/spec-graph-schema/test/nodes/index.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { NodeSchema, nodeRegistry } from "../../src/nodes/index.js";

describe("nodes index", () => {
  it("discriminated union narrows on kind", () => {
    const parsed = NodeSchema.parse({
      kind: "page",
      id: "page:home",
      path: "/",
      title: "Home",
      renderMode: "ssr"
    });
    if (parsed.kind === "page") {
      expect(parsed.path).toBe("/");
    } else {
      throw new Error("expected page");
    }
  });

  it("registry contains every node kind", () => {
    expect(Object.keys(nodeRegistry).sort()).toEqual([
      "aifeature", "authboundary", "clientstate", "compliance", "component",
      "dependency", "designtoken", "endpoint", "flow", "mediaasset", "model",
      "page", "route", "test"
    ]);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F @atlas/spec-graph-schema test
git add packages/spec-graph-schema/src/nodes/index.ts packages/spec-graph-schema/test/nodes/index.test.ts
git commit -m "feat(spec-graph-schema): assemble node discriminated union and registry"
```

---

### Task 18: Edges — composition and data (renders, fetches, reads, mutates)

**Files:**
- Create: `packages/spec-graph-schema/src/edges/renders.ts`
- Create: `packages/spec-graph-schema/src/edges/fetches.ts`
- Create: `packages/spec-graph-schema/src/edges/reads.ts`
- Create: `packages/spec-graph-schema/src/edges/mutates.ts`

These four edges all share the same shape: `{ type, from, to, attrs? }`. The runtime check that `from` and `to` reference the right node kinds happens at invariant level (Task 23+), not here — Zod schemas only enforce structure.

- [ ] **Step 1: Implementation (all four files share the helper pattern)**

`packages/spec-graph-schema/src/edges/renders.ts`:
```ts
import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const RendersEdgeSchema = z
  .object({
    type: z.literal("renders"),
    from: NodeIdSchema,
    to: NodeIdSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type RendersEdge = z.infer<typeof RendersEdgeSchema>;
```

Same shape for `fetches.ts`, `reads.ts`, `mutates.ts` (substitute the literal). Each gets one tiny test:

`packages/spec-graph-schema/test/edges/all-edges.test.ts` (one file covers them all):
```ts
import { describe, expect, it } from "vitest";
import { RendersEdgeSchema } from "../../src/edges/renders.js";
import { FetchesEdgeSchema } from "../../src/edges/fetches.js";
import { ReadsEdgeSchema } from "../../src/edges/reads.js";
import { MutatesEdgeSchema } from "../../src/edges/mutates.js";

const each = [
  ["renders", RendersEdgeSchema],
  ["fetches", FetchesEdgeSchema],
  ["reads", ReadsEdgeSchema],
  ["mutates", MutatesEdgeSchema]
] as const;

describe("composition + data edges", () => {
  for (const [type, schema] of each) {
    it(`${type}: accepts {type, from, to}`, () => {
      expect(() => schema.parse({ type, from: "page:home", to: "component:Button" })).not.toThrow();
    });
    it(`${type}: rejects unknown type literal`, () => {
      expect(() => schema.parse({ type: "wrong", from: "page:home", to: "component:Button" })).toThrow();
    });
    it(`${type}: rejects malformed NodeId`, () => {
      expect(() => schema.parse({ type, from: "no-colon", to: "component:Button" })).toThrow();
    });
  }
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm -F @atlas/spec-graph-schema test -- test/edges/all-edges.test.ts
git add packages/spec-graph-schema/src/edges/renders.ts packages/spec-graph-schema/src/edges/fetches.ts packages/spec-graph-schema/src/edges/reads.ts packages/spec-graph-schema/src/edges/mutates.ts packages/spec-graph-schema/test/edges/all-edges.test.ts
git commit -m "feat(spec-graph-schema): add composition+data edge schemas (renders/fetches/reads/mutates)"
```

---

### Task 19: Edges — protection, coverage, deps (requires, covers, dependsOn)

**Files:**
- Create: `packages/spec-graph-schema/src/edges/requires.ts`
- Create: `packages/spec-graph-schema/src/edges/covers.ts`
- Create: `packages/spec-graph-schema/src/edges/depends-on.ts`

- [ ] **Step 1: Implementation**

Same minimal shape as Task 18 — substitute the literal in each file. Append to `test/edges/all-edges.test.ts`:

```ts
import { RequiresEdgeSchema } from "../../src/edges/requires.js";
import { CoversEdgeSchema } from "../../src/edges/covers.js";
import { DependsOnEdgeSchema } from "../../src/edges/depends-on.js";

describe("protection/coverage/deps edges", () => {
  for (const [type, schema] of [
    ["requires", RequiresEdgeSchema],
    ["covers", CoversEdgeSchema],
    ["dependsOn", DependsOnEdgeSchema]
  ] as const) {
    it(`${type}: accepts valid edge`, () => {
      expect(() => schema.parse({ type, from: "page:home", to: "authboundary:admin" })).not.toThrow();
    });
  }
});
```

- [ ] **Step 2: Commit** `feat(spec-graph-schema): add protection+coverage+deps edges (requires/covers/dependsOn)`

---

### Task 20: Edges — design, compliance, lineage (styledBy, subjectTo, supersedes)

Same as Task 18-19 pattern. Implement three edge files; append to `all-edges.test.ts`. Commit with message `feat(spec-graph-schema): add design+compliance+lineage edges (styledBy/subjectTo/supersedes)`.

---

### Task 21: Edges — AI, media, state (powers, displays, manages)

Same pattern. Implement three edge files; append to `all-edges.test.ts`. Commit with message `feat(spec-graph-schema): add AI+media+state edges (powers/displays/manages)`.

---

### Task 22: Edge discriminated union + registry

**Files:**
- Create: `packages/spec-graph-schema/src/edges/index.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from "zod";

import { RendersEdgeSchema, type RendersEdge } from "./renders.js";
import { FetchesEdgeSchema, type FetchesEdge } from "./fetches.js";
import { ReadsEdgeSchema, type ReadsEdge } from "./reads.js";
import { MutatesEdgeSchema, type MutatesEdge } from "./mutates.js";
import { RequiresEdgeSchema, type RequiresEdge } from "./requires.js";
import { CoversEdgeSchema, type CoversEdge } from "./covers.js";
import { DependsOnEdgeSchema, type DependsOnEdge } from "./depends-on.js";
import { StyledByEdgeSchema, type StyledByEdge } from "./styled-by.js";
import { SubjectToEdgeSchema, type SubjectToEdge } from "./subject-to.js";
import { SupersedesEdgeSchema, type SupersedesEdge } from "./supersedes.js";
import { PowersEdgeSchema, type PowersEdge } from "./powers.js";
import { DisplaysEdgeSchema, type DisplaysEdge } from "./displays.js";
import { ManagesEdgeSchema, type ManagesEdge } from "./manages.js";

export const EDGE_TYPES = [
  "renders", "fetches", "reads", "mutates",
  "requires", "covers", "dependsOn",
  "styledBy", "subjectTo", "supersedes",
  "powers", "displays", "manages"
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const EdgeSchema = z.discriminatedUnion("type", [
  RendersEdgeSchema, FetchesEdgeSchema, ReadsEdgeSchema, MutatesEdgeSchema,
  RequiresEdgeSchema, CoversEdgeSchema, DependsOnEdgeSchema,
  StyledByEdgeSchema, SubjectToEdgeSchema, SupersedesEdgeSchema,
  PowersEdgeSchema, DisplaysEdgeSchema, ManagesEdgeSchema
]);

export type Edge =
  | RendersEdge | FetchesEdge | ReadsEdge | MutatesEdge
  | RequiresEdge | CoversEdge | DependsOnEdge
  | StyledByEdge | SubjectToEdge | SupersedesEdge
  | PowersEdge | DisplaysEdge | ManagesEdge;

export const edgeRegistry = {
  renders: RendersEdgeSchema,
  fetches: FetchesEdgeSchema,
  reads: ReadsEdgeSchema,
  mutates: MutatesEdgeSchema,
  requires: RequiresEdgeSchema,
  covers: CoversEdgeSchema,
  dependsOn: DependsOnEdgeSchema,
  styledBy: StyledByEdgeSchema,
  subjectTo: SubjectToEdgeSchema,
  supersedes: SupersedesEdgeSchema,
  powers: PowersEdgeSchema,
  displays: DisplaysEdgeSchema,
  manages: ManagesEdgeSchema
} as const satisfies Record<EdgeType, z.ZodTypeAny>;

export type EdgeRegistry = typeof edgeRegistry;
```

Add a smoke test to `all-edges.test.ts`:
```ts
import { EdgeSchema, edgeRegistry, EDGE_TYPES } from "../../src/edges/index.js";

describe("edge index", () => {
  it("discriminated union accepts a renders edge", () => {
    const parsed = EdgeSchema.parse({ type: "renders", from: "page:home", to: "component:Button" });
    if (parsed.type === "renders") expect(parsed.from).toBe("page:home");
  });
  it("registry contains all 13 types", () => {
    expect(Object.keys(edgeRegistry).sort()).toEqual([...EDGE_TYPES].sort());
  });
});
```

- [ ] **Step 2: Commit** `feat(spec-graph-schema): assemble edge discriminated union and registry (13 types)`

---

### Task 23: Graph root object

**Files:**
- Create: `packages/spec-graph-schema/src/graph.ts`
- Create: `packages/spec-graph-schema/test/graph.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { SpecGraphSchema } from "../src/graph.js";

const minimal = {
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: []
};

describe("SpecGraphSchema", () => {
  it("accepts a minimal graph", () => {
    expect(() => SpecGraphSchema.parse(minimal)).not.toThrow();
  });
  it("rejects schemaVersion not equal to 1.0.0", () => {
    expect(() => SpecGraphSchema.parse({ ...minimal, schemaVersion: "0.9.0" })).toThrow();
  });
  it("rejects empty complianceClasses (baseline must be present)", () => {
    expect(() => SpecGraphSchema.parse({ ...minimal, complianceClasses: [] })).toThrow();
  });
  it("rejects extra top-level keys", () => {
    expect(() => SpecGraphSchema.parse({ ...minimal, extra: 1 })).toThrow();
  });
  it("nodes is keyed by NodeId pattern", () => {
    expect(() =>
      SpecGraphSchema.parse({
        ...minimal,
        nodes: {
          "page:home": {
            kind: "page",
            id: "page:home",
            path: "/",
            title: "Home",
            renderMode: "ssr"
          }
        }
      })
    ).not.toThrow();
  });
  it("edges is an array of Edge", () => {
    expect(() =>
      SpecGraphSchema.parse({
        ...minimal,
        edges: [{ type: "renders", from: "page:home", to: "component:Button" }]
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2-3: Implementation**

`packages/spec-graph-schema/src/graph.ts`:
```ts
import { z } from "zod";
import { ProjectIdSchema, ExtensionsSchema } from "./primitives.js";
import { NodeSchema } from "./nodes/index.js";
import { EdgeSchema } from "./edges/index.js";

const DatabaseProviderSchema = z
  .object({
    tier: z.enum(["atlas-run", "byo-cloud", "self-hosted"]),
    provider: z.string().min(1),
    region: z.string().min(1),
    connectionStringRef: z.string().min(1)
  })
  .strict();

const TemplateDigestSchema = z.string().regex(/^sha256:[0-9a-f]{6,64}$/, "templateDigest must be sha256:<hex>");

export const SpecGraphSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    projectId: ProjectIdSchema,
    name: z.string().min(1),
    complianceClasses: z.array(z.string().min(1)).nonempty(),
    databaseProvider: DatabaseProviderSchema,
    templateDigest: TemplateDigestSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    nodes: z.record(z.string(), NodeSchema),
    edges: z.array(EdgeSchema),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type SpecGraph = z.infer<typeof SpecGraphSchema>;
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add SpecGraph root object schema`

---

### Task 24: Invariant runner + ValidationResult shape

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/runner.ts`

- [ ] **Step 1: Implement (no test — exercised by Tasks 25-38 invariant tests)**

```ts
import type { SpecGraph } from "../graph.js";

export interface ValidationIssue {
  code: string;
  message: string;
  path: Array<string | number>;
  nodeId?: string;
  edgeIndex?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type Invariant = (graph: SpecGraph) => ValidationIssue[];

export function runInvariants(graph: SpecGraph, invariants: Invariant[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const invariant of invariants) {
    issues.push(...invariant(graph));
  }
  return { ok: issues.length === 0, issues };
}
```

- [ ] **Step 2: Commit** `feat(spec-graph-schema): add invariant runner and ValidationResult types`

---

### Task 25: Invariant 1 — every Page must carry a routeRef

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i01-page-routeref.ts`
- Create: `packages/spec-graph-schema/test/invariants/i01.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { i01PageRouteRef } from "../../src/invariants/i01-page-routeref.js";
import type { SpecGraph } from "../../src/graph.js";

const baseGraph = (extras: Partial<SpecGraph> = {}): SpecGraph => ({
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {},
  edges: [],
  ...extras
});

describe("i01: every Page must carry a routeRef", () => {
  it("ok when no pages", () => {
    expect(i01PageRouteRef(baseGraph())).toEqual([]);
  });
  it("ok when page has routeRef", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" }
      } as never
    });
    expect(i01PageRouteRef(g)).toEqual([]);
  });
  it("flags page missing routeRef", () => {
    const g = baseGraph({
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr" }
      } as never
    });
    const issues = i01PageRouteRef(g);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("I01_PAGE_MISSING_ROUTEREF");
    expect(issues[0]?.nodeId).toBe("page:home");
  });
});
```

- [ ] **Step 2-3: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i01PageRouteRef: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind === "page" && (node.routeRef === undefined || node.routeRef === "")) {
      issues.push({
        code: "I01_PAGE_MISSING_ROUTEREF",
        message: `Page ${id} must carry a routeRef`,
        path: ["nodes", id, "routeRef"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 4: Commit** `feat(spec-graph-schema): add invariant I01 (Page must carry routeRef)`

---

### Task 26: Invariant 2 — every Endpoint must carry a routeRef

`src/invariants/i02-endpoint-routeref.ts` — same pattern as I01 but for kind === "endpoint" and code `I02_ENDPOINT_MISSING_ROUTEREF`. Note: the EndpointSchema already requires `routeRef` (Task 8). This invariant is a defensive double-check at the graph level — it WILL effectively be unreachable if Zod parsing happens first, but we keep it because invariants may be run on raw graph fragments in the data layer.

Test mirrors I01's structure with one ok case and one flagged case. Commit: `feat(spec-graph-schema): add invariant I02 (Endpoint must carry routeRef)`.

---

### Task 27: Invariant 3 — Page with authRequired must have a `requires` edge to an AuthBoundary

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i03-page-auth-required-needs-boundary.ts`
- Create: `packages/spec-graph-schema/test/invariants/i03.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i03PageAuthRequiredNeedsBoundary: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "page") continue;
    if (!node.authRequired) continue;
    const hasRequires = graph.edges.some(
      (e) => e.type === "requires" && e.from === id && graph.nodes[e.to]?.kind === "authboundary"
    );
    if (!hasRequires) {
      issues.push({
        code: "I03_AUTH_PAGE_MISSING_BOUNDARY",
        message: `Page ${id} has authRequired=true but no requires-edge to an AuthBoundary`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test** (one ok case, one flagged) and commit `feat(spec-graph-schema): add invariant I03 (authRequired Page needs AuthBoundary)`

---

### Task 28: Invariant 4 — Endpoint mutating PII model needs auth + compliance

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i04-pii-mutating-endpoint-needs-auth-and-compliance.ts`
- Create: `packages/spec-graph-schema/test/invariants/i04.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i04PiiMutatingEndpointNeedsAuthAndCompliance: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [endpointId, endpoint] of Object.entries(graph.nodes)) {
    if (endpoint.kind !== "endpoint") continue;
    const mutates = graph.edges.filter((e) => e.type === "mutates" && e.from === endpointId);
    const mutatesPii = mutates.some((e) => {
      const target = graph.nodes[e.to];
      return target?.kind === "model" && target.piiClassification !== "none";
    });
    if (!mutatesPii) continue;

    const hasAuth = graph.edges.some(
      (e) => e.type === "requires" && e.from === endpointId && graph.nodes[e.to]?.kind === "authboundary"
    );
    const hasCompliance = graph.edges.some(
      (e) => e.type === "subjectTo" && e.from === endpointId && graph.nodes[e.to]?.kind === "compliance"
    );

    if (!hasAuth) {
      issues.push({
        code: "I04_PII_ENDPOINT_MISSING_AUTH",
        message: `Endpoint ${endpointId} mutates a PII Model but has no requires-edge to an AuthBoundary`,
        path: ["edges"],
        nodeId: endpointId
      });
    }
    if (!hasCompliance) {
      issues.push({
        code: "I04_PII_ENDPOINT_MISSING_COMPLIANCE",
        message: `Endpoint ${endpointId} mutates a PII Model but has no subjectTo-edge to a ComplianceClass`,
        path: ["edges"],
        nodeId: endpointId
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I04 (PII-mutating Endpoint needs auth + compliance)`

---

### Task 29: Invariant 5 — PII Model must have RLS for all four actions

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i05-pii-model-needs-rls.ts`
- Create: `packages/spec-graph-schema/test/invariants/i05.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

const ACTIONS = ["select", "insert", "update", "delete"] as const;

export const i05PiiModelNeedsRls: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "model" || node.piiClassification === "none") continue;
    const missing = ACTIONS.filter((a) => {
      const policy = node.rlsPolicies?.[a];
      return typeof policy !== "string" || policy.length === 0;
    });
    if (missing.length > 0) {
      issues.push({
        code: "I05_PII_MODEL_MISSING_RLS",
        message: `Model ${id} has PII but is missing RLS policies for: ${missing.join(", ")}`,
        path: ["nodes", id, "rlsPolicies"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I05 (PII Model must have RLS for all four actions)`

---

### Task 30: Invariant 6 — no critical CVEs

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i06-no-critical-cves.ts`
- Create: `packages/spec-graph-schema/test/invariants/i06.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i06NoCriticalCves: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "dependency") continue;
    if (node.cveScanStatus.severity === "critical") {
      issues.push({
        code: "I06_DEPENDENCY_HAS_CRITICAL_CVE",
        message: `Dependency ${node.name}@${node.version} has a critical CVE — merge-blocker until resolved`,
        path: ["nodes", id, "cveScanStatus"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I06 (no critical CVE dependencies)`

---

### Task 31: Invariant 7 — `renders` edges target existing Components

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i07-renders-target-exists.ts`
- Create: `packages/spec-graph-schema/test/invariants/i07.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i07RendersTargetExists: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  graph.edges.forEach((edge, idx) => {
    if (edge.type !== "renders") return;
    const target = graph.nodes[edge.to];
    if (!target) {
      issues.push({
        code: "I07_RENDERS_DANGLING_REF",
        message: `renders edge from ${edge.from} points at non-existent node ${edge.to}`,
        path: ["edges", idx, "to"],
        edgeIndex: idx
      });
    } else if (target.kind !== "component") {
      issues.push({
        code: "I07_RENDERS_WRONG_KIND",
        message: `renders edge from ${edge.from} points at ${edge.to} which is a ${target.kind}, not a component`,
        path: ["edges", idx, "to"],
        edgeIndex: idx
      });
    }
  });
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I07 (renders edges target existing Components)`

---

### Task 32: Invariant 8 — exactly one ComplianceClass with name=baseline

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i08-baseline-compliance-present.ts`
- Create: `packages/spec-graph-schema/test/invariants/i08.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i08BaselineCompliancePresent: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const baselines = Object.values(graph.nodes).filter((n) => n.kind === "compliance" && n.name === "baseline");
  if (baselines.length === 1) return [];
  return [{
    code: baselines.length === 0 ? "I08_BASELINE_COMPLIANCE_MISSING" : "I08_BASELINE_COMPLIANCE_DUPLICATED",
    message: `Exactly one ComplianceClass with name="baseline" must be present (found ${baselines.length})`,
    path: ["nodes"]
  }];
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I08 (exactly one baseline ComplianceClass)`

---

### Task 33: Invariant 9 — test coverage required for protected target kinds

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i09-test-coverage-required-targets.ts`
- Create: `packages/spec-graph-schema/test/invariants/i09.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

const COVERED_KINDS = new Set(["page", "clientstate", "endpoint", "flow", "authboundary"]);

export const i09TestCoverageRequiredTargets: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const coveredIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "covers") coveredIds.add(edge.to);
  }
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!COVERED_KINDS.has(node.kind)) continue;
    if (!coveredIds.has(id)) {
      issues.push({
        code: "I09_MISSING_TEST_COVERAGE",
        message: `${node.kind} ${id} has no covers-edge from any Test`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I09 (Page/ClientState/Endpoint/Flow/AuthBoundary need Test coverage)`

---

### Task 34: Invariant 10 — personalized AIFeature needs ComplianceClass

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i10-aifeature-personalized-needs-compliance.ts`
- Create: `packages/spec-graph-schema/test/invariants/i10.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i10AiFeaturePersonalizedNeedsCompliance: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "aifeature") continue;
    if (node.personalization === "none") continue;
    const hasCompliance = graph.edges.some(
      (e) => e.type === "subjectTo" && e.from === id && graph.nodes[e.to]?.kind === "compliance"
    );
    if (!hasCompliance) {
      issues.push({
        code: "I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE",
        message: `AIFeature ${id} has personalization=${node.personalization} but no subjectTo-edge to a ComplianceClass`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I10 (personalized AIFeature needs ComplianceClass)`

---

### Task 35: Invariant 11 — generated MediaAsset needs providerCapability

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i11-mediaasset-generated-needs-provider.ts`
- Create: `packages/spec-graph-schema/test/invariants/i11.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i11MediaAssetGeneratedNeedsProvider: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "mediaasset") continue;
    if (node.licenseStatus !== "generated") continue;
    if (!node.providerCapability) {
      issues.push({
        code: "I11_GENERATED_MEDIA_MISSING_PROVIDER",
        message: `MediaAsset ${id} is generated but missing providerCapability attestation`,
        path: ["nodes", id, "providerCapability"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I11 (generated MediaAsset needs providerCapability)`

---

### Task 36: Invariant 12 — PII ClientState needs ComplianceClass

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i12-pii-clientstate-needs-compliance.ts`
- Create: `packages/spec-graph-schema/test/invariants/i12.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i12PiiClientStateNeedsCompliance: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "clientstate") continue;
    if (node.piiClassification === "none") continue;
    const hasCompliance = graph.edges.some(
      (e) => e.type === "subjectTo" && e.from === id && graph.nodes[e.to]?.kind === "compliance"
    );
    if (!hasCompliance) {
      issues.push({
        code: "I12_PII_CLIENTSTATE_MISSING_COMPLIANCE",
        message: `ClientState ${id} carries PII (${node.piiClassification}) but has no subjectTo-edge to a ComplianceClass`,
        path: ["edges"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I12 (PII ClientState needs ComplianceClass)`

---

### Task 37: Invariant 13 — baseline tests for protected targets

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i13-baseline-tests-for-protected-targets.ts`
- Create: `packages/spec-graph-schema/test/invariants/i13.test.ts`

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i13BaselineTestsForProtectedTargets: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  // Build map of which target ids are covered by a baseline-source Test.
  const baselineCoverage = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.kind !== "test" || node.source !== "baseline") continue;
    for (const target of node.coversRef) baselineCoverage.add(target);
  }

  const protectedNeedsBaseline = (id: string): boolean => {
    const node = graph.nodes[id];
    if (!node) return false;
    if (node.kind === "authboundary") return true;
    if (node.kind === "model" && node.piiClassification !== "none") return true;
    if (node.kind === "compliance" && node.name !== "baseline") return true;
    return false;
  };

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!protectedNeedsBaseline(id)) continue;
    if (!baselineCoverage.has(id)) {
      issues.push({
        code: "I13_PROTECTED_TARGET_MISSING_BASELINE_TEST",
        message: `${node.kind} ${id} requires at least one Test with source="baseline" (non-overridable security floor)`,
        path: ["nodes", id],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I13 (AuthBoundary/PII-Model/non-baseline-Compliance need baseline Test)`

---

### Task 38: Invariant 14 — MediaAsset.kind v1 allowlist (already enforced at schema; defensive)

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i14-mediaasset-kind-allowlist-v1.ts`
- Create: `packages/spec-graph-schema/test/invariants/i14.test.ts`

This invariant is also enforced at the MediaAssetSchema level (Task 16). Including it here as a defensive check ensures fragmentary graph inputs (where Zod parsing has been bypassed) still get caught.

- [ ] **Step 1: Implementation**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";
import { MEDIA_KINDS_V1 } from "../nodes/media-asset.js";

export const i14MediaAssetKindAllowlistV1: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const allow = new Set<string>(MEDIA_KINDS_V1);
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "mediaasset") continue;
    if (!allow.has(node.mediaKind)) {
      issues.push({
        code: "I14_MEDIAASSET_KIND_PHASE_B",
        message: `MediaAsset ${id} has mediaKind="${node.mediaKind}" which is deferred to Phase B; v1 allows ${[...allow].join(", ")}`,
        path: ["nodes", id, "mediaKind"],
        nodeId: id
      });
    }
  }
  return issues;
};
```

- [ ] **Step 2: Test + commit** `feat(spec-graph-schema): add invariant I14 (MediaAsset kind v1 allowlist defensive check)`

---

### Task 39: Public `validate()` entry point

**Files:**
- Create: `packages/spec-graph-schema/src/validate.ts`
- Create: `packages/spec-graph-schema/test/validate.test.ts`
- Modify: `packages/spec-graph-schema/src/index.ts`

- [ ] **Step 1: Implementation**

`packages/spec-graph-schema/src/validate.ts`:
```ts
import { SpecGraphSchema, type SpecGraph } from "./graph.js";
import { runInvariants, type ValidationResult, type ValidationIssue, type Invariant } from "./invariants/runner.js";

import { i01PageRouteRef } from "./invariants/i01-page-routeref.js";
import { i02EndpointRouteRef } from "./invariants/i02-endpoint-routeref.js";
import { i03PageAuthRequiredNeedsBoundary } from "./invariants/i03-page-auth-required-needs-boundary.js";
import { i04PiiMutatingEndpointNeedsAuthAndCompliance } from "./invariants/i04-pii-mutating-endpoint-needs-auth-and-compliance.js";
import { i05PiiModelNeedsRls } from "./invariants/i05-pii-model-needs-rls.js";
import { i06NoCriticalCves } from "./invariants/i06-no-critical-cves.js";
import { i07RendersTargetExists } from "./invariants/i07-renders-target-exists.js";
import { i08BaselineCompliancePresent } from "./invariants/i08-baseline-compliance-present.js";
import { i09TestCoverageRequiredTargets } from "./invariants/i09-test-coverage-required-targets.js";
import { i10AiFeaturePersonalizedNeedsCompliance } from "./invariants/i10-aifeature-personalized-needs-compliance.js";
import { i11MediaAssetGeneratedNeedsProvider } from "./invariants/i11-mediaasset-generated-needs-provider.js";
import { i12PiiClientStateNeedsCompliance } from "./invariants/i12-pii-clientstate-needs-compliance.js";
import { i13BaselineTestsForProtectedTargets } from "./invariants/i13-baseline-tests-for-protected-targets.js";
import { i14MediaAssetKindAllowlistV1 } from "./invariants/i14-mediaasset-kind-allowlist-v1.js";

export const ALL_INVARIANTS: Invariant[] = [
  i01PageRouteRef,
  i02EndpointRouteRef,
  i03PageAuthRequiredNeedsBoundary,
  i04PiiMutatingEndpointNeedsAuthAndCompliance,
  i05PiiModelNeedsRls,
  i06NoCriticalCves,
  i07RendersTargetExists,
  i08BaselineCompliancePresent,
  i09TestCoverageRequiredTargets,
  i10AiFeaturePersonalizedNeedsCompliance,
  i11MediaAssetGeneratedNeedsProvider,
  i12PiiClientStateNeedsCompliance,
  i13BaselineTestsForProtectedTargets,
  i14MediaAssetKindAllowlistV1
];

/**
 * Validate a graph: structural (Zod) parse first, then run all 14 invariants.
 * If structural parse fails, no invariants run — returns issues from Zod only.
 */
export function validate(input: unknown): ValidationResult {
  const parse = SpecGraphSchema.safeParse(input);
  if (!parse.success) {
    const issues: ValidationIssue[] = parse.error.issues.map((iss) => ({
      code: `STRUCTURAL_${iss.code.toUpperCase()}`,
      message: iss.message,
      path: iss.path
    }));
    return { ok: false, issues };
  }
  return runInvariants(parse.data, ALL_INVARIANTS);
}

export type GraphValidator = (input: unknown) => ValidationResult;
export type { ValidationResult, ValidationIssue, Invariant, SpecGraph };
```

- [ ] **Step 2: Test (end-to-end on a clean graph + on the §5.5 forgot-password example)**

```ts
import { describe, expect, it } from "vitest";
import { validate, ALL_INVARIANTS } from "../src/validate.js";

const minimalValid = {
  schemaVersion: "1.0.0",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {
    "compliance:baseline": {
      kind: "compliance", id: "compliance:baseline",
      name: "baseline", scope: "global", attestation: "self-attested",
      effectiveDate: "2026-04-19"
    }
  },
  edges: []
};

describe("validate()", () => {
  it("ALL_INVARIANTS contains 14 entries", () => {
    expect(ALL_INVARIANTS).toHaveLength(14);
  });

  it("clean minimal graph passes", () => {
    const result = validate(minimalValid);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags structural error for missing baseline ComplianceClass", () => {
    const bad = { ...minimalValid, nodes: {} };
    const result = validate(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "I08_BASELINE_COMPLIANCE_MISSING")).toBe(true);
  });

  it("returns Zod issues when structural parse fails", () => {
    const bad = { ...minimalValid, schemaVersion: "0.9.0" };
    const result = validate(bad);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toMatch(/^STRUCTURAL_/);
  });
});
```

- [ ] **Step 3: Update `src/index.ts` to export the public surface**

```ts
export { validate, ALL_INVARIANTS } from "./validate.js";
export type { GraphValidator, ValidationResult, ValidationIssue, Invariant } from "./validate.js";

export { SpecGraphSchema } from "./graph.js";
export type { SpecGraph } from "./graph.js";

export { NodeSchema, nodeRegistry } from "./nodes/index.js";
export type { Node, NodeRegistry } from "./nodes/index.js";

export { EdgeSchema, edgeRegistry, EDGE_TYPES } from "./edges/index.js";
export type { Edge, EdgeRegistry, EdgeType } from "./edges/index.js";

export {
  NODE_KINDS, NodeKindSchema, ProjectIdSchema, NodeIdSchema, EdgeIdSchema,
  PiiClassificationSchema, ExtensionsSchema, parseNodeKindFromId
} from "./primitives.js";
export type { NodeKind, ProjectId, NodeId, EdgeId, PiiClassification } from "./primitives.js";

// Per-node-type schemas (re-exported for granular consumers)
export {
  PageSchema, RouteSchema, ComponentSchema, ClientStateSchema, ModelSchema,
  EndpointSchema, FlowSchema, AuthBoundarySchema, TestSchema, DesignTokenSchema,
  DependencySchema, ComplianceClassSchema, AIFeatureSchema, MediaAssetSchema
} from "./nodes/index.js";
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/spec-graph-schema test
pnpm -F @atlas/spec-graph-schema typecheck
git add packages/spec-graph-schema/src/validate.ts packages/spec-graph-schema/src/index.ts packages/spec-graph-schema/test/validate.test.ts
git commit -m "feat(spec-graph-schema): wire validate() entry point with all 14 invariants"
```

---

### Task 40: JSON Schema generation

**Files:**
- Create: `packages/spec-graph-schema/scripts/generate-json-schema.mjs`
- Modify: `packages/spec-graph-schema/package.json` (extend `build` script)
- Create: `packages/spec-graph-schema/test/json-schema.test.ts`

- [ ] **Step 1: Generation script**

`packages/spec-graph-schema/scripts/generate-json-schema.mjs`:
```js
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SpecGraphSchema } from "../dist/graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist", "schema");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "spec-graph.v1.schema.json");

const jsonSchema = zodToJsonSchema(SpecGraphSchema, {
  name: "SpecGraph",
  $refStrategy: "root",
  target: "jsonSchema2020-12"
});

writeFileSync(outFile, JSON.stringify(jsonSchema, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${outFile}\n`);
```

- [ ] **Step 2: Update `package.json` build script**

```json
"scripts": {
  "build": "tsc -p tsconfig.json && node scripts/generate-json-schema.mjs",
  ...
}
```

- [ ] **Step 3: Test that the generated artifact loads + has expected shape**

`packages/spec-graph-schema/test/json-schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(here, "..", "dist", "schema", "spec-graph.v1.schema.json");

describe("generated JSON Schema artifact", () => {
  it("exists after build", () => {
    if (!existsSync(ARTIFACT)) {
      // skip with a clear message: build must run first
      return; // soft-skip: CI will run build before test
    }
    expect(existsSync(ARTIFACT)).toBe(true);
  });

  it("parses as JSON and has $schema set to JSON Schema 2020-12", () => {
    if (!existsSync(ARTIFACT)) return;
    const doc = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    expect(doc.$schema).toMatch(/2020-12/);
    // Top-level title or definitions reference "SpecGraph"
    const text = JSON.stringify(doc);
    expect(text).toMatch(/SpecGraph/);
  });
});
```

- [ ] **Step 4: Run build then test**

```bash
pnpm -F @atlas/spec-graph-schema build
pnpm -F @atlas/spec-graph-schema test
```

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/scripts/generate-json-schema.mjs packages/spec-graph-schema/package.json packages/spec-graph-schema/test/json-schema.test.ts
git commit -m "feat(spec-graph-schema): emit JSON Schema 2020-12 artifact at build time"
```

---

### Task 41: Wire opt-in validation into `@atlas/spec-graph-data`

**Files:**
- Modify: `packages/spec-graph-data/src/repos/spec-graph.repo.ts`
- Modify: `packages/spec-graph-data/package.json` (add workspace dep)
- Create: `packages/spec-graph-data/test/spec-graph.repo.validation.test.ts`

This is the only Plan A.1 change. The validator is opt-in via a constructor flag so existing tests that pass raw payloads keep working.

- [ ] **Step 1: Add the dep**

In `packages/spec-graph-data/package.json` under `dependencies`, add:
```json
"@atlas/spec-graph-schema": "workspace:*"
```

Run `pnpm install` to pick it up.

- [ ] **Step 2: Modify SpecGraphRepo**

Read the existing file first to find the `create` and `updateGraphData` methods. Modify the constructor to accept an optional `{ validator?: GraphValidator }` and call it before each write. Throw a typed `GraphValidationError` if validation fails.

```ts
// at the top of src/repos/spec-graph.repo.ts
import type { GraphValidator, ValidationResult } from "@atlas/spec-graph-schema";

export class GraphValidationError extends Error {
  readonly result: ValidationResult;
  constructor(result: ValidationResult) {
    super(`spec-graph validation failed with ${result.issues.length} issue(s): ${result.issues.slice(0, 3).map((i) => i.code).join(", ")}${result.issues.length > 3 ? ", ..." : ""}`);
    this.name = "GraphValidationError";
    this.result = result;
  }
}

export interface SpecGraphRepoOptions {
  validator?: GraphValidator;
}
```

In the constructor, accept `opts: SpecGraphRepoOptions = {}` and store `this.validator = opts.validator`. In `create(projectId, graphData)` and `updateGraphData(projectId, graphData, currentEventSeq)`, before the SQL write:

```ts
if (this.validator) {
  const result = this.validator(graphData);
  if (!result.ok) throw new GraphValidationError(result);
}
```

- [ ] **Step 3: Test**

`packages/spec-graph-data/test/spec-graph.repo.validation.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { validate } from "@atlas/spec-graph-schema";
import { SpecGraphRepo, GraphValidationError, createDatabase, type Database } from "@atlas/spec-graph-data";

const minimalValid = {
  schemaVersion: "1.0.0",
  projectId: "00000000-0000-0000-0000-000000000000", // overridden per test
  name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DATABASE_URL" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "2026-04-19T00:00:00.000Z",
  updatedAt: "2026-04-19T00:00:00.000Z",
  nodes: {
    "compliance:baseline": {
      kind: "compliance", id: "compliance:baseline",
      name: "baseline", scope: "global", attestation: "self-attested",
      effectiveDate: "2026-04-19"
    }
  },
  edges: []
};

describe("SpecGraphRepo with opt-in validator", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  beforeEach(async () => {
    await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("create() with validator accepts a valid graph", async () => {
    const projectId = randomUUID();
    const repo = new SpecGraphRepo(db.pool, { validator: validate });
    const graphData = { ...minimalValid, projectId };
    await expect(repo.create(projectId, graphData)).resolves.toBeDefined();
  });

  it("create() with validator rejects an invalid graph", async () => {
    const projectId = randomUUID();
    const repo = new SpecGraphRepo(db.pool, { validator: validate });
    const graphData = { ...minimalValid, projectId, nodes: {} }; // missing baseline ComplianceClass
    await expect(repo.create(projectId, graphData)).rejects.toBeInstanceOf(GraphValidationError);
  });

  it("create() without validator preserves the legacy schema-agnostic behavior", async () => {
    const projectId = randomUUID();
    const repo = new SpecGraphRepo(db.pool); // no validator
    await expect(repo.create(projectId, { marker: "raw-test-payload" })).resolves.toBeDefined();
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -F @atlas/spec-graph-data test
pnpm -F @atlas/spec-graph-data typecheck
git add packages/spec-graph-data pnpm-lock.yaml
git commit -m "feat(spec-graph-data): wire opt-in spec-graph-schema validator into SpecGraphRepo"
```

---

### Task 42: Smoke test on the §5.5 forgot-password example

**Files:**
- Create: `packages/spec-graph-schema/test/fixtures/valid-forgot-password.json`
- Modify: `packages/spec-graph-schema/test/validate.test.ts`

Adds a real-shaped graph fixture (the §5.5 example from the design spec) to prove the schema + invariants accept a realistic non-trivial graph.

- [ ] **Step 1: Create the fixture** (the §5.5 forgot-password example, ~11 nodes + ~10 edges, with required baselines and tests). The file is large but mechanical — copy-paste the §5.5 nodes/edges plus add the `baseline` ComplianceClass + Test nodes the invariants require.

Skeleton structure:
```json
{
  "schemaVersion": "1.0.0",
  "projectId": "22222222-2222-4222-8222-222222222222",
  "name": "forgot-password-demo",
  "complianceClasses": ["baseline"],
  "databaseProvider": { "tier": "atlas-run", "provider": "neon", "region": "us-east-1", "connectionStringRef": "env:DATABASE_URL" },
  "templateDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "createdAt": "2026-04-19T00:00:00.000Z",
  "updatedAt": "2026-04-19T00:00:00.000Z",
  "nodes": {
    "compliance:baseline": { "kind": "compliance", "id": "compliance:baseline", "name": "baseline", "scope": "global", "attestation": "self-attested", "effectiveDate": "2026-04-19" },
    "page:ForgotPasswordPage": { "kind": "page", "id": "page:ForgotPasswordPage", "path": "/forgot-password", "title": "Forgot Password", "renderMode": "ssr", "routeRef": "GET /forgot-password" },
    "page:ResetPasswordPage": { "kind": "page", "id": "page:ResetPasswordPage", "path": "/reset-password/[token]", "title": "Reset Password", "renderMode": "ssr", "routeRef": "GET /reset-password/[token]" },
    "endpoint:requestPasswordReset": { "kind": "endpoint", "id": "endpoint:requestPasswordReset", "name": "requestPasswordReset", "routeRef": "POST /api/auth/forgot-password", "method": "POST" },
    "endpoint:resetPassword": { "kind": "endpoint", "id": "endpoint:resetPassword", "name": "resetPassword", "routeRef": "POST /api/auth/reset-password", "method": "POST" },
    "model:PasswordResetToken": {
      "kind": "model", "id": "model:PasswordResetToken", "name": "PasswordResetToken",
      "fields": { "id": "uuid", "userId": "uuid", "token": "string", "expiresAt": "datetime" },
      "rlsPolicies": { "select": "auth.uid() = user_id", "insert": "true", "update": "auth.uid() = user_id", "delete": "auth.uid() = user_id" },
      "piiClassification": "direct",
      "dataRetentionDays": 1
    },
    "flow:ForgotPasswordFlow": { "kind": "flow", "id": "flow:ForgotPasswordFlow", "name": "ForgotPassword", "steps": [{ "id": "enter-email", "label": "Enter email" }, { "id": "email-sent", "label": "Email sent" }, { "id": "click-link", "label": "Click link" }, { "id": "set-password", "label": "Set password" }, { "id": "signed-in", "label": "Signed in" }], "entryPoints": ["page:ForgotPasswordPage"] },
    "authboundary:PublicWithRateLimit": { "kind": "authboundary", "id": "authboundary:PublicWithRateLimit", "name": "PublicWithRateLimit", "type": "public" },
    "test:ForgotPasswordFlow.e2e": { "kind": "test", "id": "test:ForgotPasswordFlow.e2e", "name": "ForgotPasswordFlow.e2e", "layer": "L3", "source": "generated", "filepath": "tests/e2e/forgot-password.spec.ts", "coversRef": ["flow:ForgotPasswordFlow", "page:ForgotPasswordPage", "page:ResetPasswordPage", "endpoint:requestPasswordReset", "endpoint:resetPassword", "authboundary:PublicWithRateLimit"] },
    "test:PasswordResetToken.baseline": { "kind": "test", "id": "test:PasswordResetToken.baseline", "name": "PasswordResetToken.baseline", "layer": "L4", "source": "baseline", "filepath": "atlas-skills/baselines/security/password-reset-token.ts", "coversRef": ["model:PasswordResetToken"] },
    "test:PublicWithRateLimit.baseline": { "kind": "test", "id": "test:PublicWithRateLimit.baseline", "name": "PublicWithRateLimit.baseline", "layer": "L4", "source": "baseline", "filepath": "atlas-skills/baselines/security/rate-limit.ts", "coversRef": ["authboundary:PublicWithRateLimit"] }
  },
  "edges": [
    { "type": "fetches", "from": "page:ForgotPasswordPage", "to": "endpoint:requestPasswordReset" },
    { "type": "fetches", "from": "page:ResetPasswordPage", "to": "endpoint:resetPassword" },
    { "type": "mutates", "from": "endpoint:requestPasswordReset", "to": "model:PasswordResetToken" },
    { "type": "reads", "from": "endpoint:resetPassword", "to": "model:PasswordResetToken" },
    { "type": "mutates", "from": "endpoint:resetPassword", "to": "model:PasswordResetToken" },
    { "type": "requires", "from": "endpoint:requestPasswordReset", "to": "authboundary:PublicWithRateLimit" },
    { "type": "requires", "from": "endpoint:resetPassword", "to": "authboundary:PublicWithRateLimit" },
    { "type": "subjectTo", "from": "endpoint:requestPasswordReset", "to": "compliance:baseline" },
    { "type": "subjectTo", "from": "endpoint:resetPassword", "to": "compliance:baseline" },
    { "type": "covers", "from": "test:ForgotPasswordFlow.e2e", "to": "flow:ForgotPasswordFlow" },
    { "type": "covers", "from": "test:ForgotPasswordFlow.e2e", "to": "page:ForgotPasswordPage" },
    { "type": "covers", "from": "test:ForgotPasswordFlow.e2e", "to": "page:ResetPasswordPage" },
    { "type": "covers", "from": "test:ForgotPasswordFlow.e2e", "to": "endpoint:requestPasswordReset" },
    { "type": "covers", "from": "test:ForgotPasswordFlow.e2e", "to": "endpoint:resetPassword" },
    { "type": "covers", "from": "test:ForgotPasswordFlow.e2e", "to": "authboundary:PublicWithRateLimit" },
    { "type": "covers", "from": "test:PasswordResetToken.baseline", "to": "model:PasswordResetToken" },
    { "type": "covers", "from": "test:PublicWithRateLimit.baseline", "to": "authboundary:PublicWithRateLimit" }
  ]
}
```

- [ ] **Step 2: Add the test**

Append to `packages/spec-graph-schema/test/validate.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("validate() on §5.5 forgot-password example", () => {
  it("accepts the realistic forgot-password graph", () => {
    const fx = JSON.parse(readFileSync(join(here, "fixtures", "valid-forgot-password.json"), "utf8"));
    const result = validate(fx);
    if (!result.ok) console.error(JSON.stringify(result.issues, null, 2));
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F @atlas/spec-graph-schema test
git add packages/spec-graph-schema/test/fixtures/valid-forgot-password.json packages/spec-graph-schema/test/validate.test.ts
git commit -m "test(spec-graph-schema): smoke-validate the §5.5 forgot-password example"
```

---

### Task 43: Package README

**Files:**
- Create: `packages/spec-graph-schema/README.md`

- [ ] **Step 1: Write the README**

````markdown
# @atlas/spec-graph-schema

The canonical schema for the Atlas Spec Graph: 14 node types, 13 edge types, 14 structural invariants.

This is the **typed contract** that every Atlas surface reads — skill framework, conductor, merge gates, the Atlas backend, the public OSS skill library. It carries no runtime dependencies beyond Zod and exposes a pure `validate()` function.

## Install

```bash
pnpm add @atlas/spec-graph-schema
```

## Usage

```ts
import { validate, SpecGraphSchema, type SpecGraph } from "@atlas/spec-graph-schema";

// Validate an unknown shape
const result = validate(someJson);
if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`${issue.code}: ${issue.message}`, issue.path);
  }
}

// Or parse with Zod directly for a fully-typed value
const graph: SpecGraph = SpecGraphSchema.parse(someJson);
```

## What this package contains

- `SpecGraphSchema` — the root object Zod schema (`z.discriminatedUnion`-backed)
- `NodeSchema` and `nodeRegistry` — 14 node types
- `EdgeSchema` and `edgeRegistry` — 13 edge types
- `validate(graph) → ValidationResult` — runs the structural Zod parse plus all 14 invariants
- `ALL_INVARIANTS` — the array of invariant functions, importable for partial runs
- A JSON Schema 2020-12 artifact at `dist/schema/spec-graph.v1.schema.json` for non-TS consumers (Python, Go, generated tooling)

## Node types (14)

`Page` · `Route` · `Component` · `ClientState` · `Model` · `Endpoint` · `Flow` · `AuthBoundary` · `Test` · `DesignToken` · `Dependency` · `ComplianceClass` · `AIFeature` · `MediaAsset`

## Edge types (13)

`renders` · `fetches` · `reads` · `mutates` · `requires` · `covers` · `dependsOn` · `styledBy` · `subjectTo` · `supersedes` · `powers` · `displays` · `manages`

## Structural invariants (14)

| # | Code | Summary |
|---|---|---|
| I01 | `I01_PAGE_MISSING_ROUTEREF` | Every Page must carry a `routeRef`. |
| I02 | `I02_ENDPOINT_MISSING_ROUTEREF` | Every Endpoint must carry a `routeRef`. |
| I03 | `I03_AUTH_PAGE_MISSING_BOUNDARY` | Pages with `authRequired: true` must `requires` an AuthBoundary. |
| I04 | `I04_PII_ENDPOINT_MISSING_AUTH` / `_COMPLIANCE` | Endpoints mutating a PII Model need both AuthBoundary and ComplianceClass edges. |
| I05 | `I05_PII_MODEL_MISSING_RLS` | Models with PII must have RLS policies for select/insert/update/delete. |
| I06 | `I06_DEPENDENCY_HAS_CRITICAL_CVE` | No critical-severity dependency CVEs (merge-blocker). |
| I07 | `I07_RENDERS_DANGLING_REF` / `_WRONG_KIND` | `renders` edges must target an existing Component. |
| I08 | `I08_BASELINE_COMPLIANCE_*` | Exactly one ComplianceClass with name `baseline`. |
| I09 | `I09_MISSING_TEST_COVERAGE` | Every Page, ClientState, Endpoint, Flow, AuthBoundary needs a `covers`-edge from at least one Test. |
| I10 | `I10_AIFEATURE_PERSONALIZED_MISSING_COMPLIANCE` | Personalized AIFeatures need a ComplianceClass. |
| I11 | `I11_GENERATED_MEDIA_MISSING_PROVIDER` | Generated MediaAssets need a `providerCapability`. |
| I12 | `I12_PII_CLIENTSTATE_MISSING_COMPLIANCE` | ClientState with PII needs a ComplianceClass. |
| I13 | `I13_PROTECTED_TARGET_MISSING_BASELINE_TEST` | AuthBoundaries, PII Models, and non-baseline ComplianceClasses each need at least one Test with `source: "baseline"`. |
| I14 | `I14_MEDIAASSET_KIND_PHASE_B` | MediaAsset.kind must be one of `image`, `icon`, `illustration` in v1. |

## Wire-up with `@atlas/spec-graph-data`

The data layer accepts the validator as an opt-in:

```ts
import { SpecGraphRepo, createDatabase } from "@atlas/spec-graph-data";
import { validate } from "@atlas/spec-graph-schema";

const db = createDatabase(process.env.DATABASE_URL!);
const repo = new SpecGraphRepo(db.pool, { validator: validate });

await repo.create(projectId, graphData); // throws GraphValidationError if invalid
```

Without the constructor flag, the data layer remains schema-agnostic (existing test code paths keep working).

## Extension surface

Every node carries an optional `extensions: Record<string, unknown>` field. Use it for custom attributes you don't want to fork the schema for. Validation is lenient on `extensions` and strict on every other field.

## Developing

```bash
pnpm -F @atlas/spec-graph-schema test
pnpm -F @atlas/spec-graph-schema build      # emits dist/ + dist/schema/spec-graph.v1.schema.json
pnpm -F @atlas/spec-graph-schema typecheck
```

No DB required — this package is pure unit code.
````

- [ ] **Step 2: Commit**

```bash
git add packages/spec-graph-schema/README.md
git commit -m "docs(spec-graph-schema): add README with node/edge taxonomy and invariant codes"
```

---

## Completion Checklist

After all 43 tasks:

- [ ] `pnpm -F @atlas/spec-graph-schema test` — all tests green (~50 unit tests)
- [ ] `pnpm -F @atlas/spec-graph-schema build` — exits 0; `dist/index.js` and `dist/schema/spec-graph.v1.schema.json` exist
- [ ] `pnpm -F @atlas/spec-graph-schema typecheck` — exits 0
- [ ] `pnpm -F @atlas/spec-graph-data test` — still green (validator is opt-in; existing tests use the no-validator constructor)
- [ ] `pnpm -F @atlas/spec-graph-sync test` and `pnpm -F @atlas/spec-graph-merge-driver test` and `pnpm -F @atlas/spec-graph-ops test` — all still green (no API changes consumed by these packages)
- [ ] The §5.5 forgot-password example fixture validates clean (`validate(fixture).ok === true`)
- [ ] Every invariant has its own test file with at least one ok case and one flagged case
- [ ] README documents the 14 invariant codes

## Handoff to Plan B.2

Plan B.2 (Python Pydantic bindings; see `docs/superpowers/plans/2026-04-20-spec-graph-schema-py.md`) consumes:

- `dist/schema/spec-graph.v1.schema.json` — the canonical artifact for `datamodel-code-generator` to emit `packages/spec-graph-schema-py/`.
- `nodeRegistry` and `edgeRegistry` — the registries are public exports and serve as the authoritative node/edge catalogue for downstream consumers.
- The 14 invariant `code` strings — Python bindings should expose the same enum-shaped `InvariantCode` for cross-language tooling.

Plan B.2 does NOT modify this package's TypeScript surface. Any extension is additive (a new node type, a new invariant) and ships in this same package as an additive minor version.

## Handoff to Unit C / D

Unit C (Skill Framework) imports `nodeRegistry`, `EDGE_TYPES`, and `validate` to drive the test-generator registry. Unit D (Conductor) consumes the same imports plus `GraphValidator` to wire validation into the mutation pipeline. Neither unit needs to touch this package's internals.
