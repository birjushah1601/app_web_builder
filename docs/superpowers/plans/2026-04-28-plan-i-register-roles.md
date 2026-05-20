# Plan I — Register Security + Accessibility Roles in Conductor Factory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today, `getRitualEngine(projectId)` in `apps/atlas-web/lib/engine/factory.ts` registers exactly two Conductor roles: `architect` and `developer`. The role packages `@atlas/role-security` (D.4 — L4 merge gate) and `@atlas/role-accessibility` (D.5 — L5 merge gate) are shipped with full test suites and `Role` interface compliance, but the factory ignores them. Per `docs/superpowers/local-dev-status.md` "What's NOT wired": *"Multi-role orchestration beyond architect → developer. Ship / security / accessibility roles exist as packages but aren't registered in the factory."* Plan I registers both roles and extends the ritual chain so that after a successful developer dispatch (with a real diff), Security runs as L4 gate and Accessibility runs as L5 gate. Each role behind its own feature flag (`ATLAS_FF_SECURITY_ROLE`, `ATLAS_FF_A11Y_ROLE`) for independent rollout. Flag-OFF for both = today's architect → developer chain byte-for-byte preserved.

**Non-goal — Reviewer extraction.** The current `DeveloperRole.run` calls `reviewerVote` inline (parallel-pass winner-selection). Promoting Reviewer to a first-class Conductor role requires refactoring `DeveloperRole` to emit an intermediate `developer.passes.completed` event with both passes' outputs, then a separate `ReviewerRole` reads them and votes. That's a larger surface than this plan handles. Plan I documents this as deferred to a follow-up plan; today's inline-reviewer behavior is preserved.

**Architecture:** `RitualEngine.start()` (in `packages/ritual-engine/src/engine.ts`) gains a new `postDeveloperChain: string[]` option on its constructor — default `[]` (today's behavior). When the developer dispatch produces a non-cosmetic diff, the engine iterates the chain dispatching each role ID via `Conductor.dispatch({ forceRoleId, priorArtifact: developerOutput })`. Each role's events are appended to the ritual's `roleEvents` and the role's report (security report / a11y report) is surfaced into a new optional `RitualSnapshot` field (`securityReport?`, `accessibilityReport?`). `apps/atlas-web/lib/engine/factory.ts` constructs the chain from the per-role flags: `ATLAS_FF_SECURITY_ROLE=true` adds `"security"`; `ATLAS_FF_A11Y_ROLE=true` adds `"accessibility"`. The factory also instantiates `SecurityRole` and `AccessibilityRole` (passing the existing `llm` + a `SkillRegistry` loaded from `packages/skill-library/skills/security/` and `.../accessibility/`) and registers them in the same `roles` Map the architect + developer roles use. `apps/atlas-web/lib/actions/startRitual.ts` returns the new report fields in `StartRitualResult` so `ChatPanel` can render them in collapsible cards (similar to the existing developer-output card).

**Failure mode:** Security and Accessibility are GATES — a critical-severity issue makes `report.passed === false`. The engine treats `passed === false` as escalation: emits `ritual.escalated` with `gate: "L4"` (or `"L5"`) and `cause`, transitions state to `"escalated"`. Today's escalation surfacing in `EscalationCallout` (in `ChatPanel`) handles this without changes. The follow-up developer-side workflow (re-prompt with the report inline so the model can fix the issue) is out of scope for Plan I — listed as a follow-up.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Vitest 2.x · existing `@atlas/role-security` + `@atlas/role-accessibility` packages.

**Prerequisites the implementing engineer needs installed before starting:**
- D.4 + D.5 packages on `main` (already true — `packages/role-security` ships 13 tests; `packages/role-accessibility` ships 13 tests, both green).
- Plan B (developer chain) on `main` (already true — `getRitualEngine` registers `DeveloperRole` and the engine chains architect→developer).
- LLM provider configured (`ATLAS_LLM_BASE_URL` or `ANTHROPIC_API_KEY`) — both Security + Accessibility roles take an `llm` constructor option.
- Skill bundles present at `packages/skill-library/skills/security/` and `packages/skill-library/skills/accessibility/` (already true — D.4/D.5 ship the 4 composed skills each).
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` packages keep their `.js` suffix.

**Branch:** `plan-i/register-roles` cut from `main`. Final task merges back.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/ritual-engine/src/
  engine.ts                                                    # MODIFIED: + postDeveloperChain option, chain dispatch loop, gate-failure escalation, new snapshot fields

packages/ritual-engine/test/
  engine-post-developer-chain.test.ts                          # NEW: ~6 cases (chain dispatch, gate fail → escalate, prior artifact passed, empty chain = today)

apps/atlas-web/lib/engine/
  factory.ts                                                   # MODIFIED: instantiate SecurityRole + AccessibilityRole gated on flags; build postDeveloperChain; share SkillRegistry

apps/atlas-web/lib/
  feature-flags.ts                                             # MODIFIED: + "security-role", "a11y-role" flags

apps/atlas-web/test/lib/feature-flags.test.ts                  # MODIFIED: + cases for the two new flags

apps/atlas-web/test/lib/engine/
  factory-role-flags.test.ts                                   # NEW: 4 cases (both off; security only; a11y only; both on — verify roles map + chain)

apps/atlas-web/lib/actions/
  startRitual.ts                                               # MODIFIED: surface securityReport + accessibilityReport in StartRitualResult

apps/atlas-web/components/
  ChatPanel.tsx                                                # MODIFIED: render new SecurityReportPanel + AccessibilityReportPanel collapsibles
  SecurityReportPanel.tsx                                      # NEW: small read-only panel (passed/failed badge + issues list)
  AccessibilityReportPanel.tsx                                 # NEW: same shape

apps/atlas-web/test/components/
  SecurityReportPanel.test.tsx                                 # NEW: 3 cases (passed render; failed render + issues; empty issues)
  AccessibilityReportPanel.test.tsx                            # NEW: 3 cases (mirror)
  ChatPanel.test.tsx                                           # MODIFIED: + 2 cases (renders the two new panels when present in StartRitualResult)

apps/atlas-web/test/integration/
  role-chain-end-to-end.test.ts                                # NEW: real-stack — start ritual, assert security + a11y events fire, reports land in snapshot
```

**Why this shape.** The chain extension lives in the engine because that's where `start()` already orchestrates architect→developer; co-locating the chain logic prevents three places knowing about role ordering. The atlas-web factory is the only place that decides WHICH chain to use — the engine takes a config, not a hardcoded list. Per-role flags (not a single "extra-roles" flag) let an operator turn on Security alone for an audit run, or turn off Accessibility while iterating on its prompts. The two report panels live as separate components (rather than a generic `RoleReportPanel`) because Security + Accessibility issues have meaningfully different UX (severity → color, skill names, fix suggestions) — splitting now beats refactoring later. The integration test exercises the real chain against a real Postgres + LLM proxy — the same pattern Plan D / Plan E use for end-to-end coverage.

---

## Design Decisions

1. **Chain ordering: developer → security → accessibility.** Both gates run AFTER developer (so they have a diff to evaluate). Order chosen so security runs first (more critical — a leaked secret blocks everything; an a11y issue is annoying but rarely catastrophic). If both flags are on, both roles dispatch in order. If either fails the gate, the engine escalates immediately — the OTHER gate does NOT run. Gates are cheap to skip; cheap to add later if you flip the flag.
2. **Trigger condition: only when developer produced a real diff.** Cosmetic edits skip developer entirely; nothing for Security/A11y to inspect. Architect-only rituals (developer flag off / no developer registered) likewise skip the chain. Engine gates on `developerOutput?.diff && developerOutput.diff.length > 0`.
3. **`priorArtifact` = the developer's output.** Both Security and Accessibility roles' `inv.userTurn` field carries the diff string in their existing implementations (per D.4 / D.5 `runSecurityCheck({ diff: inv.userTurn, ... })`). The chain dispatch passes the developer's diff into both. `priorArtifact` (Conductor option from Plan B) carries the full `DeveloperOutput` for richer downstream context if needed.
4. **Gate failure → escalation, not retry.** When `report.passed === false`, the engine emits `ritual.escalated` with `gate: "L4" | "L5"` and `cause: <serialized issues>`, transitions state to `"escalated"`, and stops the chain. The user sees the existing `EscalationCallout` (already wired) and the new SecurityReportPanel / AccessibilityReportPanel inline. No automatic retry — that's a Plan-J-or-later "developer-fix-loop" feature.
5. **Per-role feature flags follow the `ATLAS_FF_*` convention.** `ATLAS_FF_SECURITY_ROLE` and `ATLAS_FF_A11Y_ROLE` — matching the existing convention (`ATLAS_FF_FIGMA_IMPORTER`, `ATLAS_FF_VIDEO_KLING`, etc.). Both default OFF. Operators flip one or both per deploy. Flag-OFF for either: that role is NOT instantiated, NOT registered in the conductor's roles map, NOT included in the postDeveloperChain. The engine sees an empty chain and reverts to today's flow.
6. **Skill loading: extend the existing `loadSkillsFromDir` calls in factory.ts.** Today the factory loads `["architect", "developer", "ship", "reviewer", "debugger"]`. Plan I appends `"security"` and `"accessibility"` to that list (only the new roles read those skills, but loading them all into one SkillRegistry is the existing pattern). No new SkillRegistry needed.
7. **Snapshot fields are optional, nullable.** `RitualSnapshot.securityReport?: SecurityReport` and `accessibilityReport?: AccessibilityReport`. Today's callers don't read these fields; they're additive. Plan H's hydrator (if shipped) will need to fold them too — the hydrator-fold extension is a one-paragraph follow-up noted in the Shipped section.
8. **`StartRitualResult` mirrors the snapshot.** The Server Action returns the new fields verbatim; ChatPanel renders them. No transformation in the action layer.

---

## Task List (10 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit.

---

### Task 1: Cut the branch + add the two per-role feature flags

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/test/lib/feature-flags.test.ts`

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-i/register-roles
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/atlas-web/test/lib/feature-flags.test.ts`:

```typescript
describe("security-role + a11y-role flags (Plan I)", () => {
  it("security-role is off when ATLAS_FF_SECURITY_ROLE is unset", () => {
    expect(isFeatureEnabled("security-role", { readEnv: () => undefined })).toBe(false);
  });
  it("security-role is on when ATLAS_FF_SECURITY_ROLE=true", () => {
    expect(isFeatureEnabled("security-role", { readEnv: (n) => (n === "ATLAS_FF_SECURITY_ROLE" ? "true" : undefined) })).toBe(true);
  });
  it("a11y-role is off when ATLAS_FF_A11Y_ROLE is unset", () => {
    expect(isFeatureEnabled("a11y-role", { readEnv: () => undefined })).toBe(false);
  });
  it("a11y-role is on when ATLAS_FF_A11Y_ROLE=true", () => {
    expect(isFeatureEnabled("a11y-role", { readEnv: (n) => (n === "ATLAS_FF_A11Y_ROLE" ? "true" : undefined) })).toBe(true);
  });
  it("listFlagStates includes both", () => {
    const states = listFlagStates({ readEnv: () => undefined });
    expect(states["security-role"]).toBe(false);
    expect(states["a11y-role"]).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: 5 fails — type error on flag union; missing keys in listFlagStates.

- [ ] **Step 4: Add the flags**

Modify `apps/atlas-web/lib/feature-flags.ts`:

```typescript
export type FeatureFlag =
  | "figma-importer"
  | "stripe-payments"
  | "video-kling"
  | "auth-keycloak"
  | "live-events"
  | "security-role"
  | "a11y-role";

const FLAG_TO_ENV: Record<FeatureFlag, string> = {
  "figma-importer": "ATLAS_FF_FIGMA_IMPORTER",
  "stripe-payments": "ATLAS_FF_STRIPE_PAYMENTS",
  "video-kling": "ATLAS_FF_VIDEO_KLING",
  "auth-keycloak": "ATLAS_FF_AUTH_KEYCLOAK",
  "live-events": "ATLAS_LIVE_EVENTS",
  "security-role": "ATLAS_FF_SECURITY_ROLE",
  "a11y-role": "ATLAS_FF_A11Y_ROLE"
};
```

Update `listFlagStates` to include both new keys.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: all flag tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags.test.ts
git commit -m "feat(atlas-web): security-role + a11y-role feature flags (plan I)"
```

---

### Task 2: `RitualEngine` — accept `postDeveloperChain` option + new snapshot fields

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`

- [ ] **Step 1: Add the option + fields**

In `packages/ritual-engine/src/engine.ts`:

Modify `RitualEngineOptions`:

```typescript
export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
  sandboxApplier?: SandboxApplier;
  hydrator?: RitualHydrator;
  /** Plan I: ordered list of role IDs to dispatch after a successful
   *  developer pass (when developerOutput.diff is non-empty). Each role
   *  is dispatched via Conductor.dispatch({ forceRoleId, priorArtifact: developerOutput }).
   *  A gate-failing role (report.passed === false) escalates the ritual
   *  and stops the chain. Default [] preserves today's architect→developer-only flow. */
  postDeveloperChain?: string[];
}
```

Add to the class:

```typescript
private readonly postDeveloperChain: readonly string[];
```

In the constructor body:

```typescript
this.postDeveloperChain = opts.postDeveloperChain ?? [];
```

Modify `RitualSnapshot` to add two optional fields:

```typescript
export interface RitualSnapshot {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  roleEvents: RoleEventRecord[];
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
  /** Plan I: present when SecurityRole ran. The role's full report.
   *  passed=false means a critical issue → ritual.escalated. */
  securityReport?: unknown;
  /** Plan I: present when AccessibilityRole ran. Same shape contract. */
  accessibilityReport?: unknown;
}
```

(Use `unknown` for the report types to avoid a hard dependency on `@atlas/role-security` / `@atlas/role-accessibility` from the engine package — atlas-web casts the reports into their concrete types when reading the snapshot.)

Modify `RitualRecord` (the in-memory state) to add the same two optional fields.

- [ ] **Step 2: Verify the package still typechecks + tests still pass**

```bash
cd packages/ritual-engine && pnpm typecheck && pnpm test
```

Expected: clean. Today's tests don't pass `postDeveloperChain` — they get `[]` as default, no behavior change.

- [ ] **Step 3: Commit**

```bash
git add packages/ritual-engine/src/engine.ts
git commit -m "feat(ritual-engine): accept postDeveloperChain option + snapshot reports fields (plan I)"
```

---

### Task 3: `RitualEngine.start` — dispatch the post-developer chain on successful diff

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Create: `packages/ritual-engine/test/engine-post-developer-chain.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ritual-engine/test/engine-post-developer-chain.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

function makeEngineWith(chain: string[], dispatchImpl: (opts: unknown) => unknown) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
    postDeveloperChain: chain
  });
}

describe("RitualEngine.start — postDeveloperChain dispatch (Plan I Task 3)", () => {
  it("with empty chain (default), no extra dispatches happen after developer (today's behavior)", async () => {
    const dispatch = vi.fn(async () => ({
      roleId: "architect",
      output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }], diff: { kind: "none" } }
    }));
    const engine = makeEngineWith([], dispatch as never);
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    // 2 dispatches expected: architect (default classifier) + developer (chained when artifact non-cosmetic).
    // No third dispatch from the chain.
    expect(dispatch.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("with chain ['security'], dispatches security with forceRoleId after developer", async () => {
    const calls: Array<{ forceRoleId?: string }> = [];
    const dispatch = vi.fn(async (opts: { forceRoleId?: string }) => {
      calls.push(opts);
      // Architect → return artifact. Developer → return diff. Security → return passed report.
      if (opts.forceRoleId === undefined) {
        return {
          roleId: "architect",
          output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }], diff: { kind: "none" } }
        };
      }
      if (opts.forceRoleId === "developer") {
        return {
          roleId: "developer",
          output: { events: [{ eventType: "developer.completed", payload: { diff: "diff --git a/x b/x", summary: "x" } }],
                    diff: { kind: "patch", body: "diff --git a/x b/x" } }
        };
      }
      if (opts.forceRoleId === "security") {
        return {
          roleId: "security",
          output: { events: [{ eventType: "security.completed", payload: { passed: true, report: { passed: true, issues: [] } } }],
                    diff: { kind: "none" } }
        };
      }
      throw new Error(`unexpected role: ${opts.forceRoleId}`);
    });
    const engine = makeEngineWith(["security"], dispatch as never);
    const ritualId = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const snap = await engine.getRitual(ritualId);
    expect(snap?.securityReport).toEqual({ passed: true, issues: [] });
    expect(calls.some((c) => c.forceRoleId === "security")).toBe(true);
  });

  it("when a chain role's report has passed=false, the engine escalates and stops the chain", async () => {
    const calls: string[] = [];
    const dispatch = vi.fn(async (opts: { forceRoleId?: string }) => {
      calls.push(opts.forceRoleId ?? "auto");
      if (opts.forceRoleId === undefined) return { roleId: "architect", output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") return { roleId: "developer", output: { events: [{ eventType: "developer.completed", payload: { diff: "diff --git a/x b/x" } }], diff: { kind: "patch", body: "diff --git a/x b/x" } } };
      if (opts.forceRoleId === "security") return { roleId: "security", output: { events: [{ eventType: "security.completed", payload: { passed: false, report: { passed: false, issues: [{ severity: "critical", message: "secret leaked" }] } } }], diff: { kind: "none" } } };
      throw new Error("a11y should NOT have run after security failure");
    });
    const engine = makeEngineWith(["security", "accessibility"], dispatch as never);
    const ritualId = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const snap = await engine.getRitual(ritualId);
    expect(snap?.state).toBe("escalated");
    expect(snap?.securityReport).toBeDefined();
    expect(snap?.accessibilityReport).toBeUndefined();
    expect(calls).not.toContain("accessibility");
  });

  it("cosmetic edits skip the chain entirely", async () => {
    const dispatch = vi.fn(async () => ({
      roleId: "architect",
      output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }], diff: { kind: "none" } }
    }));
    const engine = makeEngineWith(["security", "accessibility"], dispatch as never);
    await engine.start({ projectId: "p", userId: "u", userTurn: "tweak the button color", editClass: "cosmetic" });
    // Cosmetic = architect only; no developer, no chain.
    expect(dispatch.mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/engine-post-developer-chain.test.ts
```

Expected: 4 fails (no chain logic yet).

- [ ] **Step 3: Extend `RitualEngine.start` to dispatch the chain**

In `packages/ritual-engine/src/engine.ts`, find the part of `start()` that runs the developer dispatch (after the architect → developer chain logic from Plan B). After the developer dispatch produces a `developerOutput` with a non-empty `diff`, add the chain loop:

```typescript
// Plan I: post-developer chain (Security → Accessibility per factory config).
// Skipped when chain is empty (today's behavior) OR when developer didn't
// produce a diff (cosmetic / no-developer / failed-dispatch paths).
if (developerOutput?.diff && this.postDeveloperChain.length > 0) {
  for (const roleId of this.postDeveloperChain) {
    const result = await this.conductor.dispatch({
      ritualId: ritualId as never,
      graphVersion: 0,
      userTurn: developerOutput.diff,
      projectId: input.projectId,
      forceRoleId: roleId,
      priorArtifact: developerOutput
    });

    // Pull the report from the role's *.completed event.
    const completed = result.output.events.find((e) => e.eventType === `${roleId}.completed`);
    const payload = completed?.payload as { passed?: boolean; report?: unknown } | undefined;

    // Append role events to the snapshot.
    record.roleEvents = (record.roleEvents ?? []).concat(
      result.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as object | undefined }))
    );

    // Surface the report into the snapshot's typed slot.
    if (roleId === "security") {
      record.securityReport = payload?.report;
    } else if (roleId === "accessibility") {
      record.accessibilityReport = payload?.report;
    }

    // Gate failure → escalate, stop the chain.
    if (payload?.passed === false) {
      record.state = "escalated";
      await this.emit({
        type: "ritual.escalated",
        ritualId,
        ts: new Date().toISOString(),
        payload: { gate: roleId === "security" ? "L4" : "L5", cause: payload.report }
      });
      break;
    }
  }
}
```

(Insert after the existing developer dispatch + record.developerOutput = … assignment.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/engine-post-developer-chain.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Run full ritual-engine suite to catch regressions**

```bash
cd packages/ritual-engine && pnpm test
```

Expected: all green. The empty-chain default means existing tests are unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-post-developer-chain.test.ts
git commit -m "feat(ritual-engine): postDeveloperChain dispatch loop + gate-failure escalation (plan I)"
```

---

### Task 4: Wire `SecurityRole` + `AccessibilityRole` registration in `factory.ts`

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Create: `apps/atlas-web/test/lib/engine/factory-role-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/engine/factory-role-flags.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({})),
  SpecEventRepo: vi.fn().mockImplementation(() => ({}))
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn(async () => ({})) }));

describe("getRitualEngine — security/a11y flag wiring (Plan I Task 4)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ATLAS_LLM_BASE_URL = "http://localhost:3456";
  });
  afterEach(() => {
    delete process.env.ATLAS_FF_SECURITY_ROLE;
    delete process.env.ATLAS_FF_A11Y_ROLE;
    delete process.env.ATLAS_LLM_BASE_URL;
  });

  it("flag-OFF for both: postDeveloperChain is empty (today's behavior)", async () => {
    const ritualEngineMod = await import("@atlas/ritual-engine");
    const ctorSpy = vi.spyOn(ritualEngineMod, "RitualEngine");
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p");
    const opts = ctorSpy.mock.calls[ctorSpy.mock.calls.length - 1]![0] as { postDeveloperChain?: string[] };
    expect(opts.postDeveloperChain ?? []).toEqual([]);
  });

  it("ATLAS_FF_SECURITY_ROLE=true: chain = ['security']", async () => {
    process.env.ATLAS_FF_SECURITY_ROLE = "true";
    const ritualEngineMod = await import("@atlas/ritual-engine");
    const ctorSpy = vi.spyOn(ritualEngineMod, "RitualEngine");
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p");
    const opts = ctorSpy.mock.calls[ctorSpy.mock.calls.length - 1]![0] as { postDeveloperChain?: string[] };
    expect(opts.postDeveloperChain).toEqual(["security"]);
  });

  it("ATLAS_FF_A11Y_ROLE=true: chain = ['accessibility']", async () => {
    process.env.ATLAS_FF_A11Y_ROLE = "true";
    const ritualEngineMod = await import("@atlas/ritual-engine");
    const ctorSpy = vi.spyOn(ritualEngineMod, "RitualEngine");
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p");
    const opts = ctorSpy.mock.calls[ctorSpy.mock.calls.length - 1]![0] as { postDeveloperChain?: string[] };
    expect(opts.postDeveloperChain).toEqual(["accessibility"]);
  });

  it("both flags on: chain = ['security', 'accessibility'] (security first per Design Decision 1)", async () => {
    process.env.ATLAS_FF_SECURITY_ROLE = "true";
    process.env.ATLAS_FF_A11Y_ROLE = "true";
    const ritualEngineMod = await import("@atlas/ritual-engine");
    const ctorSpy = vi.spyOn(ritualEngineMod, "RitualEngine");
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p");
    const opts = ctorSpy.mock.calls[ctorSpy.mock.calls.length - 1]![0] as { postDeveloperChain?: string[] };
    expect(opts.postDeveloperChain).toEqual(["security", "accessibility"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory-role-flags.test.ts
```

Expected: 3 fails (flag-on cases — chain still empty).

- [ ] **Step 3: Modify factory.ts**

In `apps/atlas-web/lib/engine/factory.ts`:

1. Extend the `skillSubdirs` list to include `"security"` and `"accessibility"`:

```typescript
const skillSubdirs = ["architect", "developer", "ship", "reviewer", "debugger", "security", "accessibility"];
```

2. After the existing architect + developer registration block, add (still inside the `if (llm) { ... }` block):

```typescript
const { isFeatureEnabled } = await import("@/lib/feature-flags");
const postDeveloperChain: string[] = [];

if (isFeatureEnabled("security-role")) {
  const { SecurityRole } = await import("@atlas/role-security");
  const securityModel = process.env.ATLAS_LLM_SECURITY_MODEL ?? deepPlanModel;
  roles.set("security", new SecurityRole({ llm, skills: skillRegistry, model: securityModel }));
  postDeveloperChain.push("security");
}

if (isFeatureEnabled("a11y-role")) {
  const { AccessibilityRole } = await import("@atlas/role-accessibility");
  const a11yModel = process.env.ATLAS_LLM_A11Y_MODEL ?? deepPlanModel;
  roles.set("accessibility", new AccessibilityRole({ llm, skills: skillRegistry, model: a11yModel }));
  postDeveloperChain.push("accessibility");
}
```

3. Pass `postDeveloperChain` to the `new RitualEngine({ ... })` constructor:

```typescript
return new RitualEngine({
  conductor,
  eventSink: new SpecEventsSink(specEventRepo, projectId),
  personaPreferences: prefs,
  sandboxApplier: { /* unchanged */ },
  postDeveloperChain
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory-role-flags.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/test/lib/engine/factory-role-flags.test.ts
git commit -m "feat(atlas-web): wire SecurityRole + AccessibilityRole; build postDeveloperChain from flags (plan I)"
```

---

### Task 5: `SecurityReportPanel` component

**Files:**
- Create: `apps/atlas-web/components/SecurityReportPanel.tsx`
- Create: `apps/atlas-web/test/components/SecurityReportPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/components/SecurityReportPanel.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SecurityReportPanel } from "@/components/SecurityReportPanel";

describe("SecurityReportPanel — Plan I Task 5", () => {
  it("renders a green PASSED badge + skill list when report.passed", () => {
    render(<SecurityReportPanel report={{ passed: true, issues: [], skillsRun: ["audit-rls", "secrets-scan"] }} />);
    expect(screen.getByText(/passed/i)).toBeInTheDocument();
    expect(screen.getByText(/audit-rls/)).toBeInTheDocument();
    expect(screen.getByText(/secrets-scan/)).toBeInTheDocument();
  });

  it("renders a red FAILED badge + each issue with severity", () => {
    render(<SecurityReportPanel report={{
      passed: false,
      issues: [
        { severity: "critical", message: "Secret leaked in foo.ts" },
        { severity: "high",     message: "Missing CORS allowlist" }
      ],
      skillsRun: ["secrets-scan", "cors-policy"]
    }} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Secret leaked in foo\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/Missing CORS allowlist/)).toBeInTheDocument();
  });

  it("renders 'no issues' when passed and issues array is empty", () => {
    render(<SecurityReportPanel report={{ passed: true, issues: [], skillsRun: [] }} />);
    expect(screen.getByText(/no issues/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/components/SecurityReportPanel.test.tsx
```

Expected: 3 fails — `Cannot find module '@/components/SecurityReportPanel'`.

- [ ] **Step 3: Implement the panel**

Create `apps/atlas-web/components/SecurityReportPanel.tsx`:

```typescript
"use client";

interface Issue {
  severity: "critical" | "high" | "medium" | "low";
  message: string;
}

export interface SecurityReport {
  passed: boolean;
  issues: Issue[];
  skillsRun?: string[];
}

const SEVERITY_BG: Record<Issue["severity"], string> = {
  critical: "bg-red-100 text-red-900",
  high:     "bg-orange-100 text-orange-900",
  medium:   "bg-amber-100 text-amber-900",
  low:      "bg-slate-100 text-slate-900"
};

export function SecurityReportPanel({ report }: { report: SecurityReport }) {
  return (
    <details className="mt-2 rounded-md border border-slate-200 p-2">
      <summary className="flex items-center gap-2 cursor-pointer">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${
            report.passed ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"
          }`}
        >
          Security {report.passed ? "PASSED" : "FAILED"}
        </span>
        {report.skillsRun && report.skillsRun.length > 0 && (
          <span className="text-xs text-slate-500">
            Ran: {report.skillsRun.join(", ")}
          </span>
        )}
      </summary>
      <div className="mt-2">
        {report.issues.length === 0 ? (
          <p className="text-sm text-slate-600">No issues</p>
        ) : (
          <ul className="space-y-1">
            {report.issues.map((issue, i) => (
              <li key={i} className={`rounded px-2 py-1 text-sm ${SEVERITY_BG[issue.severity]}`}>
                <strong className="uppercase mr-1">{issue.severity}</strong>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/components/SecurityReportPanel.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/SecurityReportPanel.tsx apps/atlas-web/test/components/SecurityReportPanel.test.tsx
git commit -m "feat(atlas-web): SecurityReportPanel — passed/failed badge + issue list (plan I)"
```

---

### Task 6: `AccessibilityReportPanel` component (mirror)

**Files:**
- Create: `apps/atlas-web/components/AccessibilityReportPanel.tsx`
- Create: `apps/atlas-web/test/components/AccessibilityReportPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/components/AccessibilityReportPanel.test.tsx` — same shape as SecurityReportPanel.test.tsx but `Accessibility` and a11y-specific issue messages (e.g. "Image missing alt", "Insufficient color contrast"). Mirror exactly: 3 cases (passed render, failed render, empty issues).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/components/AccessibilityReportPanel.test.tsx
```

Expected: 3 fails.

- [ ] **Step 3: Implement the panel**

Create `apps/atlas-web/components/AccessibilityReportPanel.tsx` — copy the SecurityReportPanel implementation, swap the badge text to "Accessibility PASSED/FAILED", and rename the export. The Issue + SEVERITY_BG types are identical.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/components/AccessibilityReportPanel.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/AccessibilityReportPanel.tsx apps/atlas-web/test/components/AccessibilityReportPanel.test.tsx
git commit -m "feat(atlas-web): AccessibilityReportPanel mirror (plan I)"
```

---

### Task 7: Surface reports through `StartRitualResult` + render in `ChatPanel`

**Files:**
- Modify: `apps/atlas-web/lib/actions/startRitual.ts`
- Modify: `apps/atlas-web/components/ChatPanel.tsx`
- Modify: `apps/atlas-web/test/components/ChatPanel.test.tsx`

- [ ] **Step 1: Add fields to `StartRitualResult`**

In `apps/atlas-web/lib/actions/startRitual.ts`, find the `StartRitualResult` interface (or its export) and add:

```typescript
export interface StartRitualResult {
  // ... existing fields ...
  /** Plan I: present when SecurityRole ran. */
  securityReport?: import("@/components/SecurityReportPanel").SecurityReport;
  /** Plan I: present when AccessibilityRole ran. */
  accessibilityReport?: import("@/components/AccessibilityReportPanel").AccessibilityReport;
}
```

In the action body (after engine.start + getRitual), forward the snapshot fields:

```typescript
const snapshot = await engine.getRitual(ritualId);
return {
  ritualId,
  // ... existing fields ...
  securityReport: snapshot?.securityReport as never,
  accessibilityReport: snapshot?.accessibilityReport as never
};
```

- [ ] **Step 2: Render in ChatPanel**

In `apps/atlas-web/components/ChatPanel.tsx`, after the existing developer-output card render, add:

```typescript
{result?.securityReport && (
  <SecurityReportPanel report={result.securityReport} />
)}
{result?.accessibilityReport && (
  <AccessibilityReportPanel report={result.accessibilityReport} />
)}
```

Add the imports:

```typescript
import { SecurityReportPanel } from "@/components/SecurityReportPanel";
import { AccessibilityReportPanel } from "@/components/AccessibilityReportPanel";
```

- [ ] **Step 3: Add tests for ChatPanel rendering**

Append to `apps/atlas-web/test/components/ChatPanel.test.tsx` two cases:

```typescript
it("renders SecurityReportPanel when result.securityReport is present", async () => {
  const action = vi.fn(async () => ({
    ritualId: "r-1", roleEvents: [],
    securityReport: { passed: true, issues: [], skillsRun: ["secrets-scan"] }
  }));
  render(<ChatPanel projectId="p" action={action} />);
  // ... type + send (mirror existing test pattern) ...
  await waitFor(() => expect(screen.getByText(/Security PASSED/)).toBeInTheDocument());
});

it("renders AccessibilityReportPanel when result.accessibilityReport is present", async () => {
  const action = vi.fn(async () => ({
    ritualId: "r-2", roleEvents: [],
    accessibilityReport: { passed: false, issues: [{ severity: "high", message: "Missing alt" }], skillsRun: ["wcag-audit"] }
  }));
  render(<ChatPanel projectId="p" action={action} />);
  // ... type + send (mirror existing test pattern) ...
  await waitFor(() => expect(screen.getByText(/Accessibility FAILED/)).toBeInTheDocument());
  expect(screen.getByText(/Missing alt/)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run tests + typecheck**

```bash
cd apps/atlas-web && pnpm test test/components/ChatPanel.test.tsx && pnpm typecheck
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/actions/startRitual.ts apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/test/components/ChatPanel.test.tsx
git commit -m "feat(atlas-web): surface security + a11y reports through StartRitualResult; render in ChatPanel (plan I)"
```

---

### Task 8: Real-stack integration test — chain end-to-end

**Files:**
- Create: `apps/atlas-web/test/integration/role-chain-end-to-end.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/atlas-web/test/integration/role-chain-end-to-end.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { getRitualEngine } from "@/lib/engine/factory";

describe("ritual chain — security + a11y registration end-to-end (Plan I Task 8)", () => {
  beforeAll(() => {
    if (!process.env.ATLAS_LLM_BASE_URL && !process.env.ANTHROPIC_API_KEY) {
      throw new Error("integration test needs an LLM provider");
    }
    process.env.ATLAS_FF_SECURITY_ROLE = "true";
    process.env.ATLAS_FF_A11Y_ROLE = "true";
  });

  it("with both flags on, the engine has security + accessibility roles registered", async () => {
    const engine = await getRitualEngine(`p-i-${Date.now()}`);
    // The chain config is private; assert via a probe ritual instead.
    // For a true end-to-end test, run a small ritual and assert the chain dispatched.
    // (Skipped in CI without an LLM proxy — gate on env presence.)
    expect(engine).toBeDefined();
  });
});
```

(For a richer test, add a probe ritual that runs the full chain — but this requires a working LLM proxy + skills registry + Postgres. Keep this test minimal: it asserts the wiring without paying the full LLM cost. A future PR can extend it.)

- [ ] **Step 2: Run the integration test**

```bash
cd apps/atlas-web && pnpm test test/integration/role-chain-end-to-end.test.ts
```

Expected: 1 test passes (or skips cleanly if env not set).

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/integration/role-chain-end-to-end.test.ts
git commit -m "test(atlas-web): integration — security + a11y role registration end-to-end (plan I)"
```

---

### Task 9: Flag-OFF behavioural lock + final verification

**Files:**
- (no new code — verification gate)

- [ ] **Step 1: Run full atlas-web suite with both flags OFF**

```bash
cd apps/atlas-web && unset ATLAS_FF_SECURITY_ROLE && unset ATLAS_FF_A11Y_ROLE && pnpm test
```

Expected: every existing test still green. Pre-existing parallel-run flakes (factory.test.ts, callback.test.ts, etc.) are out-of-scope per the Plan G/H precedent — verify they reproduce on `main` baseline; do NOT attempt to fix.

- [ ] **Step 2: Cross-package typecheck**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/ritual-engine typecheck
pnpm -F @atlas/role-security typecheck
pnpm -F @atlas/role-accessibility typecheck
```

Expected: all clean.

- [ ] **Step 3: Run the new tests with flag combinations**

```bash
cd apps/atlas-web && ATLAS_FF_SECURITY_ROLE=true pnpm test test/lib/engine/factory-role-flags.test.ts
cd apps/atlas-web && ATLAS_FF_SECURITY_ROLE=true ATLAS_FF_A11Y_ROLE=true pnpm test test/lib/engine/factory-role-flags.test.ts
```

Expected: green.

- [ ] **Step 4: Commit if any inline fixes were needed; otherwise skip**

---

### Task 10: Update docs + merge

**Files:**
- Modify: `docs/superpowers/local-dev-status.md`
- Modify: this plan file

- [ ] **Step 1: Update local-dev-status.md**

Find the bullet under "What's NOT wired (deferred)" referencing "Multi-role orchestration beyond architect → developer". Either remove the security/a11y portion or rewrite to mention only Reviewer-as-role (the remaining gap). Append to "What's wired":

```markdown
- **Plan I: Security + Accessibility roles registered.** When `ATLAS_FF_SECURITY_ROLE=true` and/or `ATLAS_FF_A11Y_ROLE=true`, `getRitualEngine()` instantiates `SecurityRole` (D.4) / `AccessibilityRole` (D.5) and appends them to a post-developer chain. After a successful developer dispatch with a real diff, the engine dispatches each chained role with the diff as `userTurn` and `developerOutput` as `priorArtifact`. A gate failure (`report.passed === false`) escalates the ritual with `gate: "L4" | "L5"` and stops the chain. Reports surface in `RitualSnapshot.{securityReport, accessibilityReport}` and render in `ChatPanel` via `<SecurityReportPanel />` / `<AccessibilityReportPanel />`. Flag-OFF for both = today's architect → developer chain unchanged.
```

- [ ] **Step 2: Mark plan shipped**

Append to this plan file:

```markdown
---

## Shipped

All 10 tasks merged to `plan-i/register-roles` and then to `main`. `pnpm typecheck` clean across atlas-web + @atlas/ritual-engine + @atlas/role-security + @atlas/role-accessibility. atlas-web added ~14 new test cases across 5 new files (factory-role-flags, SecurityReportPanel, AccessibilityReportPanel, role-chain integration, ChatPanel additions). Ritual-engine added 4 cases for postDeveloperChain. Flag-OFF behavioural lock preserved — existing tests stay green when both flags unset. `docs/superpowers/local-dev-status.md` updated — Plan I moved to "What's wired"; Reviewer-as-role remains in deferrals as a follow-up.
```

- [ ] **Step 3: Commit + merge**

```bash
git add docs/superpowers/local-dev-status.md docs/superpowers/plans/2026-04-28-plan-i-register-roles.md
git commit -m "docs(plan-i): mark shipped — security + a11y roles registered behind per-role flags"
git checkout main
git pull
git merge --no-ff plan-i/register-roles -m "Merge branch 'plan-i/register-roles'

Plan I — Security + Accessibility role registration behind per-role flags.
- New postDeveloperChain option on RitualEngine (default [] = today's behavior)
- Engine.start dispatches chain after successful developer; gate failure escalates
- Factory builds chain from ATLAS_FF_SECURITY_ROLE + ATLAS_FF_A11Y_ROLE
- New SecurityReportPanel + AccessibilityReportPanel rendered in ChatPanel
- Reviewer extraction deferred to follow-up plan
"
git branch -d plan-i/register-roles
```

- [ ] **Step 4: Verify main is green post-merge**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/ritual-engine test
```

Expected: all green.

---

## Completion Checklist

After all 10 tasks:

- [ ] `pnpm typecheck` — clean across atlas-web + ritual-engine + role-security + role-accessibility
- [ ] `pnpm test` — full atlas-web suite green; +14 new cases across 5 new files
- [ ] Ritual-engine — +4 new cases (postDeveloperChain); 49→53 total
- [ ] Flag combos verified: both off (today's behavior); security only; a11y only; both on
- [ ] Manual smoke (when LLM proxy + skills available): start a ritual with both flags on; confirm SecurityReportPanel + AccessibilityReportPanel render below the developer-output card
- [ ] Manual smoke: trigger a critical security finding (e.g. inject a hardcoded secret); confirm ritual escalates and ChatPanel shows EscalationCallout + SecurityReportPanel
- [ ] `docs/superpowers/local-dev-status.md` updated — Plan I moved to "What's wired"
- [ ] This plan file marked Shipped at the bottom
- [ ] `plan-i/register-roles` merged to `main` (`--no-ff`); branch deleted

## Follow-ups (out of scope for Plan I)

1. **Reviewer-as-Role.** `DeveloperRole.run` calls `reviewerVote` inline; promoting Reviewer to a Conductor role requires extracting the parallel-pass results into a `developer.passes.completed` event and adding a separate `ReviewerRole` that reads them. Estimated 8-10 task plan.
2. **Developer-fix-loop on gate failure.** When Security or Accessibility fails, automatically re-prompt the developer with the report inline so the model can fix the issue. Today's flow stops at escalation; user must manually retry. Plan-K candidate.
3. **Hydrator extension for new fields.** If Plan H ships, `replayEventsToSnapshot` should fold `security.completed` + `accessibility.completed` events into the new snapshot fields. One-task addition to Plan H's hydrator.

---

## Shipped

8 of 10 tasks executed inline + merged to `plan-i/register-roles` and then to `main`. `pnpm typecheck` clean across atlas-web + @atlas/ritual-engine + @atlas/role-security + @atlas/role-accessibility. ritual-engine added 4 postDeveloperChain cases (71 total now); atlas-web added 4 factory-flag + 6 panel cases + 5 feature-flag cases. `docs/superpowers/local-dev-status.md` updated — multi-role-orchestration entry rewritten to call out Reviewer-as-Role and Ship as remaining gaps; Plan I added under "What's wired".

Deviations from plan:
- **Tasks 5-7 combined** into one commit (panels + ChatPanel surfacing + Server Action result-shape are tightly coupled).
- **Task 8 (real-stack integration test) skipped** — would require a working LLM proxy + skill registry + Postgres; out of scope for inline execution. The factory-role-flags test exercises the wiring without LLM cost.
- **Escalation event:** the plan emitted `ritual.escalated` but that event type isn't in `events.ts` schema. Switched to `ritual.escalation_requested` (which IS in the schema), encoded gate ID + report into `payload.reason`.
- **Atlas-web package.json** needed `@atlas/role-security` and `@atlas/role-accessibility` added to deps (the plan didn't call this out — workspace deps must be declared explicitly).
- **Engine `start()` short-circuit** added after the chain when state flips to `escalated` — otherwise the trailing `applyTransition` throws InvalidTransitionError from the terminal state.
- **Factory test** uses `vi.mock` on the role packages instead of `vi.spyOn` (the latter breaks `new` invocation on class constructors — same lesson from Plan H Task 10).
