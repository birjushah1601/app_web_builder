# Plan A — Follow-ups Plan B Must Handle Before Building

These came out of the whole-branch review of Plan A at HEAD `6d2c72b`. They are NOT in Plan A's scope (Plan A's stub-driven goal was met) but Plan B will hit each one within its first few tasks, so they're called out here so the next session doesn't rediscover them.

## Must-fix-at-start-of-Plan-B

### F1 — Add FK `workflow_runs.project_id → projects(id)`
- **Where:** new migration in `packages/spec-graph-data/drizzle/`, plus update `packages/spec-graph-data/src/schema/workflow-runs.ts` with `.references(() => projects.id, { onDelete: "cascade" })`
- **Why:** the spec (Section 6) called for the FK; Plan A's migration omits it. Without it, orphaned `workflow_runs` rows against non-existent projects are possible at the DB level.
- **Cost:** small. Use the standard Drizzle migration tool to produce the SQL.

### F2 — Persist planner's `dependencyProfile` into `workflow_runs`
- **Where:** `packages/workflow-engine/src/engine.ts` (`start()` method), `packages/spec-graph-data/src/repo/workflow-run.repo.ts` (add `updateDependencyProfile(runId, profile)` or extend `updateStatus`)
- **Why:** Plan A's `engine.start()` reads the planner's `dependencyProfile` then does `void dependencyProfile`. The `workflow_runs` row keeps the empty placeholder `{schemaVersion: "1"}` it was inserted with. `getWorkflowRun()` then returns a snapshot whose `dependencyProfile` is always empty. Any Plan B/C code reading this will get wrong data.
- **Fix:** after planner emits, call `runRepo.updateDependencyProfile(workflowRunId, plannerDag.dependencyProfile)` before flipping status to `awaiting_approval`.

### F3 — Wire `CheckpointRecorder` into the broker
- **Where:** `apps/atlas-web/lib/engine/factory.ts` (`getWorkflowEngine`)
- **Why:** the `CheckpointRecorder` class exists and is unit-tested, but `getWorkflowEngine` never creates one or subscribes it to the broker. With stubs in Plan A this is silent because no real broker events fire. The moment Plan B wires real role dispatch, every checkpoint event will be silently dropped.
- **Fix:** in `getWorkflowEngine`, construct `new CheckpointRecorder(checkpointRepo, new Map())`, subscribe its `onEvent` to the project's broker stream, and have the real `launchNodeRitual` (the one Plan B writes) call `recorder.registerRitualForNode(ritualId, workflowRunId, nodeId)` each time a node ritual is launched.

### F4 — Make scheduler invocation fire-and-forget in `approvePlan`
- **Where:** `packages/workflow-engine/src/engine.ts` (`approvePlan` method)
- **Why:** Plan A awaits `scheduler.execute()` inside `approvePlan` so the integration tests can assert final state synchronously. In production this means the `approveWorkflowPlan` Server Action blocks until the entire workflow finishes — for a real multi-minute DAG that's a guaranteed HTTP timeout.
- **Fix:** change `await scheduler.execute()` to `void scheduler.execute().catch(err => console.error(...))`. The scheduler already persists its own terminal status via `persistWorkflowStatus` so the caller doesn't need to await. Update the engine unit tests to either (a) explicitly await a non-public completion promise or (b) poll `getRun()` until status terminal.

### F5 — Fix `retryNode` to reset transitively-blocked descendants
- **Where:** `packages/workflow-engine/src/engine.ts` (`retryNode` method)
- **Why:** when a node fails, `WorkflowScheduler.blockDependents()` correctly marks transitive dependents as `blocked`. But `retryNode` only resets the specific failed node back to `pending`. The blocked dependents stay `blocked` forever. In a diamond DAG (`b` and `c` both depend on `a`; `d` depends on `b` and `c`): if `b` fails and is later retried successfully, `d` should run but won't — it's still marked blocked.
- **Fix:** after resetting the failed node to `pending`, traverse the DAG and reset any node currently marked `blocked` whose dependsOn chain transits through the just-retried node. Reset them to `pending`.
- **Test:** Plan A's integration test for failure cascades was simulated via DB injection and didn't cover this. Plan B should add an integration test where retry recovers a multi-node failure cascade.

### F6 — Add `Conductor.registerRole()` and remove the `(as any)` cast
- **Where:** `packages/conductor/src/conductor.ts` (add public `registerRole(id, role)` method), `apps/atlas-web/lib/engine/factory.ts` (remove the `(ritualEngine as any).conductor.roles.set(...)` cast)
- **Why:** Plan A registers `StubWorkflowPlannerRole` by reaching into a private `Conductor.roles` field. The cast works at runtime because JS ignores TS access modifiers, but it's brittle (any future refactor of Conductor's internals breaks atlas-web silently).
- **Fix:** add `Conductor.registerRole(id: string, role: Role): void { this.roles.set(id, role); }` as a public method. Plan B will need this anyway when registering the real `WorkflowPlannerRole`.

## Known caveats (working-but-fragile)

### C1 — `getWorkflowEventLog` leaks `pg.Pool` per call
- **Where:** `apps/atlas-web/lib/actions/getWorkflowEventLog.ts`
- **Impact:** every call to this action allocates a new `pg.Pool` and never closes it. At normal poll rates (e.g., a UI History tab polling every 5s) the Postgres connection limit will be exhausted in minutes.
- **Fix:** reuse the pool from `getWorkflowEngine` or extract a module-singleton pool. Same pattern as the broker singleton.
- **Priority:** medium. Plan C (UI) will likely surface this — fix before History tab ships.

### C2 — `makeLaunchRitual`/`makeAwaitRitual` are private; Plan B integration requires editing engine.ts
- **Where:** `packages/workflow-engine/src/engine.ts`
- **Impact:** Plan B's real ritual integration can't be injected from outside; the implementer has to edit these two methods in-place. Not a seam break, just a planned modification.
- **Alternative fix:** make them injectable via `WorkflowEngineOptions` (mirroring how `WorkflowScheduler.SchedulerDeps` works). Cleaner long-term but optional.

### C3 — `buildSnapshot()` casts `policy` from JSONB without Zod validation
- **Where:** `packages/workflow-engine/src/engine.ts` (`getRun()` → `buildSnapshot()`)
- **Impact:** a DB row with a malformed policy object produces a runtime `WorkflowNode` with invalid `policy` data. Acceptable for Plan A because the only writer is the engine itself, but Plan B should add `NodePolicySchema.parse(node.policy)` defensively.

### C4 — Double `auth()` in `deferNode` and `resumeDeferredNode`
- **Where:** `apps/atlas-web/lib/actions/deferNode.ts`, `apps/atlas-web/lib/actions/resumeDeferredNode.ts`
- **Impact:** each call invokes `auth()` once in the action then again when it delegates to `setNodePolicy`. Redundant work, not a correctness issue. The `userId` from the outer `auth()` is unused.
- **Fix:** either thread `userId` into `setNodePolicy` or have defer/resume call the engine directly.

## Test coverage gaps

### TG1 — End-to-end failure-cascade not exercised against real DB
- **Where:** `packages/workflow-engine/test/integration.test.ts`
- **What's covered:** unit-level scheduler test with mocked deps proves failure → block → end. DB-level test simulates a failed node by setting status directly.
- **What's NOT covered:** real ritual fails → scheduler observes → blocks dependent → workflow escalates → user retries → cascade unwinds. Plan B should add this once `makeLaunchRitual`/`makeAwaitRitual` accept failure injection.

### TG2 — Planner triage Q→answer→DAG flow not tested
- **Where:** same file
- **Why deferred:** Plan A's stub planner doesn't do triage. Plan B's real planner will need its own integration test exercising the `triage-clarifications` canvas-pause kind.

### TG3 — Crash + resume not tested
- **Why deferred:** requires killing the process mid-flight, which a vitest run can't do cleanly. Plan B (or a dedicated reliability spec) should set up an integration test that aborts a partially-running scheduler and verifies resume from checkpoints.
