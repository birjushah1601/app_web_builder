# Bootstrap Checkpoint + Risk-Acceptance Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/bootstrap-checkpoint/` — a 6-item sanity checklist that runs **once per project, on the first Visualize→Agree→Build ritual**, before the engine transitions out of `visualize`. Each item is persona-tiered (Ama sees plain language, Diego sees graph nodes, Priya sees raw JSON). Failure to pass any item routes the ritual back to `visualize` with the specific item flagged. Implements the bootstrap checkpoint from PRD §18.2 and Council blind-spot #1, plus formalises the audit trail of risk-accept events from Plan E.1.

**Architecture:** A single new pnpm-workspace package. The checkpoint engine wraps `@atlas/ritual-engine.RitualEngine` via a thin adapter — it does NOT modify the engine itself. Instead, it subscribes to the engine's `EventSink`, watches for the first `ritual.transitioned { from: visualize, to: agree }` event for a given `projectId`, intercepts it, runs the checklist, and either: (a) emits `bootstrap.passed` and lets the ritual proceed, or (b) emits `bootstrap.failed { items }` and triggers a `changes_requested` to route back to visualize. "First ritual ever" tracking lives in `@atlas/spec-graph-data`'s `bootstrap_checkpoints` table (one row per project; absent = first ritual). Subsequent rituals on the project skip the checkpoint unless the user explicitly opts in via a `rerun: true` flag (regulated-industry customers per PRD §18.2).

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS. Workspace deps: `@atlas/ritual-engine`, `@atlas/spec-graph-data`, `@atlas/spec-graph-schema`. No new external runtime deps.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans A.1, B.1, C.1, D.1, D.2, E.1 merged (the package consumes their packages).
- Node 22 LTS + pnpm 9+.
- DB required for Tasks 4 + 18 (bootstrap_checkpoints table + integration test).

---

## File Structure

```
packages/
  bootstrap-checkpoint/                       # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts
      checklist.ts                            # the 6 canonical items + ChecklistItemSchema
      persona-views.ts                        # per-persona renderer interface (returns prompts/cards)
      checkpoint-store.ts                     # CheckpointStore interface + InMemoryCheckpointStore
      checkpoint.ts                           # BootstrapCheckpoint class — subscribes, intercepts, runs
      events.ts                               # bootstrap.* event union extending RitualEvent
      errors.ts
    test/
      checklist.test.ts
      persona-views.test.ts
      checkpoint-store.test.ts
      checkpoint-first-ritual.test.ts
      checkpoint-skip-on-second-ritual.test.ts
      checkpoint-rerun-flag.test.ts
      checkpoint-failure-routes-back.test.ts
      checkpoint-persona-rendering.test.ts
      integration.test.ts                     # against real DB if available; else skipped

packages/spec-graph-data/                     # MODIFIED
  src/repo/bootstrap-repo.ts                  # NEW — bootstrap_checkpoints table accessor
  src/schema/migrations/                      # NEW migration: bootstrap_checkpoints table
  test/repo/bootstrap-repo.test.ts            # NEW

docs/superpowers/plans/
  README.md                                   # MODIFIED — add F.1 entry
```

**Why this shape.** The checkpoint is a *decorator* over `RitualEngine`, not a fork. Subscribing to the engine's existing `EventSink` keeps the engine pure. The `CheckpointStore` interface lets tests use in-memory storage; production points at `bootstrap_checkpoints` in `@atlas/spec-graph-data`. Persona-rendering is a separate module so UI surfaces (Plan E.2) can reuse it without pulling in the entire checkpoint runtime.

## Open-question resolutions

These resolve four open questions from `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` Unit F section:

- **OQ1 (six items or fewer) → six is correct for v1.** The PRD §18.2 enumerates them. Plan F.1 ships the six; plan-author re-validation against 3 real pilot projects (per the directional doc) becomes a Phase A exit criterion, not an F.1 task.
- **OQ2 ("something's off" escape-hatch routing) → free-text field + Priya-reviewer escalation.** Item #6 ("Is anything off about this plan you can't articulate?") emits `bootstrap.escalation_requested` event with the free-text and a `requestedReviewer: "priya"` flag. The UI surface (Plan E.2) renders an "ask a reviewer" affordance.
- **OQ3 (risk-accept time budget) → 20+ chars rationale, no multi-confirm.** Already enforced by E.1's `RiskAcceptedSchema.rationale.min(20)`. F.1 reuses the schema unchanged.
- **OQ4 (auditor-plane integration) → emit-and-forget; auditor reads from `spec_events`.** The checkpoint emits `bootstrap.passed` / `bootstrap.failed` / `bootstrap.escalation_requested` to the same `EventSink` the engine uses. The auditor is downstream — F.1 doesn't author a separate `compliance-evidence/` writer here; that lands with the L4/L5 merge gates in D.4/D.5.

---

## The 6 canonical checklist items (PRD §18.2 source of truth)

| # | Item | Affirms |
|---|---|---|
| 1 | Is the compliance class correct? | The Spec Graph's root `complianceClasses` array matches the project's regulatory context (HIPAA / GDPR / DPDP-India / SOC2 / PCI / etc.). |
| 2 | Is the data-residency region correct? | The `databaseProvider.region` matches the project's residency requirements. |
| 3 | Is the auth provider correct? | The project's chosen auth provider (Clerk / Supabase Auth / Lucia) is what the user expects. |
| 4 | Is the DB provider correct? | The `databaseProvider.provider` (e.g., neon, supabase) is what the user expects. |
| 5 | Is the persona tier correct? | The user's effective persona for this project (Ama / Diego / Priya) is what they expect. Switching tier here is a one-click flow. |
| 6 | Is anything off about this plan you can't articulate? | Free-text escape hatch. Triggers the `bootstrap.escalation_requested` event. |

Each item is **persona-tiered**:
- Ama: a card with simple language and a single Yes / No / Ask.
- Diego: the checkbox + the underlying graph-node id and field path being affirmed.
- Priya: the raw JSON mutation + a "view event" link.

---

## Tasks

### Task 1: Scaffold `packages/bootstrap-checkpoint/`

**Files:** package.json, tsconfig, vitest.config, src/index.ts placeholder.

- [ ] **Step 1: Tree**
```bash
mkdir -p packages/bootstrap-checkpoint/src packages/bootstrap-checkpoint/test
```

- [ ] **Step 2: package.json**

```json
{
  "name": "@atlas/bootstrap-checkpoint",
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
    "@atlas/ritual-engine": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
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

- [ ] **Step 3: tsconfig + vitest** — same shape as `packages/ritual-engine/*`.
- [ ] **Step 4: src/index.ts placeholder** — `export {};`
- [ ] **Step 5: Install + verify**
```bash
pnpm install
pnpm -F @atlas/bootstrap-checkpoint typecheck
```
Expected: exit 0.
- [ ] **Step 6: Commit**
```bash
git add packages/bootstrap-checkpoint/ pnpm-lock.yaml
git commit -m "feat(bootstrap-checkpoint): scaffold package with workspace deps on ritual-engine + spec-graph-data"
```

---

### Task 2: `ChecklistItem` + `ChecklistItemSchema` + the 6 canonical items

**Files:** create `src/checklist.ts` + `test/checklist.test.ts`.

- [ ] **Step 1: Write failing test**

`test/checklist.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CANONICAL_ITEMS, ChecklistItemSchema, ChecklistResultSchema, type ChecklistItem } from "../src/checklist.js";

describe("Bootstrap checklist items", () => {
  it("ships exactly 6 canonical items", () => {
    expect(CANONICAL_ITEMS).toHaveLength(6);
  });

  it("every item has id, key, prompt, kind", () => {
    for (const item of CANONICAL_ITEMS) {
      expect(ChecklistItemSchema.parse(item)).toEqual(item);
    }
  });

  it("items 1-5 are kind=affirm; item 6 is kind=escape_hatch", () => {
    expect(CANONICAL_ITEMS.slice(0, 5).every((i) => i.kind === "affirm")).toBe(true);
    expect(CANONICAL_ITEMS[5].kind).toBe("escape_hatch");
  });

  it("item keys are stable identifiers used in events", () => {
    const keys = CANONICAL_ITEMS.map((i) => i.key);
    expect(keys).toEqual([
      "compliance_class",
      "data_residency_region",
      "auth_provider",
      "db_provider",
      "persona_tier",
      "intuition_check"
    ]);
  });

  it("ChecklistResultSchema accepts a passed result", () => {
    const r = ChecklistResultSchema.parse({
      passed: true,
      itemResults: CANONICAL_ITEMS.map((i) => ({ key: i.key, passed: true }))
    });
    expect(r.passed).toBe(true);
  });

  it("ChecklistResultSchema rejects passed=true with any item failed", () => {
    expect(() => ChecklistResultSchema.parse({
      passed: true,
      itemResults: [{ key: "compliance_class", passed: false, notes: "wrong" }]
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checklist
```

- [ ] **Step 3: Implement `src/checklist.ts`**

```typescript
import { z } from "zod";

export const ChecklistItemSchema = z.object({
  id: z.number().int().min(1).max(6),
  key: z.string().min(1),
  prompt: z.string().min(1),
  kind: z.enum(["affirm", "escape_hatch"])
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CANONICAL_ITEMS: ChecklistItem[] = [
  { id: 1, key: "compliance_class", prompt: "Is the compliance class correct?", kind: "affirm" },
  { id: 2, key: "data_residency_region", prompt: "Is the data-residency region correct?", kind: "affirm" },
  { id: 3, key: "auth_provider", prompt: "Is the auth provider correct?", kind: "affirm" },
  { id: 4, key: "db_provider", prompt: "Is the DB provider correct?", kind: "affirm" },
  { id: 5, key: "persona_tier", prompt: "Is the persona tier correct?", kind: "affirm" },
  { id: 6, key: "intuition_check", prompt: "Is anything off about this plan you can't articulate?", kind: "escape_hatch" }
];

export const ItemResultSchema = z.object({
  key: z.string(),
  passed: z.boolean(),
  notes: z.string().optional()
});
export type ItemResult = z.infer<typeof ItemResultSchema>;

export const ChecklistResultSchema = z.object({
  passed: z.boolean(),
  itemResults: z.array(ItemResultSchema)
}).superRefine((result, ctx) => {
  const anyFailed = result.itemResults.some((r) => !r.passed);
  if (result.passed && anyFailed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "passed cannot be true when any itemResult.passed=false",
      path: ["passed"]
    });
  }
});
export type ChecklistResult = z.infer<typeof ChecklistResultSchema>;
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checklist
git add packages/bootstrap-checkpoint/src/checklist.ts packages/bootstrap-checkpoint/test/checklist.test.ts
git commit -m "feat(bootstrap-checkpoint): 6 canonical items + ChecklistResult Zod with superRefine"
```

---

### Task 3: Persona-tiered renderer interface

**Files:** `src/persona-views.ts` + `test/persona-views.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
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
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/bootstrap-checkpoint test persona-views
```

- [ ] **Step 3: Implement**

`src/persona-views.ts`:

```typescript
import type { PersonaTier } from "@atlas/ritual-engine";
import type { ChecklistItem } from "./checklist.js";

export interface ItemContext {
  graphNodeId: string;
  fieldPath: string;
  rawValue: unknown;
}

export interface ItemView {
  prompt: string;
  detail?: string;
  actions: string[];
  inputKind: "buttons" | "free_text";
}

export function renderItemForPersona(
  item: ChecklistItem,
  persona: PersonaTier,
  ctx: ItemContext
): ItemView {
  if (item.kind === "escape_hatch") {
    return {
      prompt: item.prompt,
      actions: ["Submit", "Skip"],
      inputKind: "free_text"
    };
  }
  switch (persona) {
    case "ama":
      return { prompt: item.prompt, actions: ["Yes", "No", "Ask"], inputKind: "buttons" };
    case "diego":
      return {
        prompt: item.prompt,
        detail: `Affirming ${ctx.graphNodeId} :: ${ctx.fieldPath}`,
        actions: ["Approve", "Reject"],
        inputKind: "buttons"
      };
    case "priya":
      return {
        prompt: item.prompt,
        detail: `${ctx.fieldPath} = ${JSON.stringify(ctx.rawValue)}`,
        actions: ["Approve", "Reject", "View event"],
        inputKind: "buttons"
      };
  }
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test persona-views
git add packages/bootstrap-checkpoint/src/persona-views.ts packages/bootstrap-checkpoint/test/persona-views.test.ts
git commit -m "feat(bootstrap-checkpoint): persona-tiered item renderer (Ama/Diego/Priya views)"
```

---

### Task 4: `CheckpointStore` interface + InMemory + spec-graph-data table

**Files:**
- Create: `src/checkpoint-store.ts` + `test/checkpoint-store.test.ts`
- Create: `packages/spec-graph-data/src/repo/bootstrap-repo.ts` + migration + test
- Modify: `packages/spec-graph-data/src/index.ts` (export the new repo)

The `CheckpointStore` knows: "for project P, has the bootstrap checkpoint already passed?" Two implementations: `InMemoryCheckpointStore` for tests + a `BootstrapRepo` in spec-graph-data wired to a new `bootstrap_checkpoints` table.

- [ ] **Step 1: Write failing test for InMemory**

`test/checkpoint-store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

describe("InMemoryCheckpointStore", () => {
  it("returns false for an unseen project", async () => {
    const store = new InMemoryCheckpointStore();
    expect(await store.hasPassed("p-1")).toBe(false);
  });

  it("returns true after markPassed", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "2026-04-20T00:00:00Z", ritualId: "r-1" });
    expect(await store.hasPassed("p-1")).toBe(true);
  });

  it("getRecord returns the stored record", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "t", ritualId: "r-1" });
    const rec = await store.getRecord("p-1");
    expect(rec?.ritualId).toBe("r-1");
  });
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-store
```

- [ ] **Step 3: Implement `src/checkpoint-store.ts`**

```typescript
export interface CheckpointRecord {
  ts: string;
  ritualId: string;
}

export interface CheckpointStore {
  hasPassed(projectId: string): Promise<boolean>;
  markPassed(projectId: string, record: CheckpointRecord): Promise<void>;
  getRecord(projectId: string): Promise<CheckpointRecord | null>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, CheckpointRecord>();
  async hasPassed(projectId: string): Promise<boolean> {
    return this.store.has(projectId);
  }
  async markPassed(projectId: string, record: CheckpointRecord): Promise<void> {
    this.store.set(projectId, record);
  }
  async getRecord(projectId: string): Promise<CheckpointRecord | null> {
    return this.store.get(projectId) ?? null;
  }
}
```

- [ ] **Step 4: Add the spec-graph-data side**

In `packages/spec-graph-data/src/schema/migrations/`, create the next-numbered migration file:

```sql
-- 00NN_bootstrap_checkpoints.sql
CREATE TABLE bootstrap_checkpoints (
  project_id  uuid PRIMARY KEY REFERENCES spec_graphs(project_id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  ritual_id   text NOT NULL
);
COMMENT ON TABLE bootstrap_checkpoints IS 'One row per project; absent = first ritual not yet bootstrapped.';
```

(Replace `00NN` with the actual next migration number — check the highest existing.)

Create `packages/spec-graph-data/src/repo/bootstrap-repo.ts`:

```typescript
import type { Pool } from "pg";

export interface BootstrapRecord {
  ts: string;
  ritualId: string;
}

export class BootstrapRepo {
  constructor(private readonly pool: Pool) {}

  async hasPassed(projectId: string): Promise<boolean> {
    const r = await this.pool.query("SELECT 1 FROM bootstrap_checkpoints WHERE project_id = $1", [projectId]);
    return r.rowCount! > 0;
  }

  async markPassed(projectId: string, record: BootstrapRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO bootstrap_checkpoints (project_id, ts, ritual_id) VALUES ($1, $2, $3) ON CONFLICT (project_id) DO NOTHING",
      [projectId, record.ts, record.ritualId]
    );
  }

  async getRecord(projectId: string): Promise<BootstrapRecord | null> {
    const r = await this.pool.query<{ ts: string; ritual_id: string }>(
      "SELECT ts, ritual_id FROM bootstrap_checkpoints WHERE project_id = $1",
      [projectId]
    );
    if (r.rowCount === 0) return null;
    return { ts: r.rows[0].ts, ritualId: r.rows[0].ritual_id };
  }
}
```

Export it in `packages/spec-graph-data/src/index.ts`:

```typescript
export { BootstrapRepo, type BootstrapRecord } from "./repo/bootstrap-repo.js";
```

Create `packages/spec-graph-data/test/repo/bootstrap-repo.test.ts` following the existing repo-test pattern (use the global setup that hits Postgres on port 5433):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { BootstrapRepo } from "../../src/repo/bootstrap-repo.js";
import { withTestDb } from "../helpers/with-test-db.js"; // existing helper from A.1

describe("BootstrapRepo", () => {
  it("hasPassed false initially, true after markPassed", async () => {
    await withTestDb(async (pool) => {
      const projectId = "11111111-1111-4111-8111-111111111111";
      // Insert a parent spec_graph row for FK
      await pool.query(
        "INSERT INTO spec_graphs (project_id, name, schema_version, graph_data) VALUES ($1, 'demo', '1.0.0', '{}')",
        [projectId]
      );
      const repo = new BootstrapRepo(pool);
      expect(await repo.hasPassed(projectId)).toBe(false);
      await repo.markPassed(projectId, { ts: "2026-04-20T00:00:00Z", ritualId: "r-1" });
      expect(await repo.hasPassed(projectId)).toBe(true);
      const r = await repo.getRecord(projectId);
      expect(r?.ritualId).toBe("r-1");
    });
  });
});
```

If the existing `with-test-db` helper doesn't match the import path, adjust per A.1's actual helper layout — read `packages/spec-graph-data/test/` to find the canonical fixture.

- [ ] **Step 5: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-store
pnpm -F @atlas/spec-graph-data test bootstrap-repo
git add packages/bootstrap-checkpoint/src/checkpoint-store.ts packages/bootstrap-checkpoint/test/checkpoint-store.test.ts packages/spec-graph-data/src/repo/bootstrap-repo.ts packages/spec-graph-data/src/schema/migrations/ packages/spec-graph-data/src/index.ts packages/spec-graph-data/test/repo/bootstrap-repo.test.ts
git commit -m "feat(bootstrap-checkpoint, spec-graph-data): CheckpointStore interface + BootstrapRepo + bootstrap_checkpoints migration"
```

---

### Task 5: `bootstrap.*` event union extending `RitualEvent`

**Files:** `src/events.ts` + test.

The checkpoint emits its own typed events through the same `EventSink` the engine uses. Three event types:

- `bootstrap.required` — emitted at first-ritual interception
- `bootstrap.passed` — all 6 items passed; ritual proceeds
- `bootstrap.failed` — at least one item failed; ritual routes back to visualize
- `bootstrap.escalation_requested` — item #6 emitted free text → Priya escalation

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { BootstrapEventSchema, type BootstrapEvent } from "../src/events.js";

describe("BootstrapEventSchema", () => {
  it("parses bootstrap.required", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.required", ritualId: "r-1", projectId: "p-1", ts: "t"
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });

  it("parses bootstrap.passed", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.passed", ritualId: "r-1", projectId: "p-1", ts: "t",
      payload: { itemKeys: ["compliance_class", "auth_provider"] }
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });

  it("parses bootstrap.failed with itemResults", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.failed", ritualId: "r-1", projectId: "p-1", ts: "t",
      payload: { failedKeys: ["compliance_class"], notes: { compliance_class: "actually GDPR not HIPAA" } }
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });

  it("parses bootstrap.escalation_requested with free-text and reviewer", () => {
    const e: BootstrapEvent = {
      type: "bootstrap.escalation_requested", ritualId: "r-1", projectId: "p-1", ts: "t",
      payload: { freeText: "I just have a bad feeling about the auth setup", requestedReviewer: "priya" }
    };
    expect(BootstrapEventSchema.parse(e)).toEqual(e);
  });
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/bootstrap-checkpoint test events
```

- [ ] **Step 3: Implement `src/events.ts`**

```typescript
import { z } from "zod";

const BaseSchema = z.object({
  ritualId: z.string().min(1),
  projectId: z.string().min(1),
  ts: z.string()
});

const Required = BaseSchema.extend({ type: z.literal("bootstrap.required") });
const Passed = BaseSchema.extend({
  type: z.literal("bootstrap.passed"),
  payload: z.object({ itemKeys: z.array(z.string()) })
});
const Failed = BaseSchema.extend({
  type: z.literal("bootstrap.failed"),
  payload: z.object({
    failedKeys: z.array(z.string()).min(1),
    notes: z.record(z.string(), z.string())
  })
});
const Escalation = BaseSchema.extend({
  type: z.literal("bootstrap.escalation_requested"),
  payload: z.object({
    freeText: z.string().min(1),
    requestedReviewer: z.enum(["priya"])
  })
});

export const BootstrapEventSchema = z.discriminatedUnion("type", [Required, Passed, Failed, Escalation]);
export type BootstrapEvent = z.infer<typeof BootstrapEventSchema>;
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test events
git add packages/bootstrap-checkpoint/src/events.ts packages/bootstrap-checkpoint/test/events.test.ts
git commit -m "feat(bootstrap-checkpoint): BootstrapEvent discriminated-union (required/passed/failed/escalation)"
```

---

### Task 6: `BootstrapCheckpoint` class — first-ritual interception

**Files:** `src/checkpoint.ts` + `test/checkpoint-first-ritual.test.ts`.

The checkpoint subscribes to the engine's events. On the first `ritual.transitioned` from `visualize` to `agree` (or to `build` for cosmetic) for a project that has NOT passed, it intercepts: emits `bootstrap.required`, runs the checklist via an injected `ChecklistRunner` (UI provides; tests use a deterministic stub), then either marks-passed and lets the ritual continue, or emits `bootstrap.failed` and re-routes via the engine's `approve(changes_requested)`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";
import type { ChecklistRunner } from "../src/checkpoint.js";

const passingRunner: ChecklistRunner = {
  async run(_items, _persona) {
    return {
      passed: true,
      itemResults: [
        { key: "compliance_class", passed: true },
        { key: "data_residency_region", passed: true },
        { key: "auth_provider", passed: true },
        { key: "db_provider", passed: true },
        { key: "persona_tier", passed: true },
        { key: "intuition_check", passed: true }
      ]
    };
  }
};

describe("BootstrapCheckpoint first ritual", () => {
  it("intercepts first-ritual transitioned event, runs runner, marks store passed", async () => {
    const store = new InMemoryCheckpointStore();
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store,
      runner: passingRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    // Engine emits ritual.transitioned visualize→agree for project p-1
    await cp.onRitualEvent({
      type: "ritual.transitioned",
      ritualId: "r-1",
      ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    // Should have emitted required + passed (in order)
    const calls = sink.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).toContain("bootstrap.required");
    expect(calls).toContain("bootstrap.passed");
    expect(calls.indexOf("bootstrap.required")).toBeLessThan(calls.indexOf("bootstrap.passed"));

    // Store now records the project
    expect(await store.hasPassed("p-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fail**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-first-ritual
```

- [ ] **Step 3: Implement `src/checkpoint.ts`**

```typescript
import type { PersonaPreferences, RitualEvent } from "@atlas/ritual-engine";
import { CANONICAL_ITEMS, type ChecklistItem, type ChecklistResult } from "./checklist.js";
import type { BootstrapEvent } from "./events.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface ChecklistRunner {
  run(items: ChecklistItem[], persona: PersonaTier): Promise<ChecklistResult>;
}

export interface BootstrapCheckpointOptions {
  store: CheckpointStore;
  runner: ChecklistRunner;
  eventSink: { emit(event: BootstrapEvent): Promise<void> };
  personaPreferences: PersonaPreferences;
}

export interface RitualContext {
  projectId: string;
  userId: string;
}

export class BootstrapCheckpoint {
  private readonly store: CheckpointStore;
  private readonly runner: ChecklistRunner;
  private readonly sink: { emit(event: BootstrapEvent): Promise<void> };
  private readonly prefs: PersonaPreferences;

  constructor(opts: BootstrapCheckpointOptions) {
    this.store = opts.store;
    this.runner = opts.runner;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
  }

  /** Engine wires every RitualEvent through this method. The checkpoint
   *  inspects only the first transitioned-out-of-visualize event per project. */
  async onRitualEvent(event: RitualEvent, ctx: RitualContext): Promise<void> {
    if (event.type !== "ritual.transitioned") return;
    if (event.payload.from !== "visualize") return;
    if (event.payload.to !== "agree" && event.payload.to !== "build") return;

    if (await this.store.hasPassed(ctx.projectId)) return;

    const ts = new Date().toISOString();
    await this.sink.emit({
      type: "bootstrap.required",
      ritualId: event.ritualId,
      projectId: ctx.projectId,
      ts
    });

    const persona = await this.prefs.getPersona(ctx.userId, ctx.projectId);
    const result = await this.runner.run(CANONICAL_ITEMS, persona);

    if (result.passed) {
      await this.store.markPassed(ctx.projectId, { ts, ritualId: event.ritualId });
      await this.sink.emit({
        type: "bootstrap.passed",
        ritualId: event.ritualId,
        projectId: ctx.projectId,
        ts: new Date().toISOString(),
        payload: { itemKeys: result.itemResults.map((r) => r.key) }
      });
    } else {
      const failed = result.itemResults.filter((r) => !r.passed);
      const notes: Record<string, string> = {};
      for (const r of failed) if (r.notes) notes[r.key] = r.notes;
      await this.sink.emit({
        type: "bootstrap.failed",
        ritualId: event.ritualId,
        projectId: ctx.projectId,
        ts: new Date().toISOString(),
        payload: { failedKeys: failed.map((r) => r.key), notes }
      });
    }
  }
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-first-ritual
git add packages/bootstrap-checkpoint/src/checkpoint.ts packages/bootstrap-checkpoint/test/checkpoint-first-ritual.test.ts
git commit -m "feat(bootstrap-checkpoint): BootstrapCheckpoint intercepts first-ritual transition + runs checklist"
```

---

### Task 7: Skip on second ritual (already passed)

**Files:** `test/checkpoint-skip-on-second-ritual.test.ts`.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const noopRunner = { run: vi.fn(async () => ({ passed: true, itemResults: [] })) };

describe("BootstrapCheckpoint skip on second ritual", () => {
  it("does not re-run the checklist if the project already passed", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "yesterday", ritualId: "r-0" });
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner: noopRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-2", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    expect(noopRunner.run).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-skip-on-second-ritual
git add packages/bootstrap-checkpoint/test/checkpoint-skip-on-second-ritual.test.ts
git commit -m "test(bootstrap-checkpoint): skip checklist on second+ ritual when project already passed"
```

---

### Task 8: `rerun: true` flag re-runs even if passed

**Files:** modify `src/checkpoint.ts` to accept a `rerun` flag in `onRitualEvent` context + add test.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

describe("BootstrapCheckpoint rerun flag", () => {
  it("re-runs the checklist when ctx.rerun is true even if previously passed", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "yesterday", ritualId: "r-0" });
    const runner = { run: vi.fn(async () => ({ passed: true, itemResults: [{ key: "compliance_class", passed: true }] })) };
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "priya"; } }
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-2", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1", rerun: true });

    expect(runner.run).toHaveBeenCalledOnce();
    const types = sink.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("bootstrap.required");
    expect(types).toContain("bootstrap.passed");
  });
});
```

- [ ] **Step 2: Modify `RitualContext` in `checkpoint.ts`**

Add an optional `rerun?: boolean` field:

```typescript
export interface RitualContext {
  projectId: string;
  userId: string;
  rerun?: boolean;
}
```

Modify the early-return guard:

```typescript
if (!ctx.rerun && await this.store.hasPassed(ctx.projectId)) return;
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-rerun-flag
git add packages/bootstrap-checkpoint/src/checkpoint.ts packages/bootstrap-checkpoint/test/checkpoint-rerun-flag.test.ts
git commit -m "feat(bootstrap-checkpoint): rerun=true flag bypasses already-passed guard for regulated re-checks"
```

---

### Task 9: Failure routes back via `engine.approve(changes_requested)`

**Files:** modify `checkpoint.ts` to take an optional `RitualEngine` reference + invoke `approve` on failure; add test.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const failingRunner = {
  run: async () => ({
    passed: false,
    itemResults: [
      { key: "compliance_class", passed: false, notes: "actually GDPR" },
      { key: "data_residency_region", passed: true },
      { key: "auth_provider", passed: true },
      { key: "db_provider", passed: true },
      { key: "persona_tier", passed: true },
      { key: "intuition_check", passed: true }
    ]
  })
};

describe("BootstrapCheckpoint failure path", () => {
  it("on failure, calls engine.approve(changes_requested) to route back to visualize", async () => {
    const store = new InMemoryCheckpointStore();
    const sink = vi.fn(async () => {});
    const approve = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner: failingRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "diego"; } },
      ritualEngine: { approve } as never
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-1", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    expect(approve).toHaveBeenCalledOnce();
    const call = approve.mock.calls[0];
    expect(call[0]).toBe("r-1");
    expect((call[1] as { kind: string }).kind).toBe("changes_requested");
    expect((call[1] as { notes: string }).notes).toContain("compliance_class");
  });
});
```

- [ ] **Step 2: Modify `checkpoint.ts`**

Add an optional `ritualEngine` injection:

```typescript
export interface BootstrapCheckpointOptions {
  store: CheckpointStore;
  runner: ChecklistRunner;
  eventSink: { emit(event: BootstrapEvent): Promise<void> };
  personaPreferences: PersonaPreferences;
  ritualEngine?: { approve(ritualId: string, decision: { kind: "changes_requested"; requestedBy: string; notes: string }): Promise<void> };
}
```

In the failure branch, after emitting `bootstrap.failed`, if `ritualEngine` is provided, call:

```typescript
if (this.ritualEngine) {
  const notesString = `Bootstrap checkpoint failed on: ${failed.map((r) => r.key).join(", ")}`;
  await this.ritualEngine.approve(event.ritualId, {
    kind: "changes_requested",
    requestedBy: "bootstrap-checkpoint",
    notes: notesString
  });
}
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-failure-routes-back
git add packages/bootstrap-checkpoint/src/checkpoint.ts packages/bootstrap-checkpoint/test/checkpoint-failure-routes-back.test.ts
git commit -m "feat(bootstrap-checkpoint): on failure, route back via engine.approve(changes_requested)"
```

---

### Task 10: Escape-hatch (item #6) emits escalation_requested

**Files:** modify `checkpoint.ts` + add test.

If the runner's result for `intuition_check` is `passed: false` AND has non-empty `notes`, emit `bootstrap.escalation_requested` instead of (or in addition to) `bootstrap.failed`.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const escalatingRunner = {
  run: async () => ({
    passed: false,
    itemResults: [
      { key: "compliance_class", passed: true },
      { key: "data_residency_region", passed: true },
      { key: "auth_provider", passed: true },
      { key: "db_provider", passed: true },
      { key: "persona_tier", passed: true },
      { key: "intuition_check", passed: false, notes: "Auth setup feels off, can't articulate why" }
    ]
  })
};

describe("BootstrapCheckpoint escape hatch", () => {
  it("intuition_check failed → emits bootstrap.escalation_requested with the free text", async () => {
    const store = new InMemoryCheckpointStore();
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner: escalatingRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "ama"; } }
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-1", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    const types = sink.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("bootstrap.escalation_requested");
    const escalation = sink.mock.calls.find((c) => (c[0] as { type: string }).type === "bootstrap.escalation_requested");
    const payload = (escalation![0] as { payload: { freeText: string; requestedReviewer: string } }).payload;
    expect(payload.freeText).toContain("Auth setup");
    expect(payload.requestedReviewer).toBe("priya");
  });
});
```

- [ ] **Step 2: Modify `checkpoint.ts`**

After the failure branch's `bootstrap.failed` emission, before invoking `engine.approve`:

```typescript
const intuition = result.itemResults.find((r) => r.key === "intuition_check");
if (intuition && !intuition.passed && intuition.notes) {
  await this.sink.emit({
    type: "bootstrap.escalation_requested",
    ritualId: event.ritualId,
    projectId: ctx.projectId,
    ts: new Date().toISOString(),
    payload: { freeText: intuition.notes, requestedReviewer: "priya" }
  });
}
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-escape-hatch
git add packages/bootstrap-checkpoint/src/checkpoint.ts packages/bootstrap-checkpoint/test/checkpoint-escape-hatch.test.ts
git commit -m "feat(bootstrap-checkpoint): item #6 (intuition_check) failure emits escalation_requested + free text"
```

---

### Task 11: Persona-rendering integration test

**Files:** `test/checkpoint-persona-rendering.test.ts`.

Verifies that the runner injection point + `renderItemForPersona` produce the expected per-persona prompts.

- [ ] **Step 1: Write test**

```typescript
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
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test checkpoint-persona-rendering
git add packages/bootstrap-checkpoint/test/checkpoint-persona-rendering.test.ts
git commit -m "test(bootstrap-checkpoint): persona rendering for all 5 affirm-kind items"
```

---

### Task 12: Public `src/index.ts` exports

**Files:** modify `src/index.ts`.

```typescript
export * from "./checklist.js";
export * from "./persona-views.js";
export * from "./checkpoint-store.js";
export * from "./events.js";
export * from "./checkpoint.js";
```

- [ ] **Step 1: Add a public-API smoke test asserting key exports.**

```typescript
import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API", () => {
  it("exports the canonical names", () => {
    for (const name of [
      "CANONICAL_ITEMS", "ChecklistItemSchema", "ChecklistResultSchema",
      "renderItemForPersona", "InMemoryCheckpointStore",
      "BootstrapEventSchema", "BootstrapCheckpoint"
    ]) {
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test public-api
git add packages/bootstrap-checkpoint/src/index.ts packages/bootstrap-checkpoint/test/public-api.test.ts
git commit -m "feat(bootstrap-checkpoint): public API barrel"
```

---

### Task 13: End-to-end integration with real `RitualEngine`

**Files:** `test/integration.test.ts`.

Mounts a real `RitualEngine` (E.1) with a stubbed Conductor + a real `BootstrapCheckpoint` subscribed to the same `EventSink`. Walks a first ritual through; checkpoint fires; passes; ritual proceeds.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine, InMemoryEventSink } from "@atlas/ritual-engine";
import type { Conductor } from "@atlas/conductor";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const conductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { ok: true } } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("BootstrapCheckpoint + RitualEngine integration", () => {
  it("first ritual triggers the checkpoint; passes; engine continues to agree", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });
    const store = new InMemoryCheckpointStore();
    const passingRunner = {
      async run() {
        return {
          passed: true,
          itemResults: [
            { key: "compliance_class", passed: true },
            { key: "data_residency_region", passed: true },
            { key: "auth_provider", passed: true },
            { key: "db_provider", passed: true },
            { key: "persona_tier", passed: true },
            { key: "intuition_check", passed: true }
          ]
        };
      }
    };
    const cp = new BootstrapCheckpoint({
      store, runner: passingRunner,
      eventSink: { emit: async (e) => { sink.events; await sink.emit(e as never); } },
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    // Wire the checkpoint as a side-channel: re-emit every ritual event into it
    const projectId = "p-int-1";
    const userId = "u-int-1";
    const r = await engine.start({
      userTurn: "feature", editClass: "structural",
      projectId, userId
    });
    // After start(), the engine has emitted ritual.transitioned. Replay it through the checkpoint.
    for (const ev of sink.events()) {
      await cp.onRitualEvent(ev as never, { projectId, userId });
    }

    expect(await store.hasPassed(projectId)).toBe(true);
    expect(engine.state(r)).toBe("agree"); // checkpoint passed; engine state untouched
  });
});
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/bootstrap-checkpoint test integration
git add packages/bootstrap-checkpoint/test/integration.test.ts
git commit -m "test(bootstrap-checkpoint): end-to-end with real RitualEngine + InMemoryCheckpointStore"
```

---

### Task 14: Build + workspace smoke

- [ ] **Step 1**
```bash
pnpm -F @atlas/bootstrap-checkpoint build
pnpm -F @atlas/bootstrap-checkpoint typecheck
pnpm -F @atlas/bootstrap-checkpoint test
pnpm -r test
```
Expected: package green; workspace tests green except pre-existing Postgres flakiness.

- [ ] **Step 2: Commit checkpoint**
```bash
git commit --allow-empty -m "chore(bootstrap-checkpoint): full-suite smoke — all workspace tests green post F.1"
```

---

### Task 15: Package README

**Files:** `packages/bootstrap-checkpoint/README.md`.

````markdown
# @atlas/bootstrap-checkpoint

Per-project, first-ritual sanity checklist. Implements PRD §18.2 + Council blind-spot #1.

## What it does

When a user runs Visualize → Agree → Build for the **first time** on a new Atlas project, this package intercepts the ritual immediately after the Architect emits its artifact and presents a 6-item persona-tiered checklist:

1. Is the compliance class correct?
2. Is the data-residency region correct?
3. Is the auth provider correct?
4. Is the DB provider correct?
5. Is the persona tier correct?
6. Is anything off about this plan you can't articulate?

If all 6 pass, the ritual proceeds. If any fails (items 1-5), the ritual routes back to Visualize with the failed items flagged. If item 6 fails with free text, an `bootstrap.escalation_requested` event is emitted requesting Priya-tier review. Subsequent rituals on the project skip the checkpoint unless the caller passes `rerun: true` (regulated-industry re-checks).

## Persona rendering

| Persona | View |
|---|---|
| Ama | Plain prompt + Yes / No / Ask buttons |
| Diego | Prompt + graph-node id + field path + Approve / Reject |
| Priya | Prompt + raw JSON value + Approve / Reject / View event |

## Public API

```ts
import {
  BootstrapCheckpoint,
  InMemoryCheckpointStore,
  CANONICAL_ITEMS,
  renderItemForPersona,
  type ChecklistRunner
} from "@atlas/bootstrap-checkpoint";

const cp = new BootstrapCheckpoint({
  store: bootstrapRepo,                // BootstrapRepo from @atlas/spec-graph-data in production
  runner: uiBackedRunner,              // UI provides; tests use a deterministic stub
  eventSink: ritualEngineEventSink,    // same sink the engine emits to
  personaPreferences: prefsImpl,
  ritualEngine: engine                 // optional; if provided, failures call engine.approve(changes_requested)
});

// Wire the engine to forward every event:
const sink = {
  async emit(event) {
    await ritualEngineSink.emit(event);
    await cp.onRitualEvent(event, { projectId, userId, rerun: false });
  }
};
```

## Testing

```bash
cd packages/bootstrap-checkpoint
pnpm test
```
````

- [ ] Commit
```bash
git add packages/bootstrap-checkpoint/README.md
git commit -m "docs(bootstrap-checkpoint): README — checklist items, persona rendering, public API"
```

---

### Task 16: Update plan index + handoff

**Files:** modify `docs/superpowers/plans/README.md`.

- [ ] **Step 1: Insert F.1 row after E.1**

```
| 12 | `2026-04-20-bootstrap-checkpoint.md` | **F.1 — Bootstrap Checkpoint + Risk-Acceptance Gates** | 6-item per-project sanity checklist intercepting the first ritual; persona-tiered renderer; bootstrap_checkpoints DB table; escalation_requested escape hatch | 16 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Renumber subsequent rows (directional docs become 13 + 14). Refresh execution-order diagram so F.1 appears under E.1.

- [ ] **Step 2: Commit**
```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add F.1 bootstrap-checkpoint to plan index"
```

---

## Completion Checklist

After all 16 tasks:

- [ ] `pnpm -F @atlas/bootstrap-checkpoint test` — all green (~12 tests)
- [ ] `pnpm -F @atlas/spec-graph-data test bootstrap-repo` — green (with Postgres available)
- [ ] `pnpm -F @atlas/bootstrap-checkpoint build` — exit 0
- [ ] First ritual triggers checkpoint; second ritual skips (unless `rerun: true`)
- [ ] Failure routes back via `engine.approve(changes_requested)` when engine reference is provided
- [ ] Item #6 free text → `bootstrap.escalation_requested` to Priya
- [ ] Persona rendering distinct per tier
- [ ] Plan index lists F.1 as shipped (pending merge)

## Handoff to G.1, G.2, E.2, D.4, D.5

- **G.1** (Edit Classifier): produces the `EditClass` value that gets passed to `engine.start({editClass})`. If `editClass === "security-compliance-touching"`, the bootstrap checkpoint runs even on second+ rituals (callers pass `rerun: true`).
- **G.2** (Latency Harness): measures the bootstrap-checkpoint round-trip and includes it in the cosmetic-edit p50 budget. Bootstrap should be under 100ms when skipped (the `hasPassed` lookup is the only DB hit).
- **E.2** (Atlas Web): implements the UI-backed `ChecklistRunner` — renders `renderItemForPersona` outputs, collects user responses, returns the `ChecklistResult`.
- **D.4 (Security)** + **D.5 (Accessibility)**: the L4 + L5 merge gates emit `RiskAccepted` events through the engine's `acceptRisk` API. The bootstrap checkpoint does NOT replicate this — it only handles per-project sanity at first ritual. Per-commit risk-accepts are the gates' responsibility, persisted via E.1's `RiskAcceptedSchema`.
