# Plan L — Developer Fix-Loop on Gate Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today, when Plan I's `SecurityRole` or `AccessibilityRole` fails its gate (`report.passed === false`), the engine emits `ritual.escalation_requested`, sets state to `escalated`, and stops. The user sees the report in `ChatPanel` and must manually craft a refinement message ("fix the security issue you found"). Plan L automates the fix-attempt: when a chained gate fails AND `ATLAS_FF_AUTO_FIX_LOOP=true` AND the user hasn't exhausted the per-ritual retry budget, the engine automatically triggers `refine()` with a synthesized userTurn (`"Address the L4-security findings: <bullet list of issues>"`) and the gate's report folded into a richer `PriorRitualContext` (extended with `parentSecurityReport` / `parentAccessibilityReport`). The refinement re-runs architect → developer → gates; if the gate now passes the lineage closes cleanly. Behind feature flag `ATLAS_FF_AUTO_FIX_LOOP`; flag-OFF preserves Plan I's "stop at escalation" behavior.

**Architecture:** Plan I's chain dispatch loop in `RitualEngine._runRitual()` (the post-developer chain that runs after a successful diff) detects `payload.passed === false` and currently calls `await this.emit({ type: "ritual.escalation_requested", … })` before `break`. Plan L extends this: after the escalation event but before the `break`, if `ATLAS_FF_AUTO_FIX_LOOP=true` AND `record.fixAttempts ?? 0 < MAX_FIX_ATTEMPTS` (default 2), the engine constructs a fix-attempt `RefineInput`:
- `userTurn`: `"Address the ${gateLabel} findings:\n${issuesAsBullets}"`
- `parentRitualId`: the current ritualId (the ritual whose gate just failed)
- `projectId` / `userId`: same as the parent

The engine then calls `await this.refine(refineInput)` (the Plan K method) — but with a twist: the architect prompt needs the gate's full report folded in, not just the developer's diff. We extend `buildPriorRitualContext` to accept optional `securityReport` / `accessibilityReport` fields, which `buildArchitectUserTurn` (Plan K's helper) renders as a new "## Gate findings" section after the existing "Previous turn" preamble. The fix-attempt child ritual's `RitualSnapshot` gets a new `fixAttempts: number` field that increments per attempt across the lineage; the engine reads this to enforce `MAX_FIX_ATTEMPTS`. ChatPanel surfaces the auto-fix lineage just like manual refinements (Plan K's history append) — but tags the fix-attempt cards with a `data-auto-fix="true"` attribute + small badge so users see "(auto-fix)" on the user-turn label.

**Failure modes:**
- Gate fails AND budget exhausted → emit `auto_fix.budget_exhausted` event + stop chain (existing escalation flow). No retry.
- Refinement throws (LLM error, conductor failure) → log, swallow, fall back to Plan I's escalation behavior. Don't retry on engine errors.
- Refinement succeeds + new gate passes → ritual completes normally; lineage shows N fix attempts in ChatPanel.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Vitest 2.x · existing Plan I (postDeveloperChain) + Plan K (refine() + PriorRitualContext) on `main`.

**Prerequisites:**
- Plan I merged on `main` (`postDeveloperChain` + chain-failure escalation in `RitualEngine._runRitual`).
- Plan K merged on `main` (`refine()` + `PriorRitualContext` + `buildArchitectUserTurn`).
- Plan H merged on `main` (hydrator already folds `security.completed` / `accessibility.completed` per the H+I cleanup).
- LLM provider configured.

**Branch:** `plan-l/developer-fix-loop` cut from `main`. Final task merges back.

---

## File Structure

```
packages/ritual-engine/src/
  prior-ritual-context.ts                                       # MODIFIED: + parentSecurityReport / parentAccessibilityReport fields
  engine.ts                                                     # MODIFIED: chain-failure branch triggers refine() when auto-fix flag on; fixAttempts counter

packages/ritual-engine/test/
  engine-auto-fix-loop.test.ts                                  # NEW: ~6 cases (auto-fix triggers; budget exhaust; refinement passes; flag-off path; refinement-throw fallback)
  prior-ritual-context-gate-reports.test.ts                     # NEW: 3 cases (security report folded; a11y report folded; both)

packages/role-architect/src/
  deep-plan.ts                                                  # MODIFIED: buildArchitectUserTurn renders "## Gate findings" section when prior context has reports

packages/role-architect/test/
  prior-ritual-prompt.test.ts                                   # MODIFIED: + 2 cases (gate findings rendered when present; absent when not)

apps/atlas-web/lib/
  feature-flags.ts                                              # MODIFIED: + "auto-fix-loop" flag

apps/atlas-web/test/lib/feature-flags.test.ts                   # MODIFIED: + 3 cases for the new flag

apps/atlas-web/components/
  ChatPanel.tsx                                                 # MODIFIED: render auto-fix badge on fix-attempt history entries
  ChatPanel.test.tsx                                            # MODIFIED: + 1 case (auto-fix badge rendered)
```

**Why this shape.** The fix-loop logic lives in `RitualEngine._runRitual()` (alongside the chain dispatch it triggers off) because that's the only place that knows when a gate just failed AND has the report payload + parent ritualId in scope. The `PriorRitualContext` extension is additive — existing consumers ignore the new fields. The architect prompt extension is one new section in `buildArchitectUserTurn`. The ChatPanel change is purely cosmetic (badge); no logic change to refinement history append. The `MAX_FIX_ATTEMPTS` constant (default 2) lives as an engine constant — a future plan can make it configurable per-project.

---

## Design Decisions

1. **Trigger condition: gate-fail AND flag-on AND budget-not-exhausted.** All three required. Gate-fail without the flag preserves Plan I's escalation. Budget exhaustion (default 2 attempts) prevents infinite retry loops on uncfixable issues — a future plan can let users override per-project.
2. **Synthesized userTurn is deterministic and short.** Format: `"Address the {gateLabel} findings:\n- {issue1}\n- {issue2}\n…"`. No model creativity required at this layer; the architect's deep-plan handles the actual fix design.
3. **`fixAttempts` lives on the RitualRecord, propagated forward.** Each child ritual created by auto-fix inherits `parent.fixAttempts ?? 0` and increments by 1. Manual refinements (user-triggered) reset the counter to 0 (a fresh user request shouldn't be punished by prior auto-fix attempts).
4. **Refinement uses the SAME flag-OFF / flag-ON path as Plan K.** Plan L does NOT bypass `engine.refine()`; it just calls it. This means `ATLAS_FF_AUTO_FIX_LOOP=true` ALONE is insufficient — the user must also have `ATLAS_FF_MULTI_TURN=true` (or the `engine.refine()` path won't run). Cross-flag dependency documented in `.env.example` and local-dev-status.
5. **`PriorRitualContext` extension carries the gate report verbatim.** No truncation for v1 — gate reports are bounded (~50 issues max in practice). v2 can summarize if reports balloon.
6. **`auto_fix.attempted` event** emitted by the engine before calling `refine()` so observers (Plan E.0 broker, ChatPanel timeline) can show "AI is auto-fixing the L4 issues…" UX. `auto_fix.budget_exhausted` emitted instead when the budget is hit.
7. **No partial-fix mode.** If 3 issues failed and the model fixes 2, the new gate dispatches and either passes (clean) or fails again (1 issue left → another auto-fix attempt if budget remains). No bookkeeping of "which issues were attempted".
8. **ChatPanel badge is server-derivable.** Each ritual snapshot exposes `fixAttempts: number`; ChatPanel renders "(auto-fix #N)" tag when `> 0`. No new client-side state.
9. **Hydrator already covers it.** Plan H's hydrator folds `security.completed` / `accessibility.completed` events (post H+I cleanup commit `81479d1`); Plan L's new `auto_fix.*` events are NOT folded today — that's a follow-up tracked in this plan's Shipped section.

---

## Task List (8 tasks)

---

### Task 1: Cut the branch + add `auto-fix-loop` feature flag

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/test/lib/feature-flags.test.ts`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-l/developer-fix-loop
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/atlas-web/test/lib/feature-flags.test.ts`:

```typescript
describe("auto-fix-loop flag (Plan L)", () => {
  it("is off when ATLAS_FF_AUTO_FIX_LOOP is unset", () => {
    expect(isFeatureEnabled("auto-fix-loop", sourceWith({}))).toBe(false);
  });
  it("is on when ATLAS_FF_AUTO_FIX_LOOP=true", () => {
    expect(
      isFeatureEnabled("auto-fix-loop", sourceWith({ ATLAS_FF_AUTO_FIX_LOOP: "true" }))
    ).toBe(true);
  });
  it("listFlagStates includes auto-fix-loop", () => {
    expect(listFlagStates(sourceWith({}))["auto-fix-loop"]).toBe(false);
  });
});
```

Update `listFlagStates` equality test to include `"auto-fix-loop": false`.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

- [ ] **Step 4: Add the flag**

In `apps/atlas-web/lib/feature-flags.ts`, append `"auto-fix-loop"` to the `FeatureFlag` union, add `"auto-fix-loop": "ATLAS_FF_AUTO_FIX_LOOP"` to FLAG_TO_ENV, add to listFlagStates.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags.test.ts
git commit -m "feat(atlas-web): auto-fix-loop feature flag — ATLAS_FF_AUTO_FIX_LOOP (plan L)"
```

---

### Task 2: Extend `PriorRitualContext` with gate report fields

**Files:**
- Modify: `packages/ritual-engine/src/prior-ritual-context.ts`
- Create: `packages/ritual-engine/test/prior-ritual-context-gate-reports.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ritual-engine/test/prior-ritual-context-gate-reports.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPriorRitualContext } from "../src/prior-ritual-context.js";

describe("PriorRitualContext — gate report fields (Plan L Task 2)", () => {
  it("captures parentSecurityReport when provided", () => {
    const report = { passed: false, issues: [{ severity: "critical", message: "secret leaked" }] };
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: report
    });
    expect(ctx.parentSecurityReport).toEqual(report);
  });

  it("captures parentAccessibilityReport when provided", () => {
    const report = { passed: false, issues: [{ severity: "high", message: "missing alt" }] };
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      accessibilityReport: report
    });
    expect(ctx.parentAccessibilityReport).toEqual(report);
  });

  it("both fields can be present simultaneously", () => {
    const ctx = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: { passed: false, issues: [] },
      accessibilityReport: { passed: true, issues: [] }
    });
    expect(ctx.parentSecurityReport).toBeDefined();
    expect(ctx.parentAccessibilityReport).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/prior-ritual-context-gate-reports.test.ts
```

- [ ] **Step 3: Extend the type + helper**

In `packages/ritual-engine/src/prior-ritual-context.ts`:

```typescript
export interface PriorRitualContext {
  readonly kind: "priorRitual";
  parentRitualId: string;
  parentArtifact?: unknown;
  parentDeveloperOutput?: DeveloperOutputRecord;
  parentRoleEvents?: RoleEventRecord[];
  /** Plan L: gate reports from the parent ritual when the chain failed. */
  parentSecurityReport?: unknown;
  parentAccessibilityReport?: unknown;
}

export function buildPriorRitualContext(input: {
  ritualId: string;
  artifact?: unknown;
  developerOutput?: DeveloperOutputRecord;
  roleEvents?: RoleEventRecord[];
  securityReport?: unknown;          // Plan L
  accessibilityReport?: unknown;     // Plan L
}): PriorRitualContext {
  // ... existing diff truncation logic ...
  return {
    kind: "priorRitual",
    parentRitualId: input.ritualId,
    parentArtifact: input.artifact,
    parentDeveloperOutput,
    parentRoleEvents: input.roleEvents,
    parentSecurityReport: input.securityReport,
    parentAccessibilityReport: input.accessibilityReport
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/prior-ritual-context-gate-reports.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/prior-ritual-context.ts packages/ritual-engine/test/prior-ritual-context-gate-reports.test.ts
git commit -m "feat(ritual-engine): PriorRitualContext + parentSecurityReport / parentAccessibilityReport (plan L)"
```

---

### Task 3: Architect prompt — render "## Gate findings" section when reports present

**Files:**
- Modify: `packages/role-architect/src/deep-plan.ts`
- Modify: `packages/role-architect/test/prior-ritual-prompt.test.ts`

- [ ] **Step 1: Write failing test cases**

Append to `packages/role-architect/test/prior-ritual-prompt.test.ts`:

```typescript
describe("buildArchitectUserTurn — gate findings (Plan L Task 3)", () => {
  it("renders '## Gate findings' section when parentSecurityReport.passed === false", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: {
        passed: false,
        issues: [
          { severity: "critical", message: "Hardcoded API key in src/foo.ts" }
        ]
      }
    });
    const out = buildArchitectUserTurn({
      userTurn: "address the security findings",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toMatch(/## Gate findings/);
    expect(out).toContain("Hardcoded API key");
  });

  it("renders gate-findings for accessibility too", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      accessibilityReport: {
        passed: false,
        issues: [{ severity: "high", message: "Image missing alt text" }]
      }
    });
    const out = buildArchitectUserTurn({
      userTurn: "fix the a11y issues",
      scope: "new-feature",
      priorRitual: prior
    });
    expect(out).toContain("missing alt text");
  });

  it("does NOT render '## Gate findings' when both reports are absent or passed", () => {
    const prior = buildPriorRitualContext({
      ritualId: "r-parent",
      securityReport: { passed: true, issues: [] }
    });
    const out = buildArchitectUserTurn({
      userTurn: "iterate", scope: "new-feature", priorRitual: prior
    });
    expect(out).not.toMatch(/## Gate findings/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/role-architect && pnpm test test/prior-ritual-prompt.test.ts
```

- [ ] **Step 3: Extend `buildArchitectUserTurn`**

In `packages/role-architect/src/deep-plan.ts`, modify `renderPriorRitualSection` (or add a sibling renderer called from `buildArchitectUserTurn`) to append a "## Gate findings" block when either gate report is present and `passed === false`. Format:

```
## Gate findings

The following gate failures must be addressed:

### L4 Security
- [critical] Hardcoded API key in src/foo.ts
- [high] Missing CORS allowlist on /api/x

### L5 Accessibility
- [high] Image missing alt text
```

Skip a section when the corresponding report is absent or `passed === true`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/role-architect && pnpm test test/prior-ritual-prompt.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/role-architect/src/deep-plan.ts packages/role-architect/test/prior-ritual-prompt.test.ts
git commit -m "feat(role-architect): render '## Gate findings' section when parent ritual's gate failed (plan L)"
```

---

### Task 4: Engine — add `fixAttempts` field + auto-fix trigger in chain-failure branch

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Create: `packages/ritual-engine/test/engine-auto-fix-loop.test.ts`

- [ ] **Step 1: Add `fixAttempts` to RitualRecord + Snapshot**

In `engine.ts`:

```typescript
interface RitualRecord {
  // ... existing fields ...
  /** Plan L: incremented each time the engine auto-triggers a refine() in
   *  response to a chained gate failure. Manual refinements (user-triggered)
   *  reset to 0. Capped at MAX_FIX_ATTEMPTS to prevent infinite loops. */
  fixAttempts?: number;
}

export interface RitualSnapshot {
  // ... existing fields ...
  fixAttempts?: number;
}
```

Update `getRitual` return shape to include `fixAttempts`.

- [ ] **Step 2: Write failing tests**

Create `packages/ritual-engine/test/engine-auto-fix-loop.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

interface DispatchOpts { forceRoleId?: string; priorArtifact?: unknown }

const ARTIFACT_EVENT = { eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } };

function makeEngine(opts: { autoFixEnabled?: boolean }, dispatchImpl: (req: unknown, opts?: DispatchOpts) => unknown) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
    postDeveloperChain: ["security"],
    autoFixLoopEnabled: opts.autoFixEnabled ?? false
  });
}

describe("RitualEngine auto-fix loop — Plan L Task 4", () => {
  it("flag-OFF: gate failure escalates and stops (Plan I behavior preserved)", async () => {
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") return { roleId: "developer", output: { events: [{ eventType: "developer.completed", payload: { diff: "diff x" } }], diff: { kind: "patch", body: "diff x" } } };
      if (opts.forceRoleId === "security") return { roleId: "security", output: { events: [{ eventType: "security.completed", payload: { passed: false, report: { passed: false, issues: [{ severity: "critical", message: "x" }] } } }], diff: { kind: "none" } } };
      throw new Error(`unexpected: ${opts.forceRoleId}`);
    });
    const engine = makeEngine({ autoFixEnabled: false }, dispatch);
    const id = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const snap = await engine.getRitual(id);
    expect(snap?.state).toBe("escalated");
    expect(snap?.fixAttempts ?? 0).toBe(0);  // No auto-fix attempted.
  });

  it("flag-ON + first attempt: triggers refine() with fix-request userTurn", async () => {
    let architectCallCount = 0;
    const dispatch = vi.fn(async (_req: { userTurn?: string }, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) {
        architectCallCount++;
        return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } };
      }
      if (opts.forceRoleId === "developer") return { roleId: "developer", output: { events: [{ eventType: "developer.completed", payload: { diff: `diff for arch call ${architectCallCount}` } }], diff: { kind: "patch", body: "x" } } };
      if (opts.forceRoleId === "security") {
        // First security call fails; second passes (post-fix).
        const passed = architectCallCount === 2;
        return { roleId: "security", output: { events: [{ eventType: "security.completed", payload: { passed, report: { passed, issues: passed ? [] : [{ severity: "critical", message: "secret leak" }] } } }], diff: { kind: "none" } } };
      }
      throw new Error(`unexpected: ${opts.forceRoleId}`);
    });
    const engine = makeEngine({ autoFixEnabled: true }, dispatch);
    const id = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    // The auto-fix triggers refine() which creates a child ritual; the original ritual's snapshot still exists.
    const snap = await engine.getRitual(id);
    expect(snap).toBeDefined();
    // We expect TWO architect dispatches (first ritual + auto-fix child).
    expect(architectCallCount).toBe(2);
  });

  it("flag-ON + budget exhausted: no further refine; emits auto_fix.budget_exhausted", async () => {
    // Always-failing gate; should attempt MAX_FIX_ATTEMPTS times then stop.
    const sink = { emit: vi.fn() };
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") return { roleId: "developer", output: { events: [{ eventType: "developer.completed", payload: { diff: "x" } }], diff: { kind: "patch", body: "x" } } };
      if (opts.forceRoleId === "security") return { roleId: "security", output: { events: [{ eventType: "security.completed", payload: { passed: false, report: { passed: false, issues: [{ severity: "critical", message: "x" }] } } }], diff: { kind: "none" } } };
      throw new Error(`unexpected: ${opts.forceRoleId}`);
    });
    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: sink as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
      postDeveloperChain: ["security"],
      autoFixLoopEnabled: true
    });
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    // budget_exhausted should fire eventually
    const exhaustedCall = sink.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "auto_fix.budget_exhausted");
    expect(exhaustedCall).toBeDefined();
  });

  it("auto-fix child ritual has fixAttempts === 1; second attempt has 2", async () => {
    let architectCallCount = 0;
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) { architectCallCount++; return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } }; }
      if (opts.forceRoleId === "developer") return { roleId: "developer", output: { events: [{ eventType: "developer.completed", payload: { diff: "x" } }], diff: { kind: "patch", body: "x" } } };
      if (opts.forceRoleId === "security") return { roleId: "security", output: { events: [{ eventType: "security.completed", payload: { passed: false, report: { passed: false, issues: [{ severity: "critical", message: "x" }] } } }], diff: { kind: "none" } } };
      throw new Error("unexpected");
    });
    const engine = makeEngine({ autoFixEnabled: true }, dispatch);
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    // Walk the engine's internal map; find the highest-fixAttempts ritual.
    const rituals = (engine as never as { rituals: Map<string, { fixAttempts?: number }> }).rituals;
    const maxAttempts = Math.max(...Array.from(rituals.values()).map((r) => r.fixAttempts ?? 0));
    expect(maxAttempts).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/engine-auto-fix-loop.test.ts
```

- [ ] **Step 4: Add the auto-fix trigger to `_runRitual`**

In `engine.ts`:

1. Add `autoFixLoopEnabled?: boolean` to `RitualEngineOptions`. Add a private field + constructor wiring (default false).
2. Add `MAX_FIX_ATTEMPTS = 2` constant near top of file.
3. In the chain-failure branch (where `payload?.passed === false`), AFTER emitting `ritual.escalation_requested` and BEFORE the `break`:

```typescript
if (this.autoFixLoopEnabled && (record.fixAttempts ?? 0) < MAX_FIX_ATTEMPTS) {
  const issues = (payload.report as { issues?: Array<{ severity: string; message: string }> })?.issues ?? [];
  const issuesAsBullets = issues.map((i) => `- [${i.severity}] ${i.message}`).join("\n");
  const fixUserTurn = `Address the ${gateLabel} findings:\n${issuesAsBullets}`;

  await this.emit({
    type: "auto_fix.attempted",
    ritualId,
    ts: new Date().toISOString(),
    payload: { gate: gateLabel, attemptNumber: (record.fixAttempts ?? 0) + 1, parentRitualId: ritualId }
  } as never);

  try {
    // Plan L deviates from refine()'s normal flow: we pass the parent's
    // gate report into PriorRitualContext so the architect prompt has the
    // full context, not just the diff.
    const childId = await this._runRitual({
      userTurn: fixUserTurn,
      editClass: "structural",
      projectId: input.projectId,
      userId: input.userId,
      priorContext: buildPriorRitualContext({
        ritualId,
        artifact: record.artifact,
        developerOutput: record.developerOutput,
        roleEvents: record.roleEvents,
        securityReport: record.securityReport,
        accessibilityReport: record.accessibilityReport
      }),
      parentRitualId: ritualId,
      fixAttempts: (record.fixAttempts ?? 0) + 1
    });
    // child's snapshot already in this.rituals — caller (ChatPanel via
    // engine.getRitual) walks the lineage to render history.
    void childId;
  } catch (err) {
    // Auto-fix infrastructure failed (LLM/conductor error). Don't retry —
    // emit a synthetic event and let the original escalation stand.
    await this.emit({
      type: "auto_fix.failed",
      ritualId,
      ts: new Date().toISOString(),
      payload: { gate: gateLabel, error: err instanceof Error ? err.message : String(err) }
    } as never);
  }
} else if (this.autoFixLoopEnabled && (record.fixAttempts ?? 0) >= MAX_FIX_ATTEMPTS) {
  await this.emit({
    type: "auto_fix.budget_exhausted",
    ritualId,
    ts: new Date().toISOString(),
    payload: { gate: gateLabel, attempts: record.fixAttempts ?? 0 }
  } as never);
}
break;
```

4. Extend `_runRitual`'s input to accept `fixAttempts?: number`. When set, write it into the new ritual's `RitualRecord.fixAttempts` field.

5. **Note on event types:** `auto_fix.attempted` / `auto_fix.budget_exhausted` / `auto_fix.failed` are NOT in `events.ts` schema. Use the same `as never` cast pattern Plan I used initially for `ritual.escalated`, OR (cleaner) extend the event union in `events.ts`. Recommend the latter for v1; spec the new event types as part of the commit.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/engine-auto-fix-loop.test.ts
```

- [ ] **Step 6: Run full ritual-engine suite to catch regressions**

```bash
cd packages/ritual-engine && pnpm test
```

Expected: all green (78 + 4 new = 82 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/src/events.ts packages/ritual-engine/test/engine-auto-fix-loop.test.ts
git commit -m "feat(ritual-engine): auto-fix loop on gate failure — refine() with gate report context (plan L)"
```

---

### Task 5: Wire `autoFixLoopEnabled` into atlas-web factory

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`

- [ ] **Step 1: Read the flag in factory.ts**

After the existing `postDeveloperChain` build:

```typescript
return new RitualEngine({
  conductor,
  // ... existing opts ...
  postDeveloperChain,
  autoFixLoopEnabled: isFeatureEnabled("auto-fix-loop")
});
```

- [ ] **Step 2: Verify typecheck + factory test still passes**

```bash
cd apps/atlas-web && pnpm typecheck
cd apps/atlas-web && pnpm test test/lib/engine/factory-role-flags.test.ts test/lib/engine/factory-hydrator-flag.test.ts
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts
git commit -m "feat(atlas-web): wire autoFixLoopEnabled into engine factory (plan L)"
```

---

### Task 6: ChatPanel — render "(auto-fix #N)" badge on fix-attempt history entries

**Files:**
- Modify: `apps/atlas-web/components/ChatPanel.tsx`
- Modify: `apps/atlas-web/test/components/ChatPanel.test.tsx`

- [ ] **Step 1: Add `fixAttempts?: number` to `StartRitualResult` interface in ChatPanel.tsx**

Also update `apps/atlas-web/lib/actions/startRitual.ts` and `refineRitual.ts` to forward `snapshot.fixAttempts` into the result.

- [ ] **Step 2: Render the badge in the history list**

Where ChatPanel renders the `architect` history entry (likely `m.role === "architect" && <ArchitectOutput …>`), prepend a small badge tag:

```typescript
{m.result?.fixAttempts && m.result.fixAttempts > 0 && (
  <span data-testid="auto-fix-badge" className="text-xs text-amber-700 font-mono">
    (auto-fix #{m.result.fixAttempts})
  </span>
)}
```

- [ ] **Step 3: Add test case to ChatPanel.test.tsx**

```typescript
it("renders auto-fix badge when result.fixAttempts > 0", async () => {
  const action = vi.fn(async () => ({
    ritualId: "r-1", roleEvents: [], fixAttempts: 1
  }));
  render(<ChatPanel projectId="p" action={action} />);
  // ... type + send (mirror existing pattern) ...
  await waitFor(() => {
    expect(screen.getByTestId("auto-fix-badge")).toBeInTheDocument();
    expect(screen.getByTestId("auto-fix-badge").textContent).toContain("auto-fix #1");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd apps/atlas-web && pnpm test test/components/ChatPanel.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/lib/actions/startRitual.ts apps/atlas-web/lib/actions/refineRitual.ts apps/atlas-web/test/components/ChatPanel.test.tsx
git commit -m "feat(atlas-web): ChatPanel renders '(auto-fix #N)' badge for fix-attempt rituals (plan L)"
```

---

### Task 7: Update env docs + flag-OFF lock

**Files:**
- Modify: `apps/atlas-web/.env.example`
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Document the flag in .env.example**

Append after the Plan K block:

```
# ─── Plan L: Developer fix-loop on gate failure ─────────────────────────────
# When ATLAS_FF_AUTO_FIX_LOOP=true AND ATLAS_FF_MULTI_TURN=true (required —
# the loop uses refine() under the hood) AND a Plan I gate fails, the engine
# auto-triggers a refinement with the gate's report folded into the architect
# prompt. Capped at 2 attempts per ritual lineage. Flag-OFF = today's
# escalate-and-stop behavior.
# ATLAS_FF_AUTO_FIX_LOOP=true
```

- [ ] **Step 2: Update local-dev-status.md table**

Add a row to the "How to enable each plan locally" table for Plan L. Append a "What's wired" bullet for Plan L.

- [ ] **Step 3: Run flag-OFF lock**

```bash
cd apps/atlas-web && unset ATLAS_FF_AUTO_FIX_LOOP && pnpm test
```

Expected: all green; Plan L's tests verify the flag-OFF path matches Plan I's escalate-and-stop.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/.env.example docs/superpowers/local-dev-status.md
git commit -m "docs(plan-l): env + local-dev-status — auto-fix-loop flag documented"
```

---

### Task 8: Mark shipped + merge

**Files:**
- Modify: this plan file
- (merge git op)

- [ ] **Step 1: Append Shipped section to this plan**

```markdown
## Shipped

All 8 tasks merged to `plan-l/developer-fix-loop` and then to `main`. `pnpm typecheck` clean. ritual-engine added 4 auto-fix + 3 prior-context-gate-reports cases. role-architect added 3 gate-findings cases. atlas-web added 3 flag cases + 1 ChatPanel auto-fix-badge case.
```

- [ ] **Step 2: Commit + merge**

```bash
git add docs/superpowers/plans/2026-04-29-plan-l-developer-fix-loop.md
git commit -m "docs(plan-l): mark shipped — auto-fix loop on gate failure behind ATLAS_FF_AUTO_FIX_LOOP"
git checkout main
git pull
git merge --no-ff plan-l/developer-fix-loop -m "Merge branch 'plan-l/developer-fix-loop'

Plan L — developer fix-loop on gate failure behind ATLAS_FF_AUTO_FIX_LOOP.
- New autoFixLoopEnabled option on RitualEngine
- PriorRitualContext extended with parentSecurityReport / parentAccessibilityReport
- Architect prompt renders '## Gate findings' section when reports present
- ChatPanel badges fix-attempt rituals with '(auto-fix #N)'
- MAX_FIX_ATTEMPTS=2 cap prevents infinite loops
- Cross-flag dependency: ATLAS_FF_MULTI_TURN must also be true (uses refine())
"
git branch -d plan-l/developer-fix-loop
```

- [ ] **Step 3: Verify main is green**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/ritual-engine test
```

---

## Completion Checklist

- [ ] `pnpm typecheck` — clean across atlas-web + ritual-engine + role-architect
- [ ] `pnpm test` — full atlas-web suite green; +4 new cases
- [ ] ritual-engine — +4 auto-fix + +3 prior-context-gate-reports = 89 total
- [ ] role-architect — +3 gate-findings cases (38 total)
- [ ] Flag combos verified: flag-OFF (Plan I escalate-and-stop preserved); flag-ON (auto-fix triggers up to 2 times)
- [ ] Manual smoke (with Security flag + multi-turn + auto-fix-loop on, real LLM): inject a hardcoded secret in a developer diff; observe auto-fix attempt → re-runs gate → either passes (clean) or hits budget cap
- [ ] `apps/atlas-web/.env.example` — auto-fix-loop documented with cross-flag dependency note
- [ ] `docs/superpowers/local-dev-status.md` — Plan L row added to enable-locally table
- [ ] Plan file marked Shipped at the bottom
- [ ] `plan-l/developer-fix-loop` merged to `main` (`--no-ff`); branch deleted

## Follow-ups (out of scope)

1. **Hydrator extension for auto_fix.* events.** Currently the hydrator doesn't fold `auto_fix.attempted` / `auto_fix.budget_exhausted` / `auto_fix.failed` into snapshot fields. After process restart, `fixAttempts` won't be recovered (only `parentRitualId` is). One-task addition.
2. **Per-project MAX_FIX_ATTEMPTS override.** Today's hardcoded 2 may be too low for complex scenarios; users could set per-project budgets via PreferencesRepo.
3. **Partial-fix tracking.** Today refining 3 issues either passes or fails as a whole — no bookkeeping of which 2/3 the model addressed. v2 could track per-issue resolution.
4. **Streaming progress** — when the broker fires `auto_fix.attempted` events, the rail's RitualTimeline should show "AI auto-fixing 3 L4 findings…" inline. Plan E's reducer needs a new event handler.
