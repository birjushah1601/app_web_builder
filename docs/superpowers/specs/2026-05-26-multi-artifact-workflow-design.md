# Multi-Artifact Workflow Orchestration — Design Spec

**Status:** Draft v1 (2026-05-26)
**Goal:** Turn Atlas from a single-ritual landing-page generator into a DAG-driven AI builder that produces backend + frontend + tests + IaC + deploy with typed artifact handoffs between rituals, opinionated OSS-first dependency defaults, and durable resumable execution.

**Architecture in one paragraph:** A new `WorkflowEngine` orchestrates today's `RitualEngine` over a user-approved DAG of nodes. Each node is one ritual that produces a typed `Artifact` consumed by downstream nodes. A two-phase lifecycle — plan (sequential dialogue with the user, mirroring the superpowers brainstorm → spec → plan pattern) then execute (max-parallel DAG run) — uses today's canvas-pause primitives unchanged. Workflow state persists to Postgres for crash-safe resume. Today's single-ritual flow stays byte-identical for simple prompts.

**Tech stack:** TypeScript pnpm monorepo (new `packages/workflow-engine`), Postgres (new tables, additive migrations), the existing `RitualEngine` + `Conductor` + `EventBroker`, the existing canvas-pause primitives (`option-select`, `plan-approval`, `triage-clarifications`), Zod for per-artifact-kind schemas, Next.js 15 + React 19 for the graph-view UI.

---

## 1. Scope

### In scope (this spec)
- Workflow lifecycle: plan phase → user approval → execute phase
- DAG node model, scheduler, concurrency policy
- Typed artifact contracts per `ArtifactKind`
- Postgres-backed persistence + checkpoint recorder + resume-on-restart
- Failure policy (halt-dependents, continue-independents) with per-node retry
- Graph-view UI with drill-in + per-node policy (priority / active / background / deferred)
- Coexistence with today's single-ritual flow via an entry classifier
- Operations: cancellation/abort, observability event log, re-running, per-workflow cost cap, public API surface, single-node internal execution invariant, auth/authz
- Generated-app dependency profile (auth/db/storage/email/jobs/payments/etc.) opinionated OSS-first
- Testing strategy across unit/integration/e2e layers

### Explicitly deferred to future specs
- Cross-stack/integration gates ("does the frontend's fetch actually match the backend's OpenAPI"). v1 = per-node gates only (today's Security/A11y/Build/VQ inside each ritual).
- Multi-tenant scheduling (cross-project priority, quotas)
- External workflow library integration (Temporal/Airflow)
- Workflow-level refine (today's refine action operates on one ritual; workflow-refine = own future spec)
- True mid-ritual resume (v1 resumes at node boundaries; mid-ritual resume needs `RitualEngine` checkpoint support that doesn't exist yet)
- Cloud deploy targets (Fly/Render/k8s); v1 ships docker-compose only
- Terraform IaC; v1 ships docker-compose only
- `data-pipeline`, `mobile-app`, `cli-tool` artifact-kind schemas (templates exist; schemas + roles ship in their own future plans)
- Per-provider integration code (each provider — Keycloak/Lago/MinIO/etc. — is its own implementation plan slotting into the contract this spec defines)
- User-managed dependency profile library ("save my preferred stack and reuse")

---

## 2. Architecture: WorkflowEngine over RitualEngine

Two cooperating engines with clean separation:

```
WorkflowEngine                       RitualEngine (today, unchanged)
├─ plans a workflow (DAG)            ├─ runs ONE ritual end-to-end
├─ schedules ready nodes             ├─ orchestrates roles inside a ritual
├─ persists workflow state           ├─ emits canvas-pause events
├─ drives node lifecycle             ├─ persists per-ritual state
└─ for each node:                    └─ called as a library:
   ritualEngine.start({...})            returns ritualId, eventually artifact
```

**Key properties:**
- `WorkflowEngine` lives in new `packages/workflow-engine/`
- It calls today's `RitualEngine.start()` per node — no internal API changes to `RitualEngine` (one small addition: `RitualEngine.abort(ritualId)` for the cancellation feature)
- It subscribes to the same broker SSE stream filtered by ritualId so it knows when a node's ritual finishes
- The `RitualEngine` is unaware it's running inside a workflow — the only signal it gets is the augmented `priorArtifact` carrying upstream nodes' typed artifacts

**Atlas-web wiring:**
- New Server Action `startWorkflow(input)` — alternative to today's `startRitual`
- `factory.ts` constructs both engines and wires them to the same broker/event-sink/db pool
- A new entry classifier (LLM call) routes a cold-start prompt to either `startRitual` (today) or `startWorkflow` (new) based on flag state + heuristic verdict

---

## 3. Workflow lifecycle

Two distinct phases with different concurrency models. The user sees one continuous flow.

### Phase 1 — Plan (sequential dialogue)
1. User submits the cold-start prompt.
2. Entry classifier decides single-ritual vs workflow (Section 9).
3. If workflow → `WorkflowEngine.start(prompt)` runs a new role: **workflow-planner**.
4. Planner pass 1 (triage): may emit blocker clarification questions → uses existing `triage-clarifications` canvas-pause kind. User answers.
5. Planner pass 2: emits the proposed DAG (nodes, deps, reasoning) + a `DependencyProfile` (Section 12) defaulting to OSS-first.
6. Engine pauses on the existing `plan-approval` canvas-pause kind. User sees the proposed DAG in the graph view. They can rename nodes, add/remove nodes, change `dependsOn`, toggle defer/background, and override dependency-profile choices. Click Approve.

### Phase 2 — Execute (max-parallel DAG)
7. WorkflowEngine takes the approved DAG and starts the scheduler.
8. Scheduler walks the DAG, finds ready nodes (no unsatisfied deps), launches all of them concurrently. Engine does NOT throttle by device-level constraints — the provider layer handles its own backpressure.
9. Each node runs as a normal ritual via `RitualEngine.start()` with a synthesized `priorArtifact` merging upstream nodes' typed artifacts.
10. As nodes complete, dependents become ready and get scheduled. Failed nodes halt their transitive dependents but never affect independent branches.
11. User can drill into any running node to see today's per-ritual UI scoped to that node's ritualId. From the graph view they can re-prioritize, switch to background, defer, or retry-on-failure.

### Pause primitives reused (no new primitives invented)
| Phase event | Existing primitive |
|---|---|
| Planner triage questions | `triage-clarifications` (Plan U slice 3b) |
| Plan approval | `plan-approval` (Plan UXO Task 7) |
| Per-node design pick (within a ritual) | `option-select` (Plan S.4) |

---

## 4. Typed artifact contracts

Every node emits a typed `Artifact` keyed by `ArtifactKind`. Downstream nodes declare `consumes: NodeId[]`; WorkflowEngine merges those upstream artifacts into the consuming node's `priorArtifact` at dispatch time.

### Schema location
`packages/workflow-engine/src/artifact-contracts/` — one Zod schema file per artifact kind.

### Per-kind shapes (v1)

```ts
// backend-rest-api / backend-graphql
{
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: object,              // OpenAPI 3.1 document
  routes: Array<{ method, path, opId, requestSchema, responseSchema }>,
  dbDdl?: string,                   // SQL DDL emitted by this ritual
  envContract: Array<{ name, required, description }>,
  sandboxId: string,                // for cross-stack URL resolution
  previewUrl?: string               // for the frontend to fetch from
}

// frontend-app
{
  schemaVersion: "1",
  kind: "frontend-app",
  pages: Array<{ route, file }>,
  designTokens: object,
  apiClientFile?: string,           // path to generated client
  references: Array<{ from: nodeId, kind }>
}

// tests
{
  schemaVersion: "1",
  kind: "tests",
  framework: "playwright" | "vitest" | "pytest",
  specs: Array<{ file, targets: NodeId[] }>,
  coverage?: { lines, branches }
}

// iac
{
  schemaVersion: "1",
  kind: "iac",
  tool: "compose",                  // v1 = docker-compose only
  resources: Array<{ kind, name, file }>,
  envContract: Array<{ name, required, description }>,
  topology: object
}

// deploy
{
  schemaVersion: "1",
  kind: "deploy",
  target: "docker-compose",         // v1 = compose only
  manifests: Array<{ file, kind }>,
  smokeTests: Array<{ url, expect }>
}

// generic fallback for kinds without typed schemas
{
  schemaVersion: "1",
  kind: string,
  payload: unknown                  // consumer casts at own risk
}
```

### Merge contract
`WorkflowEngine` builds `priorArtifact` for a consuming node by:
1. Looking at the node's declared `consumes: NodeId[]`
2. Fetching each upstream node's completed `Artifact` from the database
3. Merging into `{upstream: {[nodeId]: Artifact}, ...today's PriorRitualContext fields, dependencyProfile}`
4. Forwarding to `RitualEngine.start({priorArtifact})` — the engine treats it as opaque; roles that consume typed artifacts use `parseWorkflowArtifact(priorArtifact, "backend-rest-api")` to validate via Zod.

### Versioning
Every artifact carries `schemaVersion`. Consumers check compatibility — refuse incompatible versions with a clear error rather than silently casting.

### Validation
The producing role validates its artifact against the schema before the node is marked `done`. Validation failures escalate the node (same path as role failures).

---

## 5. DAG model & scheduler

### Node model
```ts
WorkflowNode {
  id: string                              // stable per-workflow
  artifactKind: ArtifactKind | "workflow-planner"
  summary: string
  dependsOn: NodeId[]                     // MUST be `done` before this node is scheduled
  consumes: NodeId[]                      // upstream artifacts merged into priorArtifact; subset of dependsOn (a node can depend on another for ordering without reading its artifact, but cannot read an artifact from a non-dependency)
  policy: {
    priority: number                      // 0 default; higher = sooner among ready
    runMode: "active" | "background" | "deferred"
    timeoutMs?: number                    // default 30 min
  }
  status: "pending" | "ready" | "running" | "done" | "failed" | "skipped" | "blocked"
  ritualId?: string                       // populated when running
  artifactRef?: { schemaVersion, location }
  failure?: { error, attempts, lastCheckpointId }
}
```

### Workflow record
```ts
WorkflowRun {
  id: string
  projectId: string
  userId: string
  prompt: string
  status: "planning" | "awaiting_approval" | "running" | "completed" | "escalated" | "aborted"
  nodes: WorkflowNode[]
  edges: Array<{ from, to }>              // derived from dependsOn; stored for fast graph queries
  dependencyProfile: DependencyProfile    // See Section 12
  concurrencyCap?: number                 // unset = unlimited (default)
  createdAt, updatedAt
}
```

### Scheduler loop (single async loop per workflow run)
```
while workflow.status == "running":
  ready = nodes.filter(n =>
    n.status == "pending"
    and n.policy.runMode != "deferred"
    and n.dependsOn.every(dep => nodes[dep].status == "done"))

  ready.sort(by priority desc, then by topological order)

  while ready.length > 0 and (concurrencyCap == null or activeNodes < concurrencyCap):
    next = ready.shift()
    next.status = "running"
    next.ritualId = launch(next)              // ritualEngine.start() in background
    activeNodes++

  await any node to terminate (event-driven via broker subscription, no polling)
  on completion: mark done, persist artifact + checkpoint
  on failure: mark failed, mark transitive dependents "blocked"
  if no running + no ready + no in-pause → workflow.status = "completed" or "escalated"
```

### Concurrency policy
Engine defaults to **unlimited parallelism**. Production assumes provider-side rate limiting handles throughput. Local-dev opt-in cap via `ATLAS_WORKFLOW_CONCURRENCY` (e.g. `1` when debugging against the single-tenant local proxy).

### Per-node timeout
Default 30 min outer cap (separate from per-role 10-min timeout that already exists inside a ritual). On timeout → node `failed` with `errorKind: "timeout"`.

---

## 6. Persistence model

Postgres-backed; additive migrations to today's schema.

### Tables
```sql
workflow_runs (
  id uuid primary key,
  project_id uuid not null references projects(id),
  user_id text not null,
  prompt text not null,
  status text not null,                  -- planning | awaiting_approval | running | completed | escalated | aborted
  concurrency_cap integer,               -- null = unlimited
  dependency_profile jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

workflow_nodes (
  id text not null,                      -- node id stable per workflow
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  artifact_kind text not null,
  summary text not null,
  depends_on jsonb not null default '[]'::jsonb,
  consumes jsonb not null default '[]'::jsonb,
  policy jsonb not null,
  status text not null,
  ritual_id text,
  artifact jsonb,                        -- the typed artifact when done
  artifact_schema_version text,
  failure jsonb,                         -- {error, attempts, lastCheckpointId}
  started_at timestamptz,
  completed_at timestamptz,
  primary key (workflow_run_id, id)
)

workflow_node_checkpoints (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  kind text not null,                    -- "role_pass_completed" | "developer_delta_batch" | etc.
  payload jsonb not null,
  ritual_event_id text,                  -- pointer to spec_events row
  created_at timestamptz not null default now()
)

workflow_usage (
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  provider text not null,                -- anthropic | google | openrouter | local-proxy
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12,4) not null default 0,
  recorded_at timestamptz not null default now()
)
```

### Write path
- Workflow planning → insert `workflow_runs` (status=planning) → insert `workflow-planner` node
- Planner produces DAG → insert sibling `workflow_nodes` rows (status=pending) → flip workflow status=awaiting_approval
- User approves → status=running → scheduler starts
- Broker subscription → `recordCheckpoint(...)` writes `workflow_node_checkpoints`
- Node `done` → write `artifact` + `artifact_schema_version` to `workflow_nodes`
- Workflow terminates → status=completed or escalated

### Resume on boot/retry
1. Query `workflow_runs WHERE status IN ('running','awaiting_approval')`
2. Rebuild scheduler state from `workflow_nodes` + latest checkpoints per node
3. `done` nodes → skip (use cached artifact)
4. `running` nodes (interrupted by crash) → mark `failed` with `errorKind: "process_crash"`, user retries from UI
5. `pending` nodes whose deps are now satisfied → schedule them

---

## 7. Failure & retry + checkpoint contract

### Failure isolation rules
| Event | Failed node | Other nodes |
|---|---|---|
| Role escalates after 3 attempts | `failed` | transitive dependents → `blocked` |
| Ritual times out | `failed` (timeout) | same |
| Artifact validation fails | `failed` (artifact_invalid) | same |
| Process crash | `failed` (process_crash) | same |
| Independent sibling | unaffected | continues |

Workflow only `escalates` once all running/ready nodes terminated AND ≥1 is `failed` AND no `pending` could still run.

### Retry model (v1 — manual)
Failed node → "Retry node" button → status back to `pending`, `failure.attempts++`, scheduler picks up. Ritual re-runs from scratch (no mid-ritual resume in v1). Today's per-role 3-attempt retry inside `RitualEngine` is unchanged and runs inside each node.

### Checkpoint contract
A checkpoint is a serializable snapshot tied to a known engine event, recorded automatically by a broker subscriber.

| Kind | When emitted | Payload |
|---|---|---|
| `role_pass_completed` | After any `<role>.pass1/pass2.completed` | `{roleId, passName, partialArtifact}` |
| `designer_revise_completed` | After designer SPU 3-pass | `{proposal}` |
| `canvas_pause_resolved` | When a canvas-pause kind resolves | `{kind, payload, autoResolved}` |
| `developer_candidate_delta_batch` | Every ~50 deltas during streaming | `{candidate, totalChars}` (telemetry-only in v1 — no payload persistence; used in v2 mid-ritual resume) |
| `sandbox_apply_completed` | After sandbox.apply.completed | `{ok, written, failed}` |
| `node_completed` | When node → `done` | `{artifact, schemaVersion}` |

### Resume policy
**v1 (this spec):** node-boundary resume. Crash interrupts a `running` node → restart from scratch on retry; upstream `done` artifacts are honored (no redo).

**v2 (deferred):** mid-ritual resume. Re-enter the ritual at the last completed pass via `role_pass_completed` checkpoints. Needs `RitualEngine` "start from checkpoint" support that doesn't exist today.

---

## 8. Multi-sandbox UX

**Top-level shift:** active workflow → project page swaps from today's per-ritual tree to a graph view. Drilling into a node restores today's per-ritual UI scoped to that node's ritualId.

### Graph view route
`/projects/[id]/workflow/[workflowId]` — new route.

### Node states (colors)
- `pending` — gray
- `running` — indigo (pulsing)
- `done` — emerald
- `failed` — red
- `blocked` — gray with diagonal hatch
- `skipped` / `deferred` — slate with dashed border

### Drill-in route
`/projects/[id]/workflow/[workflowId]/node/[nodeId]` — renders today's per-ritual UI (rail, canvas, Monaco, preview iframe) bound to that node's ritualId. The streaming card (Plan U slice 3b follow-on we shipped) works unchanged.

### Per-node context menu
- Retry node (failed only)
- Prioritize / Deprioritize
- Run in background ⇄ Active
- Defer / Resume from deferred
- Skip permanently
- Open ritual logs

### Background mode signal
Node runs normally; graph shows a "🔔 will notify" badge. Toast on completion; badge clears when user opens the node.

### Workflow chat panel
New component on the graph view's right side. Hosts the workflow-level conversation (planner Q&A, approval, completion summary). User-typed follow-ups route to: add node, retry node, refine done node (creates new workflow — same pattern as today's refine on ritual).

### Per-node preview renderer
Chosen by `artifactKind` via the existing canvas-mode-registry pattern:
- `frontend-app` → iframe preview (today's)
- `backend-rest-api` → Swagger/OpenAPI UI
- `data-pipeline` → logs viewer
- `iac` → topology diagram + rendered compose file
- `deploy` → service status + smoke test results
- `tests` → results panel (pass/fail per spec, runtime, last error)

### Approval gate UI
Between Phase 1 and Phase 2 the graph view shows the proposed DAG with all nodes `pending`. An "Edit & Approve" panel slides in: rename nodes, edit `dependsOn`, toggle defer/background, click Approve. Maps to the existing `plan-approval` pause kind.

---

## 9. Coexistence + entry classifier + feature flags

Today's single-ritual flow stays unchanged. Workflow only kicks in when the prompt warrants it AND the master flag is on.

### Entry classifier
New LLM call `classifyEntry(prompt)` → `{ mode: "single-ritual" | "workflow", reasoning, suggestedKinds?: ArtifactKind[] }`.

Heuristics:
- "landing page / hero / marketing / about page" → `single-ritual`
- "SaaS / platform / dashboard / app with login / billing / users / database / API" → `workflow` (+ suggested kinds)
- CLI / data pipeline / mobile app → `single-ritual` if scoped; `workflow` if multi-kind implied
- `artifactKindHint` from prompt-first form is a strong signal; explicit `frontend-app` → default to `single-ritual` unless prompt clearly implies backend

Model: cheap (gemini-2.5-flash). Cached per session.

### Manual override flag
`ATLAS_FF_WORKFLOW_PICKER` on → even classifier-says-workflow prompts show a checklist override: `Backend [✓] Frontend [✓] Tests [✓] IaC [ ] Deploy [ ]    Customize | Use single-ritual instead`. Off → classifier verdict goes straight through.

### Routing in Server Actions
```ts
// apps/atlas-web/lib/actions/startBuild.ts (new — replaces cold-start direct startRitual)
export async function startBuild(input: StartBuildInput) {
  const { mode, suggestedKinds, reasoning } = await classifyEntry(input.prompt)
  if (mode === "workflow") return startWorkflow({ ...input, suggestedKinds })
  return startRitual({ ...input })
}
```

Today's `startRitual` action stays as-is, callable directly from refine actions, edit-element actions, demo mode, etc.

### Feature flags
| Flag | OFF | ON |
|---|---|---|
| `ATLAS_FF_WORKFLOW` (master) | Every prompt → today's single-ritual path. Classifier never runs. | Classifier runs on every cold-start. Decides per-prompt. |
| `ATLAS_FF_WORKFLOW_PICKER` | Classifier verdict goes straight through | Workflow verdict → user sees checklist override |
| `ATLAS_FF_WORKFLOW_KINDS` (CSV, default = all 6 kinds when master ON) | All kinds eligible | Only listed kinds eligible; classifier + planner constrained |

### Rollout sequence
1. Land WorkflowEngine + persistence + UI shell with `ATLAS_FF_WORKFLOW=false`. Dead-pathed in prod.
2. Flip `ATLAS_FF_WORKFLOW=true` + `ATLAS_FF_WORKFLOW_KINDS=frontend-app,backend-rest-api` in dev. Run real workflows internally.
3. Enable `ATLAS_FF_WORKFLOW_PICKER=true` for power-user override.
4. Add `tests`, `iac`, `deploy` to `ATLAS_FF_WORKFLOW_KINDS` one at a time as each implementation plan lands.
5. Retire master flag once stable.

### Fail-safe
Any flag misconfig or classifier error → fall back to single-ritual. No prompt is ever blocked by workflow layer being broken.

### Migration semantics
- Existing rituals in the DB stay rituals; no migration.
- Existing projects continue working in single-ritual mode forever.
- New prompts on new projects get classified.
- "Convert this project to a workflow" action is a future spec.

---

## 10. Per-artifact-kind details

### `workflow-planner` (phase 1 only)
- Produces: the DAG (node list + edges + per-node summaries + reasoning) + `DependencyProfile`. Written directly to `workflow_runs` + `workflow_nodes`; not a typed `Artifact`.
- Consumes: original prompt; clarification answers; optionally prior workflows on this project (refinement awareness).
- LLM: gemini-2.5-flash for triage; claude-sonnet-4 for DAG synthesis.
- Reuses today's triage Q&A flow.

### `backend-rest-api` / `backend-graphql`
- Template: `atlas-fastapi` / `atlas-graphql-yoga`
- Produces: typed `BackendArtifact` (Section 4)
- Consumes: usually nothing (root node) or a `schema` node if split out
- UI renderer: Swagger UI + curl-example panel
- Gates: today's Security gate; build gate (pyright for FastAPI, tsc for Yoga)
- Cross-stack: commits to stable URL/port; sandbox `previewUrl` carries it

### `frontend-app`
- Template: `atlas-next-ts-v2`
- Produces: typed `FrontendArtifact`
- Consumes: upstream backend's `openApiSpec` → generates typed API client via `openapi-typescript`
- UI renderer: today's iframe preview
- Gates: today's Security + A11y + VQ
- Cross-stack: deepPlan sees backend artifact via `priorArtifact.upstream[backendNodeId]`; emits `lib/api-client.ts` from the OpenAPI spec

### `tests`
- Template depends on what's tested: Playwright (frontend e2e), Vitest (unit), pytest (FastAPI backend)
- Produces: typed `TestsArtifact`
- Consumes: every node it tests (declared via `consumes`)
- UI renderer: results panel (pass/fail per spec, runtime, last error)
- New role: `packages/role-tester`. Pass 1 reads upstream artifacts to decide specs; pass 2 emits the test files.
- Sandbox: dedicated per node; installs the test runner; runs against the upstream sandbox `previewUrl`.

### `iac`
- Template (v1): new `atlas-iac-compose` — docker-compose only. Terraform/Pulumi deferred.
- Produces: typed `IacArtifact` with `tool: "compose"`
- Consumes: every runtime node (so it knows what services to declare)
- UI renderer: topology diagram + rendered `docker-compose.yml` in Monaco
- New role: `packages/role-iac`. Emits compose file declaring services per upstream node, env vars from each `envContract`.
- Gate: lint with `docker compose config` inside a sandbox.

### `deploy`
- v1 target: `docker-compose` smoke only. Cloud targets (Fly/Render/k8s) = future specs.
- Produces: typed `DeployArtifact` with `target: "docker-compose"`
- Consumes: `iac` (the compose file) + upstream sandbox URLs to verify smoke endpoints
- UI renderer: deploy status panel (services up/down + smoke results)
- New role: `packages/role-deployer`. Brings up compose in fresh sandbox; hits smoke URLs; records results.
- Failure: smoke fail → node `failed`.

### Kinds in `ArtifactKindSchema` but NOT in v1
- `data-pipeline` (template: `atlas-dlt-python`) — schema + role in future spec
- `mobile-app` (template: `atlas-expo-rn`) — same
- `cli-tool` (template: `atlas-bun-cli`) — same

Engine doesn't need changes for these; just artifact-contracts file additions + canvas-mode-registry entries when their plans land.

---

## 11. Operations & lifecycle controls

### Cancellation / abort
New `abortWorkflow(workflowRunId, reason)` Server Action sets `workflow_runs.status = "aborted"`. Scheduler:
- Stops launching new nodes
- For currently-running nodes: calls new `RitualEngine.abort(ritualId)` which:
  1. Disposes any pending canvas-pause waiter (resolves with `abortRequested: true`)
  2. Sets a "cancelled" flag the conductor checks at every role-attempt boundary → next role start raises `RitualAbortedError`
  3. Persists ritual state as `aborted` (distinct from `failed`)
- In-flight LLM call isn't interrupted (no clean SIGINT to claude.exe/OpenRouter); result is discarded. At most one extra LLM call burned per abort.

### Observability — workflow event log
Already-recorded checkpoints power:
- "History" tab in graph view: chronological timeline (node, kind, ts, payload-summary)
- `getWorkflowEventLog(workflowRunId)` Server Action returning the raw stream
- Existing `spec_events` rows for per-ritual events remain the deeper-dive trail

### Re-running / refinement (v1)
Second cold-start prompt on a project that already has a completed workflow → new `workflow_runs` row. The new workflow's planner can read prior workflows via `priorArtifact.previousWorkflows[id]`. Deeper refinement (mutating a `done` node, partial re-runs) deferred to v2.

### Per-workflow cost cap
- `ATLAS_WORKFLOW_MAX_COST_USD` env var (default unset = uncapped)
- Each LLM call writes to `workflow_usage` (provider, model, tokens, cost)
- Scheduler checks total before launching new node; if cap reached → remaining nodes `blocked` with reason `cost_cap_reached`; workflow → `escalated`
- User views current cost in graph view header; can raise the cap mid-workflow; scheduler resumes
- Pricing table hardcoded in `packages/llm-provider/src/pricing.ts` (refreshable; Anthropic/OpenAI/OpenRouter rates as of ship date)

### Public API surface

**Server Actions** (in `apps/atlas-web/lib/actions/`):
```ts
startBuild({ projectId, prompt, artifactKindHint? })
  → Promise<{ kind: "ritual"; ritualId } | { kind: "workflow"; workflowRunId }>
startWorkflow({ projectId, prompt, suggestedKinds? })
  → Promise<{ workflowRunId }>
approveWorkflowPlan({ workflowRunId, edits? })
  → Promise<void>
retryNode({ workflowRunId, nodeId })
  → Promise<void>
abortWorkflow({ workflowRunId, reason })
  → Promise<void>
setNodePolicy({ workflowRunId, nodeId, policy })
  → Promise<void>
deferNode({ workflowRunId, nodeId })
  → Promise<void>
resumeDeferredNode({ workflowRunId, nodeId })
  → Promise<void>
getWorkflowRun({ workflowRunId })
  → Promise<WorkflowRunSnapshot>
getWorkflowEventLog({ workflowRunId })
  → Promise<WorkflowEvent[]>
```

**`WorkflowEngine` TypeScript API** (`packages/workflow-engine/src/index.ts`):
```ts
class WorkflowEngine {
  constructor(opts: WorkflowEngineOptions)
  async start(input: StartWorkflowInput): Promise<string>
  async approvePlan(workflowRunId, edits?): Promise<void>
  async retryNode(workflowRunId, nodeId): Promise<void>
  async abort(workflowRunId, reason): Promise<void>
  async setNodePolicy(workflowRunId, nodeId, policy): Promise<void>
  async getRun(workflowRunId): Promise<WorkflowRunSnapshot | undefined>
}
```

### Single-node internal execution
A node is one ritual. Inside that ritual, today's role chain runs unchanged: architect (with augmented userTurn from upstream) → researcher → designer → canvas-pause for direction → asset-gen → developer (streaming) → sandbox.apply → per-node gates (Security/A11y/Build/VQ). WorkflowEngine does NOT reach inside a ritual.

### Auth/authz
Workflow actions use the existing `auth()` helper from `@/lib/auth/clerk-compat` (today's pattern). The shim abstracts the underlying provider: today Clerk; per OSS pivot, Keycloak. WorkflowEngine and Server Actions never import an auth provider directly — auth-pivot migration is orthogonal to this spec.

Per-project ACL stays coarse in v1 (today's "owner-or-member" check). Richer Keycloak group/role gating is an auth-pivot follow-up spec.

Service-to-service auth between WorkflowEngine and sandbox/preview URLs reuses today's sandbox session bearer tokens; Keycloak service accounts are a future enhancement.

---

## 12. Generated-app dependency profile

A `DependencyProfile` opinionates which OSS-first services the generated app uses. The workflow planner emits one; downstream nodes consume it via `priorArtifact.dependencyProfile`.

### Default profile — "OSS-first"

| Concern | OSS-first default | Premium fallback (per OSS pivot memory) |
|---|---|---|
| Auth | Keycloak (self-hosted realm) / better-auth | Clerk |
| DB | Postgres (self-hosted via compose) | Neon / Supabase |
| File storage | MinIO (S3-compatible) | S3 |
| Email | Mailpit (dev) / Postal (self-hosted) | Resend / Postmark |
| Background jobs | BullMQ + Redis | Inngest / Trigger.dev |
| Search | Meilisearch | Algolia |
| Error tracking | GlitchTip (Sentry-compatible OSS) | Sentry |
| Analytics | PostHog OSS / Plausible | GA / Mixpanel |
| Payments | Lago (OSS billing) | Stripe |
| Video | Kling (per OSS pivot) | Mux / Cloudflare Stream |
| Feature flags | Unleash OSS | LaunchDarkly |
| LLM | local/Anthropic via API | provider-specific |

### Profile flow
- Planner emits `DependencyProfile` alongside the DAG
- `iac` node uses it to declare compose services
- `backend` node uses it to pick auth library, DB driver, etc.
- `frontend` node uses it to pick client SDKs
- `envContract` artifacts derive env var requirements from it

### Schema
```ts
DependencyProfile = {
  schemaVersion: "1",
  auth: { provider: "keycloak" | "clerk" | "better-auth" | "lucia" | "none", config? }
  db: { provider: "postgres" | "neon" | "supabase", connectionStringEnvVar }
  storage: { provider: "minio" | "s3", bucketEnvVar }
  email: { provider: "mailpit" | "postal" | "resend", apiKeyEnvVar? }
  jobs?: { ... }
  payments?: { provider: "lago" | "stripe" | "none" }
  search?: { ... }
  errorTracking?: { ... }
  analytics?: { ... }
  featureFlags?: { ... }
}
```

### User override during planning
When prompt implies a concern, planner asks via `triage-clarifications`:
*"Auth provider? Default Keycloak (self-hosted, no vendor lock-in) — or pick Clerk / better-auth / Lucia / Auth.js / none-for-now."*
Same for storage, email, payments. User can override the OSS-first defaults; planner records the choice in the emitted profile.

### Per-template binding
Each template carries a `supportedProviders` manifest:
- `atlas-next-ts-v2` knows: Keycloak, Clerk, better-auth, Lucia
- `atlas-fastapi` knows: Keycloak, Authlib
- etc.

Planner validates the profile against the chosen templates' support matrix before approval. Unsupported combos surface as a planner-time error with a suggested swap.

### Per-provider integration is its own plan
This spec defines only the contract. Each provider — "wire Keycloak into atlas-fastapi", "wire MinIO into atlas-next-ts" — is a separate implementation plan.

### Future
- Migration path between providers (e.g., start with Keycloak, switch to Clerk later) — own spec
- User-managed profile library ("save my preferred stack and reuse across projects") — own spec

---

## 13. Testing strategy

Testing the workflow engine itself. Three layers, distinct surfaces.

### Layer 1 — Unit (per-package, Vitest, fast, CI on every PR)
- `packages/workflow-engine/`
  - DAG model: cycle detection, ready-node selection, topological order, priority tie-break
  - Scheduler loop: launches ready nodes, halts dependents on failure, respects deferred runMode, respects opt-in concurrency cap
  - Artifact contracts: per-kind Zod schema validation + rejection of malformed payloads + version-skew detection
  - DependencyProfile: provider validation against template support matrices
  - Checkpoint recorder: synthetic broker events → correct checkpoint rows
  - Failure isolation: failing one node blocks transitive dependents, leaves independents alone
  - Mocking: `RitualEngine` mocked at public API (`start()` resolves with synthetic snapshot)
- `packages/role-tester`, `packages/role-iac`, `packages/role-deployer`
  - Per-role tests in today's `packages/role-architect/test/` style
  - Pure functions tested in isolation
  - `Role.run()` with stub LLM provider returning canned tool_use payloads

### Layer 2 — Integration (workflow + real ritual engine, no LLMs)
- New: `packages/workflow-engine/test/integration.test.ts`
- Real `WorkflowEngine` wired to real `RitualEngine` with stub roles (stub-architect always passes, stub-developer emits canned diff, etc.)
- Scenarios:
  - 2-node DAG (backend → frontend): both run, frontend's `priorArtifact` carries backend's typed artifact
  - 3-node DAG with one failure: failed node halts dependent; independent still completes
  - Planner: triage Q → answer → DAG emission → approval → execution
  - Abort mid-run: in-flight nodes resolve cleanly, no orphaned state
  - Resume: kill process mid-flight, restart, workflow picks up where it left off
- No real LLMs → cheap, fast, deterministic, runs in CI

### Layer 3 — E2E (Playwright, real Postgres, real LLMs gated by flag)
- Extends `apps/atlas-web/e2e/`
- `e2e/tests/workflow-happy.spec.ts` — cold-start → approved DAG → completion → artifacts
- `e2e/tests/workflow-abort.spec.ts` — abort mid-run, verify state
- `e2e/tests/workflow-retry-node.spec.ts` — force a failure, retry from UI, verify success
- `e2e/tests/workflow-graph-view.spec.ts` — graph rendering, drill-in routing, SSE-driven status updates
- LLM-using specs gated by `ATLAS_E2E_REAL_LLM=true` (skipped on default CI to avoid cost). Deterministic ones run on every PR.

### Cross-package contract tests
- `packages/workflow-engine/test/contract-tests/` — small suite against real `RitualEngine` API surface
- If `RitualEngine.start()` signature changes, these fail loudly

### Per-artifact-kind smoke specs
- Each new kind shipped behind `ATLAS_FF_WORKFLOW_KINDS` gets a spec asserting:
  - Role produces a valid typed artifact (Zod validation)
  - Downstream consumers read it correctly via `priorArtifact.upstream`
- E.g., `backend-artifact-shape.spec.ts`

### Fixtures
- `packages/workflow-engine/test/fixtures/` — sample workflow JSON, sample artifacts per kind, sample DAGs (chain, fan-out, fan-in, diamond)

### Explicitly NOT tested
- LLM output quality (model-evaluation problem, not workflow-engine problem)
- Generated app runtime correctness (that's what `tests` artifact kind does — the user's tests)
- Cross-stack provider integrations (Keycloak + atlas-fastapi etc.) — each is covered in its provider's own plan

---

## Appendix: Pause primitives mapping (no new ones invented)

| Workflow event | Existing primitive | Where it ships from |
|---|---|---|
| Planner triage questions | `triage-clarifications` | Plan U slice 3b (2026-05-25) |
| Plan approval (DAG review) | `plan-approval` | Plan UXO Task 7 |
| Per-node design pick | `option-select` | Plan S.4 |

---

## Appendix: New packages this spec adds

| Package | Purpose |
|---|---|
| `packages/workflow-engine/` | Core engine, DAG scheduler, artifact contracts, persistence layer |
| `packages/role-tester/` | Generates `tests` artifact kind |
| `packages/role-iac/` | Generates `iac` artifact kind (compose v1) |
| `packages/role-deployer/` | Executes `deploy` artifact kind (compose smoke v1) |
| `packages/sandbox-e2b/templates/atlas-iac-compose/` | Sandbox template for `iac` node runs |

---

## Appendix: Changes to existing packages

| Package | Change |
|---|---|
| `packages/ritual-engine/` | Add `RitualEngine.abort(ritualId)` + `RitualAbortedError` for cancellation support |
| `packages/conductor/` | Honor "cancelled" flag at role-attempt boundaries |
| `apps/atlas-web/lib/engine/factory.ts` | Construct `WorkflowEngine` alongside `RitualEngine`; wire shared broker/db |
| `apps/atlas-web/lib/actions/` | Add `startBuild`, `startWorkflow`, `approveWorkflowPlan`, `retryNode`, `abortWorkflow`, `setNodePolicy`, `deferNode`, `resumeDeferredNode`, `getWorkflowRun`, `getWorkflowEventLog` |
| `apps/atlas-web/app/projects/[id]/workflow/[workflowId]/` | New route + graph view components |
| `apps/atlas-web/lib/canvas/canvas-mode-registry.ts` | Register per-artifact-kind renderers (Swagger UI for backend, etc.) |
| `apps/atlas-web/lib/feature-flags.ts` | Add `ATLAS_FF_WORKFLOW`, `ATLAS_FF_WORKFLOW_PICKER`, `ATLAS_FF_WORKFLOW_KINDS` |
| `packages/llm-provider/src/pricing.ts` | New file: per-provider/model cost table |
| New Postgres migration | `workflow_runs`, `workflow_nodes`, `workflow_node_checkpoints`, `workflow_usage` tables |
