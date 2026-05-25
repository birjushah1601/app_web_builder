# Plan A — Core WorkflowEngine + Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the WorkflowEngine + Postgres persistence foundation so a DAG of stub-driven nodes can run end-to-end through plan → approve → execute → done, with checkpoints and crash-safe resume.

**Architecture:** New `packages/workflow-engine` orchestrates today's `RitualEngine` over a DAG. New Drizzle schemas (4 tables) persist workflow runs, nodes, checkpoints, usage. `RitualEngine` gains a single new method — `abort(ritualId)` — for cancellation. New Server Actions expose workflow lifecycle. A stub `workflow-planner` role returns a 1-node DAG so the engine can be exercised end-to-end without LLM dependencies.

**Tech Stack:** TypeScript pnpm monorepo, Postgres (Drizzle ORM), Zod, Vitest, the existing `RitualEngine` + `Conductor` + `EventBroker`.

**Spec reference:** [`docs/superpowers/specs/2026-05-26-multi-artifact-workflow-design.md`](../specs/2026-05-26-multi-artifact-workflow-design.md) — Sections 2, 4, 5, 6, 7, 11.

---

## File Structure

### New package: `packages/workflow-engine/`

| File | Responsibility |
|---|---|
| `package.json` | pnpm package manifest, deps on `@atlas/ritual-engine`, `@atlas/llm-provider`, `drizzle-orm`, `zod` |
| `tsconfig.json` | TS config matching other packages (ESM, strict, noEmit:false) |
| `src/index.ts` | Public exports: `WorkflowEngine`, types, errors |
| `src/types.ts` | `WorkflowNode`, `WorkflowRun`, `WorkflowRunSnapshot`, `NodePolicy`, `NodeStatus`, `WorkflowStatus` Zod schemas + TS types |
| `src/artifact-contracts/index.ts` | Re-exports per-kind schemas |
| `src/artifact-contracts/generic.ts` | Generic fallback schema `{schemaVersion, kind, payload}` |
| `src/artifact-contracts/parse.ts` | `parseWorkflowArtifact(priorArtifact, expectedKind)` helper |
| `src/dag.ts` | DAG utilities: cycle detection, topological sort, ready-node finder |
| `src/scheduler.ts` | `WorkflowScheduler` — the execution loop |
| `src/checkpoints.ts` | `CheckpointRecorder` — subscribes to broker, writes checkpoint rows |
| `src/engine.ts` | `WorkflowEngine` class — public API |
| `src/errors.ts` | `WorkflowNotFoundError`, `WorkflowAlreadyApprovedError`, `NodeNotFoundError`, etc. |
| `src/stub-planner-role.ts` | Stub `workflow-planner` role for Plan A integration tests |
| `test/dag.test.ts` | Cycle detection, topo sort, ready-node selection |
| `test/scheduler.test.ts` | Scheduler loop unit tests with mocked RitualEngine |
| `test/checkpoints.test.ts` | Checkpoint recorder unit tests |
| `test/engine.test.ts` | WorkflowEngine class unit tests |
| `test/artifact-contracts.test.ts` | Per-kind schema validation tests |
| `test/integration.test.ts` | End-to-end: stub role → DAG → run → checkpoints → resume |
| `test/fixtures/dags.ts` | Sample DAGs: chain, fan-out, fan-in, diamond |

### New Drizzle schemas in `packages/spec-graph-data/src/schema/`

| File | Responsibility |
|---|---|
| `workflow-runs.ts` | `workflow_runs` table |
| `workflow-nodes.ts` | `workflow_nodes` table |
| `workflow-node-checkpoints.ts` | `workflow_node_checkpoints` table |
| `workflow-usage.ts` | `workflow_usage` table |

### New repos in `packages/spec-graph-data/src/repo/`

| File | Responsibility |
|---|---|
| `workflow-run.repo.ts` | CRUD for `workflow_runs` |
| `workflow-node.repo.ts` | CRUD for `workflow_nodes` + bulk insert/update |
| `workflow-checkpoint.repo.ts` | Append + scan checkpoints |
| `workflow-usage.repo.ts` | Append usage rows + sum by workflow |

### Modifications to existing packages

| File | Change |
|---|---|
| `packages/spec-graph-data/src/schema/index.ts` | Export the 4 new schemas |
| `packages/spec-graph-data/src/repo/index.ts` (or wherever exports live) | Export the 4 new repos |
| `packages/spec-graph-data/migrations/000X_workflow_tables.sql` | New SQL migration creating the 4 tables |
| `packages/ritual-engine/src/engine.ts` | Add `abort(ritualId)` method |
| `packages/ritual-engine/src/errors.ts` | Add `RitualAbortedError` |
| `packages/ritual-engine/src/index.ts` | Export `RitualAbortedError` |
| `packages/conductor/src/conductor.ts` | Check cancelled flag at role-attempt boundary; throw `RitualAbortedError` |
| `apps/atlas-web/lib/engine/factory.ts` | Construct `WorkflowEngine` alongside `RitualEngine`; share broker/db |
| `apps/atlas-web/lib/actions/startWorkflow.ts` | New Server Action |
| `apps/atlas-web/lib/actions/approveWorkflowPlan.ts` | New |
| `apps/atlas-web/lib/actions/retryNode.ts` | New |
| `apps/atlas-web/lib/actions/abortWorkflow.ts` | New |
| `apps/atlas-web/lib/actions/setNodePolicy.ts` | New |
| `apps/atlas-web/lib/actions/deferNode.ts` | New |
| `apps/atlas-web/lib/actions/resumeDeferredNode.ts` | New |
| `apps/atlas-web/lib/actions/getWorkflowRun.ts` | New |
| `apps/atlas-web/lib/actions/getWorkflowEventLog.ts` | New |
| `apps/atlas-web/lib/feature-flags.ts` | Add `ATLAS_FF_WORKFLOW` flag (no UI effect yet — gates the Server Actions throwing UNAVAILABLE when off) |

---

## Tasks

### Task 1: Scaffold packages/workflow-engine

**Files:**
- Create: `packages/workflow-engine/package.json`
- Create: `packages/workflow-engine/tsconfig.json`
- Create: `packages/workflow-engine/vitest.config.ts`
- Create: `packages/workflow-engine/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@atlas/workflow-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@atlas/ritual-engine": "workspace:*",
    "@atlas/llm-provider": "workspace:*",
    "@atlas/conductor": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.8",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json (mirror packages/ritual-engine)**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: Create src/index.ts as a placeholder**

```ts
// Re-exports populated in later tasks.
export {};
```

- [ ] **Step 5: Install & verify build**

```bash
pnpm install
pnpm --filter @atlas/workflow-engine build
```

Expected: build succeeds, `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-engine
git commit -m "feat(workflow-engine): scaffold package skeleton"
```

---

### Task 2: Workflow + Node Zod types

**Files:**
- Create: `packages/workflow-engine/src/types.ts`
- Test: `packages/workflow-engine/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/types.test.ts
import { describe, it, expect } from "vitest";
import {
  NodePolicySchema,
  WorkflowNodeSchema,
  WorkflowRunSchema,
  type WorkflowNode,
  type WorkflowRun
} from "../src/types.js";

describe("Workflow Zod types", () => {
  it("NodePolicySchema accepts active runMode with priority 0", () => {
    const ok = NodePolicySchema.safeParse({ priority: 0, runMode: "active" });
    expect(ok.success).toBe(true);
  });

  it("NodePolicySchema rejects invalid runMode", () => {
    const bad = NodePolicySchema.safeParse({ priority: 0, runMode: "weird" });
    expect(bad.success).toBe(false);
  });

  it("WorkflowNodeSchema validates a minimal pending node", () => {
    const ok = WorkflowNodeSchema.safeParse({
      id: "n1",
      artifactKind: "frontend-app",
      summary: "Build the landing page",
      dependsOn: [],
      consumes: [],
      policy: { priority: 0, runMode: "active" },
      status: "pending"
    });
    expect(ok.success).toBe(true);
  });

  it("WorkflowNodeSchema rejects consumes that's not a subset of dependsOn", () => {
    const node: WorkflowNode = {
      id: "n2",
      artifactKind: "frontend-app",
      summary: "x",
      dependsOn: ["n1"],
      consumes: ["n1", "n99"], // n99 not in dependsOn
      policy: { priority: 0, runMode: "active" },
      status: "pending"
    };
    const result = WorkflowNodeSchema.safeParse(node);
    expect(result.success).toBe(false);
  });

  it("WorkflowRunSchema accepts a minimal run", () => {
    const run: WorkflowRun = {
      id: "00000000-0000-0000-0000-000000000001",
      projectId: "00000000-0000-0000-0000-000000000002",
      userId: "user_test",
      prompt: "Build me a SaaS",
      status: "planning",
      nodes: [],
      edges: [],
      dependencyProfile: { schemaVersion: "1", auth: { provider: "none" } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const ok = WorkflowRunSchema.safeParse(run);
    expect(ok.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @atlas/workflow-engine test
```

Expected: FAIL with "Cannot find module ../src/types.js"

- [ ] **Step 3: Implement src/types.ts**

```ts
// src/types.ts
import { z } from "zod";

export const NodeStatusSchema = z.enum([
  "pending", "ready", "running", "done", "failed", "skipped", "blocked"
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeRunModeSchema = z.enum(["active", "background", "deferred"]);
export type NodeRunMode = z.infer<typeof NodeRunModeSchema>;

export const NodePolicySchema = z.object({
  priority: z.number().int().min(0).default(0),
  runMode: NodeRunModeSchema,
  timeoutMs: z.number().int().positive().optional()
});
export type NodePolicy = z.infer<typeof NodePolicySchema>;

// Minimal DependencyProfile placeholder. Plan B fleshes out the per-provider
// fields. Plan A only requires the schema to round-trip; values can be empty.
export const DependencyProfileSchema = z.object({
  schemaVersion: z.literal("1"),
  auth: z.object({
    provider: z.enum(["keycloak", "clerk", "better-auth", "lucia", "none"]),
    config: z.record(z.unknown()).optional()
  }).optional(),
  db: z.object({
    provider: z.enum(["postgres", "neon", "supabase"]),
    connectionStringEnvVar: z.string()
  }).optional(),
  storage: z.object({
    provider: z.enum(["minio", "s3"]),
    bucketEnvVar: z.string()
  }).optional()
  // Plan B extends with email, jobs, payments, search, errorTracking, analytics, featureFlags
}).passthrough();
export type DependencyProfile = z.infer<typeof DependencyProfileSchema>;

export const ArtifactRefSchema = z.object({
  schemaVersion: z.string(),
  location: z.literal("inline") // Plan A stores artifacts inline in workflow_nodes.artifact
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const NodeFailureSchema = z.object({
  error: z.string(),
  attempts: z.number().int().nonnegative(),
  lastCheckpointId: z.string().uuid().optional()
});
export type NodeFailure = z.infer<typeof NodeFailureSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  artifactKind: z.string().min(1), // "frontend-app" | "backend-rest-api" | ... | "workflow-planner"
  summary: z.string(),
  dependsOn: z.array(z.string()),
  consumes: z.array(z.string()),
  policy: NodePolicySchema,
  status: NodeStatusSchema,
  ritualId: z.string().optional(),
  artifactRef: ArtifactRefSchema.optional(),
  artifact: z.unknown().optional(), // typed payload; validated against artifact-contracts on assignment
  failure: NodeFailureSchema.optional()
}).superRefine((node, ctx) => {
  // consumes MUST be a subset of dependsOn (Section 5 invariant)
  const depSet = new Set(node.dependsOn);
  for (const c of node.consumes) {
    if (!depSet.has(c)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consumes"],
        message: `consumes entry "${c}" is not in dependsOn`
      });
    }
  }
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowStatusSchema = z.enum([
  "planning", "awaiting_approval", "running", "completed", "escalated", "aborted"
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string()
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().min(1),
  prompt: z.string(),
  status: WorkflowStatusSchema,
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  dependencyProfile: DependencyProfileSchema,
  concurrencyCap: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export type WorkflowRunSnapshot = WorkflowRun;
```

- [ ] **Step 4: Run tests to verify passing**

```bash
pnpm --filter @atlas/workflow-engine test
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow-engine/src/types.ts packages/workflow-engine/test/types.test.ts
git commit -m "feat(workflow-engine): WorkflowRun/Node/Policy Zod schemas with consumes⊆dependsOn invariant"
```

---

### Task 3: DAG utilities (cycle detection, topo sort, ready nodes)

**Files:**
- Create: `packages/workflow-engine/src/dag.ts`
- Create: `packages/workflow-engine/test/dag.test.ts`
- Create: `packages/workflow-engine/test/fixtures/dags.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/dag.test.ts
import { describe, it, expect } from "vitest";
import { detectCycle, topoSort, findReadyNodes } from "../src/dag.js";
import type { WorkflowNode } from "../src/types.js";
import { chain, fanOut, fanIn, diamond, withCycle } from "./fixtures/dags.js";

describe("detectCycle", () => {
  it("returns null for an acyclic DAG", () => {
    expect(detectCycle(chain())).toBeNull();
    expect(detectCycle(diamond())).toBeNull();
  });
  it("returns the cycle path when there is one", () => {
    const cycle = detectCycle(withCycle());
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThan(0);
  });
});

describe("topoSort", () => {
  it("returns a valid topological order for a chain", () => {
    const order = topoSort(chain());
    expect(order.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
  it("returns parents before children for a diamond", () => {
    const order = topoSort(diamond()).map((n) => n.id);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("a")).toBeLessThan(idx("b"));
    expect(idx("a")).toBeLessThan(idx("c"));
    expect(idx("b")).toBeLessThan(idx("d"));
    expect(idx("c")).toBeLessThan(idx("d"));
  });
  it("throws on a cyclic graph", () => {
    expect(() => topoSort(withCycle())).toThrow(/cycle/i);
  });
});

describe("findReadyNodes", () => {
  it("a fresh chain returns only the root", () => {
    const ready = findReadyNodes(chain());
    expect(ready.map((n) => n.id)).toEqual(["a"]);
  });
  it("after root done, returns the next node", () => {
    const nodes = chain();
    nodes[0]!.status = "done";
    const ready = findReadyNodes(nodes);
    expect(ready.map((n) => n.id)).toEqual(["b"]);
  });
  it("returns multiple ready nodes when fan-out", () => {
    const nodes = fanOut();
    nodes[0]!.status = "done";
    const ready = findReadyNodes(nodes);
    expect(ready.map((n) => n.id).sort()).toEqual(["b", "c"]);
  });
  it("skips deferred nodes", () => {
    const nodes = chain();
    nodes[0]!.policy.runMode = "deferred";
    const ready = findReadyNodes(nodes);
    expect(ready).toEqual([]);
  });
  it("blocks nodes whose dependency failed", () => {
    const nodes = chain();
    nodes[0]!.status = "failed";
    const ready = findReadyNodes(nodes);
    expect(ready).toEqual([]);
  });
});
```

- [ ] **Step 2: Create the fixtures file**

```ts
// test/fixtures/dags.ts
import type { WorkflowNode } from "../../src/types.js";

const policy = { priority: 0, runMode: "active" as const };

export function chain(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["b"], consumes: ["b"], policy, status: "pending" }
  ];
}

export function fanOut(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" }
  ];
}

export function fanIn(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["a", "b"], consumes: ["a", "b"], policy, status: "pending" }
  ];
}

export function diamond(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: [], consumes: [], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "d", artifactKind: "frontend-app", summary: "d", dependsOn: ["b", "c"], consumes: ["b", "c"], policy, status: "pending" }
  ];
}

export function withCycle(): WorkflowNode[] {
  return [
    { id: "a", artifactKind: "frontend-app", summary: "a", dependsOn: ["c"], consumes: ["c"], policy, status: "pending" },
    { id: "b", artifactKind: "frontend-app", summary: "b", dependsOn: ["a"], consumes: ["a"], policy, status: "pending" },
    { id: "c", artifactKind: "frontend-app", summary: "c", dependsOn: ["b"], consumes: ["b"], policy, status: "pending" }
  ];
}
```

- [ ] **Step 3: Run tests to verify failure**

```bash
pnpm --filter @atlas/workflow-engine test
```

Expected: FAIL with "Cannot find module ../src/dag.js"

- [ ] **Step 4: Implement src/dag.ts**

```ts
// src/dag.ts
import type { WorkflowNode } from "./types.js";

/** DFS cycle detection. Returns the cycle path if found, or null. */
export function detectCycle(nodes: ReadonlyArray<WorkflowNode>): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        const c = color.get(dep) ?? WHITE;
        if (c === GRAY) {
          const cycleStart = stack.indexOf(dep);
          return cycleStart === -1 ? [...stack, dep] : stack.slice(cycleStart).concat(dep);
        }
        if (c === WHITE) {
          const r = visit(dep);
          if (r) return r;
        }
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  }

  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) {
      const r = visit(n.id);
      if (r) return r;
    }
  }
  return null;
}

/** Kahn's algorithm. Throws if a cycle exists. */
export function topoSort(nodes: ReadonlyArray<WorkflowNode>): WorkflowNode[] {
  const cycle = detectCycle(nodes);
  if (cycle) throw new Error(`topoSort: cycle detected: ${cycle.join(" → ")}`);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const n of nodes) for (const dep of n.dependsOn) {
    if (byId.has(n.id)) inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
    void dep;
  }
  // Compute in-degree relative to other nodes in this set
  inDegree.clear();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (byId.has(dep)) inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
    }
  }
  const queue: WorkflowNode[] = [];
  for (const n of nodes) if ((inDegree.get(n.id) ?? 0) === 0) queue.push(n);

  const result: WorkflowNode[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    result.push(n);
    for (const m of nodes) {
      if (m.dependsOn.includes(n.id)) {
        const d = (inDegree.get(m.id) ?? 0) - 1;
        inDegree.set(m.id, d);
        if (d === 0) queue.push(m);
      }
    }
  }
  if (result.length !== nodes.length) throw new Error(`topoSort: cycle detected (incomplete sort)`);
  return result;
}

/** Nodes that are pending, not deferred, and have all dependsOn `done`. */
export function findReadyNodes(nodes: ReadonlyArray<WorkflowNode>): WorkflowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.filter((n) => {
    if (n.status !== "pending") return false;
    if (n.policy.runMode === "deferred") return false;
    return n.dependsOn.every((dep) => byId.get(dep)?.status === "done");
  });
}
```

- [ ] **Step 5: Run tests to verify passing**

```bash
pnpm --filter @atlas/workflow-engine test
```

Expected: all dag tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/workflow-engine/src/dag.ts packages/workflow-engine/test/dag.test.ts packages/workflow-engine/test/fixtures/dags.ts
git commit -m "feat(workflow-engine): DAG utilities (cycle detection, topo sort, ready-node finder)"
```

---

### Task 4: Drizzle schemas for the 4 workflow tables

**Files:**
- Create: `packages/spec-graph-data/src/schema/workflow-runs.ts`
- Create: `packages/spec-graph-data/src/schema/workflow-nodes.ts`
- Create: `packages/spec-graph-data/src/schema/workflow-node-checkpoints.ts`
- Create: `packages/spec-graph-data/src/schema/workflow-usage.ts`
- Modify: `packages/spec-graph-data/src/schema/index.ts`

- [ ] **Step 1: Create workflow-runs.ts**

```ts
// packages/spec-graph-data/src/schema/workflow-runs.ts
import { integer, jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
    prompt: text("prompt").notNull(),
    status: text("status").notNull(),
    concurrencyCap: integer("concurrency_cap"),
    dependencyProfile: jsonb("dependency_profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxProject: index("idx_workflow_runs_project").on(t.projectId, t.createdAt),
    idxStatus: index("idx_workflow_runs_status").on(t.status)
  })
);

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;
```

- [ ] **Step 2: Create workflow-nodes.ts**

```ts
// packages/spec-graph-data/src/schema/workflow-nodes.ts
import { jsonb, pgTable, text, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";
import { workflowRuns } from "./workflow-runs.js";

export const workflowNodes = pgTable(
  "workflow_nodes",
  {
    id: text("id").notNull(),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    artifactKind: text("artifact_kind").notNull(),
    summary: text("summary").notNull(),
    dependsOn: jsonb("depends_on").notNull().default([]),
    consumes: jsonb("consumes").notNull().default([]),
    policy: jsonb("policy").notNull(),
    status: text("status").notNull(),
    ritualId: text("ritual_id"),
    artifact: jsonb("artifact"),
    artifactSchemaVersion: text("artifact_schema_version"),
    failure: jsonb("failure"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workflowRunId, t.id] })
  })
);

export type WorkflowNodeRow = typeof workflowNodes.$inferSelect;
export type NewWorkflowNodeRow = typeof workflowNodes.$inferInsert;
```

- [ ] **Step 3: Create workflow-node-checkpoints.ts**

```ts
// packages/spec-graph-data/src/schema/workflow-node-checkpoints.ts
import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workflowRuns } from "./workflow-runs.js";

export const workflowNodeCheckpoints = pgTable(
  "workflow_node_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    ritualEventId: text("ritual_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxRunNode: index("idx_workflow_checkpoints_run_node").on(t.workflowRunId, t.nodeId, t.createdAt)
  })
);

export type WorkflowCheckpointRow = typeof workflowNodeCheckpoints.$inferSelect;
export type NewWorkflowCheckpointRow = typeof workflowNodeCheckpoints.$inferInsert;
```

- [ ] **Step 4: Create workflow-usage.ts**

```ts
// packages/spec-graph-data/src/schema/workflow-usage.ts
import { bigint, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { workflowRuns } from "./workflow-runs.js";

export const workflowUsage = pgTable(
  "workflow_usage",
  {
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    idxRun: index("idx_workflow_usage_run").on(t.workflowRunId, t.recordedAt)
  })
);

export type WorkflowUsageRow = typeof workflowUsage.$inferSelect;
export type NewWorkflowUsageRow = typeof workflowUsage.$inferInsert;
```

- [ ] **Step 5: Update schema/index.ts to export the new tables**

```ts
// packages/spec-graph-data/src/schema/index.ts — append
export * from "./workflow-runs.js";
export * from "./workflow-nodes.js";
export * from "./workflow-node-checkpoints.js";
export * from "./workflow-usage.js";
```

- [ ] **Step 6: Build spec-graph-data**

```bash
pnpm --filter @atlas/spec-graph-data build
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-data/src/schema/workflow-runs.ts packages/spec-graph-data/src/schema/workflow-nodes.ts packages/spec-graph-data/src/schema/workflow-node-checkpoints.ts packages/spec-graph-data/src/schema/workflow-usage.ts packages/spec-graph-data/src/schema/index.ts
git commit -m "feat(spec-graph-data): Drizzle schemas for workflow_runs/nodes/checkpoints/usage"
```

---

### Task 5: SQL migration file

**Files:**
- Determine the migrations dir from existing project (check `drizzle.config.ts` or the closest convention).
- Create: appropriately-numbered `.sql` file under that dir (e.g., `migrations/0008_workflow_tables.sql` — the engineer determines the next number by listing the existing migrations).

- [ ] **Step 1: Identify the migrations directory**

```bash
find . -path ./node_modules -prune -o \( -name '*.sql' -o -name 'drizzle.config*' \) -print | head -20
ls -la <path-discovered>
```

- [ ] **Step 2: Write the migration SQL**

```sql
-- migrations/<next-num>_workflow_tables.sql
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id text not null,
  prompt text not null,
  status text not null,
  concurrency_cap integer,
  dependency_profile jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workflow_runs_project on workflow_runs (project_id, created_at);
create index if not exists idx_workflow_runs_status on workflow_runs (status);

create table if not exists workflow_nodes (
  id text not null,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  artifact_kind text not null,
  summary text not null,
  depends_on jsonb not null default '[]'::jsonb,
  consumes jsonb not null default '[]'::jsonb,
  policy jsonb not null,
  status text not null,
  ritual_id text,
  artifact jsonb,
  artifact_schema_version text,
  failure jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  primary key (workflow_run_id, id)
);

create table if not exists workflow_node_checkpoints (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  kind text not null,
  payload jsonb not null,
  ritual_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_workflow_checkpoints_run_node on workflow_node_checkpoints (workflow_run_id, node_id, created_at);

create table if not exists workflow_usage (
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,4) not null default 0,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_workflow_usage_run on workflow_usage (workflow_run_id, recorded_at);
```

- [ ] **Step 3: Apply migration against local Postgres**

```bash
# Whatever the project's migrate command is — discover via package.json scripts:
pnpm -w run migrate
# OR via psql directly if there's no script:
psql "$DATABASE_URL" -f migrations/<file>.sql
```

Expected: 4 tables created. Verify with:
```bash
psql "$DATABASE_URL" -c "\dt workflow_*"
```

- [ ] **Step 4: Commit**

```bash
git add migrations/<file>.sql
git commit -m "feat(migrations): add workflow_runs/nodes/checkpoints/usage tables"
```

---

### Task 6: Per-table repos (workflow-run.repo.ts)

**Files:**
- Create: `packages/spec-graph-data/src/repo/workflow-run.repo.ts`
- Test: `packages/spec-graph-data/test/workflow-run.repo.test.ts`

- [ ] **Step 1: Write the failing test** (integration test against a test DB — follow the pattern in existing `*.repo.test.ts` files)

Check existing repo test setup:
```bash
ls packages/spec-graph-data/test/
cat packages/spec-graph-data/test/spec-event.repo.test.ts | head -40
```

Mirror that setup. Tests should cover:
- `insert(input)` returns the inserted row with `id`
- `findById(id)` returns the row or undefined
- `listOpenForProject(projectId)` returns runs whose status is `running` or `awaiting_approval`
- `updateStatus(id, status)` updates `status` + `updated_at`

- [ ] **Step 2: Implement workflow-run.repo.ts**

```ts
// packages/spec-graph-data/src/repo/workflow-run.repo.ts
import { and, eq, inArray, desc } from "drizzle-orm";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { workflowRuns, type WorkflowRunRow, type NewWorkflowRunRow } from "../schema/workflow-runs.js";

export class WorkflowRunRepo {
  private db: ReturnType<typeof drizzle>;
  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async insert(input: NewWorkflowRunRow): Promise<WorkflowRunRow> {
    const [row] = await this.db.insert(workflowRuns).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<WorkflowRunRow | undefined> {
    const [row] = await this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1);
    return row;
  }

  async listOpenForProject(projectId: string): Promise<WorkflowRunRow[]> {
    return this.db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.projectId, projectId), inArray(workflowRuns.status, ["running", "awaiting_approval"])))
      .orderBy(desc(workflowRuns.createdAt));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(workflowRuns)
      .set({ status, updatedAt: new Date() })
      .where(eq(workflowRuns.id, id));
  }
}
```

- [ ] **Step 3: Run tests to verify passing**

```bash
pnpm --filter @atlas/spec-graph-data test workflow-run.repo
```

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-data/src/repo/workflow-run.repo.ts packages/spec-graph-data/test/workflow-run.repo.test.ts
git commit -m "feat(spec-graph-data): WorkflowRunRepo (insert/findById/listOpen/updateStatus)"
```

---

### Task 7: WorkflowNodeRepo + WorkflowCheckpointRepo + WorkflowUsageRepo

Follow Task 6's pattern for each of the remaining 3 repos:

**WorkflowNodeRepo** methods:
- `insertMany(rows)` — bulk insert at workflow creation
- `findByRunId(runId)` — returns all nodes for a run
- `findOne(runId, nodeId)` — single node lookup
- `updateStatus(runId, nodeId, status, opts?)` — set status + optionally `ritualId`, `startedAt`, `completedAt`, `failure`
- `setArtifact(runId, nodeId, artifact, schemaVersion)` — write the artifact on completion
- `updatePolicy(runId, nodeId, policy)` — used by `setNodePolicy` action

**WorkflowCheckpointRepo** methods:
- `append(row)` — insert checkpoint
- `listForNode(runId, nodeId)` — chronological history
- `listForRun(runId)` — chronological history for the entire workflow

**WorkflowUsageRepo** methods:
- `append(row)` — insert usage event
- `sumForRun(runId)` — `{inputTokens, outputTokens, costUsd}` aggregate

Each gets its own test file with insert/read coverage. Same commit-per-repo pattern.

- [ ] Implement WorkflowNodeRepo + test + commit
- [ ] Implement WorkflowCheckpointRepo + test + commit
- [ ] Implement WorkflowUsageRepo + test + commit

---

### Task 8: artifact-contracts (generic + parse helper)

**Files:**
- Create: `packages/workflow-engine/src/artifact-contracts/generic.ts`
- Create: `packages/workflow-engine/src/artifact-contracts/index.ts`
- Create: `packages/workflow-engine/src/artifact-contracts/parse.ts`
- Test: `packages/workflow-engine/test/artifact-contracts.test.ts`

- [ ] **Step 1: Write the test**

```ts
// test/artifact-contracts.test.ts
import { describe, it, expect } from "vitest";
import { GenericArtifactSchema, parseWorkflowArtifact, ArtifactContractRegistry } from "../src/artifact-contracts/index.js";

describe("GenericArtifactSchema", () => {
  it("accepts well-formed generic artifact", () => {
    const ok = GenericArtifactSchema.safeParse({ schemaVersion: "1", kind: "unknown-kind", payload: { x: 1 } });
    expect(ok.success).toBe(true);
  });
  it("rejects when schemaVersion is missing", () => {
    const bad = GenericArtifactSchema.safeParse({ kind: "x", payload: {} });
    expect(bad.success).toBe(false);
  });
});

describe("parseWorkflowArtifact", () => {
  it("validates against a registered schema", () => {
    ArtifactContractRegistry.register("test-kind", GenericArtifactSchema);
    const parsed = parseWorkflowArtifact(
      { schemaVersion: "1", kind: "test-kind", payload: { ok: true } },
      "test-kind"
    );
    expect(parsed).toBeTruthy();
  });
  it("falls back to generic for unknown kinds", () => {
    const parsed = parseWorkflowArtifact(
      { schemaVersion: "1", kind: "brand-new-kind", payload: {} },
      "brand-new-kind"
    );
    expect((parsed as any).kind).toBe("brand-new-kind");
  });
  it("throws on schema version mismatch", () => {
    ArtifactContractRegistry.register("v1-kind", GenericArtifactSchema);
    expect(() =>
      parseWorkflowArtifact({ schemaVersion: "99", kind: "v1-kind", payload: {} }, "v1-kind")
    ).toThrow(/schema version/i);
  });
});
```

- [ ] **Step 2: Implement generic.ts**

```ts
// src/artifact-contracts/generic.ts
import { z } from "zod";

export const GenericArtifactSchema = z.object({
  schemaVersion: z.string().min(1),
  kind: z.string().min(1),
  payload: z.unknown()
});
export type GenericArtifact = z.infer<typeof GenericArtifactSchema>;
```

- [ ] **Step 3: Implement index.ts (registry + re-exports)**

```ts
// src/artifact-contracts/index.ts
import type { z } from "zod";
import { GenericArtifactSchema } from "./generic.js";

type AnyArtifactSchema = z.ZodTypeAny;

class Registry {
  private map = new Map<string, AnyArtifactSchema>();
  register(kind: string, schema: AnyArtifactSchema): void {
    this.map.set(kind, schema);
  }
  get(kind: string): AnyArtifactSchema | undefined {
    return this.map.get(kind);
  }
  has(kind: string): boolean {
    return this.map.has(kind);
  }
}

export const ArtifactContractRegistry = new Registry();
export { GenericArtifactSchema };
export { parseWorkflowArtifact } from "./parse.js";
```

- [ ] **Step 4: Implement parse.ts**

```ts
// src/artifact-contracts/parse.ts
import { ArtifactContractRegistry, GenericArtifactSchema } from "./index.js";

const KNOWN_VERSIONS = ["1"];

export function parseWorkflowArtifact(value: unknown, expectedKind: string): unknown {
  const schema = ArtifactContractRegistry.get(expectedKind) ?? GenericArtifactSchema;
  const parsed = schema.parse(value);
  const version = (parsed as { schemaVersion?: string }).schemaVersion;
  if (version && !KNOWN_VERSIONS.includes(version)) {
    throw new Error(`parseWorkflowArtifact: unknown schema version "${version}" for kind "${expectedKind}"`);
  }
  return parsed;
}
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm --filter @atlas/workflow-engine test artifact-contracts
git add packages/workflow-engine/src/artifact-contracts packages/workflow-engine/test/artifact-contracts.test.ts
git commit -m "feat(workflow-engine): artifact-contract registry + generic fallback + parse helper"
```

---

### Task 9: RitualEngine.abort() + RitualAbortedError

**Files:**
- Modify: `packages/ritual-engine/src/errors.ts`
- Modify: `packages/ritual-engine/src/engine.ts`
- Modify: `packages/ritual-engine/src/index.ts`
- Modify: `packages/conductor/src/conductor.ts`
- Test: `packages/ritual-engine/test/engine-abort.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ritual-engine/test/engine-abort.test.ts
import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, RitualAbortedError } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";

const personaPrefs = { getPersona: async () => "diego" as const };

describe("RitualEngine.abort", () => {
  it("aborts an in-flight ritual; subsequent role attempts throw RitualAbortedError", async () => {
    const sink = new InMemoryEventSink();
    let attemptsBeforeAbort = 0;
    const slowRole: Role = {
      id: "architect",
      async run() {
        attemptsBeforeAbort++;
        await new Promise((r) => setTimeout(r, 30));
        return { events: [], diff: { kind: "none" as const } };
      }
    };
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map([["architect", slowRole]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });
    const engine = new RitualEngine({
      conductor, eventSink: sink, personaPreferences: personaPrefs, ritualMode: "fast"
    });

    const startPromise = engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    // Give the architect attempt #1 a moment to start, then abort
    await new Promise((r) => setTimeout(r, 10));
    const ritualId = Array.from((engine as any).rituals.keys())[0] as string;
    await engine.abort(ritualId, "test-abort");

    await startPromise; // resolves cleanly even when aborted
    expect(attemptsBeforeAbort).toBeGreaterThan(0);
    // No more attempts after abort — record should reflect aborted state
    const snapshot = await engine.getRitual(ritualId);
    expect(snapshot?.state === "escalated" || (snapshot as any)?.state === "aborted").toBe(true);
  });
});
```

- [ ] **Step 2: Add RitualAbortedError**

```ts
// packages/ritual-engine/src/errors.ts — append
export class RitualAbortedError extends Error {
  constructor(public readonly ritualId: string, public readonly reason: string) {
    super(`Ritual ${ritualId} aborted: ${reason}`);
    this.name = "RitualAbortedError";
  }
}
```

- [ ] **Step 3: Track aborted ritualIds in RitualEngine + add abort()**

```ts
// packages/ritual-engine/src/engine.ts — add to RitualEngine class

private readonly aborted = new Set<string>();

/** Plan A — mark a ritual as aborted. The next role attempt for this ritualId
 *  will throw RitualAbortedError; any pending canvas-pause waiter is disposed. */
async abort(ritualId: string, _reason: string): Promise<void> {
  this.aborted.add(ritualId);
  this.canvasPauseRegistry?.dispose(ritualId);
}

/** Check from the conductor before a role attempt. */
isAborted(ritualId: string): boolean {
  return this.aborted.has(ritualId);
}
```

- [ ] **Step 4: Thread the abort check through to the conductor**

In the conductor's dispatch loop, before each role attempt, check the abort flag via an injected callback. Inspect existing wiring of conductor → engine signals (today: events sink). Add a new optional `isAborted: (ritualId: string) => boolean` to `ConductorOptions`; conductor checks it at each role-attempt boundary and throws `RitualAbortedError` if set.

Engine factory wires `isAborted: (id) => engine.isAborted(id)` into the conductor.

- [ ] **Step 5: Export new error**

```ts
// packages/ritual-engine/src/index.ts — append
export { RitualAbortedError } from "./errors.js";
```

- [ ] **Step 6: Run tests + commit**

```bash
pnpm --filter @atlas/ritual-engine test engine-abort
pnpm --filter @atlas/ritual-engine test  # full suite — no regressions
git add packages/ritual-engine packages/conductor
git commit -m "feat(ritual-engine): RitualEngine.abort() + RitualAbortedError"
```

---

### Task 10: Stub workflow-planner role

**Files:**
- Create: `packages/workflow-engine/src/stub-planner-role.ts`
- Test: `packages/workflow-engine/test/stub-planner-role.test.ts`

This role exists so Plan A's integration tests can drive the full workflow lifecycle without LLM dependencies. Plan B replaces it with the real LLM-driven planner.

- [ ] **Step 1: Implement stub-planner-role.ts**

```ts
// src/stub-planner-role.ts
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";

/** Stub planner that returns a 1-node DAG with the requested artifactKind.
 *  The artifactKind is read from priorArtifact.suggestedKinds[0] (set by
 *  startWorkflow); defaults to "frontend-app". Used by Plan A integration
 *  tests; Plan B replaces with real LLM. */
export class StubWorkflowPlannerRole implements Role {
  readonly id = "workflow-planner";
  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const prior = inv.priorArtifact as { suggestedKinds?: string[] } | undefined;
    const kind = prior?.suggestedKinds?.[0] ?? "frontend-app";
    return {
      events: [
        {
          eventType: "workflow_planner.dag.emitted",
          payload: {
            nodes: [
              {
                id: "n1",
                artifactKind: kind,
                summary: `Build the ${kind}`,
                dependsOn: [],
                consumes: [],
                policy: { priority: 0, runMode: "active" }
              }
            ],
            dependencyProfile: { schemaVersion: "1" }
          }
        }
      ],
      diff: { kind: "none" }
    };
  }
}
```

- [ ] **Step 2: Test + commit** (basic test that `run()` returns the expected event shape)

```bash
pnpm --filter @atlas/workflow-engine test stub-planner-role
git add packages/workflow-engine/src/stub-planner-role.ts packages/workflow-engine/test/stub-planner-role.test.ts
git commit -m "feat(workflow-engine): stub workflow-planner role (for Plan A integration tests)"
```

---

### Task 11: WorkflowScheduler

**Files:**
- Create: `packages/workflow-engine/src/scheduler.ts`
- Test: `packages/workflow-engine/test/scheduler.test.ts`

The scheduler is the heart of execute phase. Single async loop per workflow run; event-driven (no polling). Subscribes to broker events filtered by ritualId to know when a node's ritual finishes.

- [ ] **Step 1: Define the interface**

```ts
// src/scheduler.ts
import type { WorkflowNode, WorkflowRunSnapshot } from "./types.js";
import { findReadyNodes } from "./dag.js";

export interface SchedulerDeps {
  /** Launches a ritual for the node; returns the ritualId immediately. */
  launchRitual: (node: WorkflowNode, run: WorkflowRunSnapshot) => Promise<string>;
  /** Returns a promise that resolves when the given ritual terminates,
   *  with either a "done" + artifact OR a "failed" + error. */
  awaitRitual: (ritualId: string) => Promise<
    | { kind: "done"; artifact: unknown; artifactKind: string }
    | { kind: "failed"; error: string }
  >;
  /** Persists node state updates to Postgres (caller wires WorkflowNodeRepo). */
  persistNodeState: (
    nodeId: string,
    update: Partial<Pick<WorkflowNode, "status" | "ritualId" | "artifact" | "failure">>
  ) => Promise<void>;
  /** Persists final workflow status. */
  persistWorkflowStatus: (status: WorkflowRunSnapshot["status"]) => Promise<void>;
}

export class WorkflowScheduler {
  constructor(
    private readonly run: WorkflowRunSnapshot,
    private readonly deps: SchedulerDeps
  ) {}

  async execute(): Promise<void> {
    const activePromises = new Map<string, Promise<void>>();
    const cap = this.run.concurrencyCap;
    let workflowFailed = false;

    while (true) {
      // Find ready nodes (not deferred, deps satisfied)
      const ready = findReadyNodes(this.run.nodes);
      // Highest priority first
      ready.sort((a, b) => b.policy.priority - a.policy.priority || a.id.localeCompare(b.id));

      while (ready.length > 0 && (cap === undefined || activePromises.size < cap)) {
        const node = ready.shift()!;
        node.status = "ready";
        await this.deps.persistNodeState(node.id, { status: "ready" });
        const p = this.launchAndAwait(node).then((failed) => {
          if (failed) workflowFailed = true;
        });
        activePromises.set(node.id, p);
      }

      if (activePromises.size === 0) break;

      // Wait for any to finish
      await Promise.race(activePromises.values());
      // Remove finished ones
      for (const [nodeId, p] of activePromises) {
        if (await isResolved(p)) activePromises.delete(nodeId);
      }
    }

    // Terminal status
    const anyFailed = this.run.nodes.some((n) => n.status === "failed");
    const finalStatus = anyFailed || workflowFailed ? "escalated" : "completed";
    await this.deps.persistWorkflowStatus(finalStatus);
  }

  private async launchAndAwait(node: WorkflowNode): Promise<boolean> {
    try {
      node.status = "running";
      const ritualId = await this.deps.launchRitual(node, this.run);
      node.ritualId = ritualId;
      await this.deps.persistNodeState(node.id, { status: "running", ritualId });
      const result = await this.deps.awaitRitual(ritualId);
      if (result.kind === "done") {
        node.status = "done";
        node.artifact = result.artifact;
        await this.deps.persistNodeState(node.id, { status: "done", artifact: result.artifact });
        return false;
      } else {
        node.status = "failed";
        node.failure = { error: result.error, attempts: (node.failure?.attempts ?? 0) + 1 };
        await this.deps.persistNodeState(node.id, { status: "failed", failure: node.failure });
        this.blockDependents(node.id);
        return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      node.status = "failed";
      node.failure = { error: msg, attempts: (node.failure?.attempts ?? 0) + 1 };
      await this.deps.persistNodeState(node.id, { status: "failed", failure: node.failure });
      this.blockDependents(node.id);
      return true;
    }
  }

  private blockDependents(failedNodeId: string): void {
    const blockedIds = new Set<string>([failedNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.run.nodes) {
        if (n.status !== "pending") continue;
        if (n.dependsOn.some((d) => blockedIds.has(d))) {
          n.status = "blocked";
          blockedIds.add(n.id);
          changed = true;
          // Persist (best-effort; failure to persist a block doesn't crash the loop)
          this.deps.persistNodeState(n.id, { status: "blocked" }).catch(() => {});
        }
      }
    }
  }
}

async function isResolved(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => true), Promise.resolve(false)]);
}
```

- [ ] **Step 2: Tests covering the scheduler in isolation**

```ts
// test/scheduler.test.ts
import { describe, it, expect, vi } from "vitest";
import { WorkflowScheduler, type SchedulerDeps } from "../src/scheduler.js";
import { chain, fanOut, diamond } from "./fixtures/dags.js";
import type { WorkflowRunSnapshot } from "../src/types.js";

function makeRun(nodes: WorkflowRunSnapshot["nodes"]): WorkflowRunSnapshot {
  return {
    id: "00000000-0000-0000-0000-00000000aaaa",
    projectId: "00000000-0000-0000-0000-00000000bbbb",
    userId: "u1",
    prompt: "test",
    status: "running",
    nodes,
    edges: [],
    dependencyProfile: { schemaVersion: "1" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function mockDeps(opts: { failures?: Set<string> } = {}): SchedulerDeps & { ritualsLaunched: string[]; finalStatus: () => string | undefined } {
  const launched: string[] = [];
  let finalStatus: string | undefined;
  return {
    launchRitual: async (node) => {
      launched.push(node.id);
      return `r-${node.id}`;
    },
    awaitRitual: async (ritualId) => {
      const nodeId = ritualId.replace("r-", "");
      if (opts.failures?.has(nodeId)) return { kind: "failed", error: "test failure" };
      return { kind: "done", artifact: { schemaVersion: "1", kind: "test", payload: { id: nodeId } }, artifactKind: "test" };
    },
    persistNodeState: async () => {},
    persistWorkflowStatus: async (s) => { finalStatus = s; },
    ritualsLaunched: launched,
    finalStatus: () => finalStatus
  } as any;
}

describe("WorkflowScheduler", () => {
  it("runs a chain end-to-end in order", async () => {
    const run = makeRun(chain());
    const deps = mockDeps();
    await new WorkflowScheduler(run, deps).execute();
    expect(deps.ritualsLaunched).toEqual(["a", "b", "c"]);
    expect(deps.finalStatus()).toBe("completed");
    expect(run.nodes.every((n) => n.status === "done")).toBe(true);
  });

  it("blocks dependents when a node fails; sibling continues", async () => {
    const run = makeRun(diamond());
    const deps = mockDeps({ failures: new Set(["b"]) });
    await new WorkflowScheduler(run, deps).execute();
    expect(run.nodes.find((n) => n.id === "a")!.status).toBe("done");
    expect(run.nodes.find((n) => n.id === "b")!.status).toBe("failed");
    expect(run.nodes.find((n) => n.id === "c")!.status).toBe("done");
    expect(run.nodes.find((n) => n.id === "d")!.status).toBe("blocked");
    expect(deps.finalStatus()).toBe("escalated");
  });

  it("runs fan-out nodes in parallel", async () => {
    const run = makeRun(fanOut());
    const deps = mockDeps();
    await new WorkflowScheduler(run, deps).execute();
    expect(deps.ritualsLaunched.slice(0, 1)).toEqual(["a"]);
    expect(deps.ritualsLaunched.slice(1).sort()).toEqual(["b", "c"]);
    expect(deps.finalStatus()).toBe("completed");
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @atlas/workflow-engine test scheduler
git add packages/workflow-engine/src/scheduler.ts packages/workflow-engine/test/scheduler.test.ts
git commit -m "feat(workflow-engine): WorkflowScheduler (DAG execute loop, failure isolation)"
```

---

### Task 12: CheckpointRecorder

**Files:**
- Create: `packages/workflow-engine/src/checkpoints.ts`
- Test: `packages/workflow-engine/test/checkpoints.test.ts`

The recorder subscribes to the broker (filtered by workflow's ritualIds) and writes a checkpoint row for every event of a known kind.

- [ ] **Step 1: Implement (similar callback pattern to SpecEventsSink)**

```ts
// src/checkpoints.ts
import type { RitualEvent } from "@atlas/ritual-engine";

export interface CheckpointWriter {
  append(input: { workflowRunId: string; nodeId: string; kind: string; payload: unknown; ritualEventId?: string }): Promise<void>;
}

const CHECKPOINT_EVENT_TYPES = new Set([
  "architect.pass1.completed",
  "architect.pass2.completed",
  "researcher.brief.completed",
  "designer.draft.completed",
  "designer.critique.completed",
  "designer.revise.completed",
  "designer.proposal.completed",
  "canvas.option.selected",
  "ritual.triage.clarification_resolved",
  "sandbox.apply.completed",
  "asset.gen.completed"
]);

const DEVELOPER_DELTA_BATCH_SIZE = 50;

export class CheckpointRecorder {
  private deltaCounters = new Map<string, number>(); // ritualId → count

  constructor(
    private readonly writer: CheckpointWriter,
    private readonly ritualToNode: Map<string, { workflowRunId: string; nodeId: string }>
  ) {}

  /** Called by the broker subscriber for every event. */
  async onEvent(event: RitualEvent): Promise<void> {
    const mapping = this.ritualToNode.get(event.ritualId);
    if (!mapping) return; // not a workflow event

    if (CHECKPOINT_EVENT_TYPES.has(event.type)) {
      await this.writer.append({
        workflowRunId: mapping.workflowRunId,
        nodeId: mapping.nodeId,
        kind: event.type,
        payload: (event as { payload?: unknown }).payload ?? {}
      });
    } else if (event.type === "developer.candidate.delta") {
      const cur = (this.deltaCounters.get(event.ritualId) ?? 0) + 1;
      this.deltaCounters.set(event.ritualId, cur);
      if (cur % DEVELOPER_DELTA_BATCH_SIZE === 0) {
        await this.writer.append({
          workflowRunId: mapping.workflowRunId,
          nodeId: mapping.nodeId,
          kind: "developer_candidate_delta_batch",
          payload: { batchedDeltaCount: cur }
        });
      }
    }
  }

  registerRitualForNode(ritualId: string, workflowRunId: string, nodeId: string): void {
    this.ritualToNode.set(ritualId, { workflowRunId, nodeId });
  }
}
```

- [ ] **Step 2: Test with synthetic events + commit**

(Inject a fake `CheckpointWriter` recording append calls; feed events; assert correct rows appended.)

```bash
pnpm --filter @atlas/workflow-engine test checkpoints
git add packages/workflow-engine/src/checkpoints.ts packages/workflow-engine/test/checkpoints.test.ts
git commit -m "feat(workflow-engine): CheckpointRecorder (broker → checkpoint rows for known event kinds)"
```

---

### Task 13: WorkflowEngine public API class

**Files:**
- Create: `packages/workflow-engine/src/engine.ts`
- Create: `packages/workflow-engine/src/errors.ts`
- Modify: `packages/workflow-engine/src/index.ts`
- Test: `packages/workflow-engine/test/engine.test.ts`

- [ ] **Step 1: Implement errors.ts**

```ts
// src/errors.ts
export class WorkflowNotFoundError extends Error { constructor(id: string) { super(`Workflow ${id} not found`); this.name = "WorkflowNotFoundError"; } }
export class WorkflowAlreadyApprovedError extends Error { constructor(id: string) { super(`Workflow ${id} already approved`); this.name = "WorkflowAlreadyApprovedError"; } }
export class NodeNotFoundError extends Error { constructor(rid: string, nid: string) { super(`Node ${nid} not found in workflow ${rid}`); this.name = "NodeNotFoundError"; } }
export class InvalidNodePolicyEditError extends Error { constructor(msg: string) { super(msg); this.name = "InvalidNodePolicyEditError"; } }
```

- [ ] **Step 2: Implement engine.ts (uses repos + RitualEngine + scheduler)**

```ts
// src/engine.ts
import type { RitualEngine } from "@atlas/ritual-engine";
import type {
  WorkflowRunRepo, WorkflowNodeRepo, WorkflowCheckpointRepo
} from "@atlas/spec-graph-data";
import { WorkflowScheduler } from "./scheduler.js";
import { CheckpointRecorder } from "./checkpoints.js";
import { detectCycle } from "./dag.js";
import type {
  WorkflowRun, WorkflowRunSnapshot, WorkflowNode, NodePolicy, DependencyProfile
} from "./types.js";
import {
  WorkflowNotFoundError, WorkflowAlreadyApprovedError, NodeNotFoundError
} from "./errors.js";

export interface StartWorkflowInput {
  projectId: string;
  userId: string;
  prompt: string;
  suggestedKinds?: string[];
  concurrencyCap?: number;
}

export interface PlanEdits {
  nodes?: WorkflowNode[];          // replace the node list (planner-suggested + user-edited)
  dependencyProfile?: DependencyProfile;
}

export interface WorkflowEngineOptions {
  ritualEngine: RitualEngine;
  runRepo: WorkflowRunRepo;
  nodeRepo: WorkflowNodeRepo;
  checkpointRepo: WorkflowCheckpointRepo;
  checkpointRecorder: CheckpointRecorder;
  subscribeToEvents: (callback: (event: any) => void) => () => void;  // broker subscription
}

export class WorkflowEngine {
  constructor(private readonly opts: WorkflowEngineOptions) {}

  async start(input: StartWorkflowInput): Promise<string> {
    // 1. Insert workflow_runs row (status="planning")
    const row = await this.opts.runRepo.insert({
      projectId: input.projectId,
      userId: input.userId,
      prompt: input.prompt,
      status: "planning",
      concurrencyCap: input.concurrencyCap ?? null,
      dependencyProfile: { schemaVersion: "1" }
    });
    // 2. Insert the workflow-planner node
    await this.opts.nodeRepo.insertMany([{
      id: "planner",
      workflowRunId: row.id,
      artifactKind: "workflow-planner",
      summary: "Plan the workflow",
      dependsOn: [],
      consumes: [],
      policy: { priority: 100, runMode: "active" },
      status: "pending"
    }]);
    // 3. Launch planner ritual via ritualEngine.start with priorArtifact carrying suggestedKinds
    const plannerRitualId = await this.opts.ritualEngine.start({
      userTurn: input.prompt,
      editClass: "structural",
      projectId: input.projectId,
      userId: input.userId,
      // Engine reads suggestedKinds from priorArtifact passed to the planner role
    } as any);
    // (StartInput today doesn't directly accept priorArtifact; threading via
    // an architectPriorArtifact path is acceptable for Plan A. Plan B adds a
    // dedicated workflow-planner dispatch path in factory.)
    await this.opts.nodeRepo.updateStatus(row.id, "planner", "running", { ritualId: plannerRitualId, startedAt: new Date() });
    // 4. Subscribe to broker, await planner.completed → read its emitted DAG
    // (implementation reuses awaitRitual pattern from the scheduler.)
    const dag = await this.awaitPlannerDag(plannerRitualId);
    // 5. Insert sibling nodes
    await this.opts.nodeRepo.insertMany(dag.nodes.map((n) => ({
      ...n,
      workflowRunId: row.id
    })));
    // 6. Validate no cycles
    if (detectCycle(dag.nodes)) throw new Error("planner emitted DAG with a cycle");
    // 7. Flip workflow status to awaiting_approval
    await this.opts.runRepo.updateStatus(row.id, "awaiting_approval");
    return row.id;
  }

  async approvePlan(workflowRunId: string, edits?: PlanEdits): Promise<void> {
    const run = await this.opts.runRepo.findById(workflowRunId);
    if (!run) throw new WorkflowNotFoundError(workflowRunId);
    if (run.status !== "awaiting_approval") throw new WorkflowAlreadyApprovedError(workflowRunId);
    if (edits?.nodes) {
      // Replace node rows with edited set
      // (Bulk update via delete + insert in a transaction — implementation detail in repo.)
      // ...
    }
    await this.opts.runRepo.updateStatus(workflowRunId, "running");
    // Fire-and-forget scheduler execution; persistence keeps state recoverable
    void this.runScheduler(workflowRunId);
  }

  private async runScheduler(workflowRunId: string): Promise<void> {
    const snapshot = await this.getRunInternal(workflowRunId);
    if (!snapshot) return;
    const scheduler = new WorkflowScheduler(snapshot, {
      launchRitual: (node) => this.launchNodeRitual(node, snapshot),
      awaitRitual: (ritualId) => this.awaitRitualResult(ritualId, snapshot),
      persistNodeState: (nodeId, update) => this.opts.nodeRepo.updateStatus(workflowRunId, nodeId, update.status!, update),
      persistWorkflowStatus: (status) => this.opts.runRepo.updateStatus(workflowRunId, status)
    });
    await scheduler.execute();
  }

  // Helpers below — launchNodeRitual, awaitRitualResult, awaitPlannerDag —
  // implemented similarly to the scheduler.test patterns. ritualEngine.start
  // is awaited for the kick-off; broker subscription drives the await.

  async retryNode(workflowRunId: string, nodeId: string): Promise<void> {
    const node = await this.opts.nodeRepo.findOne(workflowRunId, nodeId);
    if (!node) throw new NodeNotFoundError(workflowRunId, nodeId);
    if (node.status !== "failed") throw new Error(`Node ${nodeId} is not failed (status=${node.status})`);
    await this.opts.nodeRepo.updateStatus(workflowRunId, nodeId, "pending");
    // Unblock dependents that were blocked transitively
    // (Implementation: scan all nodes whose dependsOn contains this nodeId
    // recursively; reset their status to "pending".)
    void this.runScheduler(workflowRunId);
  }

  async abort(workflowRunId: string, reason: string): Promise<void> {
    await this.opts.runRepo.updateStatus(workflowRunId, "aborted");
    const nodes = await this.opts.nodeRepo.findByRunId(workflowRunId);
    for (const node of nodes) {
      if (node.status === "running" && node.ritualId) {
        await this.opts.ritualEngine.abort(node.ritualId, reason);
      }
    }
  }

  async setNodePolicy(workflowRunId: string, nodeId: string, policy: NodePolicy): Promise<void> {
    await this.opts.nodeRepo.updatePolicy(workflowRunId, nodeId, policy);
  }

  async getRun(workflowRunId: string): Promise<WorkflowRunSnapshot | undefined> {
    return this.getRunInternal(workflowRunId);
  }

  private async getRunInternal(workflowRunId: string): Promise<WorkflowRunSnapshot | undefined> {
    const run = await this.opts.runRepo.findById(workflowRunId);
    if (!run) return undefined;
    const nodes = await this.opts.nodeRepo.findByRunId(workflowRunId);
    return {
      id: run.id,
      projectId: run.projectId,
      userId: run.userId,
      prompt: run.prompt,
      status: run.status as any,
      nodes: nodes.map((n) => ({
        id: n.id,
        artifactKind: n.artifactKind,
        summary: n.summary,
        dependsOn: n.dependsOn as string[],
        consumes: n.consumes as string[],
        policy: n.policy as NodePolicy,
        status: n.status as any,
        ritualId: n.ritualId ?? undefined,
        artifact: n.artifact,
        failure: n.failure as any
      })),
      edges: [],
      dependencyProfile: run.dependencyProfile as DependencyProfile,
      concurrencyCap: run.concurrencyCap ?? undefined,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString()
    };
  }

  // Helpers awaitPlannerDag / launchNodeRitual / awaitRitualResult: subscribe
  // to broker for the ritualId's terminal events. See scheduler test for the
  // promise-resolves-on-event pattern.
}
```

- [ ] **Step 3: Tests + commit**

(Engine-level unit tests with mocked repos + a real WorkflowScheduler with mocked SchedulerDeps. Focus: start happy path; approvePlan happy path; abort flows abort calls down to RitualEngine; retryNode resets state.)

```bash
pnpm --filter @atlas/workflow-engine test engine
git add packages/workflow-engine/src/engine.ts packages/workflow-engine/src/errors.ts packages/workflow-engine/test/engine.test.ts packages/workflow-engine/src/index.ts
git commit -m "feat(workflow-engine): WorkflowEngine public API + errors"
```

---

### Task 14: Integration test — end-to-end through stubs

**Files:**
- Create: `packages/workflow-engine/test/integration.test.ts`

The big payoff test for Plan A. Wires real `WorkflowEngine` + real `RitualEngine` + stub roles + an in-memory broker + a real (test) Postgres database. Drives:

- Cold start → planner stub returns 1-node DAG → workflow → awaiting_approval
- approvePlan → scheduler runs the 1 node (stub developer returns canned diff) → done
- Crash simulation: kill scheduler mid-flight (throw mid-promise), restart → workflow resumes (stub node re-runs; done)
- Failure isolation: 3-node fan-out where one stub-node throws → fail isolated; siblings complete; workflow escalates

- [ ] Write the integration test
- [ ] Run + commit

```bash
pnpm --filter @atlas/workflow-engine test integration
git add packages/workflow-engine/test/integration.test.ts
git commit -m "test(workflow-engine): end-to-end integration test (stub roles, real DB)"
```

---

### Task 15: atlas-web Server Actions

**Files:**
- Create: 9 server action files in `apps/atlas-web/lib/actions/`
- Modify: `apps/atlas-web/lib/feature-flags.ts` (add `ATLAS_FF_WORKFLOW` master flag)
- Modify: `apps/atlas-web/lib/engine/factory.ts` (construct WorkflowEngine + return alongside ritualEngine)

Each action mirrors today's `startRitual` action pattern (auth check + delegate to engine). All gated by `ATLAS_FF_WORKFLOW`; throw a friendly error message if flag is off.

- [ ] **Step 1: Add the master flag**

```ts
// apps/atlas-web/lib/feature-flags.ts — extend the FeatureName union
| "workflow"

// And:
"workflow": "ATLAS_FF_WORKFLOW"
```

- [ ] **Step 2: Implement `startWorkflow`**

```ts
// apps/atlas-web/lib/actions/startWorkflow.ts
"use server";
import { auth } from "@/lib/auth/clerk-compat";
import { getWorkflowEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface StartWorkflowInput {
  projectId: string;
  prompt: string;
  suggestedKinds?: string[];
  concurrencyCap?: number;
}

export async function startWorkflow(input: StartWorkflowInput): Promise<{ workflowRunId: string }> {
  if (!isFeatureEnabled("workflow")) {
    throw new Error("Workflows are not yet enabled on this deployment.");
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getWorkflowEngine(input.projectId);
  const workflowRunId = await engine.start({
    projectId: input.projectId,
    userId,
    prompt: input.prompt,
    ...(input.suggestedKinds ? { suggestedKinds: input.suggestedKinds } : {}),
    ...(input.concurrencyCap ? { concurrencyCap: input.concurrencyCap } : {})
  });
  return { workflowRunId };
}
```

- [ ] **Step 3: Implement the other 8 actions following the same pattern:**

`approveWorkflowPlan`, `retryNode`, `abortWorkflow`, `setNodePolicy`, `deferNode` (calls `setNodePolicy` with `runMode: "deferred"`), `resumeDeferredNode` (calls `setNodePolicy` with `runMode: "active"`), `getWorkflowRun`, `getWorkflowEventLog`.

Each is ~30 LOC; identical auth + flag-check + delegate pattern.

- [ ] **Step 4: Update factory.ts to construct WorkflowEngine**

Add a `getWorkflowEngine(projectId)` per-request-cached factory mirroring `getRitualEngine`. Constructs `WorkflowEngine` with the shared broker, ritualEngine, repos, checkpoint recorder. Subscribes the recorder to the broker.

- [ ] **Step 5: Type-check + commit**

```bash
pnpm --filter atlas-web type-check
git add apps/atlas-web/lib/actions/startWorkflow.ts apps/atlas-web/lib/actions/approveWorkflowPlan.ts apps/atlas-web/lib/actions/retryNode.ts apps/atlas-web/lib/actions/abortWorkflow.ts apps/atlas-web/lib/actions/setNodePolicy.ts apps/atlas-web/lib/actions/deferNode.ts apps/atlas-web/lib/actions/resumeDeferredNode.ts apps/atlas-web/lib/actions/getWorkflowRun.ts apps/atlas-web/lib/actions/getWorkflowEventLog.ts apps/atlas-web/lib/feature-flags.ts apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web): Workflow Server Actions + WorkflowEngine factory wiring (flag-gated)"
```

---

### Task 16: atlas-web action tests + final verification

**Files:**
- Create: `apps/atlas-web/test/actions/startWorkflow.test.ts` + 8 sibling files (one per action)

Each test:
- Mocks `getWorkflowEngine` to return a stub
- Asserts the action requires auth (rejects when `auth().userId` is null)
- Asserts the action calls the engine method with the right args
- Asserts the action throws when `ATLAS_FF_WORKFLOW` is off

- [ ] Implement all 9 action tests
- [ ] Run full atlas-web vitest suite — no regressions
- [ ] Run the workflow-engine integration test against the real local Postgres
- [ ] Commit

```bash
pnpm --filter atlas-web test actions/startWorkflow actions/approveWorkflowPlan actions/retryNode actions/abortWorkflow actions/setNodePolicy actions/deferNode actions/resumeDeferredNode actions/getWorkflowRun actions/getWorkflowEventLog
pnpm --filter atlas-web test  # full sweep
pnpm --filter @atlas/workflow-engine test  # full sweep
git add apps/atlas-web/test/actions
git commit -m "test(atlas-web): coverage for 9 workflow Server Actions"
```

---

## Plan A — Self-review checklist

- [ ] Spec section 2 (Architecture) → implemented across Tasks 1, 13, 15
- [ ] Spec section 4 (Typed contracts) → Task 8 (generic + registry); per-kind schemas in Plans D/E/F
- [ ] Spec section 5 (DAG + scheduler) → Tasks 3, 11
- [ ] Spec section 6 (Persistence) → Tasks 4, 5, 6, 7
- [ ] Spec section 7 (Failure + checkpoints) → Tasks 11 (failure isolation), 12 (checkpoints), 14 (resume)
- [ ] Spec section 11 (Operations) → Task 9 (abort), Tasks 15-16 (Server Actions including abort + getWorkflowEventLog)
- [ ] Workflow planner real implementation → **DEFERRED to Plan B**; Plan A uses stub
- [ ] DependencyProfile real implementation → **DEFERRED to Plan B**; Plan A schema is minimal placeholder
- [ ] Entry classifier + ATLAS_FF_WORKFLOW_PICKER + ATLAS_FF_WORKFLOW_KINDS → **DEFERRED to Plan B**
- [ ] Graph view UI → **DEFERRED to Plan C**
- [ ] Per-artifact-kind contracts (backend/frontend/tests/iac/deploy) → **DEFERRED to Plans D, E, F**
- [ ] Cost cap + observability polish → **DEFERRED to Plan G**

**Shippable result:** WorkflowEngine + persistence + abort + Server Actions exist, run end-to-end against stub roles, are exercised by integration tests against real Postgres, but are gated off in production. Plan B turns on real planning; Plan C adds the UI.
