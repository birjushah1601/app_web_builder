# Atlas Implementation Plans

Execution-ready plans (task-level TDD) for imminent work, plus directional roadmaps for work that is further out.

Paired with:
- **PRD:** `docs/ATLAS_PRD.md` — the what + why
- **Architecture reference:** `docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md` — the how, at the deep-design level

Plans are the how, at the **task level**. Each executable plan decomposes a deliverable into TDD-shaped tasks that a skilled engineer who has zero context for our codebase can follow end-to-end.

---

## Plan index

| # | File | Plan | Scope | Shape | Status |
|---|---|---|---|---|---|
| 1 | `2026-04-18-spec-graph-data-layer.md` | **A.1 — Spec Graph data layer** | Postgres schema (`spec_graphs`, `spec_events`, `spec_snapshots`), RLS tenant isolation, typed repos, observability | 21 tasks, TDD | Shipped (merged 398c539) |
| 2 | `2026-04-18-spec-graph-sync-daemon.md` | **A.2 — File ↔ mirror sync daemon** | chokidar file watcher → `@atlas/spec-graph-data` repos; bidirectional with feedback-loop prevention; CLI entry | 14 tasks, TDD | Shipped (merged 05bf3c8) |
| 3 | `2026-04-18-spec-graph-merge-driver.md` | **A.3 — Custom Git merge driver** | `.gitattributes`-registered driver; line-union for `events.jsonl`, mirror-first + structural fallback for `spec.graph.json`; install/uninstall commands | 15 tasks, TDD | Shipped (merged edd3769) |
| 4 | `2026-04-18-spec-graph-compaction-offline.md` | **A.4 — Compaction + offline mode** | snapshot+tail compactor, Postgres advisory lock, cold-storage (FS + S3); `atlas-offline` tar.gz export/import; closes Unit A | 15 tasks, TDD | Shipped (merged cef6a41) |
| 5 | `2026-04-19-spec-graph-schema.md` | **B.1 — Spec Graph Schema** | TS types, Zod schemas, 14 invariants, JSON Schema artifact | 43 tasks, TDD | Shipped (merged c7ab760) |
| 6 | `2026-04-20-spec-graph-schema-py.md` | **B.2 — Python bindings** | Pydantic v2 models generated from the JSON Schema; structural validator; drift check | 17 tasks, TDD | Shipped (merged e412268) |
| 7 | `2026-04-20-skill-runtime.md` | **C.1 — Skill Runtime** | TS package: skill frontmatter parser, `SkillRegistry`, `IntentClassifier` interface (mocked in C.1, real in D.1), composes-graph resolver, pin.json version check | 20 tasks, TDD | Shipped (merged 78bdd79) |
| 8 | `2026-04-20-skill-library.md` | **C.2 — Starter Skill Library + OSS pipeline** | 40 markdown skills grouped by role; frontmatter validator + CI; tag-push release workflow; real `loadBundledSkills()` | 18 tasks, TDD | Shipped (merged d163544) |
| 9 | `2026-04-20-conductor-llm-abstraction.md` | **D.1 — Conductor + LLM Provider Abstraction** | `@atlas/llm-provider` (Anthropic + Google stub, retry, circuit breaker, OTel + Prom metrics) and `@atlas/conductor` (thin dispatcher, 3-tier prompt-cache, graph-slice hash, checkpoint-based retry, escalation) | 22 tasks, TDD | Shipped (merged d641404) |
| 10 | `2026-04-20-role-architect.md` | **D.2 — Architect role** | Two-pass ritual-authoring: Haiku triage (ambiguity report) → Opus deep plan (scope-variant output); implements `Role` from `@atlas/conductor`; `llm-provider` `completeWithToolUse` extension | 18 tasks, TDD | Shipped (merged 8d59190) |
| 11 | `2026-04-21-role-developer.md` | **D.3 — Developer role (parallel Sonnet+Gemini + Reviewer voting)** | Parallel two-provider code-gen + Reviewer pass; real `GoogleProvider` (Gemini SDK + tool-use); walkover semantics + BothProvidersFailedError | 17 tasks, TDD | Shipped (merged e8a7902) |
| 11b | `2026-04-21-role-security.md` | **D.4 — Security role (L4 merge gate)** | Dual-interface: `Role` + `GateRunner`; Opus 4.7; 4 composed skills (audit-rls, cors-policy, secrets-scan, cve-check); `SecurityReport` with critical→passed=false constraint; concrete L4 runner for G.1 scheduler | 13 tasks, TDD | Shipped (merged ccccd7d) |
| 12 | `2026-04-20-ritual-engine.md` | **E.1 — Ritual Engine (headless)** | RitualEngine state machine for Visualize→Agree→Build, persona-tiered approval, RiskAccepted Zod with persona gate, cosmetic-edit fast path | 16 tasks, TDD | Shipped (merged d8f1808) |
| 12 | `2026-04-20-bootstrap-checkpoint.md` | **F.1 — Bootstrap Checkpoint + Risk-Accept Gates** | 6-item per-project sanity checklist intercepting first ritual; persona-tiered renderer; bootstrap_checkpoints DB table; escalation_requested escape hatch | 16 tasks, TDD | Shipped (merged 272e73d) |
| 13 | `2026-04-20-edit-classifier-gate-scheduler.md` | **G.1 — Edit Classifier + Gate Scheduler** | Deterministic edit-tier classifier (cosmetic/structural/SC-touching); sync-async gate scheduler per PRD §11.4; auto-rollback on critical issues; 3 user resolutions (retry/undo/risk-accept) | 20 tasks, TDD | Shipped (merged 5585f69 + c2641bb follow-up) |
| 14 | `2026-04-20-latency-harness.md` | **G.2 — Latency Harness + Regression Alerting** | Per-tier P50/P95 sliding-window measurement; Prometheus histogram export; budget alerts on N consecutive over-budget windows | 11 tasks, TDD | Shipped (merged 0006100) |
| 15 | `2026-04-20-atlas-web-canvas.md` | **E.2 — Atlas Web Scaffold + Canvas view** | Next.js 15 + Clerk + Tailwind + React Flow Canvas; Server Actions for start/approve/accept-risk/escalate; persona toggle (per-project override); Code view stub for E.3 | 19 tasks, TDD | Shipped (merged 73c3fbd + 58f7bd4 follow-up) |
| 16 | `2026-04-20-atlas-web-code-monaco.md` | **E.3 — Atlas Web Code view + Monaco** | Monaco editor wrapper, file tree, PR pane (Octokit), terminal + test runner stubs (E.4 wires real sandbox) | 17 tasks, TDD | Shipped (merged 6142fa0) |
| 17 | `2026-04-20-e2b-sandbox-preview.md` | **E.4 — E2B Sandbox + Preview** | `packages/sandbox-e2b/` (SandboxLifecycle/FileSystem/Exec/Preview + spend-cap helper) + atlas-web HMR iframe, viewport toggle, shareable URL, terminal + test runner sandbox wiring | 21 tasks, TDD | Shipped (merged 9f31e9a) |
| 18 | `2026-04-20-ritual-integration-tests.md` | **E.5 — Ritual Integration Tests** | Playwright e2e for Ama/Diego/Priya flows; bootstrap-checkpoint exercise; latency assertion; drift recovery; PR + multi-viewport | 16 tasks, e2e | Shipped (merged 7c001ee) |
| 19 | `2026-04-18-phase-a-units-b-through-g.md` | **Phase A Units B–G** directional | Schema+Validation (B), Skill Framework (C), Conductor+Roles (D), Ritual+UX (E), Bootstrap checkpoint (F), Edit-tiering (G) | Milestone-level; sub-plans authored at T-minus-3-weeks | Directional |
| 20 | `2026-04-18-phases-b-through-f-roadmap.md` | **Phases B–F** directional | Build polish + Migrate alpha (B), Run GA (C), Sovereign (D), Migrate GA (E), Brownfield (F) | Milestone-level with entry/exit criteria | Directional |

---

## Phase A Exit Checklist

Phase A is complete when ALL of the following plans are merged to `main`:

- [x] A.1 — Spec Graph data layer (`398c539`)
- [x] A.2 — File ↔ mirror sync daemon (`05bf3c8`)
- [x] A.3 — Custom Git merge driver (`edd3769`)
- [x] A.4 — Compaction + offline mode (`cef6a41`)
- [x] B.1 — Spec Graph Schema (`c7ab760`)
- [x] B.2 — Python bindings (`e412268`)
- [x] C.1 — Skill Runtime (`78bdd79`)
- [x] C.2 — Starter Skill Library + OSS pipeline (`d163544`)
- [x] D.1 — Conductor + LLM Provider Abstraction (`d641404`)
- [x] D.2 — Architect role (`8d59190`)
- [x] D.3 — Developer role (parallel Sonnet+Gemini + Reviewer voting) (`e8a7902`)
- [x] D.4 — Security role (L4 merge gate) (`ccccd7d`)
- [x] E.1 — Ritual Engine (headless) (`d8f1808`)
- [x] E.2 — Atlas Web Scaffold + Canvas view (`73c3fbd` + `58f7bd4`)
- [x] E.3 — Atlas Web Code view + Monaco integration (`6142fa0`)
- [x] E.4 — E2B Sandbox + Preview (`9f31e9a`)
- [x] **E.5 — Ritual Integration Tests** ← final Phase A gate (`7c001ee`)
- [x] F.1 — Bootstrap Checkpoint + Risk-Accept Gates (`272e73d`)
- [x] G.1 — Edit Classifier + Gate Scheduler (`5585f69` + `c2641bb`)
- [x] G.2 — Latency Harness + Regression Alerting (`0006100`)

When all boxes are checked: cut the `phase-a/complete` tag on `main` and open the Phase B kickoff issue.

---

## Execution order

### Phase A — immediate

```
A.1 (Plans[1])
  ├─ A.2 (Plans[2])  ─┬─ A.3 (Plans[3])
  │                    └─ A.4 (Plans[4])
  └─ Unit B — Schema & Validation
       ├─ B.1 (Plans[5], shipped)
       └─ B.2 (Plans[6], shipped)
            ├─ C.1 (Plans[7], shipped) — Skill Runtime
            │    └─ C.2 (Plans[8], shipped) — Starter Skill Library
            │         └─ C.3 — Test-Generator Registry (after C.2)
            └─ D.1 (Plans[9], shipped) — Conductor + LLM Provider
                 ├─ D.2 (Plans[10], shipped) — Architect role
                 ├─ Unit C continues — C.2 + C.3 (from Plans[11] Unit C)
                 └─ Unit D continues — D.3..D.5 role plans (from Plans[11] Unit D)
                      └─ E.1 (Plans[11], shipped) — Ritual Engine (headless)
                           ├─ F.1 (Plans[12]) — Bootstrap Checkpoint + Risk-Accept Gates
                           ├─ G.1 (Plans[13]) — Edit Classifier + Gate Scheduler
                           │    └─ G.2 (Plans[14]) — Latency Harness + Regression Alerting
                           └─ Unit E — Ritual + UX
                                ├─ E.2 (Plans[15]) — Atlas Web Scaffold + Canvas view
                                ├─ E.3 (Plans[16]) — Atlas Web Code view + Monaco      ← shipped
                                ├─ E.4 (Plans[17]) — E2B Sandbox + Preview (after E.2 + E.3) ← shipped
                                │    └─ E.5 (Plans[18]) — Ritual Integration Tests (after E.4)
                                │         Note: E.5 should mock SandboxFactory.getOrProvision at the
                                │         Next.js API boundary (fixed previewUrl) — no real E2B in e2e.
                                └─ E.5 depends on E.4 for the live-preview iframe assertion in "Build" step
```

- **A.1 is the critical path.** Start here. Nothing else begins until `@atlas/spec-graph-data` is published.
- **A.2, A.3, A.4 can partially overlap** once A.1 is green. A.2 and A.4 share `spec-graph-data` as their dependency and do not touch each other's packages; they can be done by two engineers in parallel if bench size allows. A.3 does not depend on A.2 but is best authored *after* A.2's write-token + observability patterns are established.
- **Unit B (schema + validators)** can start as soon as A.1 is green; its detailed plan should be authored when A.2 is landing (≈ 3 weeks into Phase A).
- **Units C and D** are authorable once Unit B lands.
- **Unit E** is authored once D.1 is green.
- **Unit F** is authored during E's late tasks.
- **Unit G** authored after F.

### After Phase A

Phase B–F roadmap (Plans[12]) is the guide for the next 18+ months. Task-level plans for phases B and beyond are **intentionally not yet written** — their requirements will shift meaningfully as Phase A reveals real constraints. Authoring cadence:

> **Write each unit's plan when execution is ≤ 3 weeks away.**

Writing Phase E (2027) task-level plans today is false precision. The PRD + roadmaps carry enough signal for hiring, partnerships, capital, and communication decisions; task-level plans are execution tools, not strategy documents.

---

## Format conventions (for plan authors)

All executable plans in this directory follow the same structure. Match `2026-04-18-spec-graph-data-layer.md` (Plan A.1) as the canonical style reference:

- **Header:** "For agentic workers" line + Goal + Architecture + Tech Stack + Prerequisites
- **File Structure section:** tree of files the plan creates or modifies, with one-line annotations
- **Database / API Design section** (where relevant): tables, schemas, wire contracts
- **Task list:** numbered tasks. Each task has Files (Create/Modify/Test), then 5–8 Steps following the TDD shape:
  1. Write the failing test (complete code in the step, no "similar to")
  2. Run test to verify it fails (exact command + expected output)
  3. Write minimal implementation (complete code)
  4. Run test to verify it passes (exact command + expected output)
  5. Commit (exact `git add` + `git commit -m` with Conventional Commits prefix)
- **Completion Checklist** at the end
- **Handoff section** pointing to the next plan in the chain

No placeholders. No "TODO", "TBD", "similar to Task N", "handle edge cases". Every step is runnable on its own.

See the Writing Plans skill (`superpowers:writing-plans`) for the full rubric.

---

## Execution tools

Once a plan is ready, execute it via one of two skills:

**Subagent-driven (recommended for long plans):**
`superpowers:subagent-driven-development` — dispatches a fresh subagent per task with a clean context window. Two-stage review between tasks. Best for plans with 15+ tasks where you want fast iteration + careful review.

**Inline (recommended for short plans):**
`superpowers:executing-plans` — runs tasks inline in the current session with checkpoints. Best for plans with ≤ 15 tasks where context budget allows.

Both skills parse the plan's checkbox tasks (`- [ ]`) and track progress.

---

## Spec ↔ plan ↔ code loop

```
PRD (what + why)
  ↓
Spec Graph Design Doc (how, deep)
  ↓
Directional Roadmap (when + sequence)
  ↓
Unit Plan (how, near-term, task-level)
  ↓
Execution (subagent-driven-development or executing-plans)
  ↓
Lessons → PRD §21 risk register
         → Roadmap milestones (refinements)
         → Skill library (patterns captured as reusable skills)
```

Keep this loop tight. Plans that go unexecuted for more than a sprint are probably ready to be re-authored. PRDs that don't get updated after phase learnings are probably wrong.

---

## Ownership

Plans live in this directory under revision control. Each plan has a filename-embedded authoring date for provenance. Updates happen via:

- **Minor corrections** (typo, missing step): amend-and-commit on the same file.
- **Major restructure** (tasks re-grouped, dependencies change): supersede with a new file (e.g., `2026-05-03-spec-graph-data-layer-v2.md`) and mark the old file's header as **SUPERSEDED** with a pointer.

Archive location (if the old plan is kept at all): `docs/superpowers/plans/archive/`.
