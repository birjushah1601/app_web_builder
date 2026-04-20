# Ritual Engine (headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/ritual-engine/` — the headless library that orchestrates Atlas's three-step **Visualize → Agree → Build** ritual across the three personas (Ama, Diego, Priya). The engine holds a typed state machine, dispatches role invocations via `@atlas/conductor`, persists every transition + approval + risk-accept to `@atlas/spec-graph-data`'s `spec_events`, and enforces persona-gated risk-accept policy per PRD §9.5. UI surfaces (Plans E.2–E.4) consume this engine; E.1 itself ships zero UI code.

**Architecture:** A single new pnpm-workspace package. `RitualEngine` is a class with state-machine semantics: `start(intent, context) → visualize → agree → build → done` with explicit escape hatches (`escalated`, `aborted`). Each transition emits a typed `RitualEvent` to a `EventSink` interface (the production wiring writes through `@atlas/spec-graph-data.specEventsRepo`; tests use an in-memory sink). The engine takes its `Conductor` + `EventSink` + `PersonaPreferences` as constructor injections so it stays purely deterministic over its inputs. Approval decisions and risk-accept events are validated against Zod schemas; the `RiskAcceptedSchema` is the canonical type Plan F.1's bootstrap checkpoint also imports. No runtime side effects beyond what the injected dependencies do.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS. Workspace deps: `@atlas/conductor`, `@atlas/spec-graph-data`, `@atlas/spec-graph-schema`. No new external runtime deps.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans A.1, B.1, C.1, D.1, D.2 merged (the engine consumes their packages).
- Node 22 LTS + pnpm 9+.
- DB required only for Task 16 (integration test); reuses A.1's docker-compose Postgres.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/
  ritual-engine/                              # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts                                # public API
      personas.ts                             # PersonaTier Zod + PersonaPreferences storage interface
      state.ts                                # RitualState Zod + valid-transitions table + applyTransition()
      events.ts                               # RitualEvent discriminated-union + EventSink interface
      approval.ts                             # ApprovalDecision Zod + applyApproval()
      risk-accept.ts                          # RiskAcceptedSchema + persona-gate enforcement
      engine.ts                               # RitualEngine class
      errors.ts                               # PersonaGateError, InvalidTransitionError, RitualAbortedError
    test/
      personas.test.ts
      state-transitions.test.ts
      events.test.ts
      approval.test.ts
      risk-accept-persona-gate.test.ts
      engine-happy.test.ts
      engine-escalation.test.ts
      engine-risk-accept.test.ts
      integration.test.ts                     # full engine with mocked Conductor + in-memory EventSink

docs/superpowers/plans/
  README.md                                   # MODIFIED — add E.1 entry
```

**Why this shape.** State-machine logic (`state.ts`) stays separate from approval and risk-accept policy (`approval.ts` + `risk-accept.ts`) so each unit can be unit-tested in isolation; `engine.ts` glues them via dependency injection. `EventSink` is an interface so tests use in-memory stubs and production wires through `@atlas/spec-graph-data` — matching B.1's opt-in validator pattern (data layer stays loosely coupled).

## Open-question resolutions

These resolve four open questions from `docs/superpowers/plans/2026-04-18-phase-a-units-b-through-g.md` Unit E section:

- **OQ4 (persona toggle persistence) → per-user profile flag with per-project override.** `PersonaPreferences` is an interface with `getPersona(userId, projectId): Promise<PersonaTier>`. Production wiring reads from `@atlas/spec-graph-data`'s `tenant_profiles` table (Phase A introduces this column); the engine never assumes a sync read.
- **OQ5 (risk-accept UX for Ama) → engine-level enforcement + escalation event.** Ama-tier callers attempting `gate: "L4-security"` or `gate: "L5-compliance"` risk-accepts get a `PersonaGateError` thrown synchronously; the engine emits a `ritual.escalation_requested` event so a UI surface (Plan E.2) can render the "ask a reviewer" affordance.
- **OQ6 (live-edit latency budget — state-machine transitions for cosmetic edits) → cosmetic-edit fast path documented.** Cosmetic-class edits (per PRD §9.5) skip the explicit `agree` state and go `visualize → build` directly. The engine's `start()` method takes an `editClass` hint; `editClass: "cosmetic"` produces a 2-state ritual; `structural` and `security-compliance-touching` produce the full 3-state ritual. The classifier itself is Plan G.1; E.1 just declares the contract.
- **OQ1 (auth provider at v1) → out of scope for E.1.** E.1 is headless and never authenticates; auth is the UI's concern (Plan E.2).
- **OQ2 (git integration mechanics) → out of scope for E.1.** Git integration lives in the Build state's role invocations (Developer role D.3 + Ship role in Phase B). The engine treats Build as opaque dispatch through Conductor.
- **OQ3 (canvas rendering tech) → out of scope for E.1.** Pure UI choice; lands in E.2.

---

## Tasks

### Task 1: Scaffold `packages/ritual-engine/`

**Files:**
- Create: `packages/ritual-engine/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (placeholder)

No TDD — scaffolding.

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p packages/ritual-engine/src packages/ritual-engine/test
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@atlas/ritual-engine",
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

- [ ] **Step 3: Write `tsconfig.json`** — same shape as `packages/conductor/tsconfig.json`. `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, strict, declaration, outDir `./dist`, rootDir `./src`, include `src/**/*`, exclude `test`, `dist`, `node_modules`.

- [ ] **Step 4: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
```

- [ ] **Step 5: Placeholder `src/index.ts`**

```typescript
export {};
```

- [ ] **Step 6: Install + verify**

```bash
pnpm install
pnpm -F @atlas/ritual-engine typecheck
pnpm -F @atlas/ritual-engine build
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/ritual-engine/ pnpm-lock.yaml
git commit -m "feat(ritual-engine): scaffold package with workspace deps on conductor + spec-graph-data + schema"
```

---

### Task 2: `PersonaTier` + `PersonaPreferences` interface

**Files:**
- Create: `packages/ritual-engine/src/personas.ts`
- Create: `packages/ritual-engine/test/personas.test.ts`

- [ ] **Step 1: Write failing test**

`packages/ritual-engine/test/personas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PersonaTierSchema, type PersonaTier, type PersonaPreferences, isAtLeast } from "../src/personas.js";

describe("PersonaTier", () => {
  it("accepts the three canonical tiers", () => {
    for (const t of ["ama", "diego", "priya"] as const) {
      expect(PersonaTierSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown tiers", () => {
    expect(() => PersonaTierSchema.parse("admin")).toThrow();
  });

  it("isAtLeast reflects the linear ordering ama < diego < priya", () => {
    expect(isAtLeast("ama", "ama")).toBe(true);
    expect(isAtLeast("diego", "ama")).toBe(true);
    expect(isAtLeast("priya", "diego")).toBe(true);
    expect(isAtLeast("ama", "diego")).toBe(false);
    expect(isAtLeast("ama", "priya")).toBe(false);
    expect(isAtLeast("diego", "priya")).toBe(false);
  });

  it("PersonaPreferences interface accepts an in-memory implementation", async () => {
    const stored = new Map<string, PersonaTier>([["u-1:p-1", "diego"]]);
    const prefs: PersonaPreferences = {
      async getPersona(userId, projectId) {
        return stored.get(`${userId}:${projectId}`) ?? "ama";
      }
    };
    expect(await prefs.getPersona("u-1", "p-1")).toBe("diego");
    expect(await prefs.getPersona("u-1", "p-other")).toBe("ama");
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/ritual-engine test personas
```

- [ ] **Step 3: Implement**

`packages/ritual-engine/src/personas.ts`:

```typescript
import { z } from "zod";

export const PersonaTierSchema = z.enum(["ama", "diego", "priya"]);
export type PersonaTier = z.infer<typeof PersonaTierSchema>;

const RANK: Record<PersonaTier, number> = { ama: 0, diego: 1, priya: 2 };

export function isAtLeast(actual: PersonaTier, required: PersonaTier): boolean {
  return RANK[actual] >= RANK[required];
}

export interface PersonaPreferences {
  /** Returns the user's persona for this project. Per-project override falls
   *  back to per-user default; default-default is "ama" (least privileged). */
  getPersona(userId: string, projectId: string): Promise<PersonaTier>;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/ritual-engine test personas
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/personas.ts packages/ritual-engine/test/personas.test.ts
git commit -m "feat(ritual-engine): PersonaTier + PersonaPreferences (per-user + per-project override)"
```

---

### Task 3: `RitualState` + valid-transitions table

**Files:**
- Create: `packages/ritual-engine/src/state.ts`
- Create: `packages/ritual-engine/test/state-transitions.test.ts`

The state machine has 5 named states: `visualize`, `agree`, `build`, `done`, `escalated`. Plus `aborted` for explicit user-initiated cancel. Transitions:

```
visualize → agree (artifact emitted)
visualize → build (cosmetic edit-class fast path)
visualize → escalated (Architect role escalation per D.2)
visualize → aborted (user cancel)
agree → visualize (changes_requested)
agree → build (approved)
agree → escalated (risk-accept by under-privileged persona)
agree → aborted
build → done (merge gates green)
build → escalated (merge gate failure exhausted retries)
build → aborted
```

Terminal states: `done`, `escalated`, `aborted`.

- [ ] **Step 1: Write failing test**

`packages/ritual-engine/test/state-transitions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RitualStateSchema, applyTransition, isTerminal, type RitualState, type RitualTransition } from "../src/state.js";
import { InvalidTransitionError } from "../src/errors.js";

describe("RitualState transitions", () => {
  it("RitualStateSchema accepts the 6 canonical states", () => {
    for (const s of ["visualize", "agree", "build", "done", "escalated", "aborted"] as const) {
      expect(RitualStateSchema.parse(s)).toBe(s);
    }
  });

  it("isTerminal returns true for done/escalated/aborted only", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("escalated")).toBe(true);
    expect(isTerminal("aborted")).toBe(true);
    expect(isTerminal("visualize")).toBe(false);
    expect(isTerminal("agree")).toBe(false);
    expect(isTerminal("build")).toBe(false);
  });

  it("visualize → agree on artifact_emitted", () => {
    expect(applyTransition("visualize", { kind: "artifact_emitted" })).toBe("agree");
  });

  it("visualize → build on artifact_emitted_cosmetic (fast path)", () => {
    expect(applyTransition("visualize", { kind: "artifact_emitted_cosmetic" })).toBe("build");
  });

  it("agree → build on approved", () => {
    expect(applyTransition("agree", { kind: "approved" })).toBe("build");
  });

  it("agree → visualize on changes_requested", () => {
    expect(applyTransition("agree", { kind: "changes_requested" })).toBe("visualize");
  });

  it("build → done on merge_gates_green", () => {
    expect(applyTransition("build", { kind: "merge_gates_green" })).toBe("done");
  });

  it("any → escalated on escalate", () => {
    for (const s of ["visualize", "agree", "build"] as const) {
      expect(applyTransition(s, { kind: "escalate", reason: "x" })).toBe("escalated");
    }
  });

  it("any → aborted on abort", () => {
    for (const s of ["visualize", "agree", "build"] as const) {
      expect(applyTransition(s, { kind: "abort", reason: "x" })).toBe("aborted");
    }
  });

  it("rejects illegal transitions with InvalidTransitionError", () => {
    expect(() => applyTransition("done", { kind: "approved" })).toThrow(InvalidTransitionError);
    expect(() => applyTransition("visualize", { kind: "approved" })).toThrow(InvalidTransitionError);
    expect(() => applyTransition("build", { kind: "changes_requested" })).toThrow(InvalidTransitionError);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/ritual-engine test state-transitions
```

- [ ] **Step 3: Implement**

`packages/ritual-engine/src/state.ts`:

```typescript
import { z } from "zod";
import { InvalidTransitionError } from "./errors.js";

export const RitualStateSchema = z.enum(["visualize", "agree", "build", "done", "escalated", "aborted"]);
export type RitualState = z.infer<typeof RitualStateSchema>;

export type RitualTransition =
  | { kind: "artifact_emitted" }
  | { kind: "artifact_emitted_cosmetic" }
  | { kind: "approved" }
  | { kind: "changes_requested" }
  | { kind: "merge_gates_green" }
  | { kind: "escalate"; reason: string }
  | { kind: "abort"; reason: string };

const TABLE: Record<string, RitualState> = {
  "visualize:artifact_emitted": "agree",
  "visualize:artifact_emitted_cosmetic": "build",
  "agree:approved": "build",
  "agree:changes_requested": "visualize",
  "build:merge_gates_green": "done"
};

const TERMINAL = new Set<RitualState>(["done", "escalated", "aborted"]);

export function isTerminal(state: RitualState): boolean {
  return TERMINAL.has(state);
}

export function applyTransition(state: RitualState, tx: RitualTransition): RitualState {
  if (tx.kind === "escalate") {
    if (TERMINAL.has(state)) throw new InvalidTransitionError(state, tx.kind);
    return "escalated";
  }
  if (tx.kind === "abort") {
    if (TERMINAL.has(state)) throw new InvalidTransitionError(state, tx.kind);
    return "aborted";
  }
  const key = `${state}:${tx.kind}`;
  const next = TABLE[key];
  if (!next) throw new InvalidTransitionError(state, tx.kind);
  return next;
}
```

- [ ] **Step 4: Implement minimal `errors.ts`** (will be expanded in later tasks):

`packages/ritual-engine/src/errors.ts`:

```typescript
export class RitualEngineError extends Error {}

export class InvalidTransitionError extends RitualEngineError {
  readonly fromState: string;
  readonly transitionKind: string;
  constructor(fromState: string, transitionKind: string) {
    super(`invalid transition from state=${fromState} on kind=${transitionKind}`);
    this.name = "InvalidTransitionError";
    this.fromState = fromState;
    this.transitionKind = transitionKind;
  }
}
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm -F @atlas/ritual-engine test state-transitions
```

Expected: 9 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/state.ts packages/ritual-engine/src/errors.ts packages/ritual-engine/test/state-transitions.test.ts
git commit -m "feat(ritual-engine): RitualState + applyTransition with cosmetic fast-path"
```

---

### Task 4: `RitualEvent` discriminated-union + `EventSink` interface

**Files:**
- Create: `packages/ritual-engine/src/events.ts`
- Create: `packages/ritual-engine/test/events.test.ts`

- [ ] **Step 1: Write failing test**

`packages/ritual-engine/test/events.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  RitualEventSchema,
  InMemoryEventSink,
  type RitualEvent,
  type EventSink
} from "../src/events.js";

describe("RitualEvent + EventSink", () => {
  it("RitualEventSchema parses ritual.started", () => {
    const e: RitualEvent = {
      type: "ritual.started",
      ritualId: "r-1",
      ts: "2026-04-20T00:00:00.000Z",
      payload: { intent: "add forgot-password", editClass: "structural", projectId: "p-1", userId: "u-1" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("RitualEventSchema parses ritual.transitioned", () => {
    const e: RitualEvent = {
      type: "ritual.transitioned",
      ritualId: "r-1",
      ts: "2026-04-20T00:00:00.000Z",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("RitualEventSchema parses ritual.escalation_requested", () => {
    const e: RitualEvent = {
      type: "ritual.escalation_requested",
      ritualId: "r-1",
      ts: "2026-04-20T00:00:00.000Z",
      payload: { reason: "ama-blocked-from-L4-security", requestedBy: "u-1" }
    };
    expect(RitualEventSchema.parse(e)).toEqual(e);
  });

  it("InMemoryEventSink stores events in order", async () => {
    const sink = new InMemoryEventSink();
    await sink.emit({
      type: "ritual.started", ritualId: "r-1", ts: "t1",
      payload: { intent: "i", editClass: "structural", projectId: "p", userId: "u" }
    });
    await sink.emit({
      type: "ritual.transitioned", ritualId: "r-1", ts: "t2",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    });
    expect(sink.events()).toHaveLength(2);
    expect(sink.events()[0].type).toBe("ritual.started");
    expect(sink.events()[1].type).toBe("ritual.transitioned");
  });

  it("EventSink interface accepts custom implementations", async () => {
    const captured: RitualEvent[] = [];
    const sink: EventSink = { emit: async (e) => { captured.push(e); } };
    await sink.emit({
      type: "ritual.started", ritualId: "r", ts: "t",
      payload: { intent: "i", editClass: "cosmetic", projectId: "p", userId: "u" }
    });
    expect(captured).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/ritual-engine test events
```

- [ ] **Step 3: Implement**

`packages/ritual-engine/src/events.ts`:

```typescript
import { z } from "zod";
import { RitualStateSchema } from "./state.js";

export const EditClassSchema = z.enum(["cosmetic", "structural", "security-compliance-touching"]);
export type EditClass = z.infer<typeof EditClassSchema>;

const RitualStartedSchema = z.object({
  type: z.literal("ritual.started"),
  ritualId: z.string().min(1),
  ts: z.string(),
  payload: z.object({
    intent: z.string(),
    editClass: EditClassSchema,
    projectId: z.string(),
    userId: z.string()
  })
});

const RitualTransitionedSchema = z.object({
  type: z.literal("ritual.transitioned"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    from: RitualStateSchema,
    to: RitualStateSchema,
    transitionKind: z.string()
  })
});

const RitualArtifactEmittedSchema = z.object({
  type: z.literal("ritual.artifact_emitted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    fromRole: z.string(),
    artifact: z.unknown()
  })
});

const RitualApprovedSchema = z.object({
  type: z.literal("ritual.approved"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    approvedBy: z.string(),
    persona: z.enum(["ama", "diego", "priya"])
  })
});

const RitualChangesRequestedSchema = z.object({
  type: z.literal("ritual.changes_requested"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ requestedBy: z.string(), notes: z.string() })
});

const RitualRiskAcceptedSchema = z.object({
  type: z.literal("ritual.risk_accepted"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    gate: z.enum(["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"]),
    failureSummary: z.string(),
    acceptedBy: z.object({
      personaTier: z.enum(["ama", "diego", "priya"]),
      userId: z.string(),
      timestamp: z.string()
    }),
    rationale: z.string().min(20),
    scope: z.enum(["single-commit", "session", "permanent-for-project"])
  })
});

const RitualEscalationRequestedSchema = z.object({
  type: z.literal("ritual.escalation_requested"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ reason: z.string(), requestedBy: z.string() })
});

const RitualMergeGateResultSchema = z.object({
  type: z.literal("ritual.merge_gate_result"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({
    layer: z.enum(["L1", "L2", "L3", "L4", "L5", "L6", "L7"]),
    status: z.enum(["passed", "failed"]),
    summary: z.string()
  })
});

const RitualCompletedSchema = z.object({
  type: z.literal("ritual.completed"),
  ritualId: z.string(),
  ts: z.string(),
  payload: z.object({ finalState: z.enum(["done", "escalated", "aborted"]) })
});

export const RitualEventSchema = z.discriminatedUnion("type", [
  RitualStartedSchema,
  RitualTransitionedSchema,
  RitualArtifactEmittedSchema,
  RitualApprovedSchema,
  RitualChangesRequestedSchema,
  RitualRiskAcceptedSchema,
  RitualEscalationRequestedSchema,
  RitualMergeGateResultSchema,
  RitualCompletedSchema
]);
export type RitualEvent = z.infer<typeof RitualEventSchema>;

export interface EventSink {
  emit(event: RitualEvent): Promise<void>;
}

export class InMemoryEventSink implements EventSink {
  private store: RitualEvent[] = [];
  async emit(event: RitualEvent): Promise<void> {
    this.store.push(event);
  }
  events(): readonly RitualEvent[] {
    return this.store;
  }
  clear(): void {
    this.store = [];
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/ritual-engine test events
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/events.ts packages/ritual-engine/test/events.test.ts
git commit -m "feat(ritual-engine): RitualEvent discriminated-union + InMemoryEventSink"
```

---

### Task 5: `ApprovalDecision` Zod + `applyApproval()`

**Files:**
- Create: `packages/ritual-engine/src/approval.ts`
- Create: `packages/ritual-engine/test/approval.test.ts`

- [ ] **Step 1: Write failing test**

`packages/ritual-engine/test/approval.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ApprovalDecisionSchema, applyApproval, type ApprovalDecision } from "../src/approval.js";

describe("ApprovalDecision", () => {
  it("parses an approved decision", () => {
    const d: ApprovalDecision = {
      kind: "approved",
      approvedBy: "u-1",
      persona: "diego"
    };
    expect(ApprovalDecisionSchema.parse(d)).toEqual(d);
  });

  it("parses a changes_requested decision with notes", () => {
    const d: ApprovalDecision = {
      kind: "changes_requested",
      requestedBy: "u-1",
      notes: "Needs RTL handling"
    };
    expect(ApprovalDecisionSchema.parse(d)).toEqual(d);
  });

  it("rejects approval with empty notes for changes_requested", () => {
    expect(() => ApprovalDecisionSchema.parse({
      kind: "changes_requested",
      requestedBy: "u-1",
      notes: ""
    })).toThrow();
  });

  it("applyApproval(approved) → state transition object", () => {
    const tx = applyApproval({ kind: "approved", approvedBy: "u-1", persona: "diego" });
    expect(tx).toEqual({ kind: "approved" });
  });

  it("applyApproval(changes_requested) → state transition object", () => {
    const tx = applyApproval({ kind: "changes_requested", requestedBy: "u-1", notes: "x" });
    expect(tx).toEqual({ kind: "changes_requested" });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm -F @atlas/ritual-engine test approval
```

- [ ] **Step 3: Implement**

`packages/ritual-engine/src/approval.ts`:

```typescript
import { z } from "zod";
import { PersonaTierSchema } from "./personas.js";
import type { RitualTransition } from "./state.js";

const ApprovedSchema = z.object({
  kind: z.literal("approved"),
  approvedBy: z.string().min(1),
  persona: PersonaTierSchema
});

const ChangesRequestedSchema = z.object({
  kind: z.literal("changes_requested"),
  requestedBy: z.string().min(1),
  notes: z.string().min(1)
});

export const ApprovalDecisionSchema = z.discriminatedUnion("kind", [
  ApprovedSchema,
  ChangesRequestedSchema
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export function applyApproval(decision: ApprovalDecision): RitualTransition {
  if (decision.kind === "approved") return { kind: "approved" };
  return { kind: "changes_requested" };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm -F @atlas/ritual-engine test approval
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/approval.ts packages/ritual-engine/test/approval.test.ts
git commit -m "feat(ritual-engine): ApprovalDecision Zod + applyApproval transition mapper"
```

---

### Task 6: `RiskAcceptedSchema` + `acceptRisk()` (no persona gate yet)

**Files:** create `packages/ritual-engine/src/risk-accept.ts` + extend `errors.ts`.

- [ ] **Step 1: Write failing test**

`packages/ritual-engine/test/risk-accept.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RiskAcceptedSchema, type RiskAccepted } from "../src/risk-accept.js";

describe("RiskAcceptedSchema", () => {
  it("parses a valid L4-security risk-accept", () => {
    const ev: RiskAccepted = {
      gate: "L4-security",
      failureSummary: "CORS policy reverts to wildcard",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "2026-04-20T00:00:00Z" },
      rationale: "Wildcard required for legacy partner integration; sunset by 2026-06-01",
      scope: "session"
    };
    expect(RiskAcceptedSchema.parse(ev)).toEqual(ev);
  });

  it("rejects rationale shorter than 20 chars", () => {
    expect(() => RiskAcceptedSchema.parse({
      gate: "L5-compliance",
      failureSummary: "f",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "t" },
      rationale: "too short",
      scope: "single-commit"
    })).toThrow();
  });

  it("rejects unknown gate", () => {
    expect(() => RiskAcceptedSchema.parse({
      gate: "L9-imaginary",
      failureSummary: "f",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "t" },
      rationale: "valid rationale that is at least twenty chars",
      scope: "session"
    })).toThrow();
  });

  it("rejects unknown scope", () => {
    expect(() => RiskAcceptedSchema.parse({
      gate: "L4-security",
      failureSummary: "f",
      acceptedBy: { personaTier: "priya", userId: "u-1", timestamp: "t" },
      rationale: "valid rationale that is at least twenty chars",
      scope: "forever-and-ever"
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/ritual-engine test risk-accept
```

- [ ] **Step 3: Implement**

`packages/ritual-engine/src/risk-accept.ts`:

```typescript
import { z } from "zod";
import { PersonaTierSchema } from "./personas.js";

export const GateSchema = z.enum(["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"]);
export type Gate = z.infer<typeof GateSchema>;

export const RiskScopeSchema = z.enum(["single-commit", "session", "permanent-for-project"]);
export type RiskScope = z.infer<typeof RiskScopeSchema>;

export const RiskAcceptedSchema = z.object({
  gate: GateSchema,
  failureSummary: z.string().min(1),
  acceptedBy: z.object({
    personaTier: PersonaTierSchema,
    userId: z.string().min(1),
    timestamp: z.string().min(1)
  }),
  rationale: z.string().min(20),
  scope: RiskScopeSchema
});
export type RiskAccepted = z.infer<typeof RiskAcceptedSchema>;
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test risk-accept
git add packages/ritual-engine/src/risk-accept.ts packages/ritual-engine/test/risk-accept.test.ts
git commit -m "feat(ritual-engine): RiskAcceptedSchema (gate + rationale ≥20 + scope + persona-tier)"
```

---

### Task 7: Persona-gate enforcement on risk-accept

**Files:** extend `risk-accept.ts` with `enforcePersonaGate()` + add `PersonaGateError` to `errors.ts`.

Per PRD §9.5 + Unit E OQ5: Ama-tier callers cannot risk-accept `L4-security` or `L5-compliance` gates. Diego can risk-accept any. Priya can risk-accept any. The gate-vs-persona mapping:

| Gate | Min persona |
|---|---|
| L4-security | diego |
| L5-compliance | diego |
| L6-a11y-advisory | ama |
| L7-visual-advisory | ama |

- [ ] **Step 1: Write failing test**

`packages/ritual-engine/test/risk-accept-persona-gate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { enforcePersonaGate, type RiskAccepted } from "../src/risk-accept.js";
import { PersonaGateError } from "../src/errors.js";

const baseEvent = (gate: RiskAccepted["gate"], persona: "ama" | "diego" | "priya"): RiskAccepted => ({
  gate,
  failureSummary: "x",
  acceptedBy: { personaTier: persona, userId: "u", timestamp: "t" },
  rationale: "twenty-or-more characters present",
  scope: "single-commit"
});

describe("enforcePersonaGate", () => {
  it("Ama can risk-accept L6 + L7 advisory gates", () => {
    expect(() => enforcePersonaGate(baseEvent("L6-a11y-advisory", "ama"))).not.toThrow();
    expect(() => enforcePersonaGate(baseEvent("L7-visual-advisory", "ama"))).not.toThrow();
  });

  it("Ama CANNOT risk-accept L4-security or L5-compliance", () => {
    expect(() => enforcePersonaGate(baseEvent("L4-security", "ama"))).toThrow(PersonaGateError);
    expect(() => enforcePersonaGate(baseEvent("L5-compliance", "ama"))).toThrow(PersonaGateError);
  });

  it("Diego can risk-accept any gate", () => {
    for (const g of ["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"] as const) {
      expect(() => enforcePersonaGate(baseEvent(g, "diego"))).not.toThrow();
    }
  });

  it("Priya can risk-accept any gate", () => {
    for (const g of ["L4-security", "L5-compliance", "L6-a11y-advisory", "L7-visual-advisory"] as const) {
      expect(() => enforcePersonaGate(baseEvent(g, "priya"))).not.toThrow();
    }
  });

  it("PersonaGateError carries the gate + actual persona", () => {
    try {
      enforcePersonaGate(baseEvent("L4-security", "ama"));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PersonaGateError);
      expect((err as PersonaGateError).gate).toBe("L4-security");
      expect((err as PersonaGateError).actualPersona).toBe("ama");
      expect((err as PersonaGateError).requiredPersona).toBe("diego");
    }
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/ritual-engine test risk-accept-persona-gate
```

- [ ] **Step 3: Extend `errors.ts`**

Append to `packages/ritual-engine/src/errors.ts`:

```typescript
import type { Gate } from "./risk-accept.js";
import type { PersonaTier } from "./personas.js";

export class PersonaGateError extends RitualEngineError {
  readonly gate: string;
  readonly actualPersona: string;
  readonly requiredPersona: string;
  constructor(gate: string, actualPersona: string, requiredPersona: string) {
    super(`persona ${actualPersona} cannot risk-accept gate ${gate}; requires ${requiredPersona} or higher`);
    this.name = "PersonaGateError";
    this.gate = gate;
    this.actualPersona = actualPersona;
    this.requiredPersona = requiredPersona;
  }
}

export class RitualAbortedError extends RitualEngineError {
  readonly ritualId: string;
  readonly reason: string;
  constructor(ritualId: string, reason: string) {
    super(`ritual ${ritualId} aborted: ${reason}`);
    this.name = "RitualAbortedError";
    this.ritualId = ritualId;
    this.reason = reason;
  }
}
```

(Note: the `import type` at the top of errors.ts can be omitted if the types aren't actually used in error class signatures — they're imported into `RiskAccepted` from the consumers' side. Keep `errors.ts` self-contained.)

Simpler: delete the `import type` lines and use plain `string` for the typed fields. Final `errors.ts` has only `string`-typed fields.

- [ ] **Step 4: Implement `enforcePersonaGate` in `risk-accept.ts`**

Append to `packages/ritual-engine/src/risk-accept.ts`:

```typescript
import { isAtLeast, type PersonaTier } from "./personas.js";
import { PersonaGateError } from "./errors.js";

const MIN_PERSONA_FOR_GATE: Record<Gate, PersonaTier> = {
  "L4-security": "diego",
  "L5-compliance": "diego",
  "L6-a11y-advisory": "ama",
  "L7-visual-advisory": "ama"
};

export function enforcePersonaGate(event: RiskAccepted): void {
  const required = MIN_PERSONA_FOR_GATE[event.gate];
  if (!isAtLeast(event.acceptedBy.personaTier, required)) {
    throw new PersonaGateError(event.gate, event.acceptedBy.personaTier, required);
  }
}
```

- [ ] **Step 5: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test risk-accept-persona-gate
git add packages/ritual-engine/src/risk-accept.ts packages/ritual-engine/src/errors.ts packages/ritual-engine/test/risk-accept-persona-gate.test.ts
git commit -m "feat(ritual-engine): persona-gate enforcement on risk-accept (Ama blocked from L4/L5)"
```

---

### Task 8: `RitualEngine` class — `start()` and basic dispatch

**Files:** create `packages/ritual-engine/src/engine.ts` + `test/engine-happy.test.ts`.

Engine takes its `Conductor` + `EventSink` + `PersonaPreferences` as constructor injections. `start(input)` initialises a ritual: emits `ritual.started`, sets state to `visualize`, dispatches the Architect role via the Conductor, transitions to `agree` on artifact emission.

- [ ] **Step 1: Write failing test (happy path: start → visualize → agree, no UI)**

`packages/ritual-engine/test/engine-happy.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor } from "@atlas/conductor";

function mockConductor(): Conductor {
  return {
    dispatch: vi.fn(async () => ({
      roleId: "architect",
      attempts: 1,
      output: {
        events: [{
          eventType: "architect.pass2.completed",
          payload: { scope: "new-feature", artifact: { scope: "new-feature", diffPlan: { summary: "x", tasks: [] }, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } } }
        }],
        diff: { kind: "none" as const }
      }
    }))
  } as unknown as Conductor;
}

describe("RitualEngine.start (happy path)", () => {
  it("transitions visualize → agree after Architect emits artifact", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: mockConductor(),
      eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    const ritualId = await engine.start({
      userTurn: "add forgot-password",
      editClass: "structural",
      projectId: "11111111-1111-4111-8111-111111111111",
      userId: "u-1"
    });

    expect(ritualId).toMatch(/^r-/);
    const types = sink.events().map((e) => e.type);
    expect(types).toContain("ritual.started");
    expect(types).toContain("ritual.artifact_emitted");
    expect(types).toContain("ritual.transitioned");

    expect(engine.state(ritualId)).toBe("agree");
  });

  it("cosmetic edit-class skips agree and goes straight to build", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: mockConductor(),
      eventSink: sink,
      personaPreferences: { async getPersona() { return "ama"; } }
    });

    const ritualId = await engine.start({
      userTurn: "change button color",
      editClass: "cosmetic",
      projectId: "11111111-1111-4111-8111-111111111111",
      userId: "u-1"
    });

    expect(engine.state(ritualId)).toBe("build");
  });
});
```

- [ ] **Step 2: Run — expect fail**
```bash
pnpm -F @atlas/ritual-engine test engine-happy
```

- [ ] **Step 3: Implement `engine.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { Conductor } from "@atlas/conductor";
import type { EventSink } from "./events.js";
import type { EditClass } from "./events.js";
import type { PersonaPreferences } from "./personas.js";
import { applyTransition, isTerminal, type RitualState, type RitualTransition } from "./state.js";
import { applyApproval, type ApprovalDecision } from "./approval.js";
import { enforcePersonaGate, type RiskAccepted } from "./risk-accept.js";

export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
}

export interface StartInput {
  userTurn: string;
  editClass: EditClass;
  projectId: string;
  userId: string;
}

interface RitualRecord {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
}

export class RitualEngine {
  private readonly conductor: Conductor;
  private readonly sink: EventSink;
  private readonly prefs: PersonaPreferences;
  private readonly rituals = new Map<string, RitualRecord>();

  constructor(opts: RitualEngineOptions) {
    this.conductor = opts.conductor;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
  }

  async start(input: StartInput): Promise<string> {
    const ritualId = `r-${randomUUID()}`;
    this.rituals.set(ritualId, { state: "visualize", projectId: input.projectId, userId: input.userId });
    await this.emit({
      type: "ritual.started",
      ritualId,
      ts: new Date().toISOString(),
      payload: {
        intent: input.userTurn,
        editClass: input.editClass,
        projectId: input.projectId,
        userId: input.userId
      }
    });

    // Dispatch Architect role for the Visualize step
    const result = await this.conductor.dispatch({
      ritualId: ritualId as never,
      graphVersion: 0,
      userTurn: input.userTurn,
      projectId: input.projectId
    });

    // Pull the artifact from the role's pass2.completed event (D.2 contract)
    const completed = result.output.events.find((e) => e.eventType.endsWith(".pass2.completed"));
    const artifact = (completed?.payload as { artifact?: unknown } | undefined)?.artifact;
    this.rituals.get(ritualId)!.artifact = artifact;

    await this.emit({
      type: "ritual.artifact_emitted",
      ritualId,
      ts: new Date().toISOString(),
      payload: { fromRole: result.roleId, artifact: artifact ?? null }
    });

    const tx: RitualTransition = input.editClass === "cosmetic"
      ? { kind: "artifact_emitted_cosmetic" }
      : { kind: "artifact_emitted" };
    await this.transition(ritualId, tx);
    return ritualId;
  }

  async approve(ritualId: string, decision: ApprovalDecision): Promise<void> {
    const tx = applyApproval(decision);
    await this.transition(ritualId, tx);
    if (decision.kind === "approved") {
      await this.emit({
        type: "ritual.approved",
        ritualId,
        ts: new Date().toISOString(),
        payload: { approvedBy: decision.approvedBy, persona: decision.persona }
      });
    } else {
      await this.emit({
        type: "ritual.changes_requested",
        ritualId,
        ts: new Date().toISOString(),
        payload: { requestedBy: decision.requestedBy, notes: decision.notes }
      });
    }
  }

  async acceptRisk(ritualId: string, event: RiskAccepted): Promise<void> {
    enforcePersonaGate(event); // throws PersonaGateError if disallowed
    await this.emit({
      type: "ritual.risk_accepted",
      ritualId,
      ts: new Date().toISOString(),
      payload: event
    });
  }

  async escalate(ritualId: string, reason: string, requestedBy: string): Promise<void> {
    await this.emit({
      type: "ritual.escalation_requested",
      ritualId,
      ts: new Date().toISOString(),
      payload: { reason, requestedBy }
    });
    await this.transition(ritualId, { kind: "escalate", reason });
  }

  state(ritualId: string): RitualState {
    const r = this.rituals.get(ritualId);
    if (!r) throw new Error(`unknown ritualId: ${ritualId}`);
    return r.state;
  }

  artifact(ritualId: string): unknown {
    return this.rituals.get(ritualId)?.artifact;
  }

  private async transition(ritualId: string, tx: RitualTransition): Promise<void> {
    const record = this.rituals.get(ritualId);
    if (!record) throw new Error(`unknown ritualId: ${ritualId}`);
    const from = record.state;
    const to = applyTransition(from, tx);
    record.state = to;
    await this.emit({
      type: "ritual.transitioned",
      ritualId,
      ts: new Date().toISOString(),
      payload: { from, to, transitionKind: tx.kind }
    });
    if (isTerminal(to)) {
      await this.emit({
        type: "ritual.completed",
        ritualId,
        ts: new Date().toISOString(),
        payload: { finalState: to as "done" | "escalated" | "aborted" }
      });
    }
  }

  private async emit(event: import("./events.js").RitualEvent): Promise<void> {
    await this.sink.emit(event);
  }
}
```

- [ ] **Step 4: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test engine-happy
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-happy.test.ts
git commit -m "feat(ritual-engine): RitualEngine.start with cosmetic fast-path + Architect dispatch"
```

---

### Task 9: Engine — escalation path

**Files:** create `test/engine-escalation.test.ts`.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor } from "@atlas/conductor";

const minimalConductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: {} } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("RitualEngine escalation", () => {
  it("escalate() transitions to 'escalated' and emits both events", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: minimalConductor,
      eventSink: sink,
      personaPreferences: { async getPersona() { return "ama"; } }
    });
    const ritualId = await engine.start({
      userTurn: "x", editClass: "structural", projectId: "p", userId: "u"
    });

    await engine.escalate(ritualId, "needs Priya review", "u-ama");
    expect(engine.state(ritualId)).toBe("escalated");
    const types = sink.events().map((e) => e.type);
    expect(types).toContain("ritual.escalation_requested");
    expect(types.filter((t) => t === "ritual.completed")).toHaveLength(1);
    const completed = sink.events().find((e) => e.type === "ritual.completed");
    expect((completed!.payload as { finalState: string }).finalState).toBe("escalated");
  });
});
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test engine-escalation
git add packages/ritual-engine/test/engine-escalation.test.ts
git commit -m "test(ritual-engine): escalate() transitions to terminal 'escalated' + emits completion"
```

---

### Task 10: Engine — risk-accept with persona-gate enforcement

**Files:** create `test/engine-risk-accept.test.ts`.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import { PersonaGateError } from "../src/errors.js";
import type { Conductor } from "@atlas/conductor";

const minimalConductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: {} } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("RitualEngine risk-accept", () => {
  it("Diego can risk-accept L4-security; event is persisted", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: minimalConductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });
    const ritualId = await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    await engine.acceptRisk(ritualId, {
      gate: "L4-security",
      failureSummary: "wildcard CORS for legacy partner",
      acceptedBy: { personaTier: "diego", userId: "u-diego", timestamp: "2026-04-20T00:00:00Z" },
      rationale: "Sunset by 2026-06-01; tracked in JIRA-123",
      scope: "session"
    });
    const event = sink.events().find((e) => e.type === "ritual.risk_accepted");
    expect(event).toBeDefined();
    expect((event!.payload as { gate: string }).gate).toBe("L4-security");
  });

  it("Ama cannot risk-accept L4-security — throws PersonaGateError, no event emitted", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: minimalConductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "ama"; } }
    });
    const ritualId = await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    await expect(engine.acceptRisk(ritualId, {
      gate: "L4-security", failureSummary: "f",
      acceptedBy: { personaTier: "ama", userId: "u-ama", timestamp: "t" },
      rationale: "twenty character rationale here", scope: "session"
    })).rejects.toBeInstanceOf(PersonaGateError);
    expect(sink.events().filter((e) => e.type === "ritual.risk_accepted")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test engine-risk-accept
git add packages/ritual-engine/test/engine-risk-accept.test.ts
git commit -m "test(ritual-engine): risk-accept Ama→L4-security blocked, Diego→L4-security succeeds"
```

---

### Task 11: Engine — full Visualize → Agree → Build → done flow

**Files:** create `test/engine-full-flow.test.ts`.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor } from "@atlas/conductor";

const conductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { ok: true } } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("RitualEngine full Visualize→Agree→Build→done flow", () => {
  it("walks through every state and ends in 'done' after merge_gates_green", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    const r = await engine.start({ userTurn: "feature", editClass: "structural", projectId: "p", userId: "u" });
    expect(engine.state(r)).toBe("agree");

    await engine.approve(r, { kind: "approved", approvedBy: "u-diego", persona: "diego" });
    expect(engine.state(r)).toBe("build");

    // Simulate merge gates green
    await engine.markBuildComplete(r);
    expect(engine.state(r)).toBe("done");

    const types = sink.events().map((e) => e.type);
    expect(types).toContain("ritual.started");
    expect(types).toContain("ritual.artifact_emitted");
    expect(types).toContain("ritual.approved");
    expect(types).toContain("ritual.completed");
    const completed = sink.events().find((e) => e.type === "ritual.completed");
    expect((completed!.payload as { finalState: string }).finalState).toBe("done");
  });

  it("changes_requested at agree returns to visualize", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });
    const r = await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    await engine.approve(r, { kind: "changes_requested", requestedBy: "u-diego", notes: "Add accessibility check" });
    expect(engine.state(r)).toBe("visualize");
  });
});
```

- [ ] **Step 2: Add `markBuildComplete()` to `engine.ts`**

```typescript
async markBuildComplete(ritualId: string): Promise<void> {
  await this.transition(ritualId, { kind: "merge_gates_green" });
}
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test engine-full-flow
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-full-flow.test.ts
git commit -m "feat(ritual-engine): markBuildComplete() + full Visualize→Agree→Build→done test"
```

---

### Task 12: Public `src/index.ts` exports

**Files:** modify `packages/ritual-engine/src/index.ts`.

- [ ] **Step 1: Write test asserting public surface**

`packages/ritual-engine/test/public-api.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API surface", () => {
  it("exports the canonical names", () => {
    const expected = [
      "RitualEngine",
      "InMemoryEventSink",
      "RitualEventSchema",
      "RitualStateSchema",
      "isTerminal",
      "applyTransition",
      "PersonaTierSchema",
      "isAtLeast",
      "ApprovalDecisionSchema",
      "applyApproval",
      "RiskAcceptedSchema",
      "GateSchema",
      "RiskScopeSchema",
      "enforcePersonaGate",
      "EditClassSchema",
      "PersonaGateError",
      "InvalidTransitionError",
      "RitualEngineError",
      "RitualAbortedError"
    ];
    for (const name of expected) {
      expect((api as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Implement `src/index.ts`**

```typescript
export * from "./personas.js";
export * from "./state.js";
export * from "./events.js";
export * from "./approval.js";
export * from "./risk-accept.js";
export * from "./errors.js";
export * from "./engine.js";
```

- [ ] **Step 3: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test public-api
git add packages/ritual-engine/src/index.ts packages/ritual-engine/test/public-api.test.ts
git commit -m "feat(ritual-engine): public API barrel exports"
```

---

### Task 13: Integration test — engine driven by mocked Conductor end-to-end

**Files:** create `test/integration.test.ts`.

This test mounts a real `@atlas/conductor.Conductor` (with mocked classifier + role) under the engine and walks a full ritual through `start → approve → markBuildComplete`. Validates that engine + conductor compose without shims.

- [ ] **Step 1: Write test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { Conductor } from "@atlas/conductor";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";

describe("RitualEngine + real Conductor integration", () => {
  it("dispatches a ritual through a real Conductor with a stubbed Architect role", async () => {
    const stubArchitect = {
      id: "architect",
      run: async () => ({
        events: [
          { eventType: "architect.pass1.completed", payload: { passed: true, scope: "new-feature" } },
          { eventType: "architect.pass2.completed", payload: { artifact: { scope: "new-feature" } } }
        ],
        diff: { kind: "none" as const }
      })
    };

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
      roles: new Map([["architect", stubArchitect]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    const r = await engine.start({
      userTurn: "add forgot-password", editClass: "structural",
      projectId: "11111111-1111-4111-8111-111111111111", userId: "u-1"
    });
    await engine.approve(r, { kind: "approved", approvedBy: "u-1", persona: "diego" });
    await engine.markBuildComplete(r);

    expect(engine.state(r)).toBe("done");
    expect(engine.artifact(r)).toEqual({ scope: "new-feature" });

    const types = sink.events().map((e) => e.type);
    for (const expected of ["ritual.started", "ritual.artifact_emitted", "ritual.approved", "ritual.completed"]) {
      expect(types).toContain(expected);
    }
  });
});
```

- [ ] **Step 2: Run + commit**
```bash
pnpm -F @atlas/ritual-engine test integration
git add packages/ritual-engine/test/integration.test.ts
git commit -m "test(ritual-engine): integration with real @atlas/conductor + stubbed Architect role"
```

---

### Task 14: Build + full-suite smoke

- [ ] **Step 1: Run package build + typecheck + tests**
```bash
pnpm -F @atlas/ritual-engine build
pnpm -F @atlas/ritual-engine typecheck
pnpm -F @atlas/ritual-engine test
```
Expected: all green; ~10 test files, ~25 tests.

- [ ] **Step 2: Workspace-wide smoke**
```bash
pnpm -r test
```
Expected: pre-existing Postgres flakiness in spec-graph-sync/merge-driver acceptable; no other regressions.

- [ ] **Step 3: Commit checkpoint**
```bash
git commit --allow-empty -m "chore(ritual-engine): full-suite smoke — all workspace tests green post E.1"
```

---

### Task 15: Package README

**Files:** create `packages/ritual-engine/README.md`.

- [ ] **Step 1: Write README**

````markdown
# @atlas/ritual-engine

The headless state machine that drives Atlas's **Visualize → Agree → Build** ritual. UI surfaces (Plan E.2 Atlas Web; future external integrations) consume this engine.

## Architecture

`RitualEngine` is purely deterministic over its inputs. It takes three injected dependencies:

- `Conductor` from `@atlas/conductor` — dispatches role invocations.
- `EventSink` — emits typed `RitualEvent`s. Production wires through `@atlas/spec-graph-data.spec_events`; tests use `InMemoryEventSink`.
- `PersonaPreferences` — resolves a user/project pair to a `PersonaTier` (ama/diego/priya).

## State machine

```
visualize → agree (artifact_emitted) → build (approved) → done (merge_gates_green)
visualize → build (artifact_emitted_cosmetic — fast path)
agree → visualize (changes_requested)
* → escalated (escalate)
* → aborted (abort)
```

Terminal states: `done`, `escalated`, `aborted`.

## Public API

```ts
import {
  RitualEngine,
  type StartInput, type ApprovalDecision, type RiskAccepted,
  PersonaGateError, InvalidTransitionError
} from "@atlas/ritual-engine";

const engine = new RitualEngine({ conductor, eventSink, personaPreferences });
const ritualId = await engine.start({ userTurn, editClass, projectId, userId });
await engine.approve(ritualId, { kind: "approved", approvedBy, persona });
await engine.markBuildComplete(ritualId);
```

## Risk-accept persona gate (PRD §9.5)

Per the open-question resolution OQ5, the engine enforces:

| Gate | Min persona |
|---|---|
| L4-security | diego |
| L5-compliance | diego |
| L6-a11y-advisory | ama |
| L7-visual-advisory | ama |

Calling `engine.acceptRisk(ritualId, event)` with an under-privileged persona throws `PersonaGateError` and emits no `ritual.risk_accepted` event. UI surfaces should render an "ask a reviewer" affordance in response.

## Edit-class fast path (PRD §9.5)

`StartInput.editClass` controls the state-machine shape:
- `cosmetic` → 2-state (`visualize → build`); the Agree step is skipped.
- `structural` → full 3-state (`visualize → agree → build`).
- `security-compliance-touching` → full 3-state with explicit human-confirmation gate (Plan F.1's bootstrap-checkpoint pre-pends).

The classifier itself is Plan G.1; this engine just respects the hint.

## Testing

```bash
cd packages/ritual-engine
pnpm test
```
````

- [ ] **Step 2: Commit**
```bash
git add packages/ritual-engine/README.md
git commit -m "docs(ritual-engine): README — architecture, API, persona-gate, edit-class fast path"
```

---

### Task 16: Update plan index + handoff

**Files:** modify `docs/superpowers/plans/README.md`.

- [ ] **Step 1: Insert E.1 row after D.2**

Add a new row after row 10 (D.2) in the Plan index table:

```
| 11 | `2026-04-20-ritual-engine.md` | **E.1 — Ritual Engine (headless)** | RitualEngine state machine for Visualize→Agree→Build, persona-tiered approval, RiskAccepted Zod with persona gate, cosmetic-edit fast path | 16 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Renumber subsequent rows (directional docs become 12 and 13). Update execution-order ASCII diagram to show E.1 under D.2.

- [ ] **Step 2: Commit**
```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add E.1 ritual-engine to plan index"
```

---

## Completion Checklist

After all 16 tasks:

- [ ] `pnpm -F @atlas/ritual-engine test` — all tests green (~25)
- [ ] `pnpm -F @atlas/ritual-engine build` — exits 0
- [ ] `pnpm -F @atlas/ritual-engine typecheck` — exits 0
- [ ] `pnpm -r test` — no cross-package regressions
- [ ] State machine: every legal transition + every illegal transition tested
- [ ] Persona-gate: Ama blocked from L4/L5; Diego/Priya allowed any
- [ ] Cosmetic edit-class fast path tested
- [ ] Integration test exercises engine + real Conductor + stubbed Architect role
- [ ] Plan index lists E.1 as shipped (pending merge)

## Handoff to F.1, G.1, G.2, E.2-E.5

- **F.1** (Bootstrap Checkpoint) imports `RiskAcceptedSchema` from this package and pre-pends a 6-item sanity checklist before the first ritual transitions out of `visualize`. F.1 calls `engine.start(...)` once, intercepts on the first `ritual.transitioned` event, runs the checklist, then either resumes or aborts.
- **G.1** (Edit Classifier) classifies user intent into `EditClass` and is consumed by callers of `engine.start({ editClass: ... })`. G.1 does not touch the engine; it sits one layer above.
- **G.2** (Latency Harness) measures the wall-clock between `ritual.started` and `ritual.completed` (where `finalState=done`) keyed on `editClass`; emits regression alerts when `cosmetic` p50 exceeds the PRD §NFR-8 budget.
- **E.2–E.4** (Atlas Web UI) consumes `RitualEngine`'s public API via a Next.js server-component layer. No engine code changes are expected for UI integration.
- **E.5** (Ritual Integration Tests) drives `RitualEngine` through Playwright end-to-end against the real Atlas Web app + a real Conductor + real role packages.
