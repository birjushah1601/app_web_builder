# Plan K — Multi-Turn Ritual Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today, ChatPanel sends one user turn → ritual runs once → result lands → done. The user has no way to say "the diff is mostly right but rename `foo` to `bar` and add a docstring" without starting a fresh ritual that loses all prior context. Per `docs/superpowers/local-dev-status.md` "What's NOT wired": *"Multi-turn refinement. No 'user reads developer output → asks for changes → ritual re-runs with feedback' loop."* Plan K adds a `RitualEngine.refine(parentRitualId, userTurn)` method that starts a NEW ritual *linked to* the parent, threads the parent's `developerOutput` and `roleEvents` into the architect's prompt context as `priorRitual`, and lets the developer role generate a follow-up diff that builds on the previous one. ChatPanel surfaces a "Refine this" button under the developer-output card; clicking it expands an inline textarea + Send. The full conversation thread renders as a vertical stack of ritual cards. Behind feature flag `ATLAS_FF_MULTI_TURN`; flag-OFF preserves today's one-shot behavior.

**Architecture:** A new `RitualEngine.refine(input: RefineInput)` method runs the same architect → developer → security → a11y chain as `start()`, but with two key differences:
1. The architect's `RoleInvocation.priorArtifact` is set to a `PriorRitualContext` blob: `{ parentRitualId, parentArtifact, parentDeveloperOutput, parentRoleEvents }`. The architect's prompt assembly reads this and includes "you previously planned X and the developer wrote Y — the user now says Z; produce an updated plan that incorporates Z while building on X+Y" as system context.
2. The new ritual gets a `parentRitualId` field on its `RitualRecord` + `RitualSnapshot`, so callers can walk the lineage. Hydrator follows `parentRitualId` chains to assemble multi-turn history when ChatPanel queries getRitual.

A new Server Action `refineRitual({ projectId, parentRitualId, userTurn, editClass })` wraps the engine call. ChatPanel renders a `<RefinementInputBar />` under each developer-output card with a textarea + "Refine" button — when clicked, it calls `refineRitual` and appends a new ritual card to the conversation thread. The thread is sourced from a new `useRefinementThread(rootRitualId)` client hook that walks the parent-chain and returns `RitualSnapshot[]` ordered oldest → newest.

**Non-goals:**
- Multi-turn for non-developer paths (cosmetic edits): refinement only makes sense when there's a diff to refine. Cosmetic flow remains one-shot.
- Branching refinements (user wants to try TWO different changes off the same parent): v1 is linear-only; the data model supports DAG via parentRitualId but UX surfaces only the most-recent leaf.
- Cross-project lineage: parent + child rituals must share `projectId` (engine asserts this).

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Vitest 2.x · Postgres (lineage column added to `spec_events.payload` by convention; no schema migration needed).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan B (developer chain) merged on `main` — `RitualEngine.start` already chains architect → developer.
- Plan H (persistent rituals) merged on `main` — hydrator can recover parent rituals on restart so the refinement chain survives `pnpm dev` restarts.
- Plan I (security/a11y roles) merged on `main` — gates run on the refined diff too, not just first-shot.
- Plan E.0 (event broker) merged on `main` — refinement events publish to the live UI.
- LLM provider configured (`ATLAS_LLM_BASE_URL` or `ANTHROPIC_API_KEY`).
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` packages keep their `.js` suffix.

**Branch:** `plan-k/multi-turn-refinement` cut from `main`. Final task merges back.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/ritual-engine/src/
  engine.ts                                                    # MODIFIED: + refine() method, + parentRitualId on RitualRecord/Snapshot, + RefineInput type
  prior-ritual-context.ts                                      # NEW: PriorRitualContext type + buildPriorRitualContext helper

packages/ritual-engine/test/
  engine-refine.test.ts                                        # NEW: ~8 cases (refine threads parent context; preserves chain; rejects cross-project parent; flag-off path)

packages/role-architect/src/
  assemble-prompt.ts                                           # MODIFIED: read PriorRitualContext from priorArtifact; inject "previously you planned X / developer wrote Y / now user says Z" preamble

packages/role-architect/test/
  prior-ritual-prompt.test.ts                                  # NEW: 4 cases (no prior → today's prompt; with prior → preamble injected; truncation when prior is huge; cosmetic-edit prior is ignored)

apps/atlas-web/lib/
  feature-flags.ts                                             # MODIFIED: + "multi-turn" flag (ATLAS_FF_MULTI_TURN)

apps/atlas-web/lib/actions/
  refineRitual.ts                                              # NEW: Server Action wrapping engine.refine; gated on flag

apps/atlas-web/lib/refinement/
  useRefinementThread.ts                                       # NEW: client hook walking parentRitualId chain via /api/projects/[id]/ritual/[id]/thread route

apps/atlas-web/app/api/projects/[projectId]/ritual/[ritualId]/thread/
  route.ts                                                     # NEW: GET handler returning RitualSnapshot[] from root → leaf

apps/atlas-web/components/
  ChatPanel.tsx                                                # MODIFIED: render refinement thread (vertical stack of ritual cards); + <RefinementInputBar /> under each developer-output card
  RefinementInputBar.tsx                                       # NEW: textarea + Send button; calls refineRitual; gated on multi-turn flag

apps/atlas-web/test/lib/actions/
  refineRitual.test.ts                                         # NEW: 4 cases (calls engine.refine; flag-off throws; missing parent rejects; success returns child snapshot)

apps/atlas-web/test/lib/refinement/
  useRefinementThread.test.tsx                                 # NEW: 3 cases (loading state; thread loads with N rituals in order; refresh on new refinement)

apps/atlas-web/test/components/
  RefinementInputBar.test.tsx                                  # NEW: 4 cases (renders textarea + button; submit calls action; pending state disables; flag-off renders nothing)
  ChatPanel.test.tsx                                           # MODIFIED: + 3 cases (renders thread; refinement shows new card; flag-off hides RefinementInputBar)

apps/atlas-web/test/app/api/
  ritual-thread-route.test.ts                                  # NEW: 3 cases (returns array root→leaf; 404 on unknown; cross-project access denied)
```

**Why this shape.** The `refine()` method lives on the engine because it's the same dispatch logic as `start()` plus parent-context threading — duplicating into the Server Action would mean two places that need to know about the role chain. `PriorRitualContext` is its own file because the architect-prompt assembly is the only consumer and the shape will evolve (v2 might add per-role-failure summaries, retry counts, etc.) — isolating it from `engine.ts` lets that file stay focused on state machine logic. The thread-loading API route is a separate file (not folded into the existing `/events` route) because it has different cache semantics (events are streaming, threads are point-in-time queries). `RefinementInputBar` is a separate component from ChatPanel because it has its own state (textarea value, pending) and isolating it lets the rail's `<RailShell />` (Plan G) compose it later as a footer affordance without restructuring ChatPanel. The thread-walk happens via API route (not in-process) because client components can't import server-only `getRitualEngine` directly.

---

## Design Decisions

1. **`refine` is a NEW ritual, not a transition on the parent.** Today's `RitualEngine.start` returns a fresh `ritualId`; refinement does the same and links via `parentRitualId`. Reasons: (a) lineage is a tree, not a state machine — collapsing into the parent would force parent state back to `visualize` which violates the existing terminal-state semantics; (b) audit trail is cleaner — `spec_events` shows two distinct ritual.started events with parent linkage in the second's payload; (c) hydrator already knows how to fold individual rituals — extending it for parent-chain walks is additive.
2. **`parentRitualId` is in the `ritual.started` event payload, NOT a new column.** `spec_events.payload` is JSONB; adding `parentRitualId` to the started event's payload keeps the table schema unchanged. The hydrator reads it from there. Listings ("show me all rituals for project X with their parent links") use the same `payload->>'parentRitualId'` JSON path as Plan H's `listByRitual`.
3. **`PriorRitualContext` is constructed inside `engine.refine` from the parent's hydrated snapshot.** Engine calls `await this.getRitual(parentRitualId)` (which may hit the hydrator if parent is from a previous process), pulls `{ artifact, developerOutput, roleEvents }`, packages as `PriorRitualContext`, and passes via `Conductor.dispatch({ priorArtifact: context })`. The architect role detects the wrapper via a discriminator field (`{ kind: "priorRitual", ... }`) and routes to the multi-turn prompt path. Without this discriminator, today's first-shot path runs as before.
4. **Architect prompt preamble is appended, not replaced.** The existing prompt-assembly pipeline (graph slice, intent, ambiguity rubric) is preserved. Plan K prepends a "Previous turn" section before the user intent. Why: zero risk of breaking the first-shot prompt path; the model sees the same baseline structure plus extra context.
5. **Truncation: cap prior context at 8000 chars.** Past developer diffs can be huge. The architect's deep-plan budget is ~16k tokens; we reserve 8k for the prior-context section, the rest for graph slice + new intent + reasoning. Hard cap on the diff portion: keep the first 4000 chars + last 4000 chars with a `... [N chars elided] ...` marker.
6. **Thread API is a single GET, not a streaming SSE.** Refinement is user-driven (button click → page request) — instant gratification of the parent chain doesn't need streaming. The route walks the parent chain server-side: `getRitual(leafId)` → if `parentRitualId` set, recurse → return `[root, ..., leaf]`. Cycle detection: max depth 50 (a hard cap; v2 can add cycle-set tracking).
7. **Flag-OFF behavior:** `ATLAS_FF_MULTI_TURN=false` (default). The `refineRitual` Server Action throws `"multi-turn refinement is disabled — set ATLAS_FF_MULTI_TURN=true to enable"`. The `<RefinementInputBar />` reads the flag at SSR time and renders `null` when off. `useRefinementThread` always works (it's a read of the lineage which exists either way) but ChatPanel's vertical-thread rendering only shows the parent + leaf when the flag is on; flag-off shows just the latest single ritual as today.
8. **Editing class for refinements: inferred from the diff.** Refining a structural ritual stays structural. Refining a cosmetic ritual stays cosmetic. The `RefineInput` doesn't take an `editClass` — engine reads `parentSnapshot.developerOutput?.diff` and classifies via the existing edit-class classifier (G.1). Cosmetic refinement skips the developer chain (same rule as start).
9. **Concurrent refinements on the same parent: last-write semantics for the leaf pointer.** If two browser tabs both submit a refinement off the same parent, both succeed and both create child rituals. The thread API returns only ONE chain (whichever path the recursion picks first via `getRitual`). v2 could disambiguate; v1 documents this as expected ("don't refine in two tabs").
10. **No multi-turn for the security/a11y reports themselves.** A failing security gate escalates the ritual; the user can refine to address the issue (which fits the same flow), but they can't directly "ask the security role for elaboration" — that's a different feature (role chat). Out of scope for K.

---

## Task List (12 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit.

---

### Task 1: Cut the branch + add `multi-turn` feature flag

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/test/lib/feature-flags.test.ts`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-k/multi-turn-refinement
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/atlas-web/test/lib/feature-flags.test.ts`:

```typescript
describe("multi-turn flag (Plan K)", () => {
  it("is off when ATLAS_FF_MULTI_TURN is unset", () => {
    expect(isFeatureEnabled("multi-turn", sourceWith({}))).toBe(false);
  });
  it("is on when ATLAS_FF_MULTI_TURN=true", () => {
    expect(
      isFeatureEnabled("multi-turn", sourceWith({ ATLAS_FF_MULTI_TURN: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes multi-turn", () => {
    expect(listFlagStates(sourceWith({}))["multi-turn"]).toBe(false);
  });
});
```

Update the `listFlagStates` equality test to include `"multi-turn": false`.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: 3 fails — type error on flag union.

- [ ] **Step 4: Add the flag**

Modify `apps/atlas-web/lib/feature-flags.ts`:

```typescript
export type FeatureFlag =
  | "figma-importer"
  | "stripe-payments"
  | "video-kling"
  | "auth-keycloak"
  | "live-events"
  | "ritual-hydration"
  | "security-role"
  | "a11y-role"
  | "run-grafana"
  | "multi-turn";
```

Add `"multi-turn": "ATLAS_FF_MULTI_TURN"` to FLAG_TO_ENV. Add `"multi-turn": isFeatureEnabled("multi-turn", source)` to listFlagStates.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags.test.ts
git commit -m "feat(atlas-web): multi-turn feature flag — ATLAS_FF_MULTI_TURN (plan K)"
```

---

### Task 2: Define `PriorRitualContext` + helper in ritual-engine

**Files:**
- Create: `packages/ritual-engine/src/prior-ritual-context.ts`
- Modify: `packages/ritual-engine/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ritual-engine/test/prior-ritual-context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPriorRitualContext, isPriorRitualContext } from "../src/prior-ritual-context.js";

describe("PriorRitualContext (Plan K Task 2)", () => {
  it("buildPriorRitualContext packages snapshot fields with the discriminator", () => {
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan" },
      developerOutput: { diff: "diff --git a/x b/x", summary: "added x" },
      roleEvents: [{ eventType: "architect.pass2.completed", payload: {} }]
    });
    expect(ctx.kind).toBe("priorRitual");
    expect(ctx.parentRitualId).toBe("r-parent");
    expect(ctx.parentDeveloperOutput?.diff).toContain("diff --git");
  });

  it("isPriorRitualContext returns true for a properly-shaped object", () => {
    const ctx = buildPriorRitualContext({ ritualId: "r-1" });
    expect(isPriorRitualContext(ctx)).toBe(true);
  });

  it("isPriorRitualContext returns false for unrelated objects", () => {
    expect(isPriorRitualContext({ kind: "plan" })).toBe(false);
    expect(isPriorRitualContext(undefined)).toBe(false);
    expect(isPriorRitualContext(null)).toBe(false);
  });

  it("truncates a developer diff exceeding 8000 chars (4k head + 4k tail + marker)", () => {
    const huge = "x".repeat(20000);
    const ctx = buildPriorRitualContext({
      ritualId: "r-1",
      developerOutput: { diff: huge }
    });
    const truncated = ctx.parentDeveloperOutput!.diff;
    expect(truncated.length).toBeLessThan(huge.length);
    expect(truncated).toContain("[12000 chars elided]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/prior-ritual-context.test.ts
```

Expected: 4 fails — module not found.

- [ ] **Step 3: Implement the module**

Create `packages/ritual-engine/src/prior-ritual-context.ts`:

```typescript
import type { RoleEventRecord, DeveloperOutputRecord } from "./engine.js";

export interface PriorRitualContext {
  /** Discriminator so consumers can detect this shape vs other priorArtifact payloads. */
  readonly kind: "priorRitual";
  parentRitualId: string;
  parentArtifact?: unknown;
  parentDeveloperOutput?: DeveloperOutputRecord;
  parentRoleEvents?: RoleEventRecord[];
}

const DIFF_TRUNCATE_MAX = 8000;

export function buildPriorRitualContext(input: {
  ritualId: string;
  artifact?: unknown;
  developerOutput?: DeveloperOutputRecord;
  roleEvents?: RoleEventRecord[];
}): PriorRitualContext {
  let parentDeveloperOutput = input.developerOutput;
  if (parentDeveloperOutput && parentDeveloperOutput.diff.length > DIFF_TRUNCATE_MAX) {
    const head = parentDeveloperOutput.diff.slice(0, DIFF_TRUNCATE_MAX / 2);
    const tail = parentDeveloperOutput.diff.slice(-DIFF_TRUNCATE_MAX / 2);
    const elided = parentDeveloperOutput.diff.length - DIFF_TRUNCATE_MAX;
    parentDeveloperOutput = {
      diff: `${head}\n... [${elided} chars elided] ...\n${tail}`,
      summary: parentDeveloperOutput.summary
    };
  }
  return {
    kind: "priorRitual",
    parentRitualId: input.ritualId,
    parentArtifact: input.artifact,
    parentDeveloperOutput,
    parentRoleEvents: input.roleEvents
  };
}

export function isPriorRitualContext(value: unknown): value is PriorRitualContext {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).kind === "priorRitual"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/prior-ritual-context.test.ts
```

- [ ] **Step 5: Re-export from package index**

Add to `packages/ritual-engine/src/index.ts`:

```typescript
export { buildPriorRitualContext, isPriorRitualContext, type PriorRitualContext } from "./prior-ritual-context.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/prior-ritual-context.ts packages/ritual-engine/src/index.ts packages/ritual-engine/test/prior-ritual-context.test.ts
git commit -m "feat(ritual-engine): PriorRitualContext + buildPriorRitualContext + truncation (plan K)"
```

---

### Task 3: `RitualEngine.refine()` — new method that mirrors `start()` with parent threading

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Create: `packages/ritual-engine/test/engine-refine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ritual-engine/test/engine-refine.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine, isPriorRitualContext } from "../src/index.js";

function makeEngine(dispatchImpl: (req: unknown, opts?: { forceRoleId?: string }) => unknown) {
  const engine = new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
  });
  return engine;
}

describe("RitualEngine.refine — Plan K Task 3", () => {
  it("creates a NEW ritualId (not the parent's)", async () => {
    const engine = makeEngine(async () => ({ roleId: "architect", output: { events: [], diff: { kind: "none" } } }));
    // Seed a parent ritual in the in-memory map.
    (engine as never as { rituals: Map<string, unknown> }).rituals.set("r-parent", {
      state: "done", projectId: "p", userId: "u", roleEvents: []
    });
    const childId = await engine.refine({
      parentRitualId: "r-parent",
      projectId: "p",
      userId: "u",
      userTurn: "rename foo to bar"
    });
    expect(childId).not.toBe("r-parent");
    expect(childId).toMatch(/^r-/);
  });

  it("threads parent's developerOutput + artifact into the architect's priorArtifact as PriorRitualContext", async () => {
    const dispatch = vi.fn(async (_req: unknown, _opts?: { forceRoleId?: string }) => ({
      roleId: "architect",
      output: { events: [], diff: { kind: "none" } }
    }));
    const engine = makeEngine(dispatch);
    (engine as never as { rituals: Map<string, unknown> }).rituals.set("r-parent", {
      state: "done", projectId: "p", userId: "u",
      artifact: { kind: "plan", title: "build foo" },
      developerOutput: { diff: "diff --git a/foo b/foo", summary: "added foo" },
      roleEvents: [{ eventType: "architect.pass2.completed", payload: {} }]
    });
    await engine.refine({
      parentRitualId: "r-parent",
      projectId: "p",
      userId: "u",
      userTurn: "rename foo to bar"
    });
    // Architect dispatch is the FIRST call (no forceRoleId set).
    const firstCall = dispatch.mock.calls[0]!;
    const dispatchOpts = firstCall[1] as { priorArtifact?: unknown } | undefined;
    expect(isPriorRitualContext(dispatchOpts?.priorArtifact)).toBe(true);
    const ctx = dispatchOpts!.priorArtifact as { parentDeveloperOutput?: { diff: string } };
    expect(ctx.parentDeveloperOutput?.diff).toContain("foo");
  });

  it("rejects when the parent ritualId is unknown", async () => {
    const engine = makeEngine(async () => ({ roleId: "architect", output: { events: [], diff: { kind: "none" } } }));
    await expect(engine.refine({
      parentRitualId: "r-missing",
      projectId: "p",
      userId: "u",
      userTurn: "x"
    })).rejects.toThrow(/parent.*not found/i);
  });

  it("rejects when the parent's projectId does not match input.projectId (cross-project denial)", async () => {
    const engine = makeEngine(async () => ({ roleId: "architect", output: { events: [], diff: { kind: "none" } } }));
    (engine as never as { rituals: Map<string, unknown> }).rituals.set("r-parent", {
      state: "done", projectId: "p-A", userId: "u", roleEvents: []
    });
    await expect(engine.refine({
      parentRitualId: "r-parent",
      projectId: "p-B",  // different project
      userId: "u",
      userTurn: "x"
    })).rejects.toThrow(/project mismatch/i);
  });

  it("the child ritual's snapshot has parentRitualId set to the parent's ritualId", async () => {
    const engine = makeEngine(async () => ({
      roleId: "architect",
      output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }], diff: { kind: "none" } }
    }));
    (engine as never as { rituals: Map<string, unknown> }).rituals.set("r-parent", {
      state: "done", projectId: "p", userId: "u", roleEvents: []
    });
    const childId = await engine.refine({
      parentRitualId: "r-parent", projectId: "p", userId: "u", userTurn: "x"
    });
    const childSnap = await engine.getRitual(childId);
    expect((childSnap as { parentRitualId?: string } | undefined)?.parentRitualId).toBe("r-parent");
  });

  it("ritual.started event for the child includes parentRitualId in payload (lineage trail)", async () => {
    const sink = { emit: vi.fn() };
    const engine = new RitualEngine({
      conductor: { dispatch: vi.fn(async () => ({ roleId: "architect", output: { events: [], diff: { kind: "none" } } })) } as never,
      eventSink: sink as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });
    (engine as never as { rituals: Map<string, unknown> }).rituals.set("r-parent", {
      state: "done", projectId: "p", userId: "u", roleEvents: []
    });
    await engine.refine({
      parentRitualId: "r-parent", projectId: "p", userId: "u", userTurn: "x"
    });
    const startedCall = sink.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "ritual.started");
    expect(startedCall).toBeDefined();
    const startedPayload = (startedCall![0] as { payload: { parentRitualId?: string } }).payload;
    expect(startedPayload.parentRitualId).toBe("r-parent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/engine-refine.test.ts
```

Expected: 6 fails — `engine.refine is not a function`.

- [ ] **Step 3: Add `RefineInput` + `refine()` to `RitualEngine`**

In `packages/ritual-engine/src/engine.ts`:

Add to the `RitualRecord` interface and `RitualSnapshot` interface:

```typescript
/** Plan K: present on rituals created by RitualEngine.refine(). Points
 *  back to the parent ritual whose snapshot was threaded into this
 *  ritual's architect prompt as PriorRitualContext. */
parentRitualId?: string;
```

Add the new input type:

```typescript
export interface RefineInput {
  parentRitualId: string;
  projectId: string;
  userId: string;
  userTurn: string;
}
```

Add the import at the top of engine.ts:

```typescript
import { buildPriorRitualContext } from "./prior-ritual-context.js";
```

Add the method to `RitualEngine` class (after `start()`):

```typescript
async refine(input: RefineInput): Promise<string> {
  // Look up the parent — may hit hydrator on in-memory miss.
  const parent = await this.getRitual(input.parentRitualId);
  if (!parent) {
    throw new Error(`refine: parent ritual ${input.parentRitualId} not found`);
  }
  if (parent.projectId !== input.projectId) {
    throw new Error(
      `refine: project mismatch — parent.projectId=${parent.projectId} input.projectId=${input.projectId}`
    );
  }

  const priorContext = buildPriorRitualContext({
    ritualId: input.parentRitualId,
    artifact: parent.artifact,
    developerOutput: parent.developerOutput,
    roleEvents: parent.roleEvents
  });

  // Infer editClass from parent's developerOutput presence — refinement of
  // a structural ritual stays structural; refinement of a cosmetic-only
  // ritual stays cosmetic (no diff, so developer chain skipped same as start).
  const editClass: EditClass = parent.developerOutput?.diff
    ? "structural"
    : "cosmetic";

  // Run the same start() logic but with a parent linkage — easiest to
  // express by inlining the relevant parts. (A future refactor can extract
  // a shared internal `_runRitual` helper; for v1 we duplicate just the
  // architect dispatch + chain handling, but that creates drift risk.
  // Instead, use start() and patch the resulting record to set parentRitualId.)
  const childRitualId = await this._startInternal({
    userTurn: input.userTurn,
    editClass,
    projectId: input.projectId,
    userId: input.userId,
    priorContext,
    parentRitualId: input.parentRitualId
  });

  return childRitualId;
}
```

Refactor `start()` to delegate to a private `_startInternal({ ...input, priorContext?, parentRitualId? })` method. The internal method:
- Uses `priorContext` (when present) as `priorArtifact` on the architect dispatch (Conductor.dispatch options), instead of the today's `undefined`.
- Sets `record.parentRitualId = parentRitualId` when present.
- Includes `parentRitualId` in the `ritual.started` event payload when present.

(This refactor is the largest single change in the plan; ~40 lines moved, ~15 lines new.)

- [ ] **Step 4: Update `getRitual` to surface `parentRitualId`**

In the `getRitual` return shape, add `parentRitualId: r.parentRitualId`.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/engine-refine.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 6: Run full ritual-engine suite to catch regressions**

```bash
cd packages/ritual-engine && pnpm test
```

Expected: all green (start() behavior preserved through the refactor).

- [ ] **Step 7: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-refine.test.ts
git commit -m "feat(ritual-engine): refine() — new ritual linked to parent via parentRitualId; threads PriorRitualContext to architect (plan K)"
```

---

### Task 4: Architect prompt — read PriorRitualContext + inject preamble

**Files:**
- Modify: `packages/role-architect/src/assemble-prompt.ts`
- Create: `packages/role-architect/test/prior-ritual-prompt.test.ts`

- [ ] **Step 1: Find the existing prompt-assembly file**

```bash
ls packages/role-architect/src/
```

Locate the function that assembles the architect's deep-plan system prompt (likely `assemble-prompt.ts` or similar).

- [ ] **Step 2: Write the failing test**

Create `packages/role-architect/test/prior-ritual-prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { assembleArchitectPrompt } from "../src/assemble-prompt.js";  // adjust if function lives elsewhere
import { buildPriorRitualContext } from "@atlas/ritual-engine";

describe("architect prompt — PriorRitualContext threading (Plan K Task 4)", () => {
  it("when no priorRitual is set, the prompt has no 'Previous turn' section (today's behavior)", () => {
    const prompt = assembleArchitectPrompt({
      intent: "build a thing",
      graphSlice: { bytes: "{}", hash: "x" }
    });
    expect(prompt).not.toMatch(/previous turn/i);
  });

  it("when priorRitual is set, the prompt prepends a 'Previous turn' section with parent's plan + diff", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan", title: "add foo" },
      developerOutput: { diff: "diff --git a/foo b/foo\n+++ b/foo", summary: "added foo()" }
    });
    const prompt = assembleArchitectPrompt({
      intent: "rename foo to bar",
      graphSlice: { bytes: "{}", hash: "x" },
      priorRitual: prior
    });
    expect(prompt).toMatch(/previous turn/i);
    expect(prompt).toContain("add foo");
    expect(prompt).toContain("diff --git a/foo");
    expect(prompt).toContain("rename foo to bar");
  });

  it("priorRitual without developerOutput (architect-only parent) renders the artifact section but no diff section", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      artifact: { kind: "plan", title: "explore" }
    });
    const prompt = assembleArchitectPrompt({
      intent: "now build it",
      graphSlice: { bytes: "{}", hash: "x" },
      priorRitual: prior
    });
    expect(prompt).toMatch(/previous turn/i);
    expect(prompt).toContain("explore");
    expect(prompt).not.toContain("Previous diff");  // no diff section
  });

  it("priorArtifact that is NOT a PriorRitualContext (legacy shape) is ignored — no preamble", () => {
    const prompt = assembleArchitectPrompt({
      intent: "build a thing",
      graphSlice: { bytes: "{}", hash: "x" },
      priorRitual: { kind: "plan" } as never  // shape that fails isPriorRitualContext
    });
    expect(prompt).not.toMatch(/previous turn/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/role-architect && pnpm test test/prior-ritual-prompt.test.ts
```

Expected: 3 fails (the no-prior case may pass trivially).

- [ ] **Step 4: Modify the prompt assembler**

In `packages/role-architect/src/assemble-prompt.ts`:

```typescript
import { isPriorRitualContext, type PriorRitualContext } from "@atlas/ritual-engine";

export interface AssembleArchitectPromptInput {
  intent: string;
  graphSlice: { bytes: string; hash: string };
  /** Plan K: when present + a real PriorRitualContext, the prompt
   *  prepends a "Previous turn" section. When undefined or an unrelated
   *  shape, today's first-shot prompt is used unchanged. */
  priorRitual?: unknown;
}

export function assembleArchitectPrompt(input: AssembleArchitectPromptInput): string {
  const sections: string[] = [];

  if (isPriorRitualContext(input.priorRitual)) {
    sections.push(renderPriorRitualSection(input.priorRitual));
  }

  // ... existing prompt-assembly code (graph slice, intent, ambiguity rubric, etc.)
  sections.push(renderTodaysPromptBody(input));

  return sections.join("\n\n---\n\n");
}

function renderPriorRitualSection(prior: PriorRitualContext): string {
  const lines: string[] = [
    "## Previous turn",
    "",
    `In a prior turn (ritualId=${prior.parentRitualId}), you produced this plan:`,
    "",
    "```json",
    JSON.stringify(prior.parentArtifact, null, 2),
    "```"
  ];
  if (prior.parentDeveloperOutput) {
    lines.push(
      "",
      "And the developer wrote this diff:",
      "",
      "```diff",
      prior.parentDeveloperOutput.diff,
      "```"
    );
    if (prior.parentDeveloperOutput.summary) {
      lines.push("", `Summary: ${prior.parentDeveloperOutput.summary}`);
    }
  }
  lines.push(
    "",
    "The user has now provided a follow-up request — produce an updated plan that builds on the previous work."
  );
  return lines.join("\n");
}
```

(The existing `renderTodaysPromptBody` is whatever the file already does — preserve verbatim.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/role-architect && pnpm test test/prior-ritual-prompt.test.ts
```

- [ ] **Step 6: Run full role-architect suite**

```bash
cd packages/role-architect && pnpm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/role-architect/src/assemble-prompt.ts packages/role-architect/test/prior-ritual-prompt.test.ts
git commit -m "feat(role-architect): assemble-prompt threads PriorRitualContext as 'Previous turn' preamble (plan K)"
```

---

### Task 5: `refineRitual` Server Action

**Files:**
- Create: `apps/atlas-web/lib/actions/refineRitual.ts`
- Create: `apps/atlas-web/test/lib/actions/refineRitual.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/actions/refineRitual.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const refineMock = vi.fn();
const getRitualMock = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("@/lib/auth/clerk-compat", () => ({ auth: vi.fn(async () => ({ userId: "u-1" })) }));
vi.mock("@/lib/engine/factory", () => ({
  getRitualEngine: vi.fn(async () => ({ refine: refineMock, getRitual: getRitualMock }))
}));

describe("refineRitual Server Action — Plan K Task 5", () => {
  beforeEach(() => {
    refineMock.mockReset();
    getRitualMock.mockReset();
  });
  afterEach(() => { delete process.env.ATLAS_FF_MULTI_TURN; });

  it("flag-OFF: throws a clear error", async () => {
    const { refineRitual } = await import("@/lib/actions/refineRitual");
    await expect(
      refineRitual({ projectId: "p", parentRitualId: "r-parent", userTurn: "x" })
    ).rejects.toThrow(/multi-turn refinement is disabled/i);
  });

  it("flag-ON: calls engine.refine + returns the child snapshot", async () => {
    process.env.ATLAS_FF_MULTI_TURN = "true";
    refineMock.mockResolvedValue("r-child");
    getRitualMock.mockResolvedValue({
      projectId: "p", userId: "u-1", state: "done", roleEvents: [],
      parentRitualId: "r-parent",
      developerOutput: { diff: "x" }
    });
    const { refineRitual } = await import("@/lib/actions/refineRitual");
    const result = await refineRitual({ projectId: "p", parentRitualId: "r-parent", userTurn: "rename foo" });
    expect(refineMock).toHaveBeenCalledWith(expect.objectContaining({
      parentRitualId: "r-parent",
      projectId: "p",
      userTurn: "rename foo"
    }));
    expect(result.ritualId).toBe("r-child");
    expect(result.parentRitualId).toBe("r-parent");
  });

  it("propagates engine.refine errors (parent not found, etc.)", async () => {
    process.env.ATLAS_FF_MULTI_TURN = "true";
    refineMock.mockRejectedValue(new Error("parent ritual r-? not found"));
    const { refineRitual } = await import("@/lib/actions/refineRitual");
    await expect(
      refineRitual({ projectId: "p", parentRitualId: "r-?", userTurn: "x" })
    ).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/actions/refineRitual.test.ts
```

Expected: 3 fails — module not found.

- [ ] **Step 3: Implement the action**

Create `apps/atlas-web/lib/actions/refineRitual.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { StartRitualResult } from "./startRitual";
import type { SecurityReport } from "@/components/SecurityReportPanel";
import type { AccessibilityReport } from "@/components/AccessibilityReportPanel";

export interface RefineRitualInput {
  projectId: string;
  parentRitualId: string;
  userTurn: string;
}

export interface RefineRitualResult extends StartRitualResult {
  parentRitualId: string;
}

export async function refineRitual(input: RefineRitualInput): Promise<RefineRitualResult> {
  if (!isFeatureEnabled("multi-turn")) {
    throw new Error(
      "multi-turn refinement is disabled — set ATLAS_FF_MULTI_TURN=true to enable"
    );
  }
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  const childId = await engine.refine({
    parentRitualId: input.parentRitualId,
    projectId: input.projectId,
    userId,
    userTurn: input.userTurn
  });
  const snapshot = await engine.getRitual(childId);
  return {
    ritualId: childId,
    parentRitualId: input.parentRitualId,
    artifact: snapshot?.artifact,
    roleEvents: snapshot?.roleEvents ?? [],
    developerOutput: snapshot?.developerOutput,
    sandboxApplyResult: snapshot?.sandboxApplyResult,
    securityReport: snapshot?.securityReport as SecurityReport | undefined,
    accessibilityReport: snapshot?.accessibilityReport as AccessibilityReport | undefined
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/actions/refineRitual.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/actions/refineRitual.ts apps/atlas-web/test/lib/actions/refineRitual.test.ts
git commit -m "feat(atlas-web): refineRitual Server Action — flag-gated wrapper around engine.refine (plan K)"
```

---

### Task 6: Thread API route — GET `/api/projects/[projectId]/ritual/[ritualId]/thread`

**Files:**
- Create: `apps/atlas-web/app/api/projects/[projectId]/ritual/[ritualId]/thread/route.ts`
- Create: `apps/atlas-web/test/app/api/ritual-thread-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/app/api/ritual-thread-route.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

const getRitualMock = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: "u-1" }) }));
vi.mock("@/lib/engine/factory", () => ({
  getRitualEngine: vi.fn(async () => ({ getRitual: getRitualMock }))
}));

import { GET } from "@/app/api/projects/[projectId]/ritual/[ritualId]/thread/route";

describe("GET /api/projects/[id]/ritual/[id]/thread — Plan K Task 6", () => {
  it("returns array root → leaf when ritual chain has 3 entries", async () => {
    getRitualMock.mockImplementation(async (id: string) => {
      if (id === "r-leaf")   return { projectId: "p", userId: "u-1", state: "done", roleEvents: [], parentRitualId: "r-mid" };
      if (id === "r-mid")    return { projectId: "p", userId: "u-1", state: "done", roleEvents: [], parentRitualId: "r-root" };
      if (id === "r-root")   return { projectId: "p", userId: "u-1", state: "done", roleEvents: [] };
      return undefined;
    });
    const res = await GET(new Request("https://x/x"), { params: Promise.resolve({ projectId: "p", ritualId: "r-leaf" }) });
    const body = await res.json();
    expect(body.thread.length).toBe(3);
    expect(body.thread[0].parentRitualId).toBeUndefined(); // root first
    expect(body.thread[2].parentRitualId).toBe("r-mid");   // leaf last
  });

  it("returns 404 when the requested ritualId is unknown", async () => {
    getRitualMock.mockResolvedValue(undefined);
    const res = await GET(new Request("https://x/x"), { params: Promise.resolve({ projectId: "p", ritualId: "r-?" }) });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the requested ritual's projectId does not match the URL projectId", async () => {
    getRitualMock.mockResolvedValue({ projectId: "p-OTHER", userId: "u-1", state: "done", roleEvents: [] });
    const res = await GET(new Request("https://x/x"), { params: Promise.resolve({ projectId: "p", ritualId: "r-x" }) });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/app/api/ritual-thread-route.test.ts
```

Expected: 3 fails.

- [ ] **Step 3: Implement the route**

Create `apps/atlas-web/app/api/projects/[projectId]/ritual/[ritualId]/thread/route.ts`:

```typescript
import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";

const MAX_DEPTH = 50;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; ritualId: string }> }
) {
  const { projectId, ritualId } = await params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const engine = await getRitualEngine(projectId);
  const leaf = await engine.getRitual(ritualId);
  if (!leaf) return Response.json({ error: "ritual not found" }, { status: 404 });
  if (leaf.projectId !== projectId) {
    return Response.json({ error: "project mismatch" }, { status: 403 });
  }

  // Walk parent chain root-ward, then reverse so caller gets root → leaf.
  const reverseChain: typeof leaf[] = [leaf];
  let cursor = leaf;
  for (let depth = 0; depth < MAX_DEPTH && cursor.parentRitualId; depth++) {
    const parent = await engine.getRitual(cursor.parentRitualId);
    if (!parent) break;  // chain broken — return what we have
    reverseChain.push(parent);
    cursor = parent;
  }

  return Response.json({ thread: reverseChain.reverse() });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/app/api/ritual-thread-route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/api/projects/[projectId]/ritual/[ritualId]/thread/route.ts apps/atlas-web/test/app/api/ritual-thread-route.test.ts
git commit -m "feat(atlas-web): GET /api/projects/[id]/ritual/[id]/thread — walks parent-chain root→leaf (plan K)"
```

---

### Task 7: `useRefinementThread` client hook

**Files:**
- Create: `apps/atlas-web/lib/refinement/useRefinementThread.ts`
- Create: `apps/atlas-web/test/lib/refinement/useRefinementThread.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/refinement/useRefinementThread.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { useRefinementThread } from "@/lib/refinement/useRefinementThread";

function Probe({ projectId, ritualId }: { projectId: string; ritualId: string }) {
  const { thread, loading, error } = useRefinementThread(projectId, ritualId);
  if (loading) return <div data-testid="loading" />;
  if (error)   return <div data-testid="error">{error.message}</div>;
  return <div data-testid="ok" data-count={thread.length}>{thread.map((r) => r.ritualId ?? "?").join(",")}</div>;
}

describe("useRefinementThread — Plan K Task 7", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as never;
  });

  it("starts loading, then resolves with thread array", async () => {
    (global.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ thread: [
        { ritualId: "r-root", parentRitualId: undefined },
        { ritualId: "r-leaf", parentRitualId: "r-root" }
      ] })
    });
    render(<Probe projectId="p" ritualId="r-leaf" />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("ok").getAttribute("data-count")).toBe("2");
    });
  });

  it("surfaces error when the API returns non-200", async () => {
    (global.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ error: "ritual not found" })
    });
    render(<Probe projectId="p" ritualId="r-?" />);
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toMatch(/not found|404/i);
    });
  });

  it("re-fetches when ritualId changes", async () => {
    (global.fetch as never as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thread: [{ ritualId: "r-A" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thread: [{ ritualId: "r-B" }] }) });
    const { rerender } = render(<Probe projectId="p" ritualId="r-A" />);
    await waitFor(() => expect(screen.getByTestId("ok").textContent).toBe("r-A"));
    rerender(<Probe projectId="p" ritualId="r-B" />);
    await waitFor(() => expect(screen.getByTestId("ok").textContent).toBe("r-B"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/refinement/useRefinementThread.test.tsx
```

Expected: 3 fails.

- [ ] **Step 3: Implement the hook**

Create `apps/atlas-web/lib/refinement/useRefinementThread.ts`:

```typescript
"use client";

import { useEffect, useState } from "react";

export interface ThreadRitual {
  ritualId?: string;
  parentRitualId?: string;
  artifact?: unknown;
  developerOutput?: { diff: string; summary?: string };
  state?: string;
}

export interface UseRefinementThreadResult {
  thread: ThreadRitual[];
  loading: boolean;
  error: Error | null;
  /** Manual re-fetch (call after a successful refineRitual). */
  refresh: () => void;
}

export function useRefinementThread(
  projectId: string,
  ritualId: string | null
): UseRefinementThreadResult {
  const [thread, setThread] = useState<ThreadRitual[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ritualId) {
      setThread([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/ritual/${encodeURIComponent(ritualId)}/thread`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = await res.json();
        if (!cancelled) setThread(body.thread ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, ritualId, tick]);

  return { thread, loading, error, refresh: () => setTick((t) => t + 1) };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/refinement/useRefinementThread.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/refinement/useRefinementThread.ts apps/atlas-web/test/lib/refinement/useRefinementThread.test.tsx
git commit -m "feat(atlas-web): useRefinementThread hook — fetches /thread route + re-fetches on ritualId change (plan K)"
```

---

### Task 8: `RefinementInputBar` component

**Files:**
- Create: `apps/atlas-web/components/RefinementInputBar.tsx`
- Create: `apps/atlas-web/test/components/RefinementInputBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/components/RefinementInputBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { RefinementInputBar } from "@/components/RefinementInputBar";

describe("RefinementInputBar — Plan K Task 8", () => {
  it("renders nothing when flagEnabled=false (server-side flag check)", () => {
    const { container } = render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={false}
        onRefine={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders textarea + Refine button when flagEnabled=true", () => {
    render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={true}
        onRefine={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/refine/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
  });

  it("calls onRefine with the typed text on submit", async () => {
    const onRefine = vi.fn(async () => undefined);
    render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={true}
        onRefine={onRefine}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/refine/i), { target: { value: "rename foo" } });
    fireEvent.click(screen.getByRole("button", { name: /refine/i }));
    await waitFor(() => {
      expect(onRefine).toHaveBeenCalledWith("rename foo");
    });
  });

  it("disables the button + textarea while pending", async () => {
    let resolveRefine: () => void = () => {};
    const onRefine = vi.fn(() => new Promise<void>((res) => { resolveRefine = res; }));
    render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={true}
        onRefine={onRefine}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/refine/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /refine/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refine/i })).toBeDisabled();
    });
    resolveRefine();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/components/RefinementInputBar.test.tsx
```

Expected: 4 fails.

- [ ] **Step 3: Implement the component**

Create `apps/atlas-web/components/RefinementInputBar.tsx`:

```typescript
"use client";

import { useState } from "react";

export interface RefinementInputBarProps {
  projectId: string;
  parentRitualId: string;
  flagEnabled: boolean;
  onRefine: (userTurn: string) => Promise<void>;
}

export function RefinementInputBar({
  parentRitualId,
  flagEnabled,
  onRefine
}: RefinementInputBarProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!flagEnabled) return null;

  const handleSubmit = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onRefine(text);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2" data-parent-ritual={parentRitualId}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        placeholder="Refine: describe the change you'd like…"
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        rows={2}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={pending || !text.trim()}
          className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? "Refining…" : "Refine"}
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-700">{error}</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/components/RefinementInputBar.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/RefinementInputBar.tsx apps/atlas-web/test/components/RefinementInputBar.test.tsx
git commit -m "feat(atlas-web): RefinementInputBar — textarea + Refine button; flag-OFF renders nothing (plan K)"
```

---

### Task 9: Wire ChatPanel to render the refinement thread + RefinementInputBar

**Files:**
- Modify: `apps/atlas-web/components/ChatPanel.tsx`
- Modify: `apps/atlas-web/test/components/ChatPanel.test.tsx`

- [ ] **Step 1: Add the wiring**

In `ChatPanel.tsx`:
1. Add `multiTurnFlagEnabled?: boolean` to `ChatPanel` props (passed in from server-side caller — RailShell or canvas/page).
2. Add `refineAction?: (input: { projectId: string; parentRitualId: string; userTurn: string }) => Promise<RefineRitualResult>` to props (the Server Action ref).
3. After each developer-output card render, render `<RefinementInputBar projectId={projectId} parentRitualId={result.ritualId} flagEnabled={multiTurnFlagEnabled} onRefine={(userTurn) => refineAction({ projectId, parentRitualId: result.ritualId, userTurn })} />`.
4. Maintain a local `history` state that appends the refinement result (so the user sees the new ritual card after refining).

The full thread-loading via `useRefinementThread` is reserved for a future iteration — v1 just appends to local in-session history. (This avoids a chicken-and-egg problem with the API route requiring a flag-on flow that the test environment doesn't have.)

- [ ] **Step 2: Add ChatPanel tests**

Append to `ChatPanel.test.tsx`:

```typescript
it("renders RefinementInputBar under each developer-output card when multiTurnFlagEnabled=true", async () => {
  // ... (mirror existing test pattern, send a message, assert refine button visible)
});

it("does NOT render RefinementInputBar when multiTurnFlagEnabled=false (today's behavior)", async () => {
  // ... (mirror, assert refine button absent)
});

it("clicking Refine appends a new ritual card to the conversation", async () => {
  // ... (mock refineAction returning a child ritual, assert two cards visible)
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/atlas-web && pnpm test test/components/ChatPanel.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/test/components/ChatPanel.test.tsx
git commit -m "feat(atlas-web): ChatPanel renders RefinementInputBar + appends child rituals to history (plan K)"
```

---

### Task 10: Pass `multiTurnFlagEnabled` + `refineAction` through to ChatPanel from servers

**Files:**
- Modify: `apps/atlas-web/components/shell/RailShell.tsx` (Plan G's rail) — pass the flag + action
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx` — pass when ChatPanel mounts (flag-OFF path)

- [ ] **Step 1: Plumb the props from server-side renders**

In RailShell (server-readable env):
```typescript
import { isFeatureEnabled } from "@/lib/feature-flags";
import { refineRitual } from "@/lib/actions/refineRitual";

// inside RailShell's JSX, when rendering ChatPanel:
<ChatPanel
  projectId={projectId}
  action={startRitual}
  multiTurnFlagEnabled={isFeatureEnabled("multi-turn")}
  refineAction={refineRitual}
/>
```

Same plumbing in canvas/page.tsx for the flag-OFF rail path.

- [ ] **Step 2: Update tests**

Both Plan G's RailShell test and the canvas-chatpanel-gate test need to verify the new props pass through.

- [ ] **Step 3: Run typecheck + relevant tests**

```bash
cd apps/atlas-web && pnpm typecheck && pnpm test test/components/shell/ test/app/projects/
```

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/components/shell/RailShell.tsx "apps/atlas-web/app/projects/[projectId]/canvas/page.tsx" apps/atlas-web/test/components/shell/RailShell.test.tsx apps/atlas-web/test/app/projects/canvas-chatpanel-gate.test.tsx
git commit -m "feat(atlas-web): plumb multi-turn flag + refineAction through RailShell + canvas page (plan K)"
```

---

### Task 11: Flag-OFF behavioural lock + final verification

**Files:**
- (verification gate; no new code unless inline fixes needed)

- [ ] **Step 1: Run full atlas-web suite with flag OFF**

```bash
cd apps/atlas-web && unset ATLAS_FF_MULTI_TURN && pnpm test
```

Expected: every existing test still green. Pre-existing parallel-run flakes (per Plan G/H/I/J precedent) are out-of-scope.

- [ ] **Step 2: Cross-package typecheck**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/ritual-engine typecheck
pnpm -F @atlas/role-architect typecheck
```

- [ ] **Step 3: Run all Plan K tests with flag ON**

```bash
cd apps/atlas-web && ATLAS_FF_MULTI_TURN=true pnpm test test/lib/actions/refineRitual.test.ts test/components/RefinementInputBar.test.tsx test/lib/refinement/ test/app/api/ritual-thread-route.test.ts
```

Expected: all green.

---

### Task 12: Update docs + merge

**Files:**
- Modify: `docs/superpowers/local-dev-status.md`
- Modify: this plan file

- [ ] **Step 1: Update local-dev-status.md**

Find the bullet under "What's NOT wired (deferred)" referencing "Multi-turn refinement". Remove it. Append to "What's wired":

```markdown
- **Plan K: multi-turn ritual refinement.** When `ATLAS_FF_MULTI_TURN=true`, the developer-output card in ChatPanel shows a "Refine" textarea. Clicking Refine starts a NEW ritual linked to the parent via `parentRitualId`; the architect's prompt prepends a "Previous turn" section (parent's plan + diff truncated to 8000 chars). The chain runs through the same architect → developer → security → a11y pipeline as the first turn. ChatPanel's history appends the child ritual; the `/api/projects/[id]/ritual/[id]/thread` route walks the parent chain root → leaf for cross-page lineage queries. Flag-OFF: refineRitual Server Action throws; RefinementInputBar renders nothing; today's one-shot flow preserved.
```

- [ ] **Step 2: Mark plan shipped**

Append a Shipped section to this plan file.

- [ ] **Step 3: Commit + merge**

```bash
git add docs/superpowers/local-dev-status.md docs/superpowers/plans/2026-04-29-plan-k-multi-turn-refinement.md
git commit -m "docs(plan-k): mark shipped — multi-turn refinement behind ATLAS_FF_MULTI_TURN"
git checkout main
git pull
git merge --no-ff plan-k/multi-turn-refinement -m "Merge branch 'plan-k/multi-turn-refinement'

Plan K — multi-turn ritual refinement behind ATLAS_FF_MULTI_TURN.
- New RitualEngine.refine() — child ritual linked via parentRitualId
- New PriorRitualContext threaded into architect's deep-plan prompt
- New refineRitual Server Action + RefinementInputBar component
- New GET /thread API route walks parent chain root → leaf
- Flag-OFF preserves today's one-shot ChatPanel behavior
"
git branch -d plan-k/multi-turn-refinement
```

- [ ] **Step 4: Verify main is green**

```bash
cd apps/atlas-web && pnpm typecheck && pnpm test test/lib/actions/refineRitual.test.ts test/components/RefinementInputBar.test.tsx
```

---

## Completion Checklist

After all 12 tasks:

- [ ] `pnpm typecheck` — clean across atlas-web + ritual-engine + role-architect
- [ ] `pnpm test` (atlas-web) — full suite green; ~22 new cases across 6 new test files
- [ ] Ritual-engine — +6 refine + +4 prior-ritual-context cases
- [ ] Role-architect — +4 prompt-threading cases
- [ ] Flag combos verified: flag-OFF (today's one-shot); flag-ON (refinement loop active)
- [ ] Manual smoke (with LLM proxy + flags + Plan E.0 broker on): start a ritual, see developer diff, click Refine, type "rename X to Y", confirm new ritual card appears below; restart `pnpm dev` and confirm both ritual cards still visible (Plan H hydrator recovers the lineage)
- [ ] Manual smoke: cross-project denial — try to walk a parent chain across project boundary; thread route returns 403
- [ ] `docs/superpowers/local-dev-status.md` updated — Plan K moved to "What's wired"
- [ ] This plan file marked Shipped at the bottom
- [ ] `plan-k/multi-turn-refinement` merged to `main` (`--no-ff`); branch deleted

## Follow-ups (out of scope for Plan K)

1. **Branching refinements UI.** Today the data model supports DAG (multiple children off the same parent) but UX shows only the latest leaf. A future plan can add a sidebar showing alternate branches.
2. **Streaming refinement progress** via Plan E.0's broker — today the user sees a "Refining…" spinner; streaming would surface architect/developer events live (mirroring `<RitualTimeline />`).
3. **Refinement context budgeting.** The 8000-char diff truncation is naive. A future plan can use a tokenizer + smarter compression (drop hunk bodies, keep file headers + summaries).
4. **Refinement of failed rituals.** Today refinement assumes the parent has a `developerOutput.diff`. Refining a failed/escalated ritual (no diff) is supported (cosmetic path) but the prompt has nothing useful to thread; v2 could fold the failure cause into the prompt.
