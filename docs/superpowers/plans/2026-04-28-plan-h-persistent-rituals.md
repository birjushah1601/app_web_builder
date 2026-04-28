# Plan H — Persistent Ritual Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `RitualEngine.getRitual(ritualId)` survive process restart. Today the engine keeps a `private readonly rituals = new Map<string, RitualRecord>()` and returns `undefined` for any ritualId not in that map — so a `pnpm dev` restart loses every ritual's history, every Plan B developer-chain artifact, every architect plan card. Events are already persisted by `SpecEventsSink` to Postgres `spec_events` (factory.ts wires this), but no path replays them back into a snapshot. Plan H adds a `RitualHydrator` that reads `spec_events` for `(projectId, ritualId)` and folds them into a `RitualSnapshot`, then wires `engine.getRitual()` to fall back to the hydrator on in-memory miss. Behind feature flag `ATLAS_RITUAL_HYDRATION`; flag-OFF preserves today's in-memory-only behavior byte-for-byte.

**Architecture:** A new pure function `replayEventsToSnapshot(rows: SpecEventRow[]): RitualSnapshot | null` lives in `@atlas/ritual-engine` (`src/hydrator.ts`). It walks events ordered by `id` ascending, applying the same state transitions the engine applies live: `ritual.started` seeds the record (state, projectId, userId from payload), `role.completed` for architect.pass2 captures `artifact`, `developer.completed` captures `developerOutput`, `sandbox.apply.completed` captures `sandboxApplyResult`, `ritual.escalated` flips state. A new `RitualHydrator` interface (`hydrate(ritualId): Promise<RitualSnapshot | null>`) wraps `SpecEventRepo.listByRitual(projectId, ritualId)` + replay; a concrete `SpecEventsHydrator` lives in `apps/atlas-web/lib/engine/spec-events-hydrator.ts` (factory wires it). `RitualEngine`'s constructor gains an optional `hydrator?: RitualHydrator` field; `getRitual` becomes async (`Promise<RitualSnapshot | undefined>`) — on in-memory miss, if hydrator is set, calls `await hydrator.hydrate(ritualId)`; otherwise returns `undefined` (today's behavior). All existing callers `await` the result. The `SpecEventRepo` gets one new method: `listByRitual(projectId, ritualId, opts?)` — filters `spec_events` by `payload->>'ritualId'`. Flag-OFF: factory does NOT pass a hydrator into the engine; engine's `getRitual` skips the hydrator branch entirely and returns `undefined` for unknown ritualIds.

**Tech Stack:** TypeScript 5.6 · Node 22 LTS · Vitest 2.x · Postgres 16 (drizzle-orm) · feature flag via env (`ATLAS_RITUAL_HYDRATION`).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan E.0 merged on `main` (already true). Specifically: `apps/atlas-web/lib/engine/factory.ts` wires `SpecEventsSink` on the engine's `eventSink` so events ARE landing in Postgres today.
- `.env.local` with `DATABASE_URL` pointing at the local atlas Postgres (`docker compose up -d postgres`). The Plan A.1 schema migration that created `spec_events` must be applied (already true in this repo).
- `apps/atlas-web/.env.local` — no new env vars required for Plan H beyond `ATLAS_RITUAL_HYDRATION=true` to flip the flag on locally.
- Recently-merged commit `26faa85` ("strip .js suffix from relative + @/ imports for app-router compat") — every relative or `@/`-aliased import in this plan MUST omit the `.js` suffix. Cross-package imports from `@atlas/*` workspace packages keep their `.js` suffix as before.

**Branch:** `plan-h/persistent-rituals` cut from `main`. Final task in this plan merges the branch back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/ritual-engine/src/
  hydrator.ts                                                # NEW: replayEventsToSnapshot + RitualHydrator interface
  engine.ts                                                  # MODIFIED: optional hydrator opt; getRitual becomes async; falls back to hydrator
  index.ts                                                   # MODIFIED: re-export RitualHydrator + replayEventsToSnapshot

packages/ritual-engine/test/
  hydrator.test.ts                                           # NEW: ~10 cases (event-fold table-driven + missing-ritual + invariants)
  engine-getRitual-hydrator.test.ts                          # NEW: ~4 cases (in-memory hit / miss-with-hydrator-hit / miss-without-hydrator / hydrator-throws-returns-undefined)

packages/spec-graph-data/src/repo/
  spec-event.repo.ts                                         # MODIFIED: + listByRitual method (filter by payload.ritualId)

packages/spec-graph-data/test/
  spec-event-repo.test.ts                                    # MODIFIED: + 3 cases for listByRitual

apps/atlas-web/lib/engine/
  spec-events-hydrator.ts                                    # NEW: SpecEventsHydrator (composes SpecEventRepo + replayEventsToSnapshot)
  factory.ts                                                 # MODIFIED: instantiate hydrator gated on flag; pass into RitualEngine

apps/atlas-web/lib/
  feature-flags.ts                                           # MODIFIED: add "ritual-hydration" → ATLAS_RITUAL_HYDRATION

apps/atlas-web/test/lib/engine/
  spec-events-hydrator.test.ts                               # NEW: 3 cases (composes repo + replay; returns null on no events; surfaces repo error)
  factory-hydrator-flag.test.ts                              # NEW: 2 cases (flag-OFF: no hydrator wired; flag-ON: hydrator wired)

apps/atlas-web/lib/actions/
  startRitual.ts                                             # MODIFIED: await engine.getRitual(...) (signature change ripple)
  approveRitual.ts                                           # MODIFIED: await engine.getRitual(...)
  acceptRiskAction.ts                                        # MODIFIED: await engine.getRitual(...)
  escalateRitual.ts                                          # MODIFIED: await engine.getRitual(...)

apps/atlas-web/test/integration/
  ritual-hydration-roundtrip.test.ts                         # NEW: end-to-end — append events, drop in-memory map, getRitual returns hydrated snapshot
```

**Why this shape.** The hydrator's pure `replayEventsToSnapshot` lives in `@atlas/ritual-engine` (not atlas-web) because the SAME folding logic the live engine applies must apply to historical events — co-locating it with the engine prevents drift. The `RitualHydrator` interface (also in the engine package) lets the engine stay storage-agnostic — atlas-web composes it with `SpecEventRepo`, but a future test could compose it with an in-memory fixture. The `SpecEventsHydrator` adapter lives in atlas-web because that's where the Postgres pool is wired. `getRitual` becoming async is a small breaking ripple — four Server Actions need an `await` added — but the alternative (a synchronous `getRitualSync()` + an async `getRitualAsync()`) doubles the surface and forces every caller to choose. Flag-OFF behavior is preserved by the factory simply not passing the hydrator: the engine's miss path is unchanged.

---

## Design Decisions

These resolve the implementation-level questions left implicit in the spec.

1. **Hydration trigger: lazy-on-getRitual, not eager-on-startup.** A typical user opens a project, calls one ritual ID at a time. Eagerly hydrating every ritual on engine boot would scan the whole `spec_events` table per project per request — wasteful. Lazy hydration only pays the read cost when a stale ritualId is asked for. `cache()` on `getRitualEngine` keeps the engine instance alive per request, so within a single request a hydrated ritual stays in-memory.
2. **Event-replay fold is pure, lives in `@atlas/ritual-engine`, table-driven by `eventType`.** A switch on `event.eventType` sets the corresponding field on a draft snapshot. Events outside the recognized set (e.g. `dispatch.classified` — internal) are skipped silently. Order is by `spec_events.id` ascending (DB-assigned monotonic). If the first event isn't `ritual.started` (corruption / partial truncation), `replayEventsToSnapshot` returns `null` — the caller treats this as "ritual unknown" same as in-memory miss.
3. **`SpecEventRepo.listByRitual` filters via `payload->>'ritualId'`.** No new column on `spec_events`. The repo writes `payload: { ritualId, ts, ...rest }` already (per `SpecEventsSink.emit`); the new query filters on the JSON path. Postgres can index this with `CREATE INDEX ... ON spec_events ((payload->>'ritualId'))` — added as part of Task 2's migration. The query is `WHERE projectId = $1 AND payload->>'ritualId' = $2 ORDER BY id ASC LIMIT $3`. Default limit 10000 (a single ritual emits ~20-30 events; 10k is a guardrail against a runaway ritual or accidentally querying without a ritualId filter).
4. **`getRitual` becomes `async`, signature `Promise<RitualSnapshot | undefined>`.** Today it's synchronous. The four atlas-web Server Actions that consume it gain a one-character `await` change each. Reasoned trade-off: dual sync/async APIs would be confusing; making one async is mechanical. `RitualEngine` remains usable in test contexts that don't care about hydration — they pass no hydrator, the miss path returns `undefined` synchronously (well, via a resolved promise, but indistinguishable to consumers).
5. **Flag-OFF: factory does NOT instantiate the hydrator.** The engine constructor's `hydrator` option is optional; when absent, `getRitual` short-circuits the fallback. This keeps the flag-OFF path byte-for-byte equivalent to today: same Map, same return values, no new Postgres reads. Behavioural-lock tests in Task 11 prove this.
6. **Hydrator failures degrade silently to "ritual unknown".** If `SpecEventRepo.listByRitual` rejects (Postgres down, RLS denial, etc.), the `SpecEventsHydrator` catches and logs but returns `null`. From the caller's POV this is identical to today's "ritual not found" branch — they'll show "ritual id not recognized" UX rather than crash. Future plan can add structured error surfacing if real users complain.
7. **No event-write changes.** Plan H is read-only on the write path. The `SpecEventsSink.emit` from factory.ts is unchanged. The `Conductor.checkpointSink` dual-emit (broker + log) from Plan E.0 is unchanged. We only ADD the read path.
8. **Integration test uses a real Postgres (no mock).** Following the established pattern in `apps/atlas-web/test/integration/broker-sse-roundtrip.test.ts` — drop the engine instance, re-create, call `getRitual`, assert hydrated snapshot matches the original. The DB connection comes from the same `DATABASE_URL` test fixture the rest of the integration suite uses.

---

## Task List (12 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit.

---

### Task 1: Cut the branch + scaffold the new dirs/files

**Files:**
- Create: `packages/ritual-engine/src/hydrator.ts` (empty for now — `export {}`)
- Create: `packages/ritual-engine/test/hydrator.test.ts` (placeholder — `it.skip("scaffold", () => {})`)

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main && git pull && git checkout -b plan-h/persistent-rituals
```

Expected: `Switched to a new branch 'plan-h/persistent-rituals'`.

- [ ] **Step 2: Scaffold the empty source file**

Create `packages/ritual-engine/src/hydrator.ts`:

```typescript
// Plan H scaffolding. Real exports land in Tasks 3-5.
export {};
```

- [ ] **Step 3: Scaffold the test file**

Create `packages/ritual-engine/test/hydrator.test.ts`:

```typescript
import { describe, it } from "vitest";

describe("hydrator scaffold", () => {
  it.skip("placeholder — real cases land in Task 3", () => {});
});
```

- [ ] **Step 4: Verify the package still builds + tests still pass**

```bash
cd packages/ritual-engine && pnpm test && pnpm typecheck
```

Expected: existing 49 tests still green; the placeholder test reports as `1 skipped`.

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/test/hydrator.test.ts
git commit -m "chore(ritual-engine): scaffold hydrator module for plan H"
```

---

### Task 2: `SpecEventRepo.listByRitual` — filter by payload.ritualId

**Files:**
- Modify: `packages/spec-graph-data/src/repo/spec-event.repo.ts`
- Modify: `packages/spec-graph-data/test/spec-event-repo.test.ts`
- Optional: `packages/spec-graph-data/migrations/0007_index_spec_events_ritual_id.sql` — index on `(payload->>'ritualId')` (skip if first-pass perf is acceptable; document in plan H follow-ups)

- [ ] **Step 1: Write the failing test**

Add to `packages/spec-graph-data/test/spec-event-repo.test.ts`:

```typescript
describe("SpecEventRepo.listByRitual (plan H)", () => {
  it("returns only events whose payload.ritualId matches, ordered by id ASC", async () => {
    const repo = new SpecEventRepo(pool);
    await repo.append(projectId, { eventType: "ritual.started", payload: { ritualId: "r-A", ts: 1 }, actor: null });
    await repo.append(projectId, { eventType: "role.started",  payload: { ritualId: "r-B", ts: 2 }, actor: null });
    await repo.append(projectId, { eventType: "role.completed",payload: { ritualId: "r-A", ts: 3 }, actor: null });
    const rows = await repo.listByRitual(projectId, "r-A");
    expect(rows.length).toBe(2);
    expect(rows[0]!.eventType).toBe("ritual.started");
    expect(rows[1]!.eventType).toBe("role.completed");
  });

  it("returns [] when no events match the ritualId", async () => {
    const repo = new SpecEventRepo(pool);
    const rows = await repo.listByRitual(projectId, "r-DOES-NOT-EXIST");
    expect(rows).toEqual([]);
  });

  it("respects the limit option (default 10000)", async () => {
    const repo = new SpecEventRepo(pool);
    for (let i = 0; i < 5; i++) {
      await repo.append(projectId, { eventType: "role.started", payload: { ritualId: "r-LIM", ts: i }, actor: null });
    }
    const rows = await repo.listByRitual(projectId, "r-LIM", { limit: 3 });
    expect(rows.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/spec-graph-data && pnpm test test/spec-event-repo.test.ts
```

Expected: 3 fails — `repo.listByRitual is not a function`.

- [ ] **Step 3: Implement listByRitual**

Add to `packages/spec-graph-data/src/repo/spec-event.repo.ts` (inside the SpecEventRepo class, after `getLatest`):

```typescript
async listByRitual(
  projectId: string,
  ritualId: string,
  opts: { limit?: number } = {}
): Promise<SpecEventRow[]> {
  const limit = opts.limit ?? 10000;
  return withSpan("SpecEventRepo.listByRitual", { "atlas.project_id": projectId }, async () =>
    withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specEvents } });
      // Filter by payload->>'ritualId' — payload is JSONB and stores
      // { ritualId, ts, ...rest } per SpecEventsSink.emit.
      const rows = await db.execute<SpecEventRow>(
        sql`SELECT * FROM ${specEvents}
            WHERE ${specEvents.projectId} = ${projectId}
              AND payload->>'ritualId' = ${ritualId}
            ORDER BY ${specEvents.id} ASC
            LIMIT ${limit}`
      );
      return Array.from(rows as Iterable<SpecEventRow>);
    })
  );
}
```

Add `import { sql } from "drizzle-orm";` to the top of the file.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/spec-graph-data && pnpm test test/spec-event-repo.test.ts
```

Expected: all SpecEventRepo tests pass including the 3 new cases.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo/spec-event.repo.ts packages/spec-graph-data/test/spec-event-repo.test.ts
git commit -m "feat(spec-graph-data): SpecEventRepo.listByRitual — filter by payload.ritualId for plan H hydration"
```

---

### Task 3: `replayEventsToSnapshot` — pure fold (ritual.started + role events)

**Files:**
- Modify: `packages/ritual-engine/src/hydrator.ts`
- Modify: `packages/ritual-engine/test/hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the placeholder body of `packages/ritual-engine/test/hydrator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { replayEventsToSnapshot, type SpecEventRowLike } from "../src/hydrator.js";

function row(id: bigint, eventType: string, payload: object): SpecEventRowLike {
  return { id, eventType, payload, actor: null };
}

describe("replayEventsToSnapshot — pure fold (Plan H Task 3)", () => {
  it("returns null when the row list is empty", () => {
    expect(replayEventsToSnapshot([])).toBeNull();
  });

  it("returns null when the first event is NOT ritual.started (corruption / partial)", () => {
    const rows = [row(1n, "role.completed", { ritualId: "r-1", ts: 1 })];
    expect(replayEventsToSnapshot(rows)).toBeNull();
  });

  it("seeds projectId/userId/state from ritual.started payload", () => {
    const rows = [
      row(1n, "ritual.started", {
        ritualId: "r-1",
        ts: 1,
        intent: "build a thing",
        editClass: "structural",
        projectId: "p-1",
        userId: "u-1"
      })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap).not.toBeNull();
    expect(snap!.state).toBe("visualize");
    expect(snap!.projectId).toBe("p-1");
    expect(snap!.userId).toBe("u-1");
    expect(snap!.roleEvents).toEqual([]);
  });

  it("collects every role event into roleEvents in order", () => {
    const rows = [
      row(1n, "ritual.started", { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "role.started",   { ritualId: "r-1", ts: 2, role: "architect" }),
      row(3n, "role.completed", { ritualId: "r-1", ts: 3, role: "architect", artifact: { kind: "plan" } })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.roleEvents.length).toBe(2);
    expect(snap!.roleEvents[0]!.eventType).toBe("role.started");
    expect(snap!.roleEvents[1]!.eventType).toBe("role.completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: 4 fails — `replayEventsToSnapshot is not a function` and missing exports.

- [ ] **Step 3: Implement the pure fold**

Replace `packages/ritual-engine/src/hydrator.ts` with:

```typescript
import type { RitualSnapshot, RoleEventRecord } from "./engine.js";

/** Minimal shape we depend on from spec_events rows — keeps the package
 *  free of a hard import on @atlas/spec-graph-data. */
export interface SpecEventRowLike {
  id: bigint;
  eventType: string;
  payload: unknown;
  actor: string | null;
}

/**
 * Folds a list of spec_events rows back into a RitualSnapshot. Pure
 * function — no I/O. Caller (typically a RitualHydrator) is responsible
 * for fetching and ordering the rows by id ASC.
 *
 * Returns null when:
 *  - rows is empty, OR
 *  - the first row is NOT a ritual.started event (corruption / partial)
 */
export function replayEventsToSnapshot(rows: SpecEventRowLike[]): RitualSnapshot | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  if (first.eventType !== "ritual.started") return null;
  const startPayload = first.payload as { projectId?: string; userId?: string };
  if (!startPayload.projectId || !startPayload.userId) return null;

  const snapshot: RitualSnapshot = {
    state: "visualize",
    projectId: startPayload.projectId,
    userId: startPayload.userId,
    roleEvents: []
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    applyOne(snapshot, r);
  }
  return snapshot;
}

function applyOne(snap: RitualSnapshot, r: SpecEventRowLike): void {
  const t = r.eventType;
  // Role events accumulate into roleEvents — Tasks 4-5 add field-setting
  // logic for specific event types (architect.pass2, developer.completed,
  // sandbox.apply.completed, ritual.escalated).
  if (t.startsWith("role.") || t.startsWith("architect.") || t.startsWith("developer.")) {
    const rec: RoleEventRecord = {
      eventType: t,
      payload: r.payload as object | undefined
    };
    snap.roleEvents.push(rec);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Re-export from package index**

Add to `packages/ritual-engine/src/index.ts`:

```typescript
export { replayEventsToSnapshot, type SpecEventRowLike } from "./hydrator.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/src/index.ts packages/ritual-engine/test/hydrator.test.ts
git commit -m "feat(ritual-engine): replayEventsToSnapshot — pure fold seeding state from ritual.started (plan H)"
```

---

### Task 4: `replayEventsToSnapshot` — capture artifact + developerOutput

**Files:**
- Modify: `packages/ritual-engine/src/hydrator.ts`
- Modify: `packages/ritual-engine/test/hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ritual-engine/test/hydrator.test.ts`:

```typescript
describe("replayEventsToSnapshot — artifact + developerOutput (Plan H Task 4)", () => {
  it("captures artifact from architect.*.pass2.completed payload", () => {
    const rows = [
      row(1n, "ritual.started",            { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "architect.pass2.completed", { ritualId: "r-1", ts: 2, artifact: { kind: "plan", graphSlice: {} } })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.artifact).toEqual({ kind: "plan", graphSlice: {} });
  });

  it("captures developerOutput from developer.completed payload", () => {
    const rows = [
      row(1n, "ritual.started",      { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "developer.completed", { ritualId: "r-1", ts: 2, diff: "diff --git a/x b/x", summary: "x" })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.developerOutput).toEqual({ diff: "diff --git a/x b/x", summary: "x" });
  });

  it("the latest matching event wins when the same field is emitted twice (last-write semantics)", () => {
    const rows = [
      row(1n, "ritual.started",            { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "architect.pass2.completed", { ritualId: "r-1", ts: 2, artifact: { kind: "first" } }),
      row(3n, "architect.pass2.completed", { ritualId: "r-1", ts: 3, artifact: { kind: "retry" } })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.artifact).toEqual({ kind: "retry" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: 3 fails — `snap.artifact is undefined`, etc.

- [ ] **Step 3: Extend the fold**

Replace the body of `applyOne` in `packages/ritual-engine/src/hydrator.ts`:

```typescript
function applyOne(snap: RitualSnapshot, r: SpecEventRowLike): void {
  const t = r.eventType;
  const p = r.payload as Record<string, unknown> | undefined;

  if (t.endsWith(".pass2.completed") && p && "artifact" in p) {
    snap.artifact = p.artifact;
  } else if (t === "developer.completed" && p) {
    snap.developerOutput = {
      diff: typeof p.diff === "string" ? p.diff : "",
      summary: typeof p.summary === "string" ? p.summary : undefined
    };
  }

  if (t.startsWith("role.") || t.startsWith("architect.") || t.startsWith("developer.")) {
    snap.roleEvents.push({ eventType: t, payload: r.payload as object | undefined });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: all hydrator tests pass (Task 3 + Task 4 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/test/hydrator.test.ts
git commit -m "feat(ritual-engine): replayEventsToSnapshot — capture artifact + developerOutput (plan H)"
```

---

### Task 5: `replayEventsToSnapshot` — sandboxApplyResult + escalation state

**Files:**
- Modify: `packages/ritual-engine/src/hydrator.ts`
- Modify: `packages/ritual-engine/test/hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ritual-engine/test/hydrator.test.ts`:

```typescript
describe("replayEventsToSnapshot — sandbox + escalation (Plan H Task 5)", () => {
  it("captures sandboxApplyResult from sandbox.apply.completed payload", () => {
    const result = { ok: true, parsed: 1, written: 1, failed: 0, skipped: 0, files: [] };
    const rows = [
      row(1n, "ritual.started",          { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "sandbox.apply.completed", { ritualId: "r-1", ts: 2, ...result })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.sandboxApplyResult?.ok).toBe(true);
    expect(snap!.sandboxApplyResult?.written).toBe(1);
  });

  it("flips state to 'escalated' when ritual.escalated event is replayed", () => {
    const rows = [
      row(1n, "ritual.started",   { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "ritual.escalated", { ritualId: "r-1", ts: 2, gate: "L4", cause: "secret leaked" })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.state).toBe("escalated");
  });

  it("flips state to 'completed' when ritual.completed is replayed", () => {
    const rows = [
      row(1n, "ritual.started",   { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "ritual.completed", { ritualId: "r-1", ts: 2 })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.state).toBe("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: 3 fails.

- [ ] **Step 3: Extend the fold**

Replace `applyOne` in `packages/ritual-engine/src/hydrator.ts` once more:

```typescript
function applyOne(snap: RitualSnapshot, r: SpecEventRowLike): void {
  const t = r.eventType;
  const p = r.payload as Record<string, unknown> | undefined;

  if (t.endsWith(".pass2.completed") && p && "artifact" in p) {
    snap.artifact = p.artifact;
  } else if (t === "developer.completed" && p) {
    snap.developerOutput = {
      diff: typeof p.diff === "string" ? p.diff : "",
      summary: typeof p.summary === "string" ? p.summary : undefined
    };
  } else if (t === "sandbox.apply.completed" && p) {
    // p includes the SandboxApplyResult fields inline (ok, parsed, written, …)
    // alongside ritualId/ts. We extract the result-shaped subset.
    snap.sandboxApplyResult = {
      ok: Boolean(p.ok),
      parsed:  Number(p.parsed  ?? 0),
      written: Number(p.written ?? 0),
      failed:  Number(p.failed  ?? 0),
      skipped: Number(p.skipped ?? 0),
      files:  Array.isArray(p.files) ? (p.files as never[]) : [],
      parseError: typeof p.parseError === "string" ? p.parseError : undefined
    };
  } else if (t === "ritual.escalated") {
    snap.state = "escalated";
  } else if (t === "ritual.completed") {
    snap.state = "completed";
  }

  if (t.startsWith("role.") || t.startsWith("architect.") || t.startsWith("developer.")) {
    snap.roleEvents.push({ eventType: t, payload: r.payload as object | undefined });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/hydrator.test.ts
```

Expected: all 10 hydrator cases pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/test/hydrator.test.ts
git commit -m "feat(ritual-engine): replayEventsToSnapshot — sandboxApplyResult + escalated/completed state (plan H)"
```

---

### Task 6: Define `RitualHydrator` interface; add optional hydrator opt to RitualEngine

**Files:**
- Modify: `packages/ritual-engine/src/hydrator.ts`
- Modify: `packages/ritual-engine/src/engine.ts`
- Modify: `packages/ritual-engine/src/index.ts`

- [ ] **Step 1: Add the interface to hydrator.ts**

Append to `packages/ritual-engine/src/hydrator.ts`:

```typescript
import type { RitualSnapshot } from "./engine.js";

export interface RitualHydrator {
  /** Returns the snapshot for ritualId by replaying historical events.
   *  Returns null when the ritualId is unknown OR when replay fails
   *  (the implementation logs and swallows so callers can treat this as
   *  a clean "not found"). */
  hydrate(ritualId: string): Promise<RitualSnapshot | null>;
}
```

- [ ] **Step 2: Modify the engine — accept optional hydrator**

In `packages/ritual-engine/src/engine.ts`, modify the `RitualEngineOptions` interface (find it near the top of the class) and the constructor:

```typescript
export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
  sandboxApplier?: SandboxApplier;
  /** Plan H: optional fallback for getRitual on in-memory miss.
   *  When omitted, getRitual returns undefined for unknown IDs (today's behavior). */
  hydrator?: RitualHydrator;
}
```

Add to the class:

```typescript
private readonly hydrator?: RitualHydrator;
```

In the constructor body, add:

```typescript
this.hydrator = opts.hydrator;
```

Add the import:

```typescript
import type { RitualHydrator } from "./hydrator.js";
```

- [ ] **Step 3: Re-export the interface**

In `packages/ritual-engine/src/index.ts`, add:

```typescript
export type { RitualHydrator } from "./hydrator.js";
```

- [ ] **Step 4: Verify the package still typechecks + tests still pass**

```bash
cd packages/ritual-engine && pnpm typecheck && pnpm test
```

Expected: typecheck clean; all 49+ existing tests + 10 hydrator cases pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ritual-engine/src/hydrator.ts packages/ritual-engine/src/engine.ts packages/ritual-engine/src/index.ts
git commit -m "feat(ritual-engine): RitualHydrator interface + optional hydrator opt on RitualEngine (plan H)"
```

---

### Task 7: `RitualEngine.getRitual` — async, falls back to hydrator on miss

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts`
- Create: `packages/ritual-engine/test/engine-getRitual-hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ritual-engine/test/engine-getRitual-hydrator.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RitualEngine, type RitualHydrator, type RitualSnapshot } from "../src/index.js";

function makeEngine(hydrator?: RitualHydrator) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn() } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn() } as never,
    hydrator
  });
}

const SNAP: RitualSnapshot = {
  state: "completed",
  projectId: "p-1",
  userId: "u-1",
  roleEvents: [],
  artifact: { kind: "plan" }
};

describe("RitualEngine.getRitual — hydrator fallback (Plan H Task 7)", () => {
  it("returns undefined when ritualId is unknown AND no hydrator is configured (today's behavior)", async () => {
    const engine = makeEngine();
    expect(await engine.getRitual("r-missing")).toBeUndefined();
  });

  it("falls back to the hydrator when configured AND in-memory miss", async () => {
    const hydrator: RitualHydrator = { hydrate: vi.fn(async () => SNAP) };
    const engine = makeEngine(hydrator);
    const result = await engine.getRitual("r-missing");
    expect(result).toEqual(SNAP);
    expect(hydrator.hydrate).toHaveBeenCalledWith("r-missing");
  });

  it("returns undefined when hydrator returns null (corruption / unknown)", async () => {
    const hydrator: RitualHydrator = { hydrate: vi.fn(async () => null) };
    const engine = makeEngine(hydrator);
    expect(await engine.getRitual("r-missing")).toBeUndefined();
  });

  it("does NOT call hydrator when in-memory hit (no extra DB read on warm path)", async () => {
    const hydrator: RitualHydrator = { hydrate: vi.fn(async () => SNAP) };
    const engine = makeEngine(hydrator);
    // Manually seed the in-memory map by reaching into the private field
    // for test purposes — simulates the engine having dispatched a ritual.
    (engine as unknown as { rituals: Map<string, unknown> }).rituals.set("r-warm", {
      state: "visualize",
      projectId: "p",
      userId: "u",
      roleEvents: []
    });
    const result = await engine.getRitual("r-warm");
    expect(result).toBeDefined();
    expect(hydrator.hydrate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ritual-engine && pnpm test test/engine-getRitual-hydrator.test.ts
```

Expected: 4 fails — `engine.getRitual is not async / does not call hydrator`.

- [ ] **Step 3: Modify getRitual**

In `packages/ritual-engine/src/engine.ts`, replace the existing `getRitual`:

```typescript
async getRitual(ritualId: string): Promise<RitualSnapshot | undefined> {
  const r = this.rituals.get(ritualId);
  if (r) {
    return {
      state: r.state,
      projectId: r.projectId,
      userId: r.userId,
      artifact: r.artifact,
      roleEvents: r.roleEvents ?? [],
      developerOutput: r.developerOutput,
      sandboxApplyResult: r.sandboxApplyResult
    };
  }
  if (this.hydrator) {
    const hydrated = await this.hydrator.hydrate(ritualId);
    return hydrated ?? undefined;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ritual-engine && pnpm test test/engine-getRitual-hydrator.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Run the full ritual-engine suite to catch the signature ripple**

```bash
cd packages/ritual-engine && pnpm test
```

Expected: every test green. If any pre-existing test calls `engine.getRitual(...)` synchronously, add `await` (the failure message will pinpoint the file/line).

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src/engine.ts packages/ritual-engine/test/engine-getRitual-hydrator.test.ts
git commit -m "feat(ritual-engine): getRitual is async; falls back to hydrator on in-memory miss (plan H)"
```

---

### Task 8: `SpecEventsHydrator` — atlas-web adapter composing repo + replay

**Files:**
- Create: `apps/atlas-web/lib/engine/spec-events-hydrator.ts`
- Create: `apps/atlas-web/test/lib/engine/spec-events-hydrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/atlas-web/test/lib/engine/spec-events-hydrator.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { SpecEventsHydrator } from "@/lib/engine/spec-events-hydrator";

const ROW_STARTED = {
  id: 1n,
  eventType: "ritual.started",
  payload: { ritualId: "r-1", ts: 1, projectId: "p-1", userId: "u-1" },
  actor: null
};

describe("SpecEventsHydrator — composes SpecEventRepo + replay (Plan H Task 8)", () => {
  it("returns a snapshot when listByRitual returns matching rows", async () => {
    const repo = { listByRitual: vi.fn(async () => [ROW_STARTED]) };
    const hyd = new SpecEventsHydrator(repo as never, "p-1");
    const snap = await hyd.hydrate("r-1");
    expect(snap?.projectId).toBe("p-1");
    expect(repo.listByRitual).toHaveBeenCalledWith("p-1", "r-1");
  });

  it("returns null when listByRitual returns []", async () => {
    const repo = { listByRitual: vi.fn(async () => []) };
    const hyd = new SpecEventsHydrator(repo as never, "p-1");
    expect(await hyd.hydrate("r-missing")).toBeNull();
  });

  it("returns null and logs when listByRitual rejects (degrades silently per Design Decision 6)", async () => {
    const repo = { listByRitual: vi.fn(async () => { throw new Error("RLS denied"); }) };
    const hyd = new SpecEventsHydrator(repo as never, "p-1");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hyd.hydrate("r-1")).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/spec-events-hydrator.test.ts
```

Expected: 3 fails — `Cannot find module '@/lib/engine/spec-events-hydrator'`.

- [ ] **Step 3: Implement the hydrator**

Create `apps/atlas-web/lib/engine/spec-events-hydrator.ts`:

```typescript
import {
  replayEventsToSnapshot,
  type RitualHydrator,
  type RitualSnapshot,
  type SpecEventRowLike
} from "@atlas/ritual-engine";

interface SpecEventRepoLike {
  listByRitual(projectId: string, ritualId: string, opts?: { limit?: number }): Promise<SpecEventRowLike[]>;
}

/**
 * SpecEventsHydrator — adapts SpecEventRepo (Postgres) into the
 * @atlas/ritual-engine RitualHydrator interface.
 *
 * Failure mode: any error from listByRitual is logged and converted to
 * `null` so the engine treats it as "ritual unknown" rather than crashing.
 * See Plan H Design Decision 6 for the rationale.
 */
export class SpecEventsHydrator implements RitualHydrator {
  constructor(
    private readonly repo: SpecEventRepoLike,
    private readonly projectId: string
  ) {}

  async hydrate(ritualId: string): Promise<RitualSnapshot | null> {
    try {
      const rows = await this.repo.listByRitual(this.projectId, ritualId);
      return replayEventsToSnapshot(rows);
    } catch (err) {
      console.error("[atlas-web] SpecEventsHydrator.hydrate failed; treating as unknown ritualId", { ritualId, err });
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/spec-events-hydrator.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/engine/spec-events-hydrator.ts apps/atlas-web/test/lib/engine/spec-events-hydrator.test.ts
git commit -m "feat(atlas-web): SpecEventsHydrator — adapter composing SpecEventRepo + replay (plan H)"
```

---

### Task 9: Add `ritual-hydration` feature flag

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/test/lib/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/atlas-web/test/lib/feature-flags.test.ts`:

```typescript
describe("ritual-hydration flag (Plan H)", () => {
  it("is off when ATLAS_RITUAL_HYDRATION is unset", () => {
    const src: FeatureFlagSource = { readEnv: () => undefined };
    expect(isFeatureEnabled("ritual-hydration", src)).toBe(false);
  });

  it("is on when ATLAS_RITUAL_HYDRATION=true", () => {
    const src: FeatureFlagSource = { readEnv: (n) => (n === "ATLAS_RITUAL_HYDRATION" ? "true" : undefined) };
    expect(isFeatureEnabled("ritual-hydration", src)).toBe(true);
  });

  it("listFlagStates includes ritual-hydration", () => {
    const states = listFlagStates({ readEnv: () => undefined });
    expect(states["ritual-hydration"]).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: 3 fails — type error on `"ritual-hydration"` (not in union); listFlagStates missing key.

- [ ] **Step 3: Add the flag**

Modify `apps/atlas-web/lib/feature-flags.ts`:

```typescript
export type FeatureFlag =
  | "figma-importer"
  | "stripe-payments"
  | "video-kling"
  | "auth-keycloak"
  | "live-events"
  | "ritual-hydration";

const FLAG_TO_ENV: Record<FeatureFlag, string> = {
  "figma-importer": "ATLAS_FF_FIGMA_IMPORTER",
  "stripe-payments": "ATLAS_FF_STRIPE_PAYMENTS",
  "video-kling": "ATLAS_FF_VIDEO_KLING",
  "auth-keycloak": "ATLAS_FF_AUTH_KEYCLOAK",
  "live-events": "ATLAS_LIVE_EVENTS",
  // Plan H — same naming convention as live-events (no FF_ prefix) since
  // operators flip this on a deploy without learning the convention.
  "ritual-hydration": "ATLAS_RITUAL_HYDRATION"
};
```

Update `listFlagStates` to include `"ritual-hydration": isFeatureEnabled("ritual-hydration", source)`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm test test/lib/feature-flags.test.ts
```

Expected: all flag tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags.test.ts
git commit -m "feat(atlas-web): ritual-hydration feature flag — ATLAS_RITUAL_HYDRATION (plan H)"
```

---

### Task 10: Wire the hydrator into `lib/engine/factory.ts`; ripple `await engine.getRitual` callers

**Files:**
- Modify: `apps/atlas-web/lib/engine/factory.ts`
- Modify: `apps/atlas-web/lib/actions/startRitual.ts`
- Modify: `apps/atlas-web/lib/actions/approveRitual.ts`
- Modify: `apps/atlas-web/lib/actions/acceptRiskAction.ts`
- Modify: `apps/atlas-web/lib/actions/escalateRitual.ts`
- Create: `apps/atlas-web/test/lib/engine/factory-hydrator-flag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/atlas-web/test/lib/engine/factory-hydrator-flag.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({})),
  SpecEventRepo: vi.fn().mockImplementation(() => ({
    listByRitual: vi.fn(async () => [])
  }))
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn(async () => ({})) }));

describe("getRitualEngine — ritual-hydration flag wiring (Plan H Task 10)", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { delete process.env.ATLAS_RITUAL_HYDRATION; });

  it("flag-OFF: engine constructed WITHOUT hydrator (today's behavior preserved)", async () => {
    delete process.env.ATLAS_RITUAL_HYDRATION;
    const ritualEngineMod = await import("@atlas/ritual-engine");
    const ctorSpy = vi.spyOn(ritualEngineMod, "RitualEngine");
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");
    expect(ctorSpy).toHaveBeenCalled();
    const opts = ctorSpy.mock.calls[ctorSpy.mock.calls.length - 1]![0] as { hydrator?: unknown };
    expect(opts.hydrator).toBeUndefined();
  });

  it("flag-ON: engine constructed WITH a hydrator instance", async () => {
    process.env.ATLAS_RITUAL_HYDRATION = "true";
    const ritualEngineMod = await import("@atlas/ritual-engine");
    const ctorSpy = vi.spyOn(ritualEngineMod, "RitualEngine");
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");
    expect(ctorSpy).toHaveBeenCalled();
    const opts = ctorSpy.mock.calls[ctorSpy.mock.calls.length - 1]![0] as { hydrator?: unknown };
    expect(opts.hydrator).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm test test/lib/engine/factory-hydrator-flag.test.ts
```

Expected: flag-ON case fails (hydrator undefined).

- [ ] **Step 3: Modify factory.ts**

In `apps/atlas-web/lib/engine/factory.ts`, after the existing `SpecEventRepo` import line near the top of the function body (it's currently `const { PreferencesRepo, SpecEventRepo } = await import("@atlas/spec-graph-data");`), add the hydrator imports + flag check before constructing the RitualEngine:

```typescript
const { isFeatureEnabled } = await import("@/lib/feature-flags");
const { SpecEventsHydrator } = await import("./spec-events-hydrator");

// ... (existing code) ...

const specEventRepo = new SpecEventRepo(pool);
const hydrator = isFeatureEnabled("ritual-hydration")
  ? new SpecEventsHydrator(specEventRepo, projectId)
  : undefined;

return new RitualEngine({
  conductor,
  eventSink: new SpecEventsSink(specEventRepo, projectId),
  personaPreferences: prefs,
  sandboxApplier: { /* unchanged */ },
  hydrator   // Plan H: undefined when flag off → today's miss=undefined behavior
});
```

(Refactor: the existing `new SpecEventRepo(pool)` inline inside `eventSink: new SpecEventsSink(new SpecEventRepo(pool), projectId)` becomes a shared `specEventRepo` const so the hydrator and the sink share one repo instance.)

- [ ] **Step 4: Ripple — `await` the four Server Action call sites**

In each of:
- `apps/atlas-web/lib/actions/startRitual.ts`
- `apps/atlas-web/lib/actions/approveRitual.ts`
- `apps/atlas-web/lib/actions/acceptRiskAction.ts`
- `apps/atlas-web/lib/actions/escalateRitual.ts`

Find every call to `engine.getRitual(ritualId)` and prepend `await`. The functions are already `async`, so this is a one-character change per call site. Run grep to find them:

```bash
grep -rn "engine.getRitual" apps/atlas-web/lib/actions/
```

Expected: a handful of matches across the four files. Add `await` to each.

- [ ] **Step 5: Run the full atlas-web typecheck + relevant tests**

```bash
cd apps/atlas-web && pnpm typecheck
cd apps/atlas-web && pnpm test test/lib/engine/ test/actions/
```

Expected: typecheck clean. Action tests green (the existing tests already use `async` test functions; adding `await` matches the typecheck-required new signature).

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/engine/factory.ts apps/atlas-web/lib/actions/ apps/atlas-web/test/lib/engine/factory-hydrator-flag.test.ts
git commit -m "feat(atlas-web): wire SpecEventsHydrator into engine factory; await ripple in Server Actions (plan H)"
```

---

### Task 11: Integration test — process-restart simulation against real Postgres

**Files:**
- Create: `apps/atlas-web/test/integration/ritual-hydration-roundtrip.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/atlas-web/test/integration/ritual-hydration-roundtrip.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { SpecEventRepo } from "@atlas/spec-graph-data";
import { SpecEventsHydrator } from "@/lib/engine/spec-events-hydrator";

const DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

describe("ritual hydration roundtrip — append events, hydrate snapshot (Plan H Task 11)", () => {
  let pool: Pool;
  let repo: SpecEventRepo;
  const projectId = `p-h-${Date.now()}`;
  const ritualId = `r-h-${Date.now()}`;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error("DATABASE_URL must be set for the integration test");
    pool = new Pool({ connectionString: DATABASE_URL });
    repo = new SpecEventRepo(pool);
  });

  afterAll(async () => { await pool.end(); });

  it("appends a ritual.started + role.completed + ritual.completed sequence and hydrates it back", async () => {
    await repo.append(projectId, {
      eventType: "ritual.started",
      payload: { ritualId, ts: 1, projectId, userId: "u-h" },
      actor: null
    });
    await repo.append(projectId, {
      eventType: "architect.pass2.completed",
      payload: { ritualId, ts: 2, artifact: { kind: "plan", title: "hydration-test" } },
      actor: null
    });
    await repo.append(projectId, {
      eventType: "ritual.completed",
      payload: { ritualId, ts: 3 },
      actor: null
    });

    const hydrator = new SpecEventsHydrator(repo, projectId);
    const snap = await hydrator.hydrate(ritualId);

    expect(snap).not.toBeNull();
    expect(snap!.state).toBe("completed");
    expect(snap!.projectId).toBe(projectId);
    expect(snap!.userId).toBe("u-h");
    expect((snap!.artifact as { kind: string }).kind).toBe("plan");
    expect(snap!.roleEvents.length).toBe(1);
    expect(snap!.roleEvents[0]!.eventType).toBe("architect.pass2.completed");
  });

  it("returns null for a ritualId that has no events in the project", async () => {
    const hydrator = new SpecEventsHydrator(repo, projectId);
    expect(await hydrator.hydrate("r-NOT-WRITTEN")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
cd apps/atlas-web && pnpm test test/integration/ritual-hydration-roundtrip.test.ts
```

Expected: 2 tests pass against real Postgres. If the DB is not running (`docker compose up -d postgres` not done), the test fails fast with a connect-refused — start Postgres and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/test/integration/ritual-hydration-roundtrip.test.ts
git commit -m "test(atlas-web): integration — ritual hydration roundtrip against real Postgres (plan H)"
```

---

### Task 12: Flag-OFF behavioural lock + final verification + merge

**Files:**
- (no new code — verification gate + merge)

- [ ] **Step 1: Verify flag-OFF preserves today's behavior**

Run the entire atlas-web vitest suite with `ATLAS_RITUAL_HYDRATION` unset:

```bash
cd apps/atlas-web && unset ATLAS_RITUAL_HYDRATION && pnpm test
```

Expected: every pre-existing test still green. New tests added by Plan H (~20 cases across 5 files) all pass. Pre-existing parallel-run flakes (factory.test.ts, callback.test.ts, etc.) are pre-existing and out-of-scope — verify they reproduce on `main` baseline if any fail; do NOT attempt to fix.

- [ ] **Step 2: Verify flag-ON exercises the hydrator path end-to-end**

```bash
cd apps/atlas-web && ATLAS_RITUAL_HYDRATION=true pnpm test test/integration/ritual-hydration-roundtrip.test.ts
```

Expected: 2 integration tests pass.

- [ ] **Step 3: Cross-package typecheck**

```bash
cd apps/atlas-web && pnpm typecheck
pnpm -F @atlas/ritual-engine typecheck
pnpm -F @atlas/spec-graph-data typecheck
```

Expected: all three clean.

- [ ] **Step 4: Update `docs/superpowers/local-dev-status.md`**

Find the bullet under "What's NOT wired (deferred)" referencing "Persistent ritual snapshots". Remove it. Append to "What's wired":

```markdown
- **Plan H: persistent ritual snapshots.** When `ATLAS_RITUAL_HYDRATION=true`, `RitualEngine.getRitual(ritualId)` falls back to a Postgres-backed `SpecEventsHydrator` on in-memory miss. Events landed by `SpecEventsSink` are folded back into a `RitualSnapshot` via the pure `replayEventsToSnapshot` in `@atlas/ritual-engine`. Process restart no longer drops history. Flag-OFF preserves today's in-memory-only behavior — no hydrator wired, miss returns undefined as before.
```

- [ ] **Step 5: Mark plan shipped**

Append to this plan file:

```markdown
---

## Shipped

All 12 tasks merged to `plan-h/persistent-rituals` and then to `main`. `pnpm typecheck` clean across atlas-web + @atlas/ritual-engine + @atlas/spec-graph-data. atlas-web added ~14 new test cases across 4 new files; ritual-engine added 14 new cases across 2 new files; spec-graph-data added 3 cases. Integration test verifies real-Postgres roundtrip. Flag-OFF behavioural lock preserved. `docs/superpowers/local-dev-status.md` updated — Plan H moved to "What's wired".
```

- [ ] **Step 6: Commit + merge**

```bash
git add docs/superpowers/local-dev-status.md docs/superpowers/plans/2026-04-28-plan-h-persistent-rituals.md
git commit -m "docs(plan-h): mark shipped — persistent ritual snapshots behind ATLAS_RITUAL_HYDRATION"
git checkout main
git pull
git merge --no-ff plan-h/persistent-rituals -m "Merge branch 'plan-h/persistent-rituals'

Plan H — persistent ritual snapshots behind ATLAS_RITUAL_HYDRATION.
- New replayEventsToSnapshot in @atlas/ritual-engine (pure event fold)
- New RitualHydrator interface + RitualEngine.hydrator option
- New SpecEventsHydrator in atlas-web composing SpecEventRepo + replay
- New SpecEventRepo.listByRitual filtering on payload.ritualId
- RitualEngine.getRitual is async; falls back to hydrator on in-memory miss
- Flag-OFF preserves today's in-memory-only behavior byte-for-byte
"
git branch -d plan-h/persistent-rituals
```

Expected: merge commit lands on main; branch deleted.

- [ ] **Step 7: Verify main is green post-merge**

```bash
cd apps/atlas-web && pnpm typecheck && pnpm test test/lib/engine/spec-events-hydrator.test.ts test/integration/ritual-hydration-roundtrip.test.ts
pnpm -F @atlas/ritual-engine test
pnpm -F @atlas/spec-graph-data test
```

Expected: all green.

---

## Completion Checklist

After all 12 tasks:

- [ ] `pnpm typecheck` — clean across atlas-web + ritual-engine + spec-graph-data
- [ ] `pnpm test` (per package) — full suites green; ~31 new cases across Plan H surface
- [ ] Integration test against real Postgres — 2 cases pass with `ATLAS_RITUAL_HYDRATION=true`
- [ ] Flag-OFF lock — engine constructed without hydrator; getRitual returns undefined on miss as before
- [ ] `docs/superpowers/local-dev-status.md` updated — Plan H moved to "What's wired"
- [ ] This plan file marked Shipped at the bottom
- [ ] `plan-h/persistent-rituals` merged to `main` (`--no-ff`); branch deleted
- [ ] Manual smoke: start atlas-web, run a ritual, restart `pnpm dev`, navigate back to ChatPanel — architect plan card + developer output recover
