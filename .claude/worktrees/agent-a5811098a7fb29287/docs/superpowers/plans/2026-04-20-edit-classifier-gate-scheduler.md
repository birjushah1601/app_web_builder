# Edit Classifier + Gate Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two paired pnpm-workspace packages — `packages/edit-classifier/` and `packages/gate-scheduler/` — that implement Atlas's three-tier edit-class semantics from PRD §9.5 and §11.4. The classifier is **deterministic**: given a Spec Graph mutation (node/edge change with field-level deltas), it returns one of `cosmetic`, `structural`, or `security-compliance-touching`. The scheduler is **policy-driven**: given a classified edit, it runs L1–L5 merge gates either sync (blocking the commit) or async (post-commit with rollback armed), per the PRD's tier table. On gate failure, the scheduler offers three resolutions per PRD §9.5: retry-with-hint / undo / risk-accepted commit (the latter via `@atlas/ritual-engine.acceptRisk` from E.1).

**Architecture:** Two packages so the classifier (pure function, no I/O) is reusable independently of the scheduler. The classifier exports `classifyEdit(graphBefore, graphAfter): EditClassification` returning the tier + reason + which fields drove the classification. The scheduler is an event-driven runner: it subscribes to Conductor's `dispatch.completed` events with a non-empty diff, looks up the classification, and dispatches the appropriate L1–L5 gate set via injected `GateRunner` interfaces. Async gates push to a queue (`AsyncGateJob`); a separate worker drains the queue, runs the gate, and on failure either auto-rolls-back (CVE-rated) or arms a notification with the user's three resolutions.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS · `simple-git` (already in spec-graph-merge-driver) for revert operations. Workspace deps: `@atlas/spec-graph-schema`, `@atlas/spec-graph-data`, `@atlas/ritual-engine`, `@atlas/conductor`. No new external runtime deps.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans A.1–A.4, B.1, C.1, D.1, D.2, E.1, F.1 merged.
- Node 22 + pnpm 9+.
- DB required only for the integration test in Task 23.

---

## File Structure

```
packages/
  edit-classifier/                            # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts
      types.ts                                # EditClass, EditClassification, FieldChange Zod
      diff.ts                                 # diffGraphs(before, after) → FieldChange[]
      rules.ts                                # the static rule table (which fields drive which tier)
      classify.ts                             # classifyEdit() — applies rules to diff
    test/
      diff.test.ts
      rules.test.ts
      classify.test.ts
      classify-cosmetic.test.ts
      classify-structural.test.ts
      classify-security-compliance.test.ts

  gate-scheduler/                             # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts
      types.ts                                # GateLayer, GateResult, GateRunner interface
      schedule.ts                             # scheduleGates(classification) → SyncGateSet + AsyncGateJob[]
      sync-runner.ts                          # runSyncGates() — blocks until L1+L2 (cosmetic) / L1-L5 (others)
      async-queue.ts                          # AsyncGateQueue interface + InMemoryAsyncQueue
      async-worker.ts                         # AsyncGateWorker — drains queue, runs gates, fires resolutions
      rollback-arm.ts                         # rollback armed = git revert + DB migration down (no exec yet)
      resolution.ts                           # the three user-facing resolutions per PRD §9.5
    test/
      schedule.test.ts
      sync-runner.test.ts
      async-queue.test.ts
      async-worker.test.ts
      async-worker-rollback.test.ts
      resolution.test.ts
      integration.test.ts                     # full edit → classify → schedule → run → resolve

docs/superpowers/plans/
  README.md                                   # MODIFIED — add G.1 entry
```

**Why this shape.** Two packages keeps the classifier independently testable and reusable — the latency harness (G.2) imports the classifier without dragging in scheduler runtime. The scheduler's `GateRunner` interface lets each gate (L1–L5) be supplied separately by D.4/D.5 + the Validator role; G.1 ships only the orchestration + injection points.

## Open-question resolutions

These resolve the four open questions from `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` Unit G section:

- **OQ1 (async gate outcome UX) → notification pane non-modal; CVE auto-rollback with after-the-fact modal.** The `Resolution` type carries `severity` ∈ `{notice, alert, critical}`. `severity === "critical"` triggers immediate `executeRollback()` then surfaces a modal-class notification; lower severities surface as a notification only and the user picks from the three resolutions.
- **OQ2 (rollback granularity) → revert just the failed commit via `git revert`.** The `RollbackArm` records the commit SHA; `executeRollback()` runs `git revert <sha>` (creating a new commit, preserving history). For chains of cosmetic commits, only the failing commit is reverted.
- **OQ3 (tier classifier test coverage) → fixture corpus shared with the existing skill-runtime classifier.** G.1 ships ~30 test fixtures under `test/fixtures/edits/<tier>/*.json` — paired before/after Spec Graph snapshots with expected classification.
- **OQ4 (latency-harness cadence) → out of scope for G.1.** That's G.2.

---

## Tasks

### Task 1: Scaffold `packages/edit-classifier/`

**Files:** package.json, tsconfig, vitest.config, src/index.ts placeholder.

- [ ] **Step 1: Tree**
```bash
mkdir -p packages/edit-classifier/src packages/edit-classifier/test/fixtures/edits/{cosmetic,structural,security-compliance-touching}
```

- [ ] **Step 2: package.json**

```json
{
  "name": "@atlas/edit-classifier",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/spec-graph-schema": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 3: tsconfig + vitest** — same shape as `packages/ritual-engine/`.
- [ ] **Step 4: src/index.ts** — `export {};`
- [ ] **Step 5: Verify**
```bash
pnpm install && pnpm -F @atlas/edit-classifier typecheck
```
- [ ] **Step 6: Commit**
```bash
git add packages/edit-classifier/ pnpm-lock.yaml
git commit -m "feat(edit-classifier): scaffold pure-function package with @atlas/spec-graph-schema dep"
```

---

### Task 2: `EditClass` + `FieldChange` + `EditClassification` Zod types

**Files:** `src/types.ts` + `test/types.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
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
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/edit-classifier test types
```

- [ ] **Step 3: Implement `src/types.ts`**

```typescript
import { z } from "zod";

export const EditClassSchema = z.enum(["cosmetic", "structural", "security-compliance-touching"]);
export type EditClass = z.infer<typeof EditClassSchema>;

const Added = z.object({
  kind: z.literal("added"),
  nodeId: z.string(),
  fieldPath: z.string(),
  newValue: z.unknown()
});
const Modified = z.object({
  kind: z.literal("modified"),
  nodeId: z.string(),
  fieldPath: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown()
});
const Removed = z.object({
  kind: z.literal("removed"),
  nodeId: z.string(),
  fieldPath: z.string(),
  oldValue: z.unknown()
});

export const FieldChangeSchema = z.discriminatedUnion("kind", [Added, Modified, Removed]);
export type FieldChange = z.infer<typeof FieldChangeSchema>;

export const EditClassificationSchema = z.object({
  class: EditClassSchema,
  reason: z.string().min(1),
  drivers: z.array(FieldChangeSchema)
});
export type EditClassification = z.infer<typeof EditClassificationSchema>;
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/edit-classifier test types
git add packages/edit-classifier/src/types.ts packages/edit-classifier/test/types.test.ts
git commit -m "feat(edit-classifier): EditClass + FieldChange + EditClassification Zod types"
```

---

### Task 3: `diffGraphs(before, after)` — produces `FieldChange[]`

**Files:** `src/diff.ts` + `test/diff.test.ts`.

The diff is structural over Spec Graph shape: walks every node, every field; reports added/removed/modified at field-path granularity. Edges are diffed by composite-key `(from, to, type)`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { diffGraphs } from "../src/diff.js";

const baseGraph = {
  schemaVersion: "1.0.0", projectId: "p", name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DB" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "t", updatedAt: "t",
  nodes: { "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" } },
  edges: [{ type: "renders", from: "page:home", to: "cmp:header" }]
};

describe("diffGraphs", () => {
  it("empty diff for identical graphs", () => {
    expect(diffGraphs(baseGraph as never, baseGraph as never)).toEqual([]);
  });

  it("modified field on existing node", () => {
    const after = { ...baseGraph, nodes: { ...baseGraph.nodes, "page:home": { ...baseGraph.nodes["page:home"], title: "Welcome" } } };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes).toEqual([{ kind: "modified", nodeId: "page:home", fieldPath: "title", oldValue: "Home", newValue: "Welcome" }]);
  });

  it("added node", () => {
    const after = {
      ...baseGraph,
      nodes: { ...baseGraph.nodes, "page:about": { kind: "page", id: "page:about", path: "/about", title: "About", renderMode: "ssr", routeRef: "GET /about" } }
    };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes.find((c) => c.nodeId === "page:about" && c.kind === "added")).toBeDefined();
  });

  it("removed node", () => {
    const after = { ...baseGraph, nodes: {} };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes.find((c) => c.nodeId === "page:home" && c.kind === "removed")).toBeDefined();
  });

  it("nested field modification (e.g. databaseProvider.region)", () => {
    const after = { ...baseGraph, databaseProvider: { ...baseGraph.databaseProvider, region: "eu-west-1" } };
    const changes = diffGraphs(baseGraph as never, after as never);
    expect(changes.some((c) => c.nodeId === "$root" && c.fieldPath === "databaseProvider.region" && c.kind === "modified")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/edit-classifier test diff
```

- [ ] **Step 3: Implement `src/diff.ts`**

```typescript
import type { SpecGraph } from "@atlas/spec-graph-schema";
import type { FieldChange } from "./types.js";

const ROOT_FIELDS = [
  "schemaVersion", "projectId", "name", "complianceClasses",
  "databaseProvider", "templateDigest"
] as const;

export function diffGraphs(before: SpecGraph, after: SpecGraph): FieldChange[] {
  const changes: FieldChange[] = [];

  // Diff root-level fields under nodeId="$root"
  for (const field of ROOT_FIELDS) {
    diffValue("$root", field, (before as never)[field], (after as never)[field], changes);
  }

  // Diff nodes by id
  const beforeNodes = (before.nodes ?? {}) as Record<string, Record<string, unknown>>;
  const afterNodes = (after.nodes ?? {}) as Record<string, Record<string, unknown>>;
  const allIds = new Set([...Object.keys(beforeNodes), ...Object.keys(afterNodes)]);
  for (const id of allIds) {
    const b = beforeNodes[id];
    const a = afterNodes[id];
    if (!b && a) {
      changes.push({ kind: "added", nodeId: id, fieldPath: "$node", newValue: a });
    } else if (b && !a) {
      changes.push({ kind: "removed", nodeId: id, fieldPath: "$node", oldValue: b });
    } else if (b && a) {
      const fields = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const f of fields) {
        diffValue(id, f, b[f], a[f], changes);
      }
    }
  }

  // Diff edges by composite key
  const edgeKey = (e: { from: string; to: string; type: string }) => `${e.from}|${e.to}|${e.type}`;
  const beforeEdges = new Map((before.edges ?? []).map((e) => [edgeKey(e as never), e]));
  const afterEdges = new Map((after.edges ?? []).map((e) => [edgeKey(e as never), e]));
  for (const [k, e] of afterEdges) {
    if (!beforeEdges.has(k)) {
      changes.push({ kind: "added", nodeId: `edge:${k}`, fieldPath: "$edge", newValue: e });
    }
  }
  for (const [k, e] of beforeEdges) {
    if (!afterEdges.has(k)) {
      changes.push({ kind: "removed", nodeId: `edge:${k}`, fieldPath: "$edge", oldValue: e });
    }
  }
  return changes;
}

function diffValue(nodeId: string, fieldPath: string, b: unknown, a: unknown, out: FieldChange[]): void {
  if (b === undefined && a !== undefined) {
    out.push({ kind: "added", nodeId, fieldPath, newValue: a });
    return;
  }
  if (b !== undefined && a === undefined) {
    out.push({ kind: "removed", nodeId, fieldPath, oldValue: b });
    return;
  }
  if (isPrimitive(b) || isPrimitive(a)) {
    if (!deepEqual(b, a)) out.push({ kind: "modified", nodeId, fieldPath, oldValue: b, newValue: a });
    return;
  }
  // Both are objects — recurse on keys
  const bo = b as Record<string, unknown>;
  const ao = a as Record<string, unknown>;
  const keys = new Set([...Object.keys(bo), ...Object.keys(ao)]);
  for (const k of keys) {
    diffValue(nodeId, `${fieldPath}.${k}`, bo[k], ao[k], out);
  }
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/edit-classifier test diff
git add packages/edit-classifier/src/diff.ts packages/edit-classifier/test/diff.test.ts
git commit -m "feat(edit-classifier): diffGraphs walks nodes + edges + nested fields → FieldChange[]"
```

---

### Task 4: `rules.ts` — the static field-tier rule table

**Files:** `src/rules.ts` + `test/rules.test.ts`.

Per PRD §9.5, the rule table maps `(nodeKind, fieldPath)` → `EditClass`. Highest tier wins when multiple drivers apply.

| Driver | Tier |
|---|---|
| Any change to `AuthBoundary` node | security-compliance-touching |
| Any change to `Model` node's `rlsPolicies` | security-compliance-touching |
| Any change to `Model` node's `piiFields` | security-compliance-touching |
| Any `ComplianceClass` add/remove/modify | security-compliance-touching |
| Any change to root `complianceClasses` | security-compliance-touching |
| Any change to root `databaseProvider` | structural |
| Add/remove of any node | structural |
| Add/remove of any edge | structural |
| Change to `Page.path`, `Page.routeRef`, `Page.renderMode`, `Page.authRequired` | structural |
| Change to `Route.method`, `Route.path`, `Route.handlerType` | structural |
| Change to `Endpoint.method`, `Endpoint.path`, `Endpoint.inputs`, `Endpoint.outputs`, `Endpoint.authBoundary` | structural |
| Change to `Flow.steps`, `Flow.failurePaths` | structural |
| Change to `Component.props`, `Component.state` | structural |
| Change to `ClientState.transitions`, `ClientState.persistence` | structural |
| Change to `DesignToken` value (color, spacing, font) | cosmetic |
| Change to `Page.title`, `Component.copy` | cosmetic |
| Change to Tailwind class strings (style fields) | cosmetic |
| Default for any other change | structural |

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { rateField, type EditClass } from "../src/rules.js";

describe("rules.rateField", () => {
  const cases: Array<[string, string, string, EditClass]> = [
    ["page:home", "title", "page", "cosmetic"],
    ["page:home", "path", "page", "structural"],
    ["page:home", "renderMode", "page", "structural"],
    ["page:home", "authRequired", "page", "structural"],
    ["model:user", "rlsPolicies.select", "model", "security-compliance-touching"],
    ["model:user", "piiFields", "model", "security-compliance-touching"],
    ["authboundary:user", "anything", "authboundary", "security-compliance-touching"],
    ["compliance:hipaa", "anything", "compliance", "security-compliance-touching"],
    ["$root", "complianceClasses", "$root", "security-compliance-touching"],
    ["$root", "databaseProvider", "$root", "structural"],
    ["$root", "databaseProvider.region", "$root", "structural"],
    ["component:button", "copy", "component", "cosmetic"],
    ["component:button", "props", "component", "structural"],
    ["designtoken:primary", "value", "designtoken", "cosmetic"],
    ["dependency:react", "version", "dependency", "structural"]
  ];

  for (const [nodeId, field, kind, expected] of cases) {
    it(`${nodeId}/${field} (${kind}) → ${expected}`, () => {
      expect(rateField(nodeId, field, kind)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/edit-classifier test rules
```

- [ ] **Step 3: Implement `src/rules.ts`**

```typescript
import type { EditClass } from "./types.js";
export type { EditClass };

const SC_TOUCH: EditClass = "security-compliance-touching";
const STR: EditClass = "structural";
const COS: EditClass = "cosmetic";

export function rateField(nodeId: string, fieldPath: string, kind: string): EditClass {
  // Always-security-compliance-touching node kinds
  if (kind === "authboundary") return SC_TOUCH;
  if (kind === "compliance") return SC_TOUCH;

  // Field-specific within Model
  if (kind === "model") {
    if (fieldPath.startsWith("rlsPolicies")) return SC_TOUCH;
    if (fieldPath === "piiFields") return SC_TOUCH;
  }

  // Root-level
  if (nodeId === "$root") {
    if (fieldPath === "complianceClasses" || fieldPath.startsWith("complianceClasses.")) return SC_TOUCH;
    return STR; // every other root field change is structural
  }

  // Page
  if (kind === "page") {
    if (["title"].includes(fieldPath) || fieldPath.startsWith("copy")) return COS;
    if (["path", "routeRef", "renderMode", "authRequired"].includes(fieldPath)) return STR;
  }

  // Route
  if (kind === "route") {
    if (["method", "path", "handlerType"].includes(fieldPath)) return STR;
  }

  // Endpoint
  if (kind === "endpoint") {
    if (["method", "path"].includes(fieldPath) || fieldPath.startsWith("inputs") || fieldPath.startsWith("outputs") || fieldPath === "authBoundary") return STR;
  }

  // Flow
  if (kind === "flow") {
    if (fieldPath === "steps" || fieldPath === "failurePaths" || fieldPath.startsWith("steps.") || fieldPath.startsWith("failurePaths.")) return STR;
  }

  // Component
  if (kind === "component") {
    if (fieldPath === "copy" || fieldPath.startsWith("copy.")) return COS;
    if (fieldPath === "props" || fieldPath === "state" || fieldPath.startsWith("props.") || fieldPath.startsWith("state.")) return STR;
    if (fieldPath === "className" || fieldPath.startsWith("classNames.")) return COS;
  }

  // ClientState
  if (kind === "clientstate") {
    if (fieldPath === "transitions" || fieldPath === "persistence" || fieldPath.startsWith("transitions.")) return STR;
  }

  // DesignToken — value/color/spacing/font are cosmetic
  if (kind === "designtoken") {
    return COS;
  }

  // Dependency — version bumps are structural by default
  if (kind === "dependency") {
    return STR;
  }

  return STR;
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/edit-classifier test rules
git add packages/edit-classifier/src/rules.ts packages/edit-classifier/test/rules.test.ts
git commit -m "feat(edit-classifier): rules.rateField — static (kind, fieldPath) → tier table"
```

---

### Task 5: `classifyEdit()` — applies rules to diff, picks highest tier

**Files:** `src/classify.ts` + `test/classify.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { classifyEdit } from "../src/classify.js";

describe("classifyEdit", () => {
  it("no changes → cosmetic with empty drivers (degenerate)", () => {
    const r = classifyEdit([]);
    expect(r.class).toBe("cosmetic");
    expect(r.drivers).toEqual([]);
  });

  it("title-only change → cosmetic", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "page:home", fieldPath: "title", oldValue: "X", newValue: "Y" }
    ], { kindOf: () => "page" });
    expect(r.class).toBe("cosmetic");
    expect(r.drivers).toHaveLength(1);
  });

  it("title + path change → structural (path drives)", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "page:home", fieldPath: "title", oldValue: "X", newValue: "Y" },
      { kind: "modified", nodeId: "page:home", fieldPath: "path", oldValue: "/", newValue: "/welcome" }
    ], { kindOf: () => "page" });
    expect(r.class).toBe("structural");
    expect(r.drivers.find((d) => d.fieldPath === "path")).toBeDefined();
  });

  it("any AuthBoundary change → security-compliance-touching", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "ab:user", fieldPath: "permissions", oldValue: [], newValue: ["read"] }
    ], { kindOf: () => "authboundary" });
    expect(r.class).toBe("security-compliance-touching");
  });

  it("Model.rlsPolicies change → security-compliance-touching even with cosmetic siblings", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "model:user", fieldPath: "name", oldValue: "User", newValue: "AppUser" },
      { kind: "modified", nodeId: "model:user", fieldPath: "rlsPolicies.select", oldValue: "auth.uid()", newValue: "true" }
    ], { kindOf: () => "model" });
    expect(r.class).toBe("security-compliance-touching");
  });

  it("reason string names the highest-tier driver", () => {
    const r = classifyEdit([
      { kind: "modified", nodeId: "ab:admin", fieldPath: "roles", oldValue: ["admin"], newValue: ["admin", "auditor"] }
    ], { kindOf: () => "authboundary" });
    expect(r.reason).toContain("authboundary");
    expect(r.reason).toContain("ab:admin");
  });
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/edit-classifier test classify
```

- [ ] **Step 3: Implement `src/classify.ts`**

```typescript
import { rateField } from "./rules.js";
import type { EditClass, EditClassification, FieldChange } from "./types.js";

export interface ClassifyContext {
  /** Returns the kind (page/route/component/...) for a given nodeId. Caller knows
   *  the graph; classifier doesn't fetch. Defaults: $root → "$root"; edge:* → "edge". */
  kindOf?(nodeId: string): string;
}

const RANK: Record<EditClass, number> = {
  "cosmetic": 0,
  "structural": 1,
  "security-compliance-touching": 2
};

const REVERSE_RANK: EditClass[] = ["cosmetic", "structural", "security-compliance-touching"];

function defaultKindOf(nodeId: string): string {
  if (nodeId === "$root") return "$root";
  if (nodeId.startsWith("edge:")) return "edge";
  const colon = nodeId.indexOf(":");
  return colon === -1 ? nodeId : nodeId.slice(0, colon);
}

export function classifyEdit(changes: FieldChange[], ctx: ClassifyContext = {}): EditClassification {
  const kindOf = ctx.kindOf ?? defaultKindOf;
  if (changes.length === 0) {
    return { class: "cosmetic", reason: "no changes detected", drivers: [] };
  }

  let highest = -1;
  let highestDriver: FieldChange | undefined;
  for (const change of changes) {
    let kind = kindOf(change.nodeId);
    if (change.fieldPath === "$node") {
      // Add/remove of a node is always structural unless the node kind itself is SC-touching.
      if (kind === "authboundary" || kind === "compliance") {
        if (RANK["security-compliance-touching"] > highest) {
          highest = RANK["security-compliance-touching"];
          highestDriver = change;
        }
        continue;
      }
      if (RANK["structural"] > highest) {
        highest = RANK["structural"];
        highestDriver = change;
      }
      continue;
    }
    if (change.fieldPath === "$edge") {
      if (RANK["structural"] > highest) {
        highest = RANK["structural"];
        highestDriver = change;
      }
      continue;
    }
    const tier = rateField(change.nodeId, change.fieldPath, kind);
    if (RANK[tier] > highest) {
      highest = RANK[tier];
      highestDriver = change;
    }
  }

  const cls = REVERSE_RANK[highest];
  const drivers = changes.filter((c) => {
    const tier = c.fieldPath === "$node"
      ? (kindOf(c.nodeId) === "authboundary" || kindOf(c.nodeId) === "compliance" ? "security-compliance-touching" : "structural")
      : c.fieldPath === "$edge"
        ? "structural"
        : rateField(c.nodeId, c.fieldPath, kindOf(c.nodeId));
    return tier === cls;
  });

  const top = highestDriver!;
  const reason = `${cls} edit driven by ${kindOf(top.nodeId)} ${top.nodeId} field ${top.fieldPath}`;

  return { class: cls, reason, drivers };
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/edit-classifier test classify
git add packages/edit-classifier/src/classify.ts packages/edit-classifier/test/classify.test.ts
git commit -m "feat(edit-classifier): classifyEdit picks highest tier across drivers + reports drivers"
```

---

### Task 6: Three fixture-driven tier-corpus tests

**Files:** `test/classify-cosmetic.test.ts`, `test/classify-structural.test.ts`, `test/classify-security-compliance.test.ts` + ~30 fixture JSON files.

Each fixture is a paired `before.json` + `after.json` + an expected `tier` declared in the filename, e.g. `cosmetic-page-title-tweak/before.json` + `after.json` + `expected.json`. The test loads each fixture group and asserts `classifyEdit(diffGraphs(before, after))` returns the expected tier.

- [ ] **Step 1: Author 10 cosmetic fixtures**

Create `test/fixtures/edits/cosmetic/`. Each fixture is a directory with `before.json` + `after.json`. Examples (file each as a separate folder):

- `00-page-title-tweak/` — Page.title changes.
- `01-component-copy-tweak/` — Component.copy changes.
- `02-design-token-color/` — DesignToken value changes.
- `03-design-token-spacing/` — DesignToken spacing changes.
- `04-tailwind-class-swap/` — Component.className changes.
- `05-page-renderMode-no-change-but-other/` — A no-op (verify cosmetic on degenerate diff with only title noise).
- `06-component-classNames-bulk-tweak/`
- `07-design-token-font-family/`
- `08-page-copy-update/`
- `09-multiple-cosmetic/` — multiple cosmetic drivers, none structural.

For each, write a minimal valid Spec Graph in `before.json` (use the `valid-forgot-password.json` from B.1 as a starter), then `after.json` with the targeted change. Use `templateDigest: "sha256:" + "0".repeat(64)`.

(In TDD discipline, the test code is one task; the 30 fixtures are sub-files. Include 3-5 representative fixture file contents in the plan; the rest follow the same shape and can be authored efficiently by the engineer using a fixture-builder script — see the helper in Step 3.)

Example fixture `00-page-title-tweak/before.json`:

```json
{
  "schemaVersion": "1.0.0",
  "projectId": "11111111-1111-4111-8111-111111111111",
  "name": "demo",
  "complianceClasses": ["baseline"],
  "databaseProvider": { "tier": "atlas-run", "provider": "neon", "region": "us-east-1", "connectionStringRef": "env:DB" },
  "templateDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "createdAt": "2026-04-20T00:00:00.000Z",
  "updatedAt": "2026-04-20T00:00:00.000Z",
  "nodes": {
    "page:home": { "kind": "page", "id": "page:home", "path": "/", "title": "Home", "renderMode": "ssr", "routeRef": "GET /" }
  },
  "edges": []
}
```

`00-page-title-tweak/after.json`: same JSON with `"title": "Welcome"`.

- [ ] **Step 2: Author 10 structural fixtures** under `test/fixtures/edits/structural/`. Examples: `00-page-path-change/`, `01-add-new-page/`, `02-remove-component/`, `03-endpoint-method-change/`, `04-flow-step-add/`, `05-component-props-add/`, `06-route-handler-type-change/`, `07-clientstate-transition-add/`, `08-database-region-change/`, `09-add-edge-renders/`.

- [ ] **Step 3: Author 10 SC-touching fixtures** under `test/fixtures/edits/security-compliance-touching/`. Examples: `00-add-authboundary/`, `01-modify-rls-policy/`, `02-add-pii-field/`, `03-add-compliance-class-hipaa/`, `04-modify-cors-allowlist/`, `05-remove-authboundary/`, `06-modify-pii-classification/`, `07-add-baseline-compliance/`, `08-rls-policy-bypass/`, `09-data-residency-region-change/`.

Helper script (developer convenience, optional) — `test/build-fixtures.mjs` reads a CSV of `(folder, change-spec)` and produces the before/after JSON pairs. Engineer judgement on whether to write the helper or hand-author each.

- [ ] **Step 4: Write the corpus test**

`test/classify-cosmetic.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffGraphs } from "../src/diff.js";
import { classifyEdit } from "../src/classify.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures", "edits", "cosmetic");

describe("cosmetic edit fixtures", () => {
  for (const dir of readdirSync(root)) {
    const fullDir = join(root, dir);
    if (!statSync(fullDir).isDirectory()) continue;
    it(`${dir} → cosmetic`, () => {
      const before = JSON.parse(readFileSync(join(fullDir, "before.json"), "utf8"));
      const after = JSON.parse(readFileSync(join(fullDir, "after.json"), "utf8"));
      const result = classifyEdit(diffGraphs(before, after));
      expect(result.class).toBe("cosmetic");
    });
  }
});
```

(Mirror this for `classify-structural.test.ts` and `classify-security-compliance.test.ts`, swapping the `root` directory + `expect` value.)

- [ ] **Step 5: Run + commit**

```bash
pnpm -F @atlas/edit-classifier test classify-cosmetic classify-structural classify-security-compliance
git add packages/edit-classifier/test/fixtures/ packages/edit-classifier/test/classify-cosmetic.test.ts packages/edit-classifier/test/classify-structural.test.ts packages/edit-classifier/test/classify-security-compliance.test.ts
git commit -m "test(edit-classifier): 30 fixture-corpus tests across all 3 tiers"
```

---

### Task 7: Public `src/index.ts`

```typescript
export * from "./types.js";
export * from "./diff.js";
export * from "./rules.js";
export * from "./classify.js";
```

Add public-API smoke test asserting `classifyEdit`, `diffGraphs`, `rateField`, `EditClassSchema` are exported. Commit:

```bash
git add packages/edit-classifier/src/index.ts packages/edit-classifier/test/public-api.test.ts
git commit -m "feat(edit-classifier): public API barrel"
```

---

### Task 8: Scaffold `packages/gate-scheduler/`

**Files:** package.json, tsconfig, vitest.config, src/index.ts placeholder.

```json
{
  "name": "@atlas/gate-scheduler",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@atlas/edit-classifier": "workspace:*",
    "@atlas/ritual-engine": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
    "zod": "3.23.8",
    "simple-git": "^3.27.0"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

Same scaffold pattern (tsconfig + vitest + src/index.ts placeholder). Verify + commit:

```bash
pnpm install && pnpm -F @atlas/gate-scheduler typecheck
git add packages/gate-scheduler/ pnpm-lock.yaml
git commit -m "feat(gate-scheduler): scaffold package with edit-classifier + ritual-engine + simple-git deps"
```

---

### Task 9: `GateLayer` + `GateResult` + `GateRunner` interface

**Files:** `src/types.ts` + `test/types.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { GateLayerSchema, GateResultSchema, type GateRunner } from "../src/types.js";

describe("gate-scheduler types", () => {
  it("GateLayerSchema accepts L1-L7", () => {
    for (const l of ["L1", "L2", "L3", "L4", "L5", "L6", "L7"]) {
      expect(GateLayerSchema.parse(l)).toBe(l);
    }
  });

  it("GateResultSchema parses a passed result", () => {
    const r = { layer: "L4", status: "passed", summary: "no issues" };
    expect(GateResultSchema.parse(r)).toEqual(r);
  });

  it("GateResultSchema parses a failed result with issues", () => {
    const r = {
      layer: "L4",
      status: "failed",
      summary: "missing RLS",
      issues: [{ severity: "critical", message: "Model:user lacks rlsPolicies.select" }]
    };
    expect(GateResultSchema.parse(r)).toEqual(r);
  });

  it("GateRunner interface accepts a stub implementation", async () => {
    const stub: GateRunner = {
      layer: "L4",
      async run() {
        return { layer: "L4", status: "passed", summary: "ok" };
      }
    };
    expect((await stub.run({} as never)).status).toBe("passed");
  });
});
```

- [ ] **Step 2: Run — fail**, then implement `src/types.ts`:

```typescript
import { z } from "zod";

export const GateLayerSchema = z.enum(["L1", "L2", "L3", "L4", "L5", "L6", "L7"]);
export type GateLayer = z.infer<typeof GateLayerSchema>;

export const GateIssueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  message: z.string()
});

export const GateResultSchema = z.object({
  layer: GateLayerSchema,
  status: z.enum(["passed", "failed"]),
  summary: z.string(),
  issues: z.array(GateIssueSchema).optional()
});
export type GateResult = z.infer<typeof GateResultSchema>;

export interface GateRunInput {
  ritualId: string;
  projectId: string;
  commitSha: string;
  graphSlice: { bytes: string; hash: string };
}

export interface GateRunner {
  readonly layer: GateLayer;
  run(input: GateRunInput): Promise<GateResult>;
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/gate-scheduler test types
git add packages/gate-scheduler/src/types.ts packages/gate-scheduler/test/types.test.ts
git commit -m "feat(gate-scheduler): GateLayer + GateResult + GateRunner interface"
```

---

### Task 10: `scheduleGates()` — split L1-L5 into sync vs async per tier

Per PRD §11.4, the schedule per tier:

| Tier | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| cosmetic | sync | sync | async | async | async |
| structural | sync | sync | sync | sync | sync |
| security-compliance-touching | sync | sync | sync | sync (+ explicit human gate) | sync (+ explicit human gate) |

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { scheduleGates } from "../src/schedule.js";
import type { EditClassification } from "@atlas/edit-classifier";

const cosmetic: EditClassification = { class: "cosmetic", reason: "x", drivers: [] };
const structural: EditClassification = { class: "structural", reason: "x", drivers: [] };
const sct: EditClassification = { class: "security-compliance-touching", reason: "x", drivers: [] };

describe("scheduleGates", () => {
  it("cosmetic: L1+L2 sync; L3+L4+L5 async", () => {
    const s = scheduleGates(cosmetic);
    expect(s.sync).toEqual(["L1", "L2"]);
    expect(s.async).toEqual(["L3", "L4", "L5"]);
    expect(s.requiresHumanGate).toBe(false);
  });

  it("structural: L1-L5 all sync", () => {
    const s = scheduleGates(structural);
    expect(s.sync).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(s.async).toEqual([]);
    expect(s.requiresHumanGate).toBe(false);
  });

  it("security-compliance-touching: L1-L5 sync + explicit human gate flag", () => {
    const s = scheduleGates(sct);
    expect(s.sync).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(s.async).toEqual([]);
    expect(s.requiresHumanGate).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `src/schedule.ts`**

```typescript
import type { EditClassification } from "@atlas/edit-classifier";
import type { GateLayer } from "./types.js";

export interface GateSchedule {
  sync: GateLayer[];
  async: GateLayer[];
  requiresHumanGate: boolean;
}

const ALL_GATES: GateLayer[] = ["L1", "L2", "L3", "L4", "L5"];

export function scheduleGates(classification: EditClassification): GateSchedule {
  switch (classification.class) {
    case "cosmetic":
      return { sync: ["L1", "L2"], async: ["L3", "L4", "L5"], requiresHumanGate: false };
    case "structural":
      return { sync: ALL_GATES, async: [], requiresHumanGate: false };
    case "security-compliance-touching":
      return { sync: ALL_GATES, async: [], requiresHumanGate: true };
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/gate-scheduler test schedule
git add packages/gate-scheduler/src/schedule.ts packages/gate-scheduler/test/schedule.test.ts
git commit -m "feat(gate-scheduler): scheduleGates per PRD §11.4 tier table"
```

---

### Task 11: `runSyncGates()` — invokes runners in order, short-circuits on fail

**Files:** `src/sync-runner.ts` + test.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { runSyncGates } from "../src/sync-runner.js";
import type { GateRunner } from "../src/types.js";

const passing = (layer: string): GateRunner => ({ layer: layer as never, async run() { return { layer: layer as never, status: "passed", summary: "ok" }; } });
const failing = (layer: string): GateRunner => ({ layer: layer as never, async run() { return { layer: layer as never, status: "failed", summary: "boom" }; } });

const input = { ritualId: "r", projectId: "p", commitSha: "abc", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } };

describe("runSyncGates", () => {
  it("runs all gates when all pass", async () => {
    const results = await runSyncGates([passing("L1"), passing("L2")], input);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "passed")).toBe(true);
  });

  it("short-circuits on first failure", async () => {
    const results = await runSyncGates([passing("L1"), failing("L2"), passing("L3")], input);
    expect(results).toHaveLength(2);
    expect(results[1].status).toBe("failed");
  });

  it("returns empty for empty input", async () => {
    expect(await runSyncGates([], input)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { GateResult, GateRunInput, GateRunner } from "./types.js";

export async function runSyncGates(runners: GateRunner[], input: GateRunInput): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const runner of runners) {
    const r = await runner.run(input);
    results.push(r);
    if (r.status === "failed") break;
  }
  return results;
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/gate-scheduler test sync-runner
git add packages/gate-scheduler/src/sync-runner.ts packages/gate-scheduler/test/sync-runner.test.ts
git commit -m "feat(gate-scheduler): runSyncGates short-circuits on first failure"
```

---

### Task 12: `AsyncGateQueue` interface + `InMemoryAsyncQueue`

**Files:** `src/async-queue.ts` + test.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryAsyncQueue, type AsyncGateJob } from "../src/async-queue.js";

const job = (id: string, layer: "L3" | "L4" | "L5"): AsyncGateJob => ({
  id, layer, ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "sha256:" + "0".repeat(64),
  enqueuedAt: new Date().toISOString()
});

describe("InMemoryAsyncQueue", () => {
  it("enqueue + dequeue FIFO", async () => {
    const q = new InMemoryAsyncQueue();
    await q.enqueue(job("a", "L3"));
    await q.enqueue(job("b", "L4"));
    expect((await q.dequeue())?.id).toBe("a");
    expect((await q.dequeue())?.id).toBe("b");
    expect(await q.dequeue()).toBeNull();
  });

  it("size reflects enqueued count", async () => {
    const q = new InMemoryAsyncQueue();
    expect(await q.size()).toBe(0);
    await q.enqueue(job("a", "L3"));
    expect(await q.size()).toBe(1);
    await q.dequeue();
    expect(await q.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { z } from "zod";
import { GateLayerSchema } from "./types.js";

export const AsyncGateJobSchema = z.object({
  id: z.string(),
  layer: GateLayerSchema,
  ritualId: z.string(),
  projectId: z.string(),
  commitSha: z.string(),
  graphSliceHash: z.string(),
  enqueuedAt: z.string()
});
export type AsyncGateJob = z.infer<typeof AsyncGateJobSchema>;

export interface AsyncGateQueue {
  enqueue(job: AsyncGateJob): Promise<void>;
  dequeue(): Promise<AsyncGateJob | null>;
  size(): Promise<number>;
}

export class InMemoryAsyncQueue implements AsyncGateQueue {
  private items: AsyncGateJob[] = [];
  async enqueue(job: AsyncGateJob): Promise<void> {
    this.items.push(job);
  }
  async dequeue(): Promise<AsyncGateJob | null> {
    return this.items.shift() ?? null;
  }
  async size(): Promise<number> {
    return this.items.length;
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/gate-scheduler test async-queue
git add packages/gate-scheduler/src/async-queue.ts packages/gate-scheduler/test/async-queue.test.ts
git commit -m "feat(gate-scheduler): AsyncGateQueue interface + InMemoryAsyncQueue (FIFO)"
```

---

### Task 13: `RollbackArm` + `executeRollback()` (git revert path)

**Files:** `src/rollback-arm.ts` + test.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RollbackArm, executeRollback } from "../src/rollback-arm.js";

describe("RollbackArm + executeRollback", () => {
  it("RollbackArm captures the commit + reason", () => {
    const arm = new RollbackArm("abc123", "L4 CVE-rated dependency");
    expect(arm.commitSha).toBe("abc123");
    expect(arm.reason).toContain("CVE");
    expect(arm.executed).toBe(false);
  });

  it("executeRollback runs git revert via injected runner + marks executed", async () => {
    const gitRevert = vi.fn(async () => "reverted abc123");
    const arm = new RollbackArm("abc123", "test");
    const result = await executeRollback(arm, gitRevert);
    expect(gitRevert).toHaveBeenCalledWith("abc123");
    expect(result.success).toBe(true);
    expect(arm.executed).toBe(true);
  });

  it("executeRollback failure surfaces error + arm stays unexecuted", async () => {
    const gitRevert = vi.fn(async () => { throw new Error("conflict"); });
    const arm = new RollbackArm("abc123", "test");
    const result = await executeRollback(arm, gitRevert);
    expect(result.success).toBe(false);
    expect(result.error).toContain("conflict");
    expect(arm.executed).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export class RollbackArm {
  readonly commitSha: string;
  readonly reason: string;
  private _executed = false;
  constructor(commitSha: string, reason: string) {
    this.commitSha = commitSha;
    this.reason = reason;
  }
  get executed(): boolean { return this._executed; }
  /** Internal — only executeRollback should mark this. */
  _markExecuted(): void { this._executed = true; }
}

export type GitRevertFn = (commitSha: string) => Promise<string>;

export interface RollbackResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function executeRollback(arm: RollbackArm, gitRevert: GitRevertFn): Promise<RollbackResult> {
  try {
    const output = await gitRevert(arm.commitSha);
    arm._markExecuted();
    return { success: true, output };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/gate-scheduler test rollback-arm
git add packages/gate-scheduler/src/rollback-arm.ts packages/gate-scheduler/test/rollback-arm.test.ts
git commit -m "feat(gate-scheduler): RollbackArm + executeRollback (git revert via injected runner)"
```

---

### Task 14: Three user-facing resolutions per PRD §9.5

**Files:** `src/resolution.ts` + test.

The three resolutions on persistent gate failure:
1. `retry-with-hint` — re-run the gate with a hint string.
2. `undo` — invoke the rollback arm.
3. `risk-accept` — emit a `ritual.risk_accepted` event via E.1's `engine.acceptRisk`.

Max 3 retries before the resolution path is forced.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { ResolutionFlow, type ResolutionChoice } from "../src/resolution.js";

describe("ResolutionFlow", () => {
  it("retry-with-hint increments attempt + invokes the runner", async () => {
    const runner = vi.fn(async () => ({ layer: "L4" as const, status: "failed" as const, summary: "again" }));
    const flow = new ResolutionFlow({ maxRetries: 3 });
    const r1 = await flow.choose({ kind: "retry-with-hint", hint: "tighten CORS allowlist" }, runner);
    expect(runner).toHaveBeenCalledOnce();
    expect(flow.attempts).toBe(1);
    expect(r1.status).toBe("failed");
  });

  it("undo invokes the rollback arm + does not call runner", async () => {
    const runner = vi.fn();
    const rollback = vi.fn(async () => ({ success: true }));
    const flow = new ResolutionFlow({ maxRetries: 3 });
    const result = await flow.choose({ kind: "undo", rollback } as never, runner);
    expect(rollback).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
    expect((result as { kind: string }).kind).toBe("undone");
  });

  it("risk-accept invokes engine.acceptRisk + does not call runner", async () => {
    const runner = vi.fn();
    const acceptRisk = vi.fn(async () => {});
    const flow = new ResolutionFlow({ maxRetries: 3 });
    const result = await flow.choose({
      kind: "risk-accept",
      acceptRisk,
      ritualId: "r-1",
      event: {
        gate: "L4-security",
        failureSummary: "wildcard CORS for legacy",
        acceptedBy: { personaTier: "diego", userId: "u", timestamp: "t" },
        rationale: "twenty character rationale here",
        scope: "session"
      }
    } as never, runner);
    expect(acceptRisk).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
    expect((result as { kind: string }).kind).toBe("risk-accepted");
  });

  it("max retries enforced — 4th retry rejects", async () => {
    const runner = vi.fn(async () => ({ layer: "L4" as const, status: "failed" as const, summary: "again" }));
    const flow = new ResolutionFlow({ maxRetries: 3 });
    for (let i = 0; i < 3; i++) {
      await flow.choose({ kind: "retry-with-hint", hint: "h" }, runner);
    }
    await expect(flow.choose({ kind: "retry-with-hint", hint: "h" }, runner)).rejects.toThrow(/max retries/i);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { GateResult, GateRunner } from "./types.js";

export type ResolutionChoice =
  | { kind: "retry-with-hint"; hint: string }
  | { kind: "undo"; rollback: () => Promise<{ success: boolean }> }
  | {
      kind: "risk-accept";
      acceptRisk: (ritualId: string, event: unknown) => Promise<void>;
      ritualId: string;
      event: unknown;
    };

export type ResolutionResult =
  | (GateResult & { kind: "retried" })
  | { kind: "undone"; success: boolean }
  | { kind: "risk-accepted" };

export class ResolutionFlow {
  private _attempts = 0;
  private readonly maxRetries: number;
  constructor(opts: { maxRetries: number }) {
    this.maxRetries = opts.maxRetries;
  }
  get attempts(): number { return this._attempts; }
  async choose(choice: ResolutionChoice, runner: (input: never) => Promise<GateResult>): Promise<ResolutionResult> {
    if (choice.kind === "retry-with-hint") {
      if (this._attempts >= this.maxRetries) {
        throw new Error(`max retries (${this.maxRetries}) exceeded`);
      }
      this._attempts += 1;
      const r = await runner({} as never);
      return { ...r, kind: "retried" } as ResolutionResult;
    }
    if (choice.kind === "undo") {
      const u = await choice.rollback();
      return { kind: "undone", success: u.success };
    }
    // risk-accept
    await choice.acceptRisk(choice.ritualId, choice.event);
    return { kind: "risk-accepted" };
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/gate-scheduler test resolution
git add packages/gate-scheduler/src/resolution.ts packages/gate-scheduler/test/resolution.test.ts
git commit -m "feat(gate-scheduler): ResolutionFlow — retry/undo/risk-accept with max-retries cap"
```

---

### Task 15: `AsyncGateWorker` — drains queue + fires resolutions on failure

**Files:** `src/async-worker.ts` + tests (`async-worker.test.ts`, `async-worker-rollback.test.ts`).

The worker pulls jobs from the queue, runs the assigned `GateRunner`, and on failure:
- if any issue is `severity: "critical"` AND a `RollbackArm` is registered → auto-execute rollback
- otherwise → emit a `Resolution` notification awaiting user choice

- [ ] **Step 1: Write happy-path test (queue drain)**

`test/async-worker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { AsyncGateWorker } from "../src/async-worker.js";
import { InMemoryAsyncQueue } from "../src/async-queue.js";

describe("AsyncGateWorker drain", () => {
  it("processes every queued job in order until queue is empty", async () => {
    const q = new InMemoryAsyncQueue();
    await q.enqueue({ id: "j1", layer: "L4", ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "h", enqueuedAt: "t" });
    await q.enqueue({ id: "j2", layer: "L5", ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "h", enqueuedAt: "t" });
    const runner = { L4: vi.fn(async () => ({ layer: "L4" as const, status: "passed" as const, summary: "ok" })),
                     L5: vi.fn(async () => ({ layer: "L5" as const, status: "passed" as const, summary: "ok" })) };
    const notify = vi.fn(async () => {});
    const worker = new AsyncGateWorker({
      queue: q,
      runners: new Map(Object.entries(runner) as never),
      notify
    });
    await worker.drainOnce();
    expect(runner.L4).toHaveBeenCalledOnce();
    expect(runner.L5).toHaveBeenCalledOnce();
    expect(await q.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Write rollback test**

`test/async-worker-rollback.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { AsyncGateWorker } from "../src/async-worker.js";
import { InMemoryAsyncQueue } from "../src/async-queue.js";
import { RollbackArm } from "../src/rollback-arm.js";

describe("AsyncGateWorker auto-rollback on critical failure", () => {
  it("critical-severity failure triggers executeRollback automatically", async () => {
    const q = new InMemoryAsyncQueue();
    const job = { id: "j1", layer: "L4" as const, ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "h", enqueuedAt: "t" };
    await q.enqueue(job);
    const runner = vi.fn(async () => ({
      layer: "L4" as const,
      status: "failed" as const,
      summary: "CVE",
      issues: [{ severity: "critical" as const, message: "react@18.0.0 has CVE-2026-XYZ" }]
    }));
    const gitRevert = vi.fn(async () => "reverted abc");
    const notify = vi.fn(async () => {});
    const worker = new AsyncGateWorker({
      queue: q,
      runners: new Map([["L4", runner]] as never),
      notify,
      registerArm: (commit) => new RollbackArm(commit, "auto critical"),
      gitRevert
    });
    await worker.drainOnce();
    expect(gitRevert).toHaveBeenCalledWith("abc");
    expect(notify).toHaveBeenCalled();
    const notification = notify.mock.calls[0][0] as { severity: string; rollbackExecuted: boolean };
    expect(notification.severity).toBe("critical");
    expect(notification.rollbackExecuted).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `src/async-worker.ts`**

```typescript
import type { AsyncGateQueue, AsyncGateJob } from "./async-queue.js";
import type { GateRunner } from "./types.js";
import { RollbackArm, executeRollback, type GitRevertFn } from "./rollback-arm.js";

export interface AsyncGateNotification {
  jobId: string;
  layer: string;
  status: "passed" | "failed";
  summary: string;
  severity: "notice" | "alert" | "critical";
  rollbackExecuted: boolean;
}

export interface AsyncGateWorkerOptions {
  queue: AsyncGateQueue;
  runners: Map<string, GateRunner["run"]>;
  notify: (note: AsyncGateNotification) => Promise<void>;
  registerArm?: (commitSha: string) => RollbackArm;
  gitRevert?: GitRevertFn;
}

export class AsyncGateWorker {
  private readonly queue: AsyncGateQueue;
  private readonly runners: Map<string, GateRunner["run"]>;
  private readonly notify: (n: AsyncGateNotification) => Promise<void>;
  private readonly registerArm?: (commitSha: string) => RollbackArm;
  private readonly gitRevert?: GitRevertFn;

  constructor(opts: AsyncGateWorkerOptions) {
    this.queue = opts.queue;
    this.runners = opts.runners;
    this.notify = opts.notify;
    this.registerArm = opts.registerArm;
    this.gitRevert = opts.gitRevert;
  }

  async drainOnce(): Promise<void> {
    while (true) {
      const job = await this.queue.dequeue();
      if (!job) return;
      await this.runJob(job);
    }
  }

  private async runJob(job: AsyncGateJob): Promise<void> {
    const runner = this.runners.get(job.layer);
    if (!runner) {
      await this.notify({
        jobId: job.id, layer: job.layer, status: "failed",
        summary: `no runner registered for layer ${job.layer}`,
        severity: "alert", rollbackExecuted: false
      });
      return;
    }
    const result = await runner({
      ritualId: job.ritualId, projectId: job.projectId,
      commitSha: job.commitSha, graphSlice: { bytes: "", hash: job.graphSliceHash }
    });

    let severity: AsyncGateNotification["severity"] = "notice";
    let rollbackExecuted = false;
    if (result.status === "failed") {
      const hasCritical = result.issues?.some((i) => i.severity === "critical") ?? false;
      severity = hasCritical ? "critical" : "alert";
      if (hasCritical && this.registerArm && this.gitRevert) {
        const arm = this.registerArm(job.commitSha);
        const r = await executeRollback(arm, this.gitRevert);
        rollbackExecuted = r.success;
      }
    }
    await this.notify({
      jobId: job.id, layer: job.layer,
      status: result.status, summary: result.summary,
      severity, rollbackExecuted
    });
  }
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/gate-scheduler test async-worker
git add packages/gate-scheduler/src/async-worker.ts packages/gate-scheduler/test/async-worker.test.ts packages/gate-scheduler/test/async-worker-rollback.test.ts
git commit -m "feat(gate-scheduler): AsyncGateWorker — drains queue, auto-rollback on critical issues"
```

---

### Task 16: Public `src/index.ts` for gate-scheduler

```typescript
export * from "./types.js";
export * from "./schedule.js";
export * from "./sync-runner.js";
export * from "./async-queue.js";
export * from "./async-worker.js";
export * from "./rollback-arm.js";
export * from "./resolution.js";
```

Add public-API smoke test asserting key exports. Commit.

```bash
git add packages/gate-scheduler/src/index.ts packages/gate-scheduler/test/public-api.test.ts
git commit -m "feat(gate-scheduler): public API barrel"
```

---

### Task 17: End-to-end integration — classify → schedule → run → resolve

**Files:** `test/integration.test.ts` (in gate-scheduler package).

Wires `@atlas/edit-classifier.classifyEdit + diffGraphs` + `scheduleGates` + `runSyncGates` + `AsyncGateWorker` end-to-end with stubbed `GateRunner`s.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { diffGraphs, classifyEdit } from "@atlas/edit-classifier";
import { scheduleGates } from "../src/schedule.js";
import { runSyncGates } from "../src/sync-runner.js";
import { AsyncGateWorker } from "../src/async-worker.js";
import { InMemoryAsyncQueue } from "../src/async-queue.js";
import type { GateRunner } from "../src/types.js";

const baseGraph = {
  schemaVersion: "1.0.0", projectId: "p", name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DB" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "t", updatedAt: "t",
  nodes: { "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" } },
  edges: []
};

const passing: GateRunner = { layer: "L1", async run() { return { layer: "L1", status: "passed", summary: "ok" }; } };

describe("integration: cosmetic edit → 2 sync, 3 async", () => {
  it("classifies a title-only change as cosmetic and schedules accordingly", async () => {
    const after = { ...baseGraph, nodes: { "page:home": { ...baseGraph.nodes["page:home"], title: "Welcome" } } };
    const changes = diffGraphs(baseGraph as never, after as never);
    const classification = classifyEdit(changes);
    expect(classification.class).toBe("cosmetic");

    const schedule = scheduleGates(classification);
    expect(schedule.sync).toEqual(["L1", "L2"]);
    expect(schedule.async).toEqual(["L3", "L4", "L5"]);

    const syncResults = await runSyncGates([passing, { ...passing, layer: "L2" }], {
      ritualId: "r", projectId: "p", commitSha: "abc",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });
    expect(syncResults).toHaveLength(2);
    expect(syncResults.every((r) => r.status === "passed")).toBe(true);

    // Enqueue async gates
    const queue = new InMemoryAsyncQueue();
    for (const layer of schedule.async) {
      await queue.enqueue({
        id: `${layer}-r`, layer, ritualId: "r", projectId: "p", commitSha: "abc",
        graphSliceHash: "sha256:" + "0".repeat(64), enqueuedAt: "t"
      });
    }
    const notifications: unknown[] = [];
    const worker = new AsyncGateWorker({
      queue,
      runners: new Map([
        ["L3", async () => ({ layer: "L3", status: "passed", summary: "ok" })],
        ["L4", async () => ({ layer: "L4", status: "passed", summary: "ok" })],
        ["L5", async () => ({ layer: "L5", status: "passed", summary: "ok" })]
      ] as never),
      notify: async (n) => { notifications.push(n); }
    });
    await worker.drainOnce();
    expect(notifications).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Commit**
```bash
pnpm -F @atlas/gate-scheduler test integration
git add packages/gate-scheduler/test/integration.test.ts
git commit -m "test(gate-scheduler): end-to-end cosmetic edit → classify → schedule → sync + async"
```

---

### Task 18: Build + workspace smoke

```bash
pnpm -F @atlas/edit-classifier build && pnpm -F @atlas/gate-scheduler build
pnpm -F @atlas/edit-classifier test && pnpm -F @atlas/gate-scheduler test
pnpm -r test
```

```bash
git commit --allow-empty -m "chore(edit-classifier, gate-scheduler): full-suite smoke green"
```

---

### Task 19: Package READMEs

Two READMEs (one per package). edit-classifier README documents the rule table + how to extend. gate-scheduler README documents the schedule per tier + how to register runners + the rollback contract. Standard format from prior plans.

```bash
git add packages/edit-classifier/README.md packages/gate-scheduler/README.md
git commit -m "docs(edit-classifier, gate-scheduler): READMEs — rule table, schedule per tier, rollback contract"
```

---

### Task 20: Update plan index + handoff

Insert G.1 row in the Plan index after F.1:

```
| 13 | `2026-04-20-edit-classifier-gate-scheduler.md` | **G.1 — Edit Classifier + Gate Scheduler** | Deterministic edit-tier classifier (cosmetic/structural/SC-touching); sync-async gate scheduler per PRD §11.4; auto-rollback on critical issues; 3 user resolutions (retry/undo/risk-accept) | 20 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Renumber subsequent rows (directional docs +1 each). Refresh execution-order diagram to show G.1 as a sibling of F.1 under E.1. Commit.

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add G.1 edit-classifier + gate-scheduler to plan index"
```

---

## Completion Checklist

- [ ] `pnpm -F @atlas/edit-classifier test` green; ≥ 30 fixture tests pass
- [ ] `pnpm -F @atlas/gate-scheduler test` green
- [ ] No cross-package regressions
- [ ] Cosmetic edit produces 2 sync + 3 async gates per scheduleGates
- [ ] Critical-severity async failure auto-executes rollback
- [ ] Plan index lists G.1 as shipped (pending merge)

## Handoff to G.2 + D.4 + D.5

- **G.2** (Latency Harness) imports `classifyEdit` to bucket measurements by tier; targets PRD §NFR-8 `<200ms cosmetic p50`.
- **D.4 + D.5** (Security + Accessibility roles) implement concrete `GateRunner`s (their `layer` = L4 / L5) and wire them into the scheduler's runner map at app startup.
- **F.1** (Bootstrap Checkpoint) does not schedule gates directly — it intercepts the first ritual and runs its 6-item checklist; on pass, the normal scheduler takes over.
