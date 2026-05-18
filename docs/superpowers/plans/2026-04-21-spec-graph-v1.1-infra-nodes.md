# B-1 — Spec Graph v1.1 — Infra Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@atlas/spec-graph-schema` with 5 new node kinds (Region, DataResidency, Runtime, Provider, WorkloadTopology) and 3 new edge types (runsOn, storesDataIn, migratesTo) to support Phase B infra modeling. Bump schema version to 1.1.0 (backward-compatible).

**Architecture:** Pure additive schema change. Existing v1.0.0 graphs remain valid because the new node kinds are introduced alongside (not replacing) v1.0 kinds, and the new edge types are added to the discriminated union. The `schemaVersion` literal becomes an enum of `"1.0.0" | "1.1.0"` — graphs created before this change are preserved; graphs that use the new kinds must declare `schemaVersion: "1.1.0"`. Two new invariants (I15, I16) enforce referential integrity on the new edges. JSON Schema artifact + Python bindings regenerate automatically.

**Tech Stack:** TypeScript 5.6.3, Zod 3.23.8, Vitest 2.1.8. Reuses the patterns established by B.1 (one file per node, discriminated union in `nodes/index.ts`, primitives `NODE_KINDS` const).

**Design decisions (recorded):**
- `requiresCompliance` edge is **not** added — the existing `subjectTo` edge already fills this role (any → `compliance`). This is DRY and preserves v1.0 graphs that already use `subjectTo`.
- `dependsOn` edge is **not** re-added — already exists, generic `from/to NodeId` shape works for both component-level and infra-level dependencies.
- Net new edges are therefore **3**, not 5 as the roadmap states. Roadmap will be updated in a later refresh.
- Schema version is an **enum**, not a bump-and-break, so Phase A graphs stay parseable.

**Prerequisites:**
- `phase-a/complete` tag on `main` (shipped 2026-04-21).
- `@atlas/spec-graph-schema` at v1.0.0 with 14 node kinds + 13 edge types + 14 invariants.
- `@atlas/spec-graph-schema-py` Pydantic generator wired to the JSON Schema artifact.

---

## File Structure

```
packages/spec-graph-schema/src/
├── primitives.ts                       # MODIFY — extend NODE_KINDS with 5 new entries
├── graph.ts                            # MODIFY — schemaVersion: z.enum(["1.0.0", "1.1.0"])
├── nodes/
│   ├── region.ts                       # NEW
│   ├── data-residency.ts               # NEW
│   ├── runtime.ts                      # NEW
│   ├── provider.ts                     # NEW
│   ├── workload-topology.ts            # NEW
│   └── index.ts                        # MODIFY — register 5 new node schemas
├── edges/
│   ├── runs-on.ts                      # NEW
│   ├── stores-data-in.ts               # NEW
│   ├── migrates-to.ts                  # NEW
│   └── index.ts                        # MODIFY — register 3 new edge schemas
└── invariants/
    ├── i15-workload-topology-references.ts   # NEW
    ├── i16-model-residency-requires-stores-data-in.ts  # NEW
    ├── runner.ts                       # MODIFY — register I15, I16
    └── index.ts                        # MODIFY — export new invariant refs
```

---

## Types & Contracts

```ts
// Region — a named geographic region on a provider
export const RegionSchema = z.object({
  kind: z.literal("region"),
  ...BaseNodeFields,
  code: z.string().min(1),                    // e.g., "us-east-1", "eu-west-1", "ap-south-1"
  cloudProviderRef: z.string().optional(),    // NodeId of owning Provider
  jurisdictionRef: z.string().optional()      // NodeId of DataResidency this region satisfies
}).strict();

// DataResidency — jurisdictional constraint (EU, US, India, sovereign, etc.)
export const DataResidencySchema = z.object({
  kind: z.literal("dataresidency"),
  ...BaseNodeFields,
  jurisdiction: z.string().min(1),            // ISO-3166 country code or "EU" / "global"
  notes: z.string().optional()
}).strict();

// Runtime — executable environment
export const RuntimeSchema = z.object({
  kind: z.literal("runtime"),
  ...BaseNodeFields,
  language: z.enum(["node", "python", "go", "rust", "java", "ruby", "other"]),
  version: z.string().min(1)                  // e.g., "22.0.0", "3.11", "1.23"
}).strict();

// Provider — cloud / on-prem vendor
export const ProviderSchema = z.object({
  kind: z.literal("provider"),
  ...BaseNodeFields,
  name: z.string().min(1),                    // "aws", "gcp", "azure", "ovh", "scaleway", "ctrls"
  type: z.enum(["hyperscaler", "regional", "on-prem", "sovereign"]),
  regionRefs: z.array(z.string()).default([]) // NodeIds of Region nodes
}).strict();

// WorkloadTopology — how workloads are distributed
export const WorkloadTopologySchema = z.object({
  kind: z.literal("workloadtopology"),
  ...BaseNodeFields,
  shape: z.enum([
    "single-region",
    "multi-region-active-passive",
    "multi-region-active-active",
    "edge-only",
    "hybrid-on-prem-cloud"
  ]),
  providerRefs: z.array(z.string()).nonempty(),
  regionRefs: z.array(z.string()).nonempty()
}).strict();

// Edges
export const RunsOnEdgeSchema = z.object({
  type: z.literal("runsOn"),
  from: NodeIdSchema,     // Component | Endpoint | WorkloadTopology
  to: NodeIdSchema,       // Runtime | Region | Provider
  extensions: ExtensionsSchema.optional()
}).strict();

export const StoresDataInEdgeSchema = z.object({
  type: z.literal("storesDataIn"),
  from: NodeIdSchema,     // Model
  to: NodeIdSchema,       // Region | DataResidency
  extensions: ExtensionsSchema.optional()
}).strict();

export const MigratesToEdgeSchema = z.object({
  type: z.literal("migratesTo"),
  from: NodeIdSchema,     // WorkloadTopology (source)
  to: NodeIdSchema,       // WorkloadTopology (target)
  extensions: ExtensionsSchema.optional()
}).strict();
```

**New invariants:**

| Code | Description |
|------|-------------|
| `I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID` | Every `providerRefs` and `regionRefs` on a WorkloadTopology points at an existing Provider / Region node. |
| `I16_PII_MODEL_MISSING_STORES_DATA_IN` | A Model with `piiClassification !== "none"` and at least one Region/DataResidency node in the graph must have a `storesDataIn` edge. (Enforced only when the graph contains regions — not a hard requirement for v1.0-shaped graphs.) |

---

### Task 1: Extend primitives — add 5 new node kinds + schemaVersion enum

**Files:**
- Modify: `packages/spec-graph-schema/src/primitives.ts`
- Modify: `packages/spec-graph-schema/src/graph.ts`
- Test: `packages/spec-graph-schema/test/primitives.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/spec-graph-schema/test/primitives.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NODE_KINDS } from "../src/primitives.js";
import { SpecGraphSchema } from "../src/graph.js";

describe("v1.1 primitives", () => {
  it("NODE_KINDS includes 5 new infra kinds", () => {
    expect(NODE_KINDS).toContain("region");
    expect(NODE_KINDS).toContain("dataresidency");
    expect(NODE_KINDS).toContain("runtime");
    expect(NODE_KINDS).toContain("provider");
    expect(NODE_KINDS).toContain("workloadtopology");
  });

  it("SpecGraphSchema accepts schemaVersion 1.1.0 and still accepts 1.0.0", () => {
    const base = {
      projectId: "00000000-0000-4000-8000-000000000000",
      name: "n",
      complianceClasses: ["baseline"],
      databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "ref" },
      templateDigest: "sha256:abcdef",
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
      nodes: {},
      edges: []
    };
    expect(SpecGraphSchema.safeParse({ schemaVersion: "1.0.0", ...base }).success).toBe(true);
    expect(SpecGraphSchema.safeParse({ schemaVersion: "1.1.0", ...base }).success).toBe(true);
    expect(SpecGraphSchema.safeParse({ schemaVersion: "2.0.0", ...base }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test primitives`
Expected: FAIL — NODE_KINDS doesn't contain "region" etc., schemaVersion rejects "1.1.0".

- [ ] **Step 3: Modify primitives.ts and graph.ts**

In `packages/spec-graph-schema/src/primitives.ts`, add to `NODE_KINDS`:
```ts
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
  "mediaasset",
  "region",
  "dataresidency",
  "runtime",
  "provider",
  "workloadtopology"
] as const;
```

In `packages/spec-graph-schema/src/graph.ts`, change `schemaVersion` to:
```ts
schemaVersion: z.enum(["1.0.0", "1.1.0"]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test primitives`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/primitives.ts packages/spec-graph-schema/src/graph.ts packages/spec-graph-schema/test/primitives.test.ts
git commit -m "feat(spec-graph-schema): v1.1 — register 5 infra node kinds + schemaVersion enum"
```

---

### Task 2: Region node schema

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/region.ts`
- Test: `packages/spec-graph-schema/test/nodes/region.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RegionSchema } from "../../src/nodes/region.js";

describe("RegionSchema", () => {
  it("accepts a minimal valid Region", () => {
    expect(RegionSchema.safeParse({
      kind: "region",
      id: "region:us-east-1",
      code: "us-east-1"
    }).success).toBe(true);
  });

  it("accepts a Region with provider + jurisdiction refs", () => {
    expect(RegionSchema.safeParse({
      kind: "region",
      id: "region:eu-west-1",
      code: "eu-west-1",
      cloudProviderRef: "provider:aws",
      jurisdictionRef: "dataresidency:eu"
    }).success).toBe(true);
  });

  it("rejects empty code", () => {
    expect(RegionSchema.safeParse({
      kind: "region",
      id: "region:x",
      code: ""
    }).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    expect(RegionSchema.safeParse({
      kind: "region",
      id: "region:x",
      code: "x",
      extra: "y"
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/region`
Expected: FAIL — module not found.

- [ ] **Step 3: Create region.ts**

```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const RegionSchema = z.object({
  kind: z.literal("region"),
  ...BaseNodeFields,
  code: z.string().min(1),
  cloudProviderRef: z.string().optional(),
  jurisdictionRef: z.string().optional(),
  extensions: ExtensionsSchema.optional()
}).strict();

export type Region = z.infer<typeof RegionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/region`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/region.ts packages/spec-graph-schema/test/nodes/region.test.ts
git commit -m "feat(spec-graph-schema): Region node schema (v1.1)"
```

---

### Task 3: DataResidency node schema

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/data-residency.ts`
- Test: `packages/spec-graph-schema/test/nodes/data-residency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DataResidencySchema } from "../../src/nodes/data-residency.js";

describe("DataResidencySchema", () => {
  it("accepts a minimal valid DataResidency", () => {
    expect(DataResidencySchema.safeParse({
      kind: "dataresidency",
      id: "dataresidency:eu",
      jurisdiction: "EU"
    }).success).toBe(true);
  });

  it("accepts ISO country codes and notes", () => {
    expect(DataResidencySchema.safeParse({
      kind: "dataresidency",
      id: "dataresidency:in",
      jurisdiction: "IN",
      notes: "DPDP Act 2023 applies"
    }).success).toBe(true);
  });

  it("rejects empty jurisdiction", () => {
    expect(DataResidencySchema.safeParse({
      kind: "dataresidency",
      id: "dataresidency:x",
      jurisdiction: ""
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/data-residency`
Expected: FAIL.

- [ ] **Step 3: Create data-residency.ts**

```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const DataResidencySchema = z.object({
  kind: z.literal("dataresidency"),
  ...BaseNodeFields,
  jurisdiction: z.string().min(1),
  notes: z.string().optional(),
  extensions: ExtensionsSchema.optional()
}).strict();

export type DataResidency = z.infer<typeof DataResidencySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/data-residency`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/data-residency.ts packages/spec-graph-schema/test/nodes/data-residency.test.ts
git commit -m "feat(spec-graph-schema): DataResidency node schema (v1.1)"
```

---

### Task 4: Runtime node schema

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/runtime.ts`
- Test: `packages/spec-graph-schema/test/nodes/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RuntimeSchema } from "../../src/nodes/runtime.js";

describe("RuntimeSchema", () => {
  it("accepts node runtime", () => {
    expect(RuntimeSchema.safeParse({
      kind: "runtime",
      id: "runtime:node-22",
      language: "node",
      version: "22.0.0"
    }).success).toBe(true);
  });

  it("accepts python + rust + go + java + ruby + other", () => {
    for (const language of ["python", "rust", "go", "java", "ruby", "other"]) {
      expect(RuntimeSchema.safeParse({
        kind: "runtime",
        id: `runtime:${language}`,
        language,
        version: "1.0"
      }).success).toBe(true);
    }
  });

  it("rejects unknown language", () => {
    expect(RuntimeSchema.safeParse({
      kind: "runtime",
      id: "runtime:erlang",
      language: "erlang",
      version: "27"
    }).success).toBe(false);
  });

  it("rejects empty version", () => {
    expect(RuntimeSchema.safeParse({
      kind: "runtime",
      id: "runtime:node",
      language: "node",
      version: ""
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/runtime`
Expected: FAIL.

- [ ] **Step 3: Create runtime.ts**

```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const RuntimeLanguageSchema = z.enum([
  "node", "python", "go", "rust", "java", "ruby", "other"
]);
export type RuntimeLanguage = z.infer<typeof RuntimeLanguageSchema>;

export const RuntimeSchema = z.object({
  kind: z.literal("runtime"),
  ...BaseNodeFields,
  language: RuntimeLanguageSchema,
  version: z.string().min(1),
  extensions: ExtensionsSchema.optional()
}).strict();

export type Runtime = z.infer<typeof RuntimeSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/runtime.ts packages/spec-graph-schema/test/nodes/runtime.test.ts
git commit -m "feat(spec-graph-schema): Runtime node schema (v1.1)"
```

---

### Task 5: Provider node schema

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/provider.ts`
- Test: `packages/spec-graph-schema/test/nodes/provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ProviderSchema } from "../../src/nodes/provider.js";

describe("ProviderSchema", () => {
  it("accepts a hyperscaler with region refs", () => {
    expect(ProviderSchema.safeParse({
      kind: "provider",
      id: "provider:aws",
      name: "aws",
      type: "hyperscaler",
      regionRefs: ["region:us-east-1", "region:eu-west-1"]
    }).success).toBe(true);
  });

  it("accepts regional / on-prem / sovereign types", () => {
    for (const type of ["regional", "on-prem", "sovereign"]) {
      expect(ProviderSchema.safeParse({
        kind: "provider",
        id: `provider:${type}`,
        name: type,
        type
      }).success).toBe(true);
    }
  });

  it("defaults regionRefs to empty array", () => {
    const parsed = ProviderSchema.parse({
      kind: "provider",
      id: "provider:x",
      name: "x",
      type: "hyperscaler"
    });
    expect(parsed.regionRefs).toEqual([]);
  });

  it("rejects unknown type", () => {
    expect(ProviderSchema.safeParse({
      kind: "provider",
      id: "provider:x",
      name: "x",
      type: "mystery"
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/provider`
Expected: FAIL.

- [ ] **Step 3: Create provider.ts**

```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const ProviderTypeSchema = z.enum(["hyperscaler", "regional", "on-prem", "sovereign"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ProviderSchema = z.object({
  kind: z.literal("provider"),
  ...BaseNodeFields,
  name: z.string().min(1),
  type: ProviderTypeSchema,
  regionRefs: z.array(z.string()).default([]),
  extensions: ExtensionsSchema.optional()
}).strict();

export type Provider = z.infer<typeof ProviderSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/provider.ts packages/spec-graph-schema/test/nodes/provider.test.ts
git commit -m "feat(spec-graph-schema): Provider node schema (v1.1)"
```

---

### Task 6: WorkloadTopology node schema

**Files:**
- Create: `packages/spec-graph-schema/src/nodes/workload-topology.ts`
- Test: `packages/spec-graph-schema/test/nodes/workload-topology.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { WorkloadTopologySchema } from "../../src/nodes/workload-topology.js";

describe("WorkloadTopologySchema", () => {
  it("accepts a single-region topology", () => {
    expect(WorkloadTopologySchema.safeParse({
      kind: "workloadtopology",
      id: "workloadtopology:main",
      shape: "single-region",
      providerRefs: ["provider:aws"],
      regionRefs: ["region:us-east-1"]
    }).success).toBe(true);
  });

  it("accepts all 5 shape values", () => {
    for (const shape of [
      "single-region",
      "multi-region-active-passive",
      "multi-region-active-active",
      "edge-only",
      "hybrid-on-prem-cloud"
    ]) {
      expect(WorkloadTopologySchema.safeParse({
        kind: "workloadtopology",
        id: `workloadtopology:${shape}`,
        shape,
        providerRefs: ["provider:x"],
        regionRefs: ["region:x"]
      }).success).toBe(true);
    }
  });

  it("rejects empty providerRefs", () => {
    expect(WorkloadTopologySchema.safeParse({
      kind: "workloadtopology",
      id: "workloadtopology:bad",
      shape: "single-region",
      providerRefs: [],
      regionRefs: ["region:x"]
    }).success).toBe(false);
  });

  it("rejects empty regionRefs", () => {
    expect(WorkloadTopologySchema.safeParse({
      kind: "workloadtopology",
      id: "workloadtopology:bad",
      shape: "single-region",
      providerRefs: ["provider:x"],
      regionRefs: []
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/workload-topology`
Expected: FAIL.

- [ ] **Step 3: Create workload-topology.ts**

```ts
import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const WorkloadShapeSchema = z.enum([
  "single-region",
  "multi-region-active-passive",
  "multi-region-active-active",
  "edge-only",
  "hybrid-on-prem-cloud"
]);
export type WorkloadShape = z.infer<typeof WorkloadShapeSchema>;

export const WorkloadTopologySchema = z.object({
  kind: z.literal("workloadtopology"),
  ...BaseNodeFields,
  shape: WorkloadShapeSchema,
  providerRefs: z.array(z.string()).nonempty(),
  regionRefs: z.array(z.string()).nonempty(),
  extensions: ExtensionsSchema.optional()
}).strict();

export type WorkloadTopology = z.infer<typeof WorkloadTopologySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/workload-topology`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/workload-topology.ts packages/spec-graph-schema/test/nodes/workload-topology.test.ts
git commit -m "feat(spec-graph-schema): WorkloadTopology node schema (v1.1)"
```

---

### Task 7: Register all 5 new node schemas in nodes/index.ts

**Files:**
- Modify: `packages/spec-graph-schema/src/nodes/index.ts`
- Test: `packages/spec-graph-schema/test/nodes/discriminated-union.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/spec-graph-schema/test/nodes/discriminated-union.test.ts` (or create):
```ts
import { describe, it, expect } from "vitest";
import { NodeSchema } from "../../src/nodes/index.js";

describe("NodeSchema discriminated union — v1.1", () => {
  it("accepts a Region through the union", () => {
    expect(NodeSchema.safeParse({
      kind: "region",
      id: "region:x",
      code: "x"
    }).success).toBe(true);
  });

  it("accepts all 5 new infra kinds through the union", () => {
    const samples = [
      { kind: "region", id: "region:r", code: "r" },
      { kind: "dataresidency", id: "dataresidency:eu", jurisdiction: "EU" },
      { kind: "runtime", id: "runtime:node", language: "node", version: "22" },
      { kind: "provider", id: "provider:aws", name: "aws", type: "hyperscaler" },
      {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:r"]
      }
    ];
    for (const s of samples) {
      expect(NodeSchema.safeParse(s).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes/discriminated-union`
Expected: FAIL — union rejects new kinds.

- [ ] **Step 3: Register in nodes/index.ts**

Add imports for the 5 new schemas and include them in the `z.discriminatedUnion("kind", [...])` array; add to any registry export (`nodeRegistry`) and type-exports that include the new types.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test nodes`
Expected: PASS across all node tests.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/nodes/index.ts packages/spec-graph-schema/test/nodes/discriminated-union.test.ts
git commit -m "feat(spec-graph-schema): register 5 v1.1 infra nodes in discriminated union"
```

---

### Task 8: runsOn edge schema

**Files:**
- Create: `packages/spec-graph-schema/src/edges/runs-on.ts`
- Test: `packages/spec-graph-schema/test/edges/runs-on.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RunsOnEdgeSchema } from "../../src/edges/runs-on.js";

describe("RunsOnEdgeSchema", () => {
  it("accepts a valid runsOn edge", () => {
    expect(RunsOnEdgeSchema.safeParse({
      type: "runsOn",
      from: "component:header",
      to: "runtime:node-22"
    }).success).toBe(true);
  });

  it("rejects wrong type discriminator", () => {
    expect(RunsOnEdgeSchema.safeParse({
      type: "dependsOn",
      from: "component:x",
      to: "runtime:y"
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test edges/runs-on`
Expected: FAIL.

- [ ] **Step 3: Create runs-on.ts**

```ts
import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const RunsOnEdgeSchema = z.object({
  type: z.literal("runsOn"),
  from: NodeIdSchema,
  to: NodeIdSchema,
  extensions: ExtensionsSchema.optional()
}).strict();

export type RunsOnEdge = z.infer<typeof RunsOnEdgeSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test edges/runs-on`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/edges/runs-on.ts packages/spec-graph-schema/test/edges/runs-on.test.ts
git commit -m "feat(spec-graph-schema): runsOn edge schema (v1.1)"
```

---

### Task 9: storesDataIn + migratesTo edge schemas

**Files:**
- Create: `packages/spec-graph-schema/src/edges/stores-data-in.ts`
- Create: `packages/spec-graph-schema/src/edges/migrates-to.ts`
- Test: extend `packages/spec-graph-schema/test/edges/runs-on.test.ts` with new describe blocks OR create two new files

- [ ] **Step 1: Write failing tests for both**

Create `packages/spec-graph-schema/test/edges/stores-data-in.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { StoresDataInEdgeSchema } from "../../src/edges/stores-data-in.js";

describe("StoresDataInEdgeSchema", () => {
  it("accepts model → region", () => {
    expect(StoresDataInEdgeSchema.safeParse({
      type: "storesDataIn",
      from: "model:user",
      to: "region:eu-west-1"
    }).success).toBe(true);
  });

  it("accepts model → dataresidency", () => {
    expect(StoresDataInEdgeSchema.safeParse({
      type: "storesDataIn",
      from: "model:user",
      to: "dataresidency:eu"
    }).success).toBe(true);
  });
});
```

Create `packages/spec-graph-schema/test/edges/migrates-to.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MigratesToEdgeSchema } from "../../src/edges/migrates-to.js";

describe("MigratesToEdgeSchema", () => {
  it("accepts source → target topology", () => {
    expect(MigratesToEdgeSchema.safeParse({
      type: "migratesTo",
      from: "workloadtopology:aws-us",
      to: "workloadtopology:ovh-eu"
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @atlas/spec-graph-schema test edges/stores-data-in edges/migrates-to`
Expected: FAIL.

- [ ] **Step 3: Create both edge files**

`packages/spec-graph-schema/src/edges/stores-data-in.ts`:
```ts
import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const StoresDataInEdgeSchema = z.object({
  type: z.literal("storesDataIn"),
  from: NodeIdSchema,
  to: NodeIdSchema,
  extensions: ExtensionsSchema.optional()
}).strict();

export type StoresDataInEdge = z.infer<typeof StoresDataInEdgeSchema>;
```

`packages/spec-graph-schema/src/edges/migrates-to.ts`:
```ts
import { z } from "zod";
import { NodeIdSchema, ExtensionsSchema } from "../primitives.js";

export const MigratesToEdgeSchema = z.object({
  type: z.literal("migratesTo"),
  from: NodeIdSchema,
  to: NodeIdSchema,
  extensions: ExtensionsSchema.optional()
}).strict();

export type MigratesToEdge = z.infer<typeof MigratesToEdgeSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @atlas/spec-graph-schema test edges/stores-data-in edges/migrates-to`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/edges/stores-data-in.ts packages/spec-graph-schema/src/edges/migrates-to.ts packages/spec-graph-schema/test/edges/stores-data-in.test.ts packages/spec-graph-schema/test/edges/migrates-to.test.ts
git commit -m "feat(spec-graph-schema): storesDataIn + migratesTo edges (v1.1)"
```

---

### Task 10: Register 3 new edges in edges/index.ts

**Files:**
- Modify: `packages/spec-graph-schema/src/edges/index.ts`
- Test: `packages/spec-graph-schema/test/edges/discriminated-union.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EdgeSchema, EDGE_TYPES } from "../../src/edges/index.js";

describe("EdgeSchema discriminated union — v1.1", () => {
  it("EDGE_TYPES includes 3 new infra edges", () => {
    expect(EDGE_TYPES).toContain("runsOn");
    expect(EDGE_TYPES).toContain("storesDataIn");
    expect(EDGE_TYPES).toContain("migratesTo");
  });

  it("accepts runsOn / storesDataIn / migratesTo through the union", () => {
    for (const type of ["runsOn", "storesDataIn", "migratesTo"] as const) {
      expect(EdgeSchema.safeParse({
        type,
        from: "component:x",
        to: "runtime:y"
      }).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test edges/discriminated-union`
Expected: FAIL.

- [ ] **Step 3: Register in edges/index.ts**

Add imports for the 3 new schemas and include them in `EDGE_TYPES` const + `EdgeSchema` discriminated union array.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test edges`
Expected: PASS across all edge tests.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/edges/index.ts packages/spec-graph-schema/test/edges/discriminated-union.test.ts
git commit -m "feat(spec-graph-schema): register 3 v1.1 infra edges in discriminated union"
```

---

### Task 11: Invariant I15 — WorkloadTopology references must resolve

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i15-workload-topology-references.ts`
- Modify: `packages/spec-graph-schema/src/invariants/runner.ts`, `packages/spec-graph-schema/src/invariants/index.ts`
- Test: `packages/spec-graph-schema/test/invariants/i15.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { i15WorkloadTopologyReferences } from "../../src/invariants/i15-workload-topology-references.js";

function makeGraph(nodes: Record<string, unknown>, edges: unknown[] = []): never {
  return { nodes, edges } as never;
}

describe("I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID", () => {
  it("passes when all refs resolve", () => {
    const graph = makeGraph({
      "provider:aws": { kind: "provider", id: "provider:aws", name: "aws", type: "hyperscaler", regionRefs: [] },
      "region:us-east-1": { kind: "region", id: "region:us-east-1", code: "us-east-1" },
      "workloadtopology:main": {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:us-east-1"]
      }
    });
    expect(i15WorkloadTopologyReferences(graph)).toEqual([]);
  });

  it("fails when providerRef is missing", () => {
    const graph = makeGraph({
      "region:us-east-1": { kind: "region", id: "region:us-east-1", code: "us-east-1" },
      "workloadtopology:main": {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:ghost"],
        regionRefs: ["region:us-east-1"]
      }
    });
    const issues = i15WorkloadTopologyReferences(graph);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.code).toBe("I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID");
  });

  it("fails when regionRef is missing", () => {
    const graph = makeGraph({
      "provider:aws": { kind: "provider", id: "provider:aws", name: "aws", type: "hyperscaler", regionRefs: [] },
      "workloadtopology:main": {
        kind: "workloadtopology",
        id: "workloadtopology:main",
        shape: "single-region",
        providerRefs: ["provider:aws"],
        regionRefs: ["region:ghost"]
      }
    });
    const issues = i15WorkloadTopologyReferences(graph);
    expect(issues.some((i) => i.code === "I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test invariants/i15`
Expected: FAIL — module not found.

- [ ] **Step 3: Create I15 invariant**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i15WorkloadTopologyReferences: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "workloadtopology") continue;
    for (const ref of node.providerRefs) {
      if (!graph.nodes[ref] || graph.nodes[ref]?.kind !== "provider") {
        issues.push({
          code: "I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID",
          message: `WorkloadTopology ${id} references missing provider "${ref}"`,
          path: ["nodes", id, "providerRefs"],
          nodeId: id
        });
      }
    }
    for (const ref of node.regionRefs) {
      if (!graph.nodes[ref] || graph.nodes[ref]?.kind !== "region") {
        issues.push({
          code: "I15_WORKLOAD_TOPOLOGY_REFERENCES_INVALID",
          message: `WorkloadTopology ${id} references missing region "${ref}"`,
          path: ["nodes", id, "regionRefs"],
          nodeId: id
        });
      }
    }
  }
  return issues;
};
```

Register in `invariants/runner.ts` and `invariants/index.ts` following the existing I01–I14 pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test invariants/i15`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/invariants/i15-workload-topology-references.ts packages/spec-graph-schema/src/invariants/runner.ts packages/spec-graph-schema/src/invariants/index.ts packages/spec-graph-schema/test/invariants/i15.test.ts
git commit -m "feat(spec-graph-schema): I15 WorkloadTopology references must resolve"
```

---

### Task 12: Invariant I16 — PII Model with residency needs storesDataIn

**Files:**
- Create: `packages/spec-graph-schema/src/invariants/i16-model-residency-requires-stores-data-in.ts`
- Modify: `packages/spec-graph-schema/src/invariants/runner.ts`, `packages/spec-graph-schema/src/invariants/index.ts`
- Test: `packages/spec-graph-schema/test/invariants/i16.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { i16ModelResidencyRequiresStoresDataIn } from "../../src/invariants/i16-model-residency-requires-stores-data-in.js";

function mkGraph(nodes: Record<string, unknown>, edges: unknown[] = []): never {
  return { nodes, edges } as never;
}

describe("I16_PII_MODEL_MISSING_STORES_DATA_IN", () => {
  it("passes when graph has no region/residency nodes (v1.0-shaped)", () => {
    const graph = mkGraph({
      "model:user": { kind: "model", id: "model:user", piiClassification: "direct" }
    });
    expect(i16ModelResidencyRequiresStoresDataIn(graph)).toEqual([]);
  });

  it("passes when PII model has storesDataIn to a region", () => {
    const graph = mkGraph(
      {
        "region:eu": { kind: "region", id: "region:eu", code: "eu" },
        "model:user": { kind: "model", id: "model:user", piiClassification: "direct" }
      },
      [{ type: "storesDataIn", from: "model:user", to: "region:eu" }]
    );
    expect(i16ModelResidencyRequiresStoresDataIn(graph)).toEqual([]);
  });

  it("fails when PII model lacks storesDataIn but graph has region", () => {
    const graph = mkGraph(
      {
        "region:eu": { kind: "region", id: "region:eu", code: "eu" },
        "model:user": { kind: "model", id: "model:user", piiClassification: "direct" }
      },
      []
    );
    const issues = i16ModelResidencyRequiresStoresDataIn(graph);
    expect(issues.length).toBe(1);
    expect(issues[0]?.code).toBe("I16_PII_MODEL_MISSING_STORES_DATA_IN");
  });

  it("ignores non-PII models (piiClassification=none)", () => {
    const graph = mkGraph(
      {
        "region:eu": { kind: "region", id: "region:eu", code: "eu" },
        "model:log": { kind: "model", id: "model:log", piiClassification: "none" }
      },
      []
    );
    expect(i16ModelResidencyRequiresStoresDataIn(graph)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/spec-graph-schema test invariants/i16`
Expected: FAIL.

- [ ] **Step 3: Create I16 invariant**

```ts
import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i16ModelResidencyRequiresStoresDataIn: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  const hasResidencyContext = Object.values(graph.nodes).some(
    (n) => n.kind === "region" || n.kind === "dataresidency"
  );
  if (!hasResidencyContext) return issues;

  const modelHasStoresDataIn = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "storesDataIn") modelHasStoresDataIn.add(edge.from);
  }

  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "model") continue;
    if (node.piiClassification === "none") continue;
    if (modelHasStoresDataIn.has(id)) continue;
    issues.push({
      code: "I16_PII_MODEL_MISSING_STORES_DATA_IN",
      message: `PII Model ${id} must declare a storesDataIn edge to a Region or DataResidency node`,
      path: ["nodes", id],
      nodeId: id
    });
  }
  return issues;
};
```

Register in `invariants/runner.ts` and `invariants/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/spec-graph-schema test invariants/i16`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-schema/src/invariants/i16-model-residency-requires-stores-data-in.ts packages/spec-graph-schema/src/invariants/runner.ts packages/spec-graph-schema/src/invariants/index.ts packages/spec-graph-schema/test/invariants/i16.test.ts
git commit -m "feat(spec-graph-schema): I16 PII Model with residency context needs storesDataIn"
```

---

### Task 13: Regenerate JSON Schema artifact + Python bindings

**Files:**
- Check: `packages/spec-graph-schema/scripts/generate-json-schema.mjs` (exists from B.1)
- Regenerate: `packages/spec-graph-schema/schema/spec-graph.schema.json`
- Regenerate: `packages/spec-graph-schema-py/src/spec_graph_schema/models.py`

- [ ] **Step 1: Run the artifact generator**

Run: `pnpm --filter @atlas/spec-graph-schema build && node packages/spec-graph-schema/scripts/generate-json-schema.mjs`
Expected: `packages/spec-graph-schema/schema/spec-graph.schema.json` now contains the 5 new node kinds + 3 new edge types + new invariant codes.

- [ ] **Step 2: Regenerate Python bindings**

Run: `pnpm py:gen`
Expected: `packages/spec-graph-schema-py/src/spec_graph_schema/models.py` regenerates with v1.1 schema.

- [ ] **Step 3: Run drift check + Python tests**

Run: `pnpm py:check && pnpm py:test`
Expected: drift check clean; Python tests pass.

- [ ] **Step 4: Commit regenerated artifacts**

```bash
git add packages/spec-graph-schema/schema/spec-graph.schema.json packages/spec-graph-schema-py/
git commit -m "build(spec-graph-schema): regenerate v1.1 JSON Schema + Python bindings"
```

---

### Task 14: README update

**Files:**
- Modify: `packages/spec-graph-schema/README.md`

- [ ] **Step 1: Add a v1.1 section to the README**

Document:
- New node kinds with one-line descriptions
- New edge types
- New invariants (I15, I16)
- schemaVersion handling (enum of "1.0.0" | "1.1.0"; v1.0 graphs remain valid)

- [ ] **Step 2: Commit**

```bash
git add packages/spec-graph-schema/README.md
git commit -m "docs(spec-graph-schema): document v1.1 infra nodes + edges + invariants"
```

---

### Task 15: Plan index update

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add a Phase B section + row**

Insert a new "## Phase B plans" section after the Phase A exit checklist, with a row:
```markdown
| 21 | `2026-04-21-spec-graph-v1.1-infra-nodes.md` | **B-1 — Spec Graph v1.1 infra nodes** | 5 new node kinds (Region, DataResidency, Runtime, Provider, WorkloadTopology) + 3 edges (runsOn, storesDataIn, migratesTo) + 2 invariants (I15, I16); schemaVersion enum for backward compat | 15 tasks, TDD | Shipped (merged <SHA>) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): mark B-1 shipped (merged <SHA>)"
```

---

## Completion Checklist

- [ ] Task 1: primitives — NODE_KINDS extended + schemaVersion enum
- [ ] Task 2: Region node
- [ ] Task 3: DataResidency node
- [ ] Task 4: Runtime node
- [ ] Task 5: Provider node
- [ ] Task 6: WorkloadTopology node
- [ ] Task 7: nodes/index.ts discriminated-union registration
- [ ] Task 8: runsOn edge
- [ ] Task 9: storesDataIn + migratesTo edges
- [ ] Task 10: edges/index.ts discriminated-union registration
- [ ] Task 11: I15 invariant
- [ ] Task 12: I16 invariant
- [ ] Task 13: JSON Schema + Python binding regen
- [ ] Task 14: README update
- [ ] Task 15: Plan index + Phase B section

---

## Handoff

Next Phase B plans in the chain:
- **B-8 — Browser Verification role** (independent of B-1, reuses dual-interface pattern from D.4/D.5).
- **B-7 — Additional compliance classes** (PCI-DSS, DPDP, LGPD) — authored alongside B-1.
- **B-2 — cloud_migration monorepo fusion** — consumes B-1's infra nodes.
- **B-9 — Migration Planner alpha** — depends on B-1.
