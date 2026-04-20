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

