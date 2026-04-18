# Phase A — Units B–G Directional Roadmap

> Companion to the executable plans at `docs/superpowers/plans/2026-04-18-spec-graph-*.md`.
> Scope: Atlas Phase A after Unit A (Spec Graph Persistence & Ops) ships.
> Purpose: **Directional, not task-level.** Each unit below specifies scope, inputs/outputs, dependencies, open questions, and the sub-plan shape we expect to author when execution becomes imminent. These plans are intentionally not written yet — their requirements will firm up as Unit A completes and reveals real constraints.

---

## Roadmap shape

```
Unit A (shipped via Plans A.1–A.4)
  └─ Unit B — Schema + Validation          ─┬─ depends on A
                                             │
  └─ Unit C — Skill Framework scaffold      ─┤ depends on B
                                             │
  └─ Unit D — Conductor + Roles             ─┴─ depends on A, B  ─┐
                                                                   │
                                             ┌─ depends on A,B,C,D┘
  └─ Unit E — Ritual + UX surfaces          ─┤
                                             │
  └─ Unit F — Bootstrap checkpoint + risk-  ─┤ depends on E
                accept gates                 │
                                             │
  └─ Unit G — Edit-semantics tiering +      ─┘ depends on E (runs last, optimizes)
                latency optimisation
```

Critical path: A → B → D → E → F. C (skill framework) and D (agents) are both consumers of B but land mostly independently — they can run in parallel weeks 3–7 of Phase A. G is iteration optimisation and overlaps with F.

---

## Unit B — Core Schema & Validation

**One-liner:** Publish `@atlas/spec-graph-schema` — the typed schema package that defines the 14 node types, 13 edge types, 14 structural invariants, and a JSON Schema artifact. Every downstream agent, skill, and UI reads types from this package.

**Scope:**
- 14 node types as Zod schemas (single source of truth): Page, Route, Component, ClientState, Model, Endpoint, Flow, AuthBoundary, Test, DesignToken, Dependency, ComplianceClass, AIFeature, MediaAsset. Each with typed attributes (e.g., `Page { id, path, title, layout?, auth? }`).
- 13 edge types: renders, fetches, reads, mutates, requires, covers, dependsOn, styledBy, subjectTo, supersedes, powers, displays, manages. Edges carry `from/to` node-id refs plus edge-specific attributes.
- Root spec-graph object: `{ version, appId, createdAt, databaseProvider, templateDigest, complianceClass, compliance_metadata, observability, nodes, edges }`.
- JSON Schema 2020-12 artifact generated from Zod (via `zod-to-json-schema`) published alongside the types — the canonical artifact for Python / non-TS consumers.
- 14 structural invariants enforced at L1 validation (e.g., "every `renders` edge's `to` node must be a Component", "every Endpoint must be reachable from at least one Page via a fetches edge chain", "ComplianceClass-bearing Endpoints must have non-empty AuthBoundary requires-edges").
- Python Pydantic bindings regenerated from the JSON Schema for `cloud_migration` future fusion.
- L1 validator function `validate(graph): ValidationResult` — pure, fast, deterministic. Returns structured errors keyed to node/edge ids for UI highlighting.

**Inputs:**
- Unit A's `@atlas/spec-graph-data` — Unit B's types are stored by A as opaque jsonb. Unit B does not change A's tables.
- The Council-approved node/edge taxonomy from `docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md` §5.

**Outputs:**
- `packages/spec-graph-schema/` publishing `@atlas/spec-graph-schema` with:
  - TypeScript types for every node and edge
  - Zod schemas
  - `validate()` function
  - JSON Schema artifact at `dist/schema/spec-graph.v1.schema.json`
- `packages/spec-graph-schema-py/` (bindings-only; generated not hand-authored) — Python Pydantic models.
- Wire the validator into `@atlas/spec-graph-data`'s `SpecGraphRepo.create` and `updateGraphData` as an **optional** opt-in (enable via a constructor flag) so the data layer remains schema-agnostic for tests but validates in production.

**Dependencies:** Unit A (published). No others.

**Rough task count:** 30–40 tasks. Each node/edge type is a self-contained task (14 + 13 = 27 tasks). Add: root object, invariant checks (one task per invariant, ~14 tasks), JSON-Schema generation wiring, Python bindings pipeline, validator entry point, test fixture corpus.

**Sub-plan decomposition (expected):** *one plan, not multiple.* All 27 node/edge types land in a single coherent package; splitting them across plans would create churn.

**Plan B.1 — Spec Graph Schema & Validation** (≈35 tasks)

**Open questions to resolve before authoring Plan B.1:**

1. **Zod v3 vs v4.** Zod v4 is in release-candidate as of the writing date; v3 is stable. Default to v3; revisit at plan-authoring time.
2. **Discriminated unions vs registry map.** Do we express `Node = Page | Route | …` as a Zod discriminated union (type-safe narrowing) or as a registry `{ [kind]: schema }`? Recommendation: discriminated union for ergonomics; registry on top for dynamic access.
3. **Extension surface.** Users and enterprises will want custom node attributes. Do we support `extensions: Record<string, unknown>` on every node in v1, or defer? Recommendation: include `extensions` from day one — it's a two-field addition with outsized long-term value.
4. **JSON Schema strictness.** Does the published JSON Schema enforce `additionalProperties: false`? Strict is safer; less strict is more forgiving for brownfield. Recommendation: strict on nodes/edges, lenient on `extensions`.
5. **Python binding provenance.** Do we generate Pydantic from the JSON Schema via `datamodel-code-generator`, or maintain a hand-written binding? Recommendation: generate. Hand-written will drift.
6. **Invariant representation.** Each of the 14 invariants is either a pure graph-level predicate (most) or cross-table (a few reference the spec-graph event log). Are event-log-consulting invariants in Unit B, or deferred to a reconciliation layer? Recommendation: only graph-local invariants live in B; cross-substrate checks go to a future reconciliation package.

---

## Unit C — Skill Framework Scaffold + Test Generator Registry

**One-liner:** Build the infrastructure that turns the OSS skill markdown library into an executable dispatcher. Skills load at runtime, classify by intent, compose, and produce the test-generator output that Units D and E consume.

**Scope:**
- `packages/skill-runtime/` — TypeScript runtime that loads `*.md` skill files from the local `.atlas/skills/` and the bundled OSS library, parses each skill's frontmatter + body, and exposes a typed API: `skillRegistry.get(name)`, `skillRegistry.match(intent)`, `skillRegistry.activate(name, args)`.
- Skill frontmatter schema: `name`, `description`, `activate_on` (pattern or intent tag), `composes` (list of skills it invokes), `model_hint` (optional), `inputs` (zod schema), `outputs` (zod schema).
- Intent classification: a Haiku-4.5-backed classifier that maps user message → skill name(s). In v1 this is a thin wrapper that the Conductor (Unit D) calls; the classifier itself is stateless and deterministic (same input → same output given same cached response).
- Test-generator registry: each of the 14 node types has an auto-activated test-generator skill (`gen-test-page.md`, `gen-test-component.md`, etc.). The registry knows how to invoke the right generator for a given graph mutation and returns generated test code plus a human-authored baseline assertion (the "no LLM can rewrite this" guarantee from PRD §10.1).
- Skill version-pinning: `.atlas/skills/pin.json` with `{ skill, version, provenance }` entries. Drift-detection nightly against a calibration dataset.
- OSS publishing pipeline: `github.com/atlas-labs/atlas-skills` public repo with a GitHub Action that validates skill frontmatter + runs a skill-behaviour test against its published test vectors.

**Inputs:**
- Unit B's types (skills operate on graph nodes and must reference node types by name).
- Atlas Skill Library authored in markdown — the initial ~35 skills listed in PRD §11.2.

**Outputs:**
- `packages/skill-runtime/` — TypeScript skill loader, registry, classifier.
- `packages/skill-library/` — the ~35 starter skills as committed markdown (Apache 2.0).
- Public GitHub repo `github.com/atlas-labs/atlas-skills` mirrored from `packages/skill-library/` via a release workflow.
- Test-generator registry producing generated test code + human-authored baseline asserts.
- Drift-detection CI job.

**Dependencies:** Unit A (Postgres mirror), Unit B (types for skill inputs/outputs).

**Rough task count:** 40–50 tasks.

**Sub-plan decomposition (expected):**
- **Plan C.1 — Skill Runtime** (≈20 tasks): loader, registry, frontmatter parser, intent classifier shim.
- **Plan C.2 — Starter Skill Library & OSS pipeline** (≈15 tasks): author the ~35 skills, CI validation, public repo mirror workflow.
- **Plan C.3 — Test-Generator Registry + Human Baseline Infrastructure** (≈15 tasks): the baseline-assertion authoring workflow (who writes them, where they live, how they pin to node types), the test-generator invocation path, drift detection.

**Open questions:**

1. **Skill execution isolation.** Do skills run in the main Node process, or each in its own child process / worker thread? Recommendation: main process in v1 (skills are markdown, not executable — they produce LLM prompts, not side effects).
2. **Intent-classifier prompt-cache hit rate.** NFR-13 targets >80%. Does a Haiku-4.5 classifier get us there, or do we need a local tiny model (e.g., distilled) for zero-latency triage? Recommendation: start with Haiku, measure, replace if miss rate is >20%.
3. **Human-baseline authorship.** Who writes the non-LLM baseline assertions at L4/L5? This is the Chairman-flagged Council blind-spot. Options: a named owner (dedicated engineer), external security consultants, staff engineering review committee. Decision needed before C.3 starts.
4. **OSS release cadence.** Weekly? Monthly? Recommendation: weekly patch releases, monthly minors — matches the community RFC rhythm.
5. **Pinning granularity.** Pin skills to exact version (reproducible but churny) or minor range (flexible but drift-prone)? Recommendation: exact pin + automated dependabot-style upgrade PRs.
6. **Calibration dataset.** Unit A's reconciliation classifier needs one; Unit C's drift detector needs one. Same dataset? Different? Recommendation: shared dataset starts in Unit C, grown by both.

---

## Unit D — Conductor + Orchestration Roles

**One-liner:** Stand up the thin-Conductor / role-Swarm agent architecture from PRD §11.3. Four priority roles in v1: Architect, Developer, Security, Accessibility.

**Scope:**
- `packages/conductor/` — the lightweight orchestrator. Holds the spec graph (reads from `@atlas/spec-graph-data`), classifies user intent (via Unit C's classifier), dispatches work to roles, tracks checkpoints.
- Conductor runs under Claude Code Agent Teams primitives: shared task list, peer messaging between roles, file locks to prevent write contention.
- Four role packages in v1:
  - `packages/role-architect/` — composes `brainstorm.md` + `spec-graph.md` + `runnable-plan.md`. Two-pass: ambiguity triage (Haiku 4.5) → deep plan (Opus 4.7).
  - `packages/role-developer/` — composes `tdd-feature.md` + `edit-only-what-changed.md` + `runnable-plan.md`. Parallel: Sonnet 4.6 + Gemini 2.5 Flash.
  - `packages/role-security/` — composes `audit-rls.md`, `cors-policy.md`, `secrets-scan.md`, `cve-check.md`. Merge gate L4. Opus 4.7.
  - `packages/role-accessibility/` — composes `wcag-audit.md`, `rtl-layout.md`, `keyboard-nav.md`, `contrast-check.md`. Merge gate L5. Sonnet 4.6 + axe-core.
- Each role is a thin dispatcher: it receives a work item with graph context, composes skills, emits outputs (diffs, events, test results), returns control to Conductor.
- Roles run in their own context windows via Claude Code Agent Teams (subagent-dispatch equivalent for this codebase).
- Shared observability: every role invocation emits OpenTelemetry spans + Prometheus counters/histograms using `@atlas/spec-graph-data`'s registry pattern.

**Inputs:**
- Unit A (mirror + repos)
- Unit B (types for graph operations and role outputs)
- Unit C (skill runtime for role composition)

**Outputs:**
- `packages/conductor/` and four `packages/role-*/` packages.
- The first end-to-end "dispatch intent → produce diff" path.
- LLM provider abstraction layer (multi-provider: Anthropic, Google, optional self-hosted) — owned here because roles are the primary model consumers.

**Dependencies:** A + B + C.

**Rough task count:** 70–90 tasks across four roles + Conductor. Each role has ~12–15 tasks: wire the role, compose its skills, build its output serializer, integrate observability, integration-test against a real mirror.

**Sub-plan decomposition (expected):**
- **Plan D.1 — Conductor + LLM Provider Abstraction** (≈20 tasks): orchestrator core, Agent-Teams integration, multi-provider client, circuit breaker, prompt-cache plumbing.
- **Plan D.2 — Architect Role** (≈15 tasks).
- **Plan D.3 — Developer Role** (≈15 tasks; parallelism work is inherited from prior v2 pipeline where applicable).
- **Plan D.4 — Security Role + L4 merge gate wiring** (≈15 tasks). Includes the human-authored baseline assertion invocation path (Council blind-spot #3).
- **Plan D.5 — Accessibility Role + L5 merge gate wiring** (≈15 tasks).

**Open questions:**

1. **Agent-Teams abstraction vs directly in the codebase.** Claude Code's Agent-Teams primitives are useful for dev tooling but not cleanly exportable as a library. Does the Conductor use them directly (tight coupling to Claude Code) or reimplement the shared-task-list / peer-messaging pattern as an internal library? Recommendation: internal lib — avoids runtime lock-in.
2. **Prompt-cache prefix shape.** Developer role is the biggest LLM consumer. Cache hit rate target is >80% (NFR-13). Prefix needs to be: base skill prompt + graph context (slow-changing) before the user turn (fast-changing). Ensure graph-context slot is stable across turns for the same project.
3. **Role recovery on failure.** If a role crashes mid-execution, does Conductor retry? Resume from last checkpoint? Discard work? Recommendation: checkpoint after every emitted event; retry with exponential backoff up to 3 attempts; on third failure, escalate to user per edit-class policy (PRD §9.5).
4. **Parallel Developer runs.** Sonnet + Gemini Flash in parallel requires a voting or merge strategy. Who judges which output wins? Recommendation: a lightweight Reviewer role (Sonnet) votes. Flag for refinement in D.3.
5. **Browser Verification (L3 gate) role.** Not in Unit D's v1 role set; it's in the backlog but deferred. Sequence: Unit D v1 has 4 roles; add Browser Verification as D.6 in Phase B. Confirm this cut is acceptable at plan-authoring time.

---

## Unit E — Visualize → Agree → Build Ritual + UX Surfaces

**One-liner:** Build the three-step product interaction on top of D's agent team. Ama, Diego, and Priya each see persona-tiered artifacts; all three approve the same underlying spec-graph mutation.

**Scope:**
- `apps/atlas-web/` — Next.js 15 App Router app. This is the Atlas product surface (canvas + code, live preview, dual-pane).
  - **Canvas** view (Ama-first): visual app map, drag-to-rearrange pages, click-to-edit components inline, chat to modify.
  - **Code** view (Diego/Priya): Monaco editor, real files, real Git, PR flow, terminal into sandbox, test runner.
  - Click on element in either view highlights in the other.
- Three-step ritual UI:
  - **Visualize:** Architect emits artifact (scope-dependent; see PRD §8). Renders in persona-tiered view.
  - **Agree:** user reviews/edits artifact. Approve / request changes / risk-accept (persona-gated). Point of no return.
  - **Build:** Developer/Security/Accessibility generate code; Reviewer critiques; Validator fixes; merge gates run; result streams to preview.
- Persona tier toggle: Ama / Diego / Priya. Data identical across tiers; UI surfaces differ.
- `.atlas/plan.md` + `.atlas/spec.graph.json` updated on every ritual loop. Living history.
- E2B integration: sandbox spin-up, prebuilt template selection (atlas-next-ts or atlas-python-fastapi from A.1's Compose stack), live HMR iframe, multi-viewport preview, shareable URL (public/password/auth).

**Inputs:**
- A + B + C + D (the whole stack under the hood).
- E2B SDK (external service — provision per project).

**Outputs:**
- `apps/atlas-web/` — the product surface.
- `packages/ritual-engine/` — headless library that orchestrates Visualize → Agree → Build across personas; the UI consumes it.

**Dependencies:** A + B + C + D.

**Rough task count:** 80–100 tasks. The product surface is the largest single unit in Phase A.

**Sub-plan decomposition (expected):**
- **Plan E.1 — Ritual Engine (headless)** (≈20 tasks): state machine for the three steps, persona-tiered artifact renderers, approval gating, risk-acceptance schema.
- **Plan E.2 — Atlas Web Scaffold + Canvas view** (≈25 tasks): Next.js app, auth, project routing, Canvas implementation, dual-pane highlighting.
- **Plan E.3 — Atlas Web Code view + Monaco integration** (≈15 tasks): Monaco, file tree, Git PR flow, test runner UI.
- **Plan E.4 — E2B Sandbox + Preview** (≈20 tasks): sandbox lifecycle, HMR iframe, shareable URLs, viewport throttling.
- **Plan E.5 — Ritual Integration Tests** (≈15 tasks): end-to-end Ama / Diego / Priya flows against a real stack.

**Open questions:**

1. **Auth provider at v1.** Clerk (fastest) vs Supabase Auth (tighter DB integration) vs self-hosted Lucia. PRD §6.6 says user picks, we wire — but at MVP we need ONE default. Recommendation: Clerk for speed in v1; make the abstraction thin enough to swap.
2. **Git integration mechanics.** Does Atlas clone the user's repo into E2B and commit from there? Or run commits via GitHub/GitLab APIs directly? Recommendation: clone-into-E2B approach — matches v2 behavior and gives the sandbox real Git state.
3. **Canvas rendering tech.** React Flow, Excalidraw, custom SVG? Recommendation: React Flow for the graph view; custom SVG for the wireframe view.
4. **Persona toggle persistence.** Per-user or per-project? Recommendation: per-user (profile flag), per-project override possible.
5. **Risk-accept UX for Ama.** Ama can't override security by policy (§9.5). What does Ama see when a gate fails and Priya-level override is needed? Recommendation: an explicit "ask a reviewer" escalation, not a silent refuse.
6. **Live-edit latency budget.** Cosmetic edits have <200ms target (NFR-8). Canvas needs optimistic UI with rollback-on-server-rejection. Plan E.1 should spell out the state-machine transitions.

---

## Unit F — Bootstrap Review Checkpoint + Risk-Acceptance Gates

**One-liner:** A human-in-the-loop gate before the *first* ritual commits on any new project. Addresses Council blind-spot #1. Also formalizes the risk-acceptance annotation schema across the system.

**Scope:**
- **Bootstrap review checkpoint:** the first time a user runs the Visualize → Agree → Build ritual on a new project, Atlas pauses after Agree with a six-item sanity checklist:
  1. "Is the compliance class correct?"
  2. "Is the data-residency region correct?"
  3. "Is the auth provider correct?"
  4. "Is the DB provider correct?"
  5. "Is the persona tier correct?"
  6. "Is anything off about this plan you can't articulate?" (the escape-hatch question)
- Each item is persona-tiered: Ama sees a card with simple language; Diego sees the checkbox + the underlying graph node being affirmed; Priya sees the raw JSON mutation.
- Failure to pass any item routes the ritual back to Visualize with the specific item flagged.
- Only runs once per project. After the first pass, subsequent rituals skip the checkpoint (there's a "rerun" option for regulated-industry customers).
- **Risk-acceptance annotation schema:** a first-class type in `@atlas/spec-graph-schema` and a row shape in `@atlas/spec-graph-data`'s events:
  ```
  {
    eventType: "risk.accepted",
    payload: {
      gate: "L4-security" | "L5-compliance" | "L6-a11y-advisory" | "L7-visual-advisory",
      failureSummary: string,
      acceptedBy: { personaTier, userId, timestamp },
      rationale: string (required, min length 20 chars),
      scope: "single-commit" | "session" | "permanent-for-project"
    }
  }
  ```
- Persona gating: Ama cannot emit `gate: "L4-security"` risk-accepts; Priya can emit any. Enforced in `ritual-engine` + audit-logged + surfaced in `compliance-evidence/`.

**Inputs:** Units A + B + C + D + E.

**Outputs:**
- `packages/bootstrap-checkpoint/` — the checklist engine.
- Ritual-engine (E.1) gains a bootstrap-gate hook.
- `@atlas/spec-graph-schema` gains the `RiskAccepted` type (extending Unit B).
- `compliance-evidence/` emission includes all risk-accepted events for the build.

**Dependencies:** E (ritual engine), plus B (types) and A (persistence).

**Rough task count:** 20–25 tasks.

**Sub-plan decomposition (expected):** single plan.
**Plan F.1 — Bootstrap Checkpoint + Risk-Acceptance Gates** (≈22 tasks).

**Open questions:**

1. **Six items or fewer.** Is the six-item list correct? PRD §18.2 names the requirement but not the exact items. Plan F.1 authorship should validate against 3–5 real pilot projects before locking the list.
2. **"Something's off" escape-hatch routing.** Where does that click go? Recommendation: opens a short free-text field + a button to add Priya as a reviewer on the project.
3. **Risk-accept UX time budget.** Adding friction here is the POINT, but too much friction drives users to bypass-scripts. Recommendation: require 20 chars of rationale (enforceable); do NOT require multiple confirmations.
4. **Auditor-plane integration.** Every risk-accept event appears in the next `compliance-evidence/` folder. Format: plaintext markdown with the full JSON event body. Priya can add a Quieting comment that appears alongside.

---

## Unit G — Edit-Semantics Tiering + Latency Optimisation

**One-liner:** Implement the three edit classes (cosmetic / structural / security-compliance-touching) from PRD §9.5 and hit NFR-8 (<200ms cosmetic-edit p50). Iteration-optimisation unit; runs last in Phase A.

**Scope:**
- Classification: at ritual-dispatch time, the Conductor (D.1) classifies the incoming edit into one of the three tiers. Classifier is deterministic: node/edge type + which fields are being mutated → tier.
- Tier-specific merge-gate scheduling (from PRD §11.4 table):
  - **Cosmetic** (Tailwind class swap, copy, color token): L1 + L2 run sync; L3 (Browser), L4 (Security), L5 (Compliance) run async post-commit with rollback-on-red trigger armed.
  - **Structural** (new node/edge, flow change, schema change): full L1–L5 sync blocks until green.
  - **Security/compliance-touching** (AuthBoundary, RLS policy, ComplianceClass, PII classification): full L1–L5 sync + explicit human confirmation gate.
- Async gate runner: a queue that picks up post-commit gate jobs, runs them, raises an alert + armed rollback on failure. Revert triggers: (a) user acknowledges and explicitly rolls back, (b) auto-rollback if failure is critical (e.g., CVE-rated dependency).
- Latency budget harness: continuous measurement infrastructure in CI + staging that samples cosmetic edits and flags P50 regression. Dashboards per tier.
- Retries + risk-accept: from PRD §9.5, persistent gate failure offers three options: retry-with-hint / undo / risk-accepted commit. The risk-accepted path lands via Unit F's schema. Max 3 retries.

**Inputs:** A + B + C + D + E + F.

**Outputs:**
- `packages/edit-classifier/` — the deterministic tier classifier.
- `packages/gate-scheduler/` — synchronous + async gate runner with rollback arming.
- `packages/latency-harness/` — continuous measurement + alerting.
- Integration into ritual-engine (Unit E): Conductor consults the classifier; scheduler runs gates accordingly.

**Dependencies:** all prior units.

**Rough task count:** 30–40 tasks.

**Sub-plan decomposition (expected):** two plans.
- **Plan G.1 — Edit Classifier + Gate Scheduler** (≈25 tasks).
- **Plan G.2 — Latency Harness + Regression Alerting** (≈12 tasks).

**Open questions:**

1. **Async gate outcome UX.** Post-commit, what does the user see when an async gate eventually fails? Toast? Modal? Automatic rollback with notification? Recommendation: notification pane (non-modal); if severity=critical (CVE), auto-rollback with modal after the fact.
2. **Rollback granularity.** Per-commit rollback is straightforward. What about a chain of cosmetic commits where only commit #4 failed? Rollback all four or just #4? Recommendation: rollback just #4 via `git revert`; preserve the others.
3. **Tier classifier test coverage.** What's the calibration dataset for classifier correctness? Recommendation: reuse the ambiguity classifier's dataset (shared with Unit C). Tag each item with its correct tier.
4. **Latency harness cadence.** Every CI run? Hourly in staging? Recommendation: every CI run for synthetic workloads; real-user metrics from staging emitted to Prometheus continuously.

---

## Cross-cutting concerns — already absorbed

The following are cross-cutting and land inside each unit above rather than as their own units:

- **Observability.** Every unit extends `@atlas/spec-graph-data`'s Prometheus registry and OpenTelemetry tracer. No central "observability unit."
- **Tenant isolation.** Unit A enforces at the DB boundary via RLS. Every subsequent unit inherits by construction.
- **Security baselines.** L4 human-authored assertions are authored in Unit C (test-generator registry) and wired into L4 gate in Unit D (Security role). Plan D.4 owns the baseline-assertion invocation path.
- **i18n / RTL / low-bandwidth.** Accessibility role (D.5) ships these as gate checks. Ritual UX (E) surfaces a translation pane.
- **Deployment contract (Neon branching + Vercel promotion + rollback + migration ordering + post-deploy health checks).** Owned by Unit E (ritual Build step) + Ship role in Phase B.

---

## Phase A exit checklist

Phase A closes when **all** of the following are true:

- [ ] Plans A.1 – A.4 executed green; `@atlas/spec-graph-data`, `@atlas/spec-graph-sync`, `@atlas/spec-graph-merge-driver`, `@atlas/spec-graph-ops` published (workspace-private; external publish is Phase B).
- [ ] Unit B shipped; `@atlas/spec-graph-schema` published with Zod + JSON Schema + Pydantic bindings.
- [ ] Unit C shipped; skill runtime loads + classifies + composes; initial ~35 skills authored; `github.com/atlas-labs/atlas-skills` live.
- [ ] Unit D shipped; Conductor dispatches to 4 roles; 1 end-to-end ritual produces a real spec-graph mutation + code diff.
- [ ] Unit E shipped; `apps/atlas-web` supports a single project going through create → feature → bug fix → dep upgrade → refactor.
- [ ] Unit F shipped; bootstrap checkpoint runs on first ritual; risk-accept events persist + surface in compliance evidence.
- [ ] Unit G shipped; three edit tiers classify correctly; cosmetic p50 <200ms; structural sync; security human-confirmed.
- [ ] 1,000-prompt weekly eval at ≥95% reliability (PRD NFR-3 GA target is 97%; Phase A gate is 95%).
- [ ] Three users at three persona tiers successfully use one project end-to-end.
- [ ] All NFRs at p50 targets (p95 can trail by one sprint).

---

## Notes on plan-authoring cadence

**Write each unit's plan(s) when execution is ≤ 3 weeks away.** Writing Unit E's plan today is false precision — Units A–D will reveal real constraints (API shapes, timing, edge cases) that shift Unit E's shape. The right time to author:

- Plan B.1: when A.2 is green (A.3 + A.4 can run in parallel with B.1 drafting).
- Plans C.1 – C.3: when B.1 is green.
- Plans D.1 – D.5: when B.1 is green (D is mostly independent of C).
- Plans E.1 – E.5: when D.1 is green and D.2/D.3 are near.
- Plan F.1: during E.4 / E.5 drafting.
- Plans G.1 – G.2: after F.1 is green.

This is deliberate. The value of a task-level plan is highest when execution is weeks, not months, away. The open questions noted above are the real work of each plan — they get resolved during authoring, and plan quality depends on the answers being grounded in the actual codebase that exists at that point.
