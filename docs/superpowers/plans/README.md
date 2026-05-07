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
| 8a | `2026-04-21-test-generator-registry.md` | **C.3 — Test-Generator Registry + Human Baselines** | Node-kind → generator-skill index; HumanBaselineStore loads `.atlas/baselines/*.yaml`; invokeGenerator injects baselines for AuthBoundary + PII-Model + ComplianceClass (I13-aligned); DriftDetector with SHA-256 pinning; CLI for baseline list/show + drift check | 16 tasks, TDD | Shipped (merged c471d9a) |
| 9 | `2026-04-20-conductor-llm-abstraction.md` | **D.1 — Conductor + LLM Provider Abstraction** | `@atlas/llm-provider` (Anthropic + Google stub, retry, circuit breaker, OTel + Prom metrics) and `@atlas/conductor` (thin dispatcher, 3-tier prompt-cache, graph-slice hash, checkpoint-based retry, escalation) | 22 tasks, TDD | Shipped (merged d641404) |
| 10 | `2026-04-20-role-architect.md` | **D.2 — Architect role** | Two-pass ritual-authoring: Haiku triage (ambiguity report) → Opus deep plan (scope-variant output); implements `Role` from `@atlas/conductor`; `llm-provider` `completeWithToolUse` extension | 18 tasks, TDD | Shipped (merged 8d59190) |
| 11 | `2026-04-21-role-developer.md` | **D.3 — Developer role (parallel Sonnet+Gemini + Reviewer voting)** | Parallel two-provider code-gen + Reviewer pass; real `GoogleProvider` (Gemini SDK + tool-use); walkover semantics + BothProvidersFailedError | 17 tasks, TDD | Shipped (merged e8a7902) |
| 11b | `2026-04-21-role-security.md` | **D.4 — Security role (L4 merge gate)** | Dual-interface: `Role` + `GateRunner`; Opus 4.7; 4 composed skills (audit-rls, cors-policy, secrets-scan, cve-check); `SecurityReport` with critical→passed=false constraint; concrete L4 runner for G.1 scheduler | 13 tasks, TDD | Shipped (merged ccccd7d) |
| 11c | `2026-04-21-role-accessibility.md` | **D.5 — Accessibility role (L5 merge gate)** | Dual-interface: `Role` + `GateRunner`; Sonnet 4.6; 4 composed skills (wcag-audit, rtl-layout, keyboard-nav, contrast-check); `AccessibilityReport` with critical→passed=false constraint; concrete L5 runner for G.1 scheduler | 13 tasks, TDD | Shipped (merged ac6edcb) |
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
| 21 | `2026-04-21-spec-graph-v1.1-infra-nodes.md` | **B-1 — Spec Graph v1.1 infra nodes** | 5 new node kinds (Region, DataResidency, Runtime, Provider, WorkloadTopology) + 3 edges (runsOn, storesDataIn, migratesTo) + 2 invariants (I15, I16); schemaVersion enum for backward compat | 15 tasks, TDD | Shipped (merged 0fd9c54) |

---

## Phase B plans

Phase B is **in progress** (kicked off 2026-04-21). Plans are authored as each milestone nears execution.

- [x] B-1 — Spec Graph v1.1 infra nodes (`0fd9c54`)
- [ ] B-2 — cloud_migration monorepo fusion (multi-session, deferred)
- [x] B-3 — AST visual edit mode skeleton (`ba142a1`); concrete TS Compiler mapper deferred (D8)
- [x] B-4 — Additional E2B templates (`3d2fd7a`)
- [ ] B-5 — Figma importer (needs Figma API credentials)
- [ ] B-6 — Video generation adapter (needs video-provider credentials)
- [x] B-7 — Additional compliance classes — PCI-DSS, DPDP-India, LGPD (`3b33d78`)
- [x] B-8 — Browser Verification role (L3 merge gate) (`3d35d24`)
- [x] B-9 — Migration Planner alpha (`ed54363`)

**Phase B status:** 6 of 9 milestones shipped (B-1, B-3 skeleton, B-4, B-7, B-8, B-9). B-2/B-5/B-6 require external resources — see "Pending external resources" below.

**Pending external resources (Phase B):**
- B-2 (cloud_migration monorepo fusion) — Per PRD §22, this is 6–8 weeks of integration work pulling `birjushah1601/cloud_migration` (Python FastAPI + Celery) into `services/migrate/` + `apps/migrate/`. Cannot be done in a single session safely. Needs a dedicated multi-session plan with the cloud_migration repo accessible.
- B-5 (Figma importer) — Needs a Figma API token and at least one source design file to validate against.
- B-6 (Video generation adapter) — Needs API credentials for at least one of Seedance / Kling / Veo / Runway, plus the cost-cap policy decision.

---

## Phase C plans

Phase C is **in progress**. Per ADR-001 (2026-04-22), Atlas no longer targets Vercel/Neon/Sentry defaults — C-1 and C-2 ship as orchestrator packages + Helm chart additions over DIY-K8s + OpenTelemetry stack + GlitchTip.

- [x] C-1 — Atlas Run deploy orchestrator + postgres-branching + Helm chart (`0d53754`) — plan: `2026-04-22-c1-deploy-orchestrator.md`
- [x] C-2 — Observability packages (`@atlas/observability` + `@atlas/run-dashboard`) + persona-tiered Run page + OTel+Prom+Loki+Tempo+Grafana+GlitchTip Helm (`d61fde1`) — plan: `2026-04-22-c2-observability-dashboard.md`
- [x] C-3 — SLO + error-budget engine (`c789d26`)
- [ ] C-4 — Multi-region failover (needs real multi-region cluster + Cloudflare zone — ops task)
- [x] C-5 — Payments hardening — idempotency + webhook signature verification (`c789d26`)
- [ ] C-6 — Usage telemetry + cost dashboards (depends on real telemetry stream in C-2 running)
- [x] C-7 — Audit log schema + sink (`c789d26`)

**Phase C status:** 5 of 7 milestones shipped (C-1, C-2, C-3, C-5, C-7). C-4/C-6 are ops-tasks that need a real cluster + live telemetry respectively. Real `KubernetesClient` / `CloudflareClient` / `HttpGrafanaClient` implementations pair with the contracts already shipped in C-1 + C-2 (see D10/D11 deferrals).

---

## Plan S — UI Quality Uplift (v1)

5 sub-plans landed 2026-05; tagged `plan-s/v1-complete` on `main`. See `docs/superpowers/specs/2026-05-02-ui-quality-uplift-design.md` for the full design rationale and `docs/superpowers/plans/2026-05-02-plan-s-overview.md` for sub-plan dependencies + flag-rollout sequence.

| # | File | Plan | Scope | Status |
|---|---|---|---|---|
| S.1 | `2026-05-02-plan-s1-sandbox-uplift.md` | **Sandbox Uplift** | Rebuild atlas-next-ts E2B template (v2) with Tailwind + shadcn + lucide + framer-motion + atlas-* CSS-variable design tokens; rewrite `SANDBOX_CONTEXT_PROMPT` from negative-list to positive-list | Shipped |
| S.2 | `2026-05-02-plan-s2-researcher-catalog.md` | **Researcher Role + Catalog** | New `@atlas/role-researcher` (Brave Search adapter behind `ATLAS_RESEARCH_WEB`) + 30-category local YAML catalog | Shipped |
| S.3 | `2026-05-02-plan-s3-designer-a2ui.md` | **Designer Role + A2UI** | New `@atlas/role-designer` + OptionsCard / AxisWizard / OutcomeCard / TechnicalCard primitives | Shipped |
| S.4 | `2026-05-02-plan-s4-canvas-engine.md` | **Polymorphic Canvas + Engine** | New `@atlas/canvas-runtime` + CanvasShell + RitualEngine pause-awaiting-canvas-selection + atlas-web canvas renderers | Shipped |
| S.5 | `2026-05-02-plan-s5-visual-quality-gate.md` | **Visual-Quality Gate + Visual Regression** | New `@atlas/gate-visual-quality` (L7) + per-renderer × persona × viewport Playwright snapshot suite + CI workflow | Shipped |

E2B templates published during Plan S: `atlas-next-ts-v2` (id `75mxlaomm6h7fasald1h`).

Out of scope (deferred to Plan S v2):
- Backend Endpoints / Exerciser / Logs canvas modes
- Mobile / data-pipeline / CLI canvas modes
- Per-component visual-edit overlay (Lovable-style click-to-edit)
- Visual-Quality gate Opus upgrade when budget allows
- Persistent inspiration cache that auto-grows from approved web hits
- Multi-tenant brand-kit injection

---

## Plan T — Multi-Stack Templates

Builds on Plan S to close the architect-classification → developer-template gap. The architect speaks 6 artifact kinds; v1 templates cover only Next.js. Plan T adds dedicated E2B templates per artifact kind, behind `ATLAS_FF_MULTI_STACK`.

| # | File | Plan | Scope | Status |
|---|---|---|---|---|
| T.1 | `2026-05-07-plan-t1-multi-stack-fastapi.md` | **FastAPI + routing** | New `atlas-fastapi` E2B template (Python 3.12 + FastAPI 0.115 + Pydantic 2 + uvicorn + sqlalchemy + alembic + pytest + ruff via uv); per-template `SANDBOX_CONTEXT_PROMPT` registry; `templateForArtifactKind` router; per-artifactKind Researcher skills | Shipped |
| T.2.1 | `(TBA)` | **atlas-hono-bun** | Bun + Hono + Drizzle ORM (alternative `backend-rest-api`) | Directional |
| T.2.2 | `(TBA)` | **atlas-graphql-yoga** | Bun + GraphQL Yoga + Pothos (`backend-graphql`) | Directional |
| T.2.3 | `(TBA)` | **atlas-expo-rn** | Expo SDK 52 + React Native + NativeWind + Expo Router (`mobile-app`) | Directional |
| T.2.4 | `(TBA)` | **atlas-dlt-python** | Python + dlt + DuckDB + dbt (`data-pipeline`) | Directional |
| T.2.5 | `(TBA)` | **atlas-bun-cli** | Bun + Commander + ink (`cli-tool`) | Directional |

E2B templates published during Plan T.1: `atlas-fastapi` (id `te6ynfz2hw7swuo2us2m`).

Per the writing-plans authoring cadence, T.2.x sub-plans land when execution is ≤ 3 weeks away.

---

## Phase D / E / F plans

Phase D (Sovereign / On-Prem), Phase E (Migrate GA), and Phase F (Brownfield Discovery GA) are **strategically gated** rather than engineering-gated. Per the roadmap (`2026-04-18-phases-b-through-f-roadmap.md`):

- **Phase D** entry requires ≥ 3 enterprise customers committed, signed MoUs with regional partners (CtrlS, OVHcloud, Liquid Telecom), and B-9 Migration Planner mature with 3 successful pilots. Engineering work is meaningful (OpenStack target, VMware adapter, K8s target, sovereign Helm chart) but cannot start without those commitments.
- **Phase E** entry requires Phase D exit + 3 successful real-customer migrations + auditor-validated compliance evidence + 5+ migration-engineer hires.
- **Phase F** entry requires Phase E + brownfield discovery agentless infra implemented (parts of which start in E-2).

Authoring and execution of D/E/F plans should happen per the writing-plans skill rule "write each unit's plan when execution is ≤ 3 weeks away" — i.e., when entry criteria are demonstrably close to met. Premature D/E/F task-level plans are false precision.

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
- [x] C.3 — Test-Generator Registry + Human Baselines (`c471d9a`)
- [x] D.1 — Conductor + LLM Provider Abstraction (`d641404`)
- [x] D.2 — Architect role (`8d59190`)
- [x] D.3 — Developer role (parallel Sonnet+Gemini + Reviewer voting) (`e8a7902`)
- [x] D.4 — Security role (L4 merge gate) (`ccccd7d`)
- [x] D.5 — Accessibility role (L5 merge gate) (`ac6edcb`)
- [x] E.1 — Ritual Engine (headless) (`d8f1808`)
- [x] E.2 — Atlas Web Scaffold + Canvas view (`73c3fbd` + `58f7bd4`)
- [x] E.3 — Atlas Web Code view + Monaco integration (`6142fa0`)
- [x] E.4 — E2B Sandbox + Preview (`9f31e9a`)
- [x] **E.5 — Ritual Integration Tests** ← final Phase A gate (`7c001ee`)
- [x] F.1 — Bootstrap Checkpoint + Risk-Accept Gates (`272e73d`)
- [x] G.1 — Edit Classifier + Gate Scheduler (`5585f69` + `c2641bb`)
- [x] G.2 — Latency Harness + Regression Alerting (`0006100`)

When all boxes are checked: cut the `phase-a/complete` tag on `main` and open the Phase B kickoff issue.

> **Phase A status (2026-04-21):** ✅ Tagged `phase-a/complete`. Known engineering deferrals tracked in [`../known-deferrals.md`](../known-deferrals.md).

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
