# Atlas Evals — Design Spec

**Status:** Draft v1 (2026-05-26)

**Goal:** Catch "AI slop" at the boundary that produced it. Every LLM-driven role's output gets evaluated against a typed rubric BEFORE the pipeline moves on; failures auto-retry once with structured feedback embedded in the prompt; if the retry also fails, the ritual escalates with a precise, per-dimension rationale the user can act on.

**Architecture in one paragraph:** Each role package gains an optional `Rubric` that exposes two layers — `structural()` (deterministic Zod/heuristic checks, fast and free) and `judge()` (LLM-as-judge with role-specific criteria). The conductor wraps every role attempt in an eval gate that runs both layers; a single quality-retry passes the failure feedback into the role's next attempt; a second failure throws `RoleEvalEscalation`. Verdicts persist to a new `eval_verdicts` table for audit + replay. One workflow-level rubric runs after multi-artifact workflows complete to catch cross-artifact integration failures that per-role evals can't see. The same rubrics power both inline gating and an offline `evals` CLI that replays them against a golden dataset.

**Tech stack:** TypeScript pnpm monorepo, Drizzle/Postgres (one new table), Zod for verdict schemas, the existing `@atlas/conductor` + `@atlas/llm-provider` + `@atlas/workflow-engine`. New package: `@atlas/eval-runtime` (rubric primitives + CLI).

**Spec philosophy — what's new vs typical eval systems:**
1. **Inline quality gating, not offline regression.** Evals run on every role output in production — slop fails the boundary that produced it. Offline replay is a side benefit, not the primary purpose.
2. **Two layers, fail-fast.** Structural runs first (free); LLM-judge only runs when structural passes. Avoids paying judge tokens for outputs that fail trivial completeness checks.
3. **Retry-with-feedback, not retry-with-hope.** When the rubric fails, the specific failures are embedded in the role's next prompt. The role sees what went wrong and addresses it.
4. **Rubrics co-located with roles.** The team owning a role owns its definition of quality. Conductor stays role-agnostic.
5. **`fixableBy` escape hatch.** The judge can mark a failure `"escalate"` so retry skips for fundamental issues (e.g., user prompt is too vague to plan anything). Saves wasted tokens.
6. **Same rubrics, two callers.** Production rubric IS the test rubric. No duplication, no drift between "what we test" and "what we ship".
7. **Three-layer quality system.** Per-role evals (this spec) + existing post-developer gates (Security/A11y/Build/VQ on the diff — unchanged) + new workflow-level integration eval. Clean separation by concern.

---

## 1. Scope

### In scope (v1)
- New `Rubric<TOutput>` interface in `@atlas/eval-runtime` (new package) and consumed by `@atlas/conductor`
- Hybrid two-layer evaluation: `rubric.structural()` + `rubric.judge()`
- Configurable judge model per role (default haiku-class; per-role override env vars)
- Conductor-level eval gate with 1 quality retry distinct from transient retries
- `evalFeedback` field on `RoleInvocation`; role prompts opt-in to read it
- New error type `RoleEvalEscalation` in `@atlas/conductor`
- New events `role.eval_escalated` + `workflow.eval.failed`
- Rubrics for Architect and Developer in v1 (highest leverage)
- Workflow-level rubric in `@atlas/workflow-engine` (cross-artifact integration check)
- Persistence: `eval_verdicts` Postgres table + `EvalVerdictRepo`
- `EvalCase` schema + `evals` CLI (`build-dataset` + `run` commands) + starter dataset
- UI surfaces: eval-failed cards in ChatPanel; eval-failed banner in workflow graph view
- Server Action `requestWorkflowFix(workflowRunId, dimension)` for the "fix this dimension" buttons

### Out of scope (deferred)
- Rubrics for Researcher, Designer, AssetGen (each gets its own follow-up spec; v1 framework supports them — they ship without rubrics back-compat)
- Continuous monitoring dashboards / drift detection
- CI integration for `evals run` (manual local runs in v1)
- Synthetic case generation
- Refactor of existing post-developer gates (they stay as-is — different concern, mature, tested)
- Tiered judge escalation (cheap → premium on borderline) — could add in a follow-up if borderline cases prove common
- Per-tenant rubric overrides
- Cross-rubric drift detection
- Judge model A/B comparison framework
- Real-user acceptance signal (separate observability spec)

---

## 2. Architecture: rubric as a typed contract

### Updated Role contract (in `@atlas/conductor`)
```ts
interface Role<TOutput = unknown> {
  readonly id: string;
  run(inv: RoleInvocation): Promise<RoleOutput>;
  rubric?: Rubric<TOutput>;
}
```

### Rubric interface (in `@atlas/eval-runtime`)
```ts
interface Rubric<TOutput> {
  readonly roleId: string;
  readonly version: string;          // e.g. "architect@1.2.0"; bump on material changes
  readonly judgeModel?: string;      // optional override; default from env

  structural(output: TOutput, inv: RoleInvocation): StructuralResult;
  judge(
    output: TOutput,
    inv: RoleInvocation,
    llm: LLMProvider
  ): Promise<JudgeResult>;
}

type StructuralResult =
  | { passed: true }
  | { passed: false; failures: Array<{ check: string; reason: string }> };

interface JudgeResult {
  passed: boolean;
  score: number;                     // 0-10 overall
  dimensions: Array<{ name: string; score: number; rationale: string }>;
  fixableBy: "retry" | "escalate";   // judge's hint to the gate
  feedback: string;                  // structured feedback embedded in the retry prompt
}
```

### Two-layer check, fail-fast
1. Conductor runs `rubric.structural(output)` first — zero LLM cost.
2. If structural fails: skip judge. Already a clear failure signal.
3. If structural passes: run `rubric.judge(output)` for the deep semantic check.
4. Either layer can trigger retry-with-feedback.

### Retry-with-feedback flow
1. Role.run() produces output via the existing dispatch loop (with transient retries inside).
2. `rubric.structural(output)` → if `passed:false`, build `EvalFeedback` from failures.
3. Else `rubric.judge(output)` → if `passed:false` AND `fixableBy === "retry"`, build feedback from judge.feedback + dimensions.
4. If retrying: a new `RoleInvocation` with `evalFeedback: EvalFeedback` is passed to `Role.run()`. The role's prompt builder reads this field and prepends:
   ```
   ## Previous-attempt feedback
   Your output failed these checks: [structural failures or judge dimensions].
   Address each point. Do not repeat the same gap.
   ```
5. If the retry also fails (either layer), conductor throws `RoleEvalEscalation` carrying the full verdict.

### Separation from existing concerns
- **Transient retries** (network, parse, malformed JSON): conductor's existing 3-attempt loop — unchanged. Run INSIDE each quality attempt.
- **Eval retries** (LLM output passed transiently but failed quality): NEW 1-attempt loop wrapping the transient one. Total worst-case: 2 × 3 = 6 LLM calls per role per ritual (typically 1 attempt × 1 quality try = 1 call).
- **Post-developer gates** (Security/A11y/Build/VQ on final diff): unchanged. They evaluate the *applied diff*, not role outputs.
- **No rubric = no eval.** Roles without a `rubric` property dispatch today's way exactly. Back-compat for: Plan A's stub planner; Plan B's real planner until its rubric ships; any role beyond Architect+Developer in v1.

---

## 3. Per-role rubric examples (v1 ships these two)

### Architect rubric

**Location:** `packages/role-architect/src/rubric.ts`

**Structural checks:**
- `scope_present` — artifact has a non-empty scope
- `plan_has_tasks` — for new-app scope, `runnablePlan.tasks.length >= 1`
- `canvas_modes` — for frontend/backend artifact kinds, `canvasManifest.modes.length >= 1`
- `graph_slice_hash` — `graphSlice.hash` matches `^sha256:[0-9a-f]{64}$`

**Judge dimensions (each ≥ 6/10 to pass):**
- `intent_coverage` — does the plan actually address what the user asked for?
- `specificity` — concrete enough for the developer to act on?
- `feasibility` — achievable in the current sandbox template?
- `scope_match` — is the scope classification (new-app / edit / bug-fix) correct?

**Default judge model:** `anthropic/claude-haiku-4.5` (env override `ATLAS_EVAL_ARCHITECT_MODEL`).

### Developer rubric

**Location:** `packages/role-developer/src/rubric.ts`

**Structural checks:**
- `diff_present` — `output.diff` non-empty
- `diff_format` — at least one `diff --git ` header
- `new_app_page` — for new-app scope, diff touches at least one `page.tsx`/`page.jsx`
- `summary_meaningful` — summary present and ≥ 20 chars

**Judge dimensions (each ≥ 6/10 to pass):**
- `plan_adherence` — does the diff implement the architect's plan?
- `completeness` — are all promised files / features present?
- `syntactic_plausibility` — does the diff look like valid code (closed braces, balanced JSX)?
- `no_truncation` — specifically catches "page.tsx ran out before closing `}`" slop where the LLM hit max_tokens mid-component

**Default judge model:** `anthropic/claude-sonnet-4.5` — developer output is user-visible, worth premium judge. Env override `ATLAS_EVAL_DEVELOPER_MODEL`.

### Shared infrastructure (in `@atlas/eval-runtime`)
- `JUDGE_TOOL_SCHEMA` — the OpenAI tool-use schema for judge calls (returns the `JudgeResult` shape)
- `formatJudgeFeedback(result)` — builds the structured "## Previous-attempt feedback" prompt fragment
- `shouldRetry(struct, judge)` — pure function: failed structural OR (failed judge AND fixableBy="retry") = true
- `parseVerdict(input)` — Zod-validates LLM output against `JudgeResult` schema

---

## 4. Conductor integration

### Pseudocode (the eval gate wraps the role attempt)

```
async function dispatchWithEval(role, inv):
  for qualityAttempt in [1, 2]:
    output = await runWithTransientRetries(role, inv)  // existing 3-attempt loop unchanged

    if !role.rubric:
      return output                                     // back-compat path

    struct = role.rubric.structural(output, inv)
    if !struct.passed:
      await verdictSink.write(structuralVerdict(struct, attempt=qualityAttempt))
      if qualityAttempt === 1:
        inv = { ...inv, evalFeedback: feedbackFromStructural(struct) }
        continue
      throw new RoleEvalEscalation({ layer: "structural", verdict: struct, attempts: 2 })

    judge = await role.rubric.judge(output, inv, llm)
    await verdictSink.write(judgeVerdict(judge, attempt=qualityAttempt))

    if !judge.passed:
      if qualityAttempt === 1 && judge.fixableBy === "retry":
        inv = { ...inv, evalFeedback: feedbackFromJudge(judge) }
        continue
      throw new RoleEvalEscalation({ layer: "judge", verdict: judge, attempts: qualityAttempt })

    return output
```

### Key design notes
- **`evalFeedback`** is a new field on `RoleInvocation`. Each role's prompt builder reads it (existing pattern from Plan U slice 3b clarifications + Plan L fix-mode).
- **`judge.fixableBy === "escalate"`** is the judge's escape hatch — for fundamental issues, no retry.
- **`RoleEvalEscalation`** (new error in `@atlas/conductor/src/errors.ts`) carries the full verdict so the engine surfaces a precise rationale.
- **Engine-side handling:** `_runRitual` catches `RoleEvalEscalation` and converts to a `role.eval_escalated` event with the verdict in payload.
- **Quality retries tracked separately:** the existing `role.retrying` event grows a `kind: "transient" | "eval"` field.
- **Verdict persistence:** conductor calls an injected `verdictSink.write(verdict)` — mock-friendly for tests; factory wires the real `EvalVerdictRepo` adapter.

---

## 5. Workflow-level eval

### Purpose
Catch failures per-role evals can't see — where every node passed individually but the integrated artifacts don't form a coherent product. Example: frontend's `api-client.ts` calls `/api/billing/*` but backend doesn't expose those routes.

### Location
`packages/workflow-engine/src/workflow-rubric.ts`. Single rubric — integration is integration-level, not per-artifact-kind.

### When it runs
In `WorkflowScheduler` after the last DAG node terminates AND no node failed. Skip if any node already failed (workflow already in `escalated` state — no point burning judge tokens).

### Inputs to the judge
- Original user prompt (from `workflow_runs.prompt`)
- The user's approved plan summary (from `workflow_planner` node's emitted DAG + rationale)
- Compact summary of each node's artifact (NOT the full artifact — too large): backend's route list + envContract; frontend's pages + apiClientFile presence; tests' pass/fail counts; iac's service list; deploy's smoke results
- The workflow's `DependencyProfile`

### Judge dimensions (each ≥ 6/10 to pass)
- `prompt_satisfaction` — does the integrated stack address the user's prompt?
- `cross_artifact_consistency` — do artifacts reference each other correctly?
- `completeness` — anything obvious missing (e.g., user asked for billing but no payments artifact)?
- `stack_coherence` — does the chosen DependencyProfile actually compose?

### Default judge model
`anthropic/claude-sonnet-4.5` — premium because integration analysis matters. Env override `ATLAS_EVAL_WORKFLOW_MODEL`.

### On failure
- Workflow status → `escalated` (not `completed`)
- New event `workflow.eval.failed` with full verdict
- UI: graph view header banner with per-dimension rationale and "Fix: re-run X" buttons (Section 8)
- New Server Action `requestWorkflowFix(workflowRunId, dimension)` — kicks off `retryNode` for the node the judge identified as responsible

### Skip conditions
- Any node already failed (workflow already escalated)
- Single-node workflow (per-role eval already covered it)
- Flag `ATLAS_FF_WORKFLOW_EVAL=false` (escape hatch for cost-sensitive deployments)

### Cost
~$0.05–0.15 per workflow completion. Tracked via Plan G's `workflow_usage` accumulator (the judge call goes through the same instrumentation hook as any other LLM call).

---

## 6. Persistence

### New table: `eval_verdicts`

```sql
create table if not exists eval_verdicts (
  id uuid primary key default gen_random_uuid(),

  -- What was evaluated
  ritual_id text not null,
  role_id text not null,                    -- "architect" | "developer" | "workflow"
  workflow_run_id uuid,                     -- set inside a workflow node
  workflow_node_id text,                    -- set alongside workflow_run_id
  project_id uuid not null,
  user_id text not null,

  -- The verdict
  attempt integer not null,                 -- 1 = first try, 2 = quality retry
  layer text not null,                      -- "structural" | "judge" | "workflow"
  passed boolean not null,
  score numeric(4,2),                       -- judge's overall 0-10; null for structural
  dimensions jsonb,                         -- judge's per-dimension scores+rationales
  failures jsonb,                           -- structural failures array
  fixable_by text,                          -- "retry" | "escalate"
  feedback_used jsonb,                      -- the EvalFeedback embedded in retry prompt

  -- Inputs (for replay)
  user_turn text,
  prior_artifact_hash text,                 -- sha256 of priorArtifact JSON
  output_hash text,                         -- sha256 of role output JSON

  -- Reproducibility
  rubric_version text not null,
  judge_model text,
  judge_input_tokens integer,
  judge_output_tokens integer,
  judge_cost_usd numeric(8,4),

  created_at timestamptz not null default now()
);

create index idx_eval_verdicts_ritual on eval_verdicts (ritual_id, created_at);
create index idx_eval_verdicts_role on eval_verdicts (role_id, passed, created_at);
create index idx_eval_verdicts_workflow on eval_verdicts (workflow_run_id, workflow_node_id) where workflow_run_id is not null;
create index idx_eval_verdicts_project on eval_verdicts (project_id, created_at);
create index idx_eval_verdicts_replay on eval_verdicts (role_id, prior_artifact_hash);
```

### Repo
`EvalVerdictRepo` in `packages/spec-graph-data/src/repo/eval-verdict.repo.ts`. Methods:
- `insert(verdict): Promise<void>`
- `findByRitual(ritualId): Promise<EvalVerdictRow[]>`
- `findFailuresForRole(roleId, limit): Promise<EvalVerdictRow[]>`
- `findUniqueByInputHash(roleId, priorArtifactHash, userTurn): Promise<EvalVerdictRow[]>` — for offline-replay dedup

### Sizing & retention
- ~80 rows/day at 10 rituals × 6 roles × 1.2 attempts + 10 workflow rolls. Negligible storage.
- v1 retains everything. TTL/archive is a future spec.

### Cross-cut with Plan G's `workflow_usage`
The judge call's tokens + cost flow through the existing instrumentation hook to `workflow_usage`. `eval_verdicts.judge_cost_usd` is a denormalized read-side copy for per-verdict queries without a join.

---

## 7. Offline replay

### EvalCase schema

```ts
interface EvalCase {
  id: string;                          // stable UUID
  roleId: string;
  rubricVersion: string;               // pin the version
  inputs: {
    userTurn: string;
    priorArtifact?: unknown;
    graphSlice?: { bytes: string; hash: string };
  };
  output: unknown;
  expected: {
    passed: boolean;
    minScore?: number;
    requiredDimensions?: Array<{ name: string; minScore: number }>;
  };
  notes?: string;                      // why this case exists
}
```

### Storage
Flat JSON files at `packages/eval-runtime/cases/<roleId>/<id>.json`. Git-tracked. Reviewable in PRs.

### `evals build-dataset` CLI
- Queries `eval_verdicts` for the last N rituals
- Dedups by `(roleId, prior_artifact_hash, output_hash)`
- Renders each verdict as an `EvalCase` JSON with the recorded verdict as `expected`
- Writes to `cases/<roleId>/<id>.json`
- Idempotent (skips existing cases)
- The user reviews generated cases (especially failures — most valuable to keep) before committing

### `evals run` CLI
- Loads cases from `cases/<roleId>/`
- For each case: runs `rubric.structural()` and `rubric.judge()` on the saved output (no `role.run()` needed — output is already in the case)
- Compares result to `case.expected`
- Reports: total, passed, regressed (was passing → now failing), surprisingly-fixed (was failing → now passing)
- Non-zero exit code if any regressions

### Versioning
- Rubrics export a `version` field
- Cases pin their `rubricVersion`
- Runner can skip mismatched-version cases OR re-judge them (CLI flag)

### v1 ships
- `EvalCase` Zod schema (validated on load)
- `evals build-dataset` CLI
- `evals run` CLI
- Starter dataset: 5–10 hand-curated architect cases + 5–10 developer cases

### Out of scope for v1
- CI integration (next-day work; user runs locally)
- Cross-rubric diff reports
- Dataset versioning / branching
- Synthetic case generation

---

## 8. UX: failure surfaces

### Single-ritual mode (ChatPanel)
When a role's eval fails after retry, `roleEvents` contains `role.eval_escalated` with the verdict. ChatPanel renders a red card:

```
┌────────────────────────────────────────────────┐
│ ⚠ Architect output failed quality check        │
│                                                │
│ Specific failures:                             │
│ • plan_has_tasks: runnablePlan.tasks is empty  │
│ • intent_coverage (3/10): Plan doesn't address │
│   the user's request to support file uploads   │
│                                                │
│ Retry attempted once with feedback. Failed     │
│ both times.                                    │
│                                                │
│ [Retry with my edits]  [Edit prompt & restart] │
└────────────────────────────────────────────────┘
```

Action buttons:
- **Retry with my edits** — opens a textarea pre-filled with failed dimensions; submits as `refineRitual`.
- **Edit prompt & restart** — copies original prompt to main input box.

### Workflow mode (graph view)
- **Per-node failure** — node card turns red. Drill-in shows verdict at top of per-node view, above existing per-ritual UI.
- **Workflow-level failure** — graph header gets a red banner:

```
┌────────────────────────────────────────────────────────┐
│ ⚠ Workflow integration failed                          │
│                                                        │
│ Failed dimensions:                                     │
│ • cross_artifact_consistency (4/10) — frontend calls   │
│   /api/billing/* but backend does not expose them      │
│   → likely fix: re-run frontend or backend node        │
│                                                        │
│ • completeness (5/10) — user asked for auth but no    │
│   auth provider is wired in iac compose file           │
│   → likely fix: re-run iac node                        │
│                                                        │
│ [Fix: re-run frontend]  [Fix: re-run iac]              │
│ [Open Workflow Plan]                                   │
└────────────────────────────────────────────────────────┘
```

Each "Fix: re-run X" calls `requestWorkflowFix(workflowRunId, dimension)` → kicks off `retryNode` for the affected node.

### SSE events
- `role.eval_escalated` — per-role failure after retry
- `workflow.eval.failed` — workflow-level integration failure

Both carry the full verdict (`{ layer, dimensions, failures, fixableBy, attemptCount, ritualId, nodeId? }`). UI renders verbatim — no further LLM call needed.

### NOT in v1
- Aggregate pass-rate dashboards
- Per-dimension drift detection
- Per-judge cost rollups (already in Plan G's workflow_usage)

---

## 9. Testing strategy

### Layer 1 — Unit (Vitest, per-package, fast, every PR)
- `packages/eval-runtime/`: Rubric interface conformance; `formatJudgeFeedback`; `shouldRetry`; `EvalCase` Zod schema
- `packages/role-architect/test/rubric.test.ts`: structural happy/sad paths; judge with stub LLM
- `packages/role-developer/test/rubric.test.ts`: same shape
- `packages/conductor/test/eval-gate.test.ts`: dispatch retries on first-fail/second-pass; throws `RoleEvalEscalation` on fail-twice; respects `fixableBy: "escalate"`; back-compat (no rubric → today's behavior)

### Layer 2 — Integration (real conductor + real role + stub LLM)
- `packages/conductor/test/eval-integration.test.ts` — real ArchitectRole with stub LLM scripted to fail first/pass second; verify verdicts persisted and second attempt got `evalFeedback`
- `packages/workflow-engine/test/eval-integration.test.ts` — 2-node workflow with intentionally inconsistent outputs; workflow-level judge stub returns failure; assert `workflow.eval.failed` event + escalation

### Layer 3 — E2E (Playwright, real LLMs gated by `ATLAS_E2E_REAL_LLM=true`)
- `apps/atlas-web/e2e/tests/eval-failure-surfaces.spec.ts` — eval-failed card renders with correct rationale + working action buttons
- `apps/atlas-web/e2e/tests/workflow-eval-failure.spec.ts` — workflow-level red banner + "Fix: re-run X" calls `requestWorkflowFix`

### Layer 4 — Self-eval (the rubrics test themselves via the CLI)
- `pnpm evals run --role architect` runs against starter dataset in CI smoke check
- `pnpm evals run --role developer` same
- Rubric authors expand the starter set as edge cases emerge

### NOT in v1
- Judge model stability across versions (drift detection — future spec)
- Cross-rubric coupling tests
- Production-traffic eval analytics

---

## Appendix A — New events on the SSE stream

| Event | Layer | Payload |
|---|---|---|
| `role.eval_escalated` | Conductor (engine forwards) | `{ ritualId, roleId, verdict: { layer, dimensions, failures, fixableBy, attemptCount } }` |
| `workflow.eval.failed` | WorkflowEngine | `{ workflowRunId, verdict: { dimensions, fixableBy } }` |
| `role.retrying` (extended) | Conductor | existing fields + `kind: "transient" \| "eval"` |

## Appendix B — New packages & files

| Package / file | Purpose |
|---|---|
| `packages/eval-runtime/` (new) | `Rubric` interface, `JudgeResult` Zod schema, shared judge tool schema, `formatJudgeFeedback`, `shouldRetry`, `parseVerdict`, `EvalCase` schema, the `evals` CLI |
| `packages/role-architect/src/rubric.ts` (new) | Architect rubric (structural + judge) |
| `packages/role-developer/src/rubric.ts` (new) | Developer rubric |
| `packages/workflow-engine/src/workflow-rubric.ts` (new) | Workflow-level rubric |
| `packages/conductor/src/conductor.ts` (modify) | Eval gate around the dispatch loop |
| `packages/conductor/src/errors.ts` (modify) | `RoleEvalEscalation` |
| `packages/spec-graph-data/src/schema/eval-verdicts.ts` (new) | Drizzle schema |
| `packages/spec-graph-data/src/repo/eval-verdict.repo.ts` (new) | `EvalVerdictRepo` |
| `packages/spec-graph-data/drizzle/0010_eval_verdicts.sql` (new) | Migration |
| `apps/atlas-web/lib/actions/requestWorkflowFix.ts` (new) | Server Action for "Fix: re-run X" buttons |
| `apps/atlas-web/components/ritual/EvalFailedCard.tsx` (new) | Single-ritual eval-failed surface |
| `apps/atlas-web/components/workflow/WorkflowEvalFailedBanner.tsx` (new) | Workflow-level banner |
| `apps/atlas-web/lib/events/EventBroker.ts` (modify) | Add `role.eval_escalated` + `workflow.eval.failed` to the type union |
| `apps/atlas-web/lib/engine/factory.ts` (modify) | Wire `EvalVerdictRepo` into the conductor's `verdictSink` |

## Appendix C — Feature flags

| Flag | Default | Effect when OFF | Effect when ON |
|---|---|---|---|
| `ATLAS_FF_EVALS` | `false` | Roles dispatch today's way; rubrics on roles are ignored | Conductor runs the eval gate; rubrics fire |
| `ATLAS_FF_WORKFLOW_EVAL` | `false` | Workflow completes without integration check | Workflow-level rubric runs after node completion |
| `ATLAS_EVAL_ARCHITECT_MODEL` | `anthropic/claude-haiku-4.5` | n/a | Override architect judge model |
| `ATLAS_EVAL_DEVELOPER_MODEL` | `anthropic/claude-sonnet-4.5` | n/a | Override developer judge model |
| `ATLAS_EVAL_WORKFLOW_MODEL` | `anthropic/claude-sonnet-4.5` | n/a | Override workflow judge model |

v1 ships with the master flag OFF in production. Internal testing flips it on; rollout follows Plan B's pattern (flag-gated, additive, fail-safe to today's behavior).

---

## Appendix D — Rollout sequence
1. Land `@atlas/eval-runtime` package + `eval_verdicts` migration + repo (no role rubrics yet, ATLAS_FF_EVALS off)
2. Land architect rubric + conductor eval-gate plumbing (still flag-off in prod; tests pass with flag-on)
3. Land developer rubric
4. Land workflow-level rubric + UI banner
5. Hand-curate starter eval cases + verify `evals run` works locally
6. Flip `ATLAS_FF_EVALS=true` in dev; run real rituals; tune rubrics
7. Flip in prod once tuned; monitor `eval_verdicts` for false-positive rate
8. Follow-up specs: Researcher rubric, Designer rubric, AssetGen rubric, CI integration for `evals run`, drift detection
