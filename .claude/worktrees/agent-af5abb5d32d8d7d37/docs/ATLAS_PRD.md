# Atlas — Product Requirements Document

> **The best AI Builder on earth — not only visualize, but *build, iterate, maintain, and manage* at one place, and make it superb.**
>
> Version: 1.0 (canonical)
> Last updated: 2026-04-18
> Supersedes: `docs/PRD.md`, `docs/PRD1.md`, `docs/PRD_v3.md`, `docs/ECOSYSTEM_VISION.md` (archived under `docs/archive/`)
> Companion (architecture reference, kept authoritative): `docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md`
> Priority order: **Correctness > Coherence > Security > Speed > Cost**

---

## Document Map

- **Part I — Vision & Mission.** Why Atlas exists. The problem. The four-pillar thesis. The moat.
- **Part II — The Product (Atlas Build).** Personas, the core ritual, the four product principles, the architectural summary (spec graph, skill framework, agent team, test pyramid, persistence, sandbox, observability), functional and non-functional requirements, pricing, compliance posture.
- **Part III — Execution.** Phase plan A–F. Phase A unit decomposition. The next-work milestone. Success metrics. What's deferred. Risks. Go-to-market.
- **Appendices.** Glossary. Archived documents. Reference links.

Readers:
- Investors / partners — read **Part I** and §10 (Moat), §22 (Go-to-market). ~10 minutes.
- Founding team / hires — read **everything**. ~45 minutes.
- Engineering execution — Part II and Part III are the working contract. Architectural depth lives in `spec-graph-v1-design.md`.

---

# Part I — Vision & Mission

## 1. Mission

**The best AI Builder on earth — not only visualize, but *build, iterate, maintain, and manage* at one place, and make it superb.**

One sentence, five verbs. Every scope decision in this document is tested against it. A proposed feature that serves only "visualize + build" and ignores iterate / maintain / manage is misaligned and does not ship. Features that strengthen the *mid-and-late* lifecycle — spec-graph coherence past 30+ files, one-click deploy, observability, compliance, migration — serve the mission directly and take priority.

The differentiation is not any single step. It is the **continuous lifecycle** delivered as one product by one team under one bill. Competitors solve the first mile (v0, Bolt, Lovable, Emergent, Replit) or the last mile (Turbonomic, CloudFuze, migration consultancies). **Nobody does both continuously.** That is the opening.

## 2. The Problem

Five world problems shape every design decision. A feature that does not serve at least one does not ship.

| # | Problem | How Atlas attacks it |
|---|---------|----------------------|
| **P1** | **Developer scarcity.** A global shortage of 4M–85M engineers ([BEON.tech, 2026](https://beon.tech/blog/software-development-talent-shortage/)). Local software for clinics, co-ops, regional governments, NGOs never gets built because hiring is unaffordable. | Non-developer → working app in under an hour at flat predictable cost. Output is real, exportable code — not a hosted trap. |
| **P2** | **AI code is insecure by default.** 25% vulnerability rate in LLM output ([ACM 2026](https://dl.acm.org/doi/10.1145/3716848)). 170+ AI-generated apps leaked real user data ([CVE-2025-48757](https://mattpalmer.io/posts/2025/05/CVE-2025-48757/)). | A dedicated **Security merge gate** audits every change: RLS, CORS, authz, secrets, CSP, dependency CVEs. No merge without a passing audit. Every check carries a human-authored baseline assertion the LLM cannot rewrite. |
| **P3** | **The last-mile gap.** Users generate apps but never ship. Domains, DNS, auth, payments, DB migrations, observability — all DIY and all blocking. | **Ship Pipeline** handles domain, DNS, TLS, managed DB, auth, payments, observability, CI, and one-click rollback as first-class product surface. |
| **P4** | **Accessibility & localization debt.** 95.9% WCAG fail rate on top sites ([WebAIM Million 2025](https://webaim.org/projects/million/)). English-only React dominates. | WCAG 2.2 AA enforced on every component by an **Accessibility merge gate**. First-class RTL, i18n, low-bandwidth, low-end Android as defaults, not options. |
| **P5** | **Code rot past 30 files.** AI builders lose architectural coherence; generated code is called "AI slop" and rewritten by pros. | **Living Spec Graph** — a persistent, typed, queryable model of the app that every agent reads and updates, not re-derives per turn. Refactors do not regress prior intent. |

These are measurable. See §19.

## 3. The Atlas Thesis

There are two worlds in the AI-native software-engineering market today.

**World 1 — AI App Builders.** v0, Bolt, Lovable, Emergent, Replit Agent, Firebase Studio, Claude Artifacts. Excellent at greenfield creation. Every one traps the user on their infrastructure. Export quality is poor. Deploy options are narrow. The moment the user outgrows the managed tier or hits a compliance requirement (data residency, sovereignty, on-prem mandate), they face a six-to-seven-figure migration project with external consultants. "Vibe coded → cloud exit" is an industry-wide dead end.

**World 2 — Cloud Migration Platforms.** Traditional consultancies, Turbonomic, CloudFuze, hyperscaler migration services. They solve the hard second half: AI-powered, zero-downtime migration across AWS/Azure/GCP and into OpenStack, VMware, bare-metal private clouds. Our existing [`cloud_migration`](https://github.com/birjushah1601/cloud_migration) codebase already implements 62 REST endpoints and 63 backend services covering discovery, planning, openstack, compliance, cost calculation, terraform generation, workflow, execution, deployment, and disaster recovery.

**The thesis.** Fused, these become the first *continuous software-sovereignty pipeline*. A founder builds a healthcare app on Atlas today. When DPDP mandates onshore data residency next year, the same platform migrates it to a sovereign-cloud tenant. No re-architecture. No consultants. No downtime. Same spec graph, same observability, same team.

**That is a product no one else can ship.**

## 4. The Four Pillars

```
┌──────────────────────── ATLAS ────────────────────────────┐
│                                                           │
│  IMAGINE         BUILD            RUN             MIGRATE │
│  ───────         ─────             ───            ─────── │
│  Spec Graph      Atlas Build       Atlas Run     Atlas    │
│  + Architect     (this PRD,        Managed       Migrate  │
│  Agent           Part II)          hosting       (existing │
│                                                  codebase) │
│                                                           │
│  ┌─ Shared Platform Layer ──────────────────────────┐     │
│  │ Spec Graph (app + infra) · Agent Team · LLM      │     │
│  │ Identity · Billing · Observability · Compliance  │     │
│  └──────────────────────────────────────────────────┘     │
│                                                           │
│  ┌─ Execution Layer ────────────────────────────────┐     │
│  │ E2B microVMs (build) · Vercel/Fly/Cloudflare    │     │
│  │ (managed run) · AWS/Azure/GCP (migrate source)  │     │
│  │ OpenStack/VMware/K8s bare-metal (sovereign)     │     │
│  └──────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────┘
```

**Pillar 1 — Imagine.** The front door. A structured conversation that turns an idea into a Living Spec Graph, extended (Phase B+) to model infrastructure: auth provider, DB choice, region, compliance class, eventual target cloud. One graph, full lifecycle.

**Pillar 2 — Build (Atlas Build).** The subject of Part II. AI agents generate a secure, accessible, production-grade app from the spec graph. Exportable TypeScript. Non-negotiable merge gates for security, accessibility, browser verification. Flat pricing.

**Pillar 3 — Run (Atlas Run).** Managed hosting in the background — Vercel / Fly / Cloudflare Workers today; our own multi-region mesh tomorrow. Domain, TLS, DB, auth, payments already wired by the Ship role. Observability and SLO dashboards included. The default for 95% of users. Most never touch Migrate.

**Pillar 4 — Migrate (Atlas Migrate).** The existing `cloud_migration` codebase, rebranded and integrated. Activated when a user has a reason to leave Atlas Run: **cost, compliance, sovereignty, scale, or acquisition**. The same spec graph that built the app describes its target infrastructure. A Migration Planner produces a staged, zero-downtime plan; the Execution engine runs it against OpenStack / VMware / bare-metal K8s / another hyperscaler. Because Atlas wrote the app, Atlas can migrate it perfectly.

**The fusion is not cosmetic.** The Spec Graph, Skill Framework, Agent Team, LLM orchestration, identity, billing, observability, and compliance engines are *shared primitives*. Migration is not a new product with new agents — it is the same **Visualize → Agree → Build** ritual applied at infrastructure scope.

## 5. The Moat

Said plainly — what no competitor can copy without rebuilding from scratch.

1. **Only platform where spec-graph coherence survives the full lifecycle** — prompt → production → private cloud. Competitors re-derive context per turn and degrade past 30–50 files.
2. **Only platform with merge-gated security + a11y + compliance on both greenfield and brownfield code.** One validation engine, two surfaces.
3. **Only platform that makes "cloud sovereignty" a one-click action** for any app — whether we built it or we're discovering it.
4. **Only platform with AI-native migration across hyperscalers and into OpenStack/VMware/bare-metal.** Everyone else does hyperscaler-to-hyperscaler or sells consulting.
5. **Only platform where one flat subscription covers the entire arc.** Not "buy a builder, then buy migration, then hire consultants."
6. **Only platform with a unified Visualize → Agree → Build ritual applied at every scale** — new app, new feature, bug fix, dep upgrade, refactor, migration — powered by an **open-source skill library** (Apache 2.0, github.com/atlas-labs/atlas-skills). The Linux-of-skills / Red-Hat-of-orchestration split, applied to AI-native software engineering.

This is not 10x. This is a new category.

## 6. Ecosystem Non-Goals

Things Atlas is explicitly **not** building — past, present, or future — because they dilute the thesis.

- **A hosted-only platform with no export.** (Base44, Create.xyz trap.)
- **A token-metered pricing model disguised as credits.** Atlas is flat, capped, transparent.
- **A "clone any website" tool.** IP risk, niche.
- **A general-purpose IDE competing with Cursor / Windsurf.** Atlas is a builder, not an IDE.
- **A Figma replacement.** Atlas imports from Claude Design at v1; it does not compete with design tools.
- **Anything that defers security, a11y, or verification as a Pro-tier upsell.** Those are mission-critical and therefore always on, always free.

---

# Part II — The Product (Atlas Build)

Part II is the detailed requirements for the current product surface: Atlas Build. Run and Migrate are integrated in later phases (see §16) but share the primitives specified here.

## 7. Personas

Three personas, one product. The handoff between them is a core feature.

| Persona | Profile | What they see at Visualize | What they approve at Agree | Graph access |
|---|---|---|---|---|
| **Ama** | Non-developer founder, NGO operations lead, small-business owner. Describes apps in plain English, Hindi, Swahili, Arabic, Portuguese. Wants a working product shipped to users, not a codebase. | Wireframes + plain-English summary ("5 pages, user login, save drafts, send email") | The summary. Atlas picks recommended defaults for every graph node. | Hidden. Events logged silently. Reconciliation automatic. |
| **Diego** | Solo developer, frontend dev, designer shortcutting boilerplate. Wants clean, editable code, iteration speed, real Git, export. | Wireframes + structured graph editor (node/edge view, attribute panels) | The structured graph. Overrides defaults. Inspects events. | Read/write via UI; raw JSON on demand. |
| **Priya** | Senior or staff engineer inheriting or reviewing the app. Wants typed, tested, documented code with clear module boundaries — the kind she'd accept in a PR at her day job. | Everything Diego sees + raw JSON + event log + branch/replay controls | Full graph diff. PR-style review. | Full read/write, raw edit, event stream, CRDT branching (Phase B). |

**Tier mobility.** Users switch tiers at any time via a profile flag with no data migration. A non-technical user who wants to level up flips a toggle and gets Diego's view.

**The test.** A successful Atlas project goes Ama → Diego → Priya without anyone wanting to throw it out.

## 8. Jobs-to-be-Done

What users hire Atlas to do. Each JTBD maps to a Visualize artifact (§9) and the skill framework routes the right skills automatically.

| Scope | JTBD | Visualize artifact |
|---|---|---|
| **New app** | "Turn my idea into a shipped app." | Spec Graph + wireframes + data model + user flows + compliance class |
| **New feature** | "Add X to my existing app without breaking anything." | Impact analysis across the Spec Graph + diff plan showing exactly what changes |
| **Bug fix** | "My login is broken. Find out why and fix it." | Four-phase debug report (reproduce → isolate → hypothesize → verify) with identified root cause |
| **Dep upgrade** | "Next.js 15 → 16 without surprises." | Breaking-change matrix + compatibility assessment + rollback plan |
| **Refactor** | "Restructure without regressing behavior." | Before/after Spec Graph + behavior-preservation contract + regression-test list |
| **Ship** | "Deploy this to a real URL with auth, payments, DB, observability." | Named rerunnable steps, idempotent, dry-run, one-click rollback armed |
| **Migrate** (Phase B+) | "Move this from AWS to our OpenStack private cloud, zero downtime." | Staged plan + cutover windows + rollback checkpoints + compliance evidence |

## 9. The Visualize → Agree → Build Ritual

**The central product interaction.** Every change to software — greenfield, feature, fix, upgrade, refactor, migration — flows through the same three-step ritual.

### 9.1 Visualize

User intent becomes a structured artifact. Never code. Artifact shape is scope-dependent (table in §8). The artifact is generated by the Architect role composing brainstorming, spec-graph, and runnable-plan skills — never by the Developer role skipping ahead.

### 9.2 Agree

The user reviews and edits the **artifact itself**, not the code. This is the point of no return. The approved artifact is *runnable* in the Superpowers sense: exact file paths, exact diffs, exact tests that must fail then pass, exact commit messages, exact rollback trigger. Not prose. Not vibes. Same quality whether the scope is one line or ten thousand.

Review depth is persona-tiered (§7) but the underlying artifact is identical across tiers. Ama sees a plain-English card view of the same artifact Priya sees as raw JSON.

### 9.3 Build

Deterministic generation from the approved artifact. Code is the **output**, not the conversation. All merge gates (§11.4) run automatically. The Reviewer role critiques every non-trivial diff before the user sees it.

### 9.4 The Ritual at Every Scale

- "Add a forgot-password flow" to a two-year-old app triggers the same Visualize → Agree → Build loop that created the app on day one.
- "Upgrade Next.js 15 → 16" does too.
- "Fix this login bug" does too.
- "Migrate to OpenStack" does too (Phase B+).

The scope changes; the discipline doesn't. This is how Atlas delivers **iterate / maintain / manage** in the mission, not as separate products but as the same ritual applied to a living app.

`plan.md` and `spec.graph.json` are checked into the repo and updated on every ritual loop. They are the **living history** of what was agreed, when, and why.

### 9.5 Edit Classes (the latency contract)

Not every ritual runs the full merge pyramid synchronously — that would be user-hostile for small edits. Three edit classes govern which gates run sync vs async:

- **Cosmetic** (Tailwind class swap, copy edit, color token change): L1 + L2 sync (schema + unit). L3–L5 async post-commit with rollback on red. Target p50 <200ms.
- **Structural** (new node/edge, flow change, schema change): full pyramid sync blocks until green. Target p50 <15s.
- **Security/compliance-touching** (AuthBoundary, RLS policy, ComplianceClass, PII classification): full pyramid sync **plus explicit human confirmation**. No silent merge.

On persistent failure (3 retries), the user gets three next-action options: *retry with hint*, *undo*, or **risk-accepted commit** (persona-gated, audit-logged, compliance-evidence-surfaced). Ama cannot override security. Priya can override aesthetic with audit trail.

**Users do not debug things Atlas silently broke. Users *can* explicitly accept risk and move forward.** This is honest about real engineering workflows.

## 10. The Four Product Principles

### 10.1 Principle 1 — Works the First Time

Every AI-generated change passes the appropriate test-pyramid layers before the user sees output. TDD is mandatory for structural and security-touching edits: failing test first, then minimal implementation, then green.

Tests are generated from the Spec Graph, but **every L4 (Security) and L5 (Compliance) check also carries a human-authored baseline assertion** that skill updates cannot modify. This breaks the circularity of LLM-generated tests validating LLM-generated code — a systematic prompt flaw that omits RLS will also omit its RLS test; the human baseline catches it.

### 10.2 Principle 2 — Secure by Default, Compliant Day One

Every Atlas-generated app ships with the full security baseline on the first commit: TLS 1.3, HSTS preload, strict nonce-based CSP, Argon2id hashing, RLS on every table, parameterized queries, Zod/Pydantic validation at every external boundary, CSRF + SSRF guards, secret scanning, CVE scanning, PII redaction in logs, immutable audit log on sensitive writes. Compliance classes are first-class graph nodes. Baseline is always present, always enforced, **never a Pro-tier upsell**. A `compliance-evidence/` folder emits on every build for auditors.

### 10.3 Principle 3 — Proactively Brainstorm AI Features

At Visualize, Atlas doesn't just accept the user's starting ask — it probes: *"Should this form be a conversation? Could AI predict what the user needs before they click? What would make this app a moonshot in its category?"* The `ai-features-brainstorm.md` skill runs a three-ceiling Socratic loop (table-stakes / differentiator / moonshot), grounded in an extensible Inspiration Library categorized by domain. AIFeature nodes are capability-abstract (no vendor lock-in) and provider-wired at Ship time.

### 10.4 Principle 4 — Category-Leading UX by Default

The Designer role applies a coherent design system, hardware-accelerated animations (Motion v12+ `motion/react`), grounded imagery (Nano Banana 2 at v1; adapter for Flux/Ideogram/SDXL in Phase B), micro-interactions, emotional-design details, and neurodivergent-aware a11y. MediaAsset is a first-class graph node. Prompts live in `.atlas/prompts/` as OSS-shareable templates. The UX+a11y merge gate includes axe-core, keyboard reachability, WCAG contrast, RTL snapshots, reduced-motion respect, neurodivergent cognitive-load audit, Lighthouse ≥ 90, sustainability budget (≤100KB initial JS), and an LLM visual-judge against curated "delightful" references (soft-block v1, hard-block Phase B).

## 11. Architectural Summary

**This section is a summary, not a specification.** The canonical architecture lives in `docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md` (~100KB, post-Council-review, ready for implementation planning). Read that for the full design. This summary is what every team member must know.

### 11.1 Spec Graph — The Living Contract

A typed, queryable, file-canonical data structure that models every architectural concept in an Atlas app.

- **14 node types:** Page · Route · Component · ClientState · Model · Endpoint · Flow · AuthBoundary · Test · DesignToken · Dependency · ComplianceClass · AIFeature · MediaAsset
- **13 edge types:** renders · fetches · reads · mutates · requires · covers · dependsOn · styledBy · subjectTo · supersedes · powers · displays · manages
- **Truth model:** Graph is authoritative for *architectural intent*; code is authoritative for *implementation details*. Drift between them is surfaced in a human-review queue, not silently reconciled. Reconciliation is explicitly lossy and asynchronous — automatic for high-confidence matches once a calibration dataset validates the classifier.
- **Persona-tiered exposure:** the underlying data is identical for all users; only the UI adapts (§7).

**Why it is the moat.** Refactors don't regress prior intent past 30+ files. The agent reads a structured model of intent, not re-derived embeddings per turn. This is Atlas's #1 differentiator against every current AI builder.

### 11.2 Skill Framework — Agents Thin, Skills the IP

Atlas is built as a **composable skill framework** in the tradition of [obra/superpowers](https://github.com/obra/superpowers). Skills are markdown files containing instructions, checklists, and decision tables. They auto-activate based on user intent (no slash commands required for non-power users), compose cleanly (one skill invokes another), and are authorable by anyone.

- **v1 library:** ~35 skills, Apache 2.0, at `github.com/atlas-labs/atlas-skills`.
- **Starter skills:** `brainstorm.md`, `spec-graph.md`, `runnable-plan.md`, `tdd-feature.md`, `four-phase-debug.md`, `edit-only-what-changed.md`, `audit-rls.md`, `wcag-audit.md`, `refactor-without-regression.md`, `upgrade-dependency-safely.md`, `visualize-diff.md`, `approve-or-reject.md`, `ship-with-rollback.md`, `reviewer-critique.md`, `incident-response.md`, plus test generators per node type.
- **Extensibility:** users author `.atlas/skills/*.md`; the framework auto-routes to them via intent classification. Enterprises pin skill sets (`acme-internal-auth.md`, `acme-brand-guidelines.md`) that always activate for their projects.
- **Governance:** public RFC at `github.com/atlas-labs/atlas-skills` accepts community contributions.
- **Skill supply-chain governance:** version-pinning contract in `.atlas/skills/pin.json`, provenance checks, nightly drift detection on a calibration dataset, documented rollback.

**The moat is not the skills.** It is the orchestrator, the Spec Graph, the merge gates, the Ship Pipeline, the execution infrastructure, and the hosted runtime. The skills are given back to the community — which compounds credibility and adoption.

### 11.3 Agent Team — Conductor + Roles

**Conductor + Swarm pattern.** One lightweight Conductor holds the Spec Graph and dispatches work. Specialized roles run in their own context windows using Claude Code Agent Teams primitives (shared task list, peer messaging, file locks).

| Role | Composes (representative skills) | Default model |
|---|---|---|
| **Conductor** | Holds spec graph, classifies intent, dispatches, tracks checkpoints | Haiku 4.5 → Sonnet 4.6 |
| **Architect** | `brainstorm.md` + `spec-graph.md` + `runnable-plan.md`; two-pass (ambiguity triage → deep plan) | Haiku 4.5 → Opus 4.7 |
| **Designer** | design-token, responsive-grid, motion, dark-mode, brand | Sonnet 4.6 |
| **Developer** (parallel) | `tdd-feature.md`, `edit-only-what-changed.md`, `runnable-plan.md` | Sonnet 4.6 + Gemini 2.5 Flash |
| **Schema** | `prisma-schema.md`, `rls-first.md`, `safe-migration.md` | Sonnet 4.6 |
| **Security** (merge gate) | `audit-rls.md`, `cors-policy.md`, `secrets-scan.md`, `cve-check.md` | Opus 4.7 |
| **Accessibility** (merge gate) | `wcag-audit.md`, `rtl-layout.md`, `keyboard-nav.md`, `contrast-check.md` | Sonnet 4.6 + axe-core |
| **Browser Verification** (merge gate) | `playwright-plan.md`, `visual-diff.md`, `console-errors.md` | Sonnet 4.6 + Playwright |
| **Debugger** | `four-phase-debug.md` — reproduce → isolate → hypothesize → verify. Never guesses. | Sonnet 4.6 |
| **Refactor** | `refactor-without-regression.md`, `behavior-preservation.md` | Sonnet 4.6 |
| **Upgrade** | `upgrade-dependency-safely.md`, `breaking-change-matrix.md`, `rollback-ready.md` | Sonnet 4.6 |
| **Reviewer** | `reviewer-critique.md`, `pr-summary.md`, `release-notes.md` | Sonnet 4.6 |
| **Validator** | 3-layer code fixer (stream · AST · build-parse) | Haiku 4.5 |
| **Ship** | `domain-dns-tls.md`, `auth-wire.md`, `payments-wire.md`, `ship-with-rollback.md` | Sonnet 4.6 |

Roles are **thin** (routers, not implementations). Upgrading to a new model (e.g., Opus 5) does not require rewriting agents — skills describe intent, not implementation.

### 11.4 Test Pyramid & Merge Gates

**Five layers in v1**, with a sixth advisory layer for UX/a11y.

| Layer | Gate | Runs | Content |
|---|---|---|---|
| **L1** | Schema static validation | Always sync | JSON Schema · structural invariants · type safety |
| **L2** | Unit + integration | Always sync | Per-node-type tests · component · endpoint · flow |
| **L3** | Browser / E2E | Structural+ sync; cosmetic async | Playwright · visual diff · console errors |
| **L4** | **Security (merge gate)** | Structural+ sync | RLS · CORS · CSP · secrets · authz · CVE · human-authored baselines |
| **L5** | **Compliance-baseline (merge gate)** | Security-touching sync | Baseline · GDPR · HIPAA · SOC2-lite · human-authored baselines |
| L6 | UX + a11y (advisory v1, hard-block Phase B) | Post-commit | axe-core · contrast · keyboard · RTL · reduced-motion · Lighthouse · LLM visual-judge |

**Merge blocked on L1–L5 failure.** Auto-fix attempted first; escalated to user on second failure. On third failure the user gets the three next-action options from §9.5.

**Every L4/L5 check carries a human-authored baseline** (Chairman-flagged Council finding: the single largest risk the Council itself missed). Breaks the LLM-validates-LLM circularity.

### 11.5 Persistence & Sync

**The live coordination substrate is a hosted Postgres mirror, not the file.** `.atlas/spec.graph.json` and `.atlas/events.jsonl` are the **export and audit surface** — regenerable from the mirror at any time.

```
.atlas/
  spec.graph.json           # snapshot — export/audit; regenerated from mirror
  events.jsonl              # append-only log — export/audit
  merge-driver.js           # custom Git merge driver (required on clone)
  schema/
    spec.graph.v1.json      # JSON Schema pinned by version
  derived/                  # brownfield-discovered nodes (uncommitted by default)
  prompts/                  # AIFeature + MediaAsset prompt templates (Git-tracked)
  cache/
    media/                  # generated media keyed by contentHash
    manifest.json
  telemetry/
    test-history.jsonl      # flaky-test quarantine
  plan.md                   # human-readable narrative (auto-regenerated)
compliance-evidence/        # emitted on every successful build
  auth-controls.md
  data-flow.md
  consent-inventory.md
  dependency-inventory.md
  access-audit.md
```

**Custom Git merge driver + documented compaction policy** (snapshot + tail) ship with v1. Users can still export, self-host, or go fully offline — the mirror is recreatable from file + events.

**Why not Git-native live coordination?** The pre-Council v1 design proposed append-only JSONL in Git as the live coordination substrate. All four Council reviewers unanimously predicted text-merge corruption under multi-branch concurrent writes. The hosted Postgres mirror eliminates that class of failure while preserving Git as the portable, auditable, self-hostable surface.

### 11.6 E2B Sandboxes + DB Tiers

**Sandbox:** E2B Firecracker microVMs (150ms cold start, hardware isolation — non-negotiable after CVE-2025-48757). Pre-warmed at T=0. Reclaimed after 15 min inactivity with snapshot.

**v1 templates (2):** `atlas-next-ts` (Next 15 App Router + React 19 + TypeScript strict + Tailwind 4) and `atlas-python-fastapi` (FastAPI + Python 3.12 + Postgres sidecar). Signed, weekly rebuilds, digest-pinned per project. Additional templates (react-vite, astro, sveltekit, go-chi, expo) deferred to Phase B.

**DB tiers:**
- **Dev:** SQLite in E2B (offline, instant).
- **Run:** Neon or Supabase (managed serverless Postgres, Architect-recommended default).
- **BYODB:** documented (user provides connection string).
- **Atlas Managed (Phase B):** OpenEverest on Atlas-operated K8s.
- **Atlas Sovereign (Phase D):** OpenEverest on user K8s.
- PlanetScale cut from v1 (Postgres-first semantics conflict).

**Offline/local mode:** the whole stack runs on the user's laptop via Docker Compose for privacy-sensitive work (health, gov, regulated industries).

### 11.7 Observability & Compliance Evidence

**Operator plane:** OpenTelemetry traces, structured logs, SLOs for daemon + Postgres mirror + ambiguity-classifier drift, Prometheus metrics per merge-pyramid layer latency.

**Auditor plane:** `compliance-evidence/` folder emitted on every successful build. Contains auth-controls, data-flow, consent-inventory, dependency-inventory, access-audit artifacts, each cryptographically linked to the event SHA that produced them.

**Public surface:** uptime + reliability page like [status.stripe.com](https://status.stripe.com) from day one.

## 12. Functional Requirements

What v1 Atlas Build must deliver. Traced to the six jobs (§8) and four principles (§10).

| ID | Requirement | Source |
|---|---|---|
| **F-1** | User creates a new app from a natural-language prompt via the Visualize → Agree → Build ritual | §9, JTBD: New app |
| **F-2** | User adds a feature to an existing app via the same ritual, producing an impact-analyzed diff plan | §9, JTBD: New feature |
| **F-3** | User fixes a bug via four-phase debug, producing a root-cause artifact | §9, JTBD: Bug fix |
| **F-4** | User upgrades a dependency via breaking-change matrix + rollback-armed apply | §9, JTBD: Dep upgrade |
| **F-5** | User refactors via before/after graph + behavior-preservation contract | §9, JTBD: Refactor |
| **F-6** | User ships via the Ship Pipeline (domain, DNS, TLS, DB, auth, payments, CI, one-click rollback) | §9, JTBD: Ship |
| **F-7** | Spec Graph persisted to hosted Postgres mirror with Git-trackable file export | §11.5 |
| **F-8** | Custom Git merge driver resolves conflicts on `.atlas/*` under Postgres coordination | §11.5 |
| **F-9** | Agent team operates under Conductor + Swarm pattern with 14 roles (§11.3) | §11.3 |
| **F-10** | Five-layer test pyramid enforces merge gates (L1–L5) with human-authored baselines at L4/L5 | §11.4 |
| **F-11** | Three-tier edit classes (cosmetic / structural / security-touching) govern sync vs async gates | §9.5 |
| **F-12** | Risk-acceptance override allowed, persona-gated, audit-logged, compliance-surfaced | §9.5 |
| **F-13** | OSS skill library (~35 skills) at `github.com/atlas-labs/atlas-skills` under Apache 2.0 | §11.2 |
| **F-14** | User-authored skills under `.atlas/skills/*.md` auto-route via intent classification | §11.2 |
| **F-15** | Skill supply-chain governance — version pin, provenance, drift detection, rollback | §11.2 |
| **F-16** | Four compliance classes v1: baseline · GDPR · HIPAA · SOC2-lite | §15 |
| **F-17** | Image generation via Nano Banana 2 with provider adapter (video deferred) | §10.4 |
| **F-18** | Full export: `git clone` produces a runnable app with tests passing on a clean machine | Principle — Ownership |
| **F-19** | Dual-pane UX: Canvas (Ama) + Code (Diego/Priya) synced live; click-in-one highlights in the other | §7 |
| **F-20** | Three persona tiers switchable via profile flag with no data migration | §7 |
| **F-21** | Persona-tiered error messaging across Ama / Diego / Priya | §7, §10 |
| **F-22** | Bootstrap review checkpoint before first ritual commits (six-item checklist, persona-tiered UX) | Council blind-spot #1 |
| **F-23** | Observability (OpenTelemetry + structured logs + SLOs + compliance-evidence folder) ships at v1 | §11.7 |
| **F-24** | Deployment contract: Neon branching + Vercel/Fly promotion + event-SHA-tied rollback + migration ordering + post-deploy health checks | §11.7 |

## 13. Non-Functional Requirements

| ID | Requirement | Target | Measurement |
|---|---|---|---|
| **NFR-1** | TTFP (skeleton preview) | <15s p50 / <25s p95 | /api/metrics |
| **NFR-2** | Time to enriched preview | <45s p50 / <75s p95 | /api/metrics |
| **NFR-3** | Reliability (working preview) | ≥97% | 1,000-prompt weekly eval |
| **NFR-4** | Security gate fail rate on merged code | <1% of merges | Security telemetry |
| **NFR-5** | WCAG 2.2 AA pass on first gen | >95% | axe-core on 100-prompt eval |
| **NFR-6** | Avg cost per project generation | <$0.30 (Builder tier) | Token spend ÷ project count |
| **NFR-7** | Iteration p50 latency | <10s | Iterate endpoint trace |
| **NFR-8** | Cosmetic edit p50 | <200ms | L1+L2 path trace |
| **NFR-9** | Spec-graph coherence at 100 files | 0 dangling refs | Graph validator |
| **NFR-10** | Export correctness (fresh clone → runs) | 100% | Nightly eval |
| **NFR-11** | Supported UI languages | 25+ | i18n scaffold |
| **NFR-12** | Low-bandwidth initial JS | <100KB | Lighthouse on generated apps |
| **NFR-13** | Prompt-cache hit rate on Developer role | >80% | Cache telemetry |

## 14. Pricing & Plans

**Flat, capped, transparent. No credits. No per-token surprises.** If Atlas blows unit economics on heavy users, that's Atlas's problem — Atlas fixes the agents, not the user's wallet. This is a deliberate bet against the industry norm ([Cursor / Bolt / Lovable credit backlash](https://www.morphllm.com/comparisons/windsurf-vs-cursor)).

| Tier | Price | What you get |
|---|---|---|
| **Atlas Free** | $0 | 3 projects, 30 iterations/mo, Atlas subdomain |
| **Atlas Builder** | **$29/mo flat** | Unlimited reasonable use, 10 projects, custom domains, GitHub export, Atlas Run managed hosting |
| **Atlas Pro** | **$99/mo flat** | Unlimited projects, team seats (3), background agents, Atlas Migrate entry tier (10 migrations/quarter, Phase B+) |
| **Atlas Team** | **$39/seat/mo** | All Pro + SSO, audit logs, shared spec graphs |
| **Atlas Social Impact** | Free (verified) | Full Builder + Run; Migrate at 90% discount (Phase B+) — verified NGOs, public schools, public health clinics in LMICs |
| **Atlas Enterprise** | Contact | SOC 2, self-host, VPC, SLA |
| **Atlas Migrate Enterprise** (Phase B+) | Usage + annual | Unlimited migrations, OpenStack/VMware/bare-metal, compliance evidence, dedicated migration engineer |
| **Atlas Sovereign** (Phase D+) | Custom | Self-host the entire platform; regulated / public sector |

## 15. Compliance Posture

**Baseline security is always on, always free.** See §10.2 for the always-enforced baseline.

**Compliance classes in v1 (four):** `baseline` · `GDPR` · `HIPAA` · `SOC2-lite`. ComplianceClass is a first-class graph node (§11.1) and activates a set of per-class skills at L5.

**Deferred to Phase B+:** PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · ISO27001.

**The evidence pack.** `compliance-evidence/` emits on every successful build. Contains auth-controls, data-flow, consent-inventory, dependency-inventory, access-audit, each cryptographically linked to the event SHA. **Tooling to help auditors, never a replacement for them.** Third-party aggregator integrations (Drata, Vanta, Secureframe) planned for Phase C.

---

# Part III — Execution

Part III turns the product into a concrete delivery plan. The current work front is **Phase A: Build Foundation**. The next work milestone is **Unit A: Spec Graph Persistence & Ops**.

## 16. Phase Plan A–F

| Phase | Window | Scope |
|---|---|---|
| **A — Atlas Build Foundation** | Q2 2026 (current) | Spec Graph persistence, skill framework, Conductor + priority roles, Visualize → Agree → Build ritual, bootstrap review checkpoint, edit-semantics tiering |
| **B — Build polish + Migrate alpha** | Q3 2026 | v1 scope cuts reintroduced where earned (AST visual edit, Figma import, additional E2B templates, video gen). Migrate backend fused per Option A (monorepo). Infra nodes added to Spec Graph. |
| **C — Run managed hosting** | Q3–Q4 2026 | One-click deploy to Vercel/Fly/Cloudflare. Observability dashboard. SLO + health dashboards. Multi-region failover (Pro). |
| **D — Sovereign / on-prem** | Q4 2026 → Q1 2027 | OpenStack target GA. VMware vSphere. Bare-metal K8s. Regional sovereign-cloud partners (CtrlS, ESDS, Yotta, OVHcloud, Scaleway). Atlas Sovereign self-host. |
| **E — Migrate GA** | Q1 2027 | Full HIPAA/SOC2/DPDP/GDPR/ITAR evidence generators. Zero-downtime cutover playbooks shipped. Enterprise migration motion. |
| **F — Brownfield** | H1 2027+ | Reverse-engineer spec graph from running legacy systems. Brownfield → Atlas Build modernization. FedRAMP Moderate. India DPDP sovereign-cloud partner program. EU Cloud Services Scheme alignment. |

**Integration with `cloud_migration` codebase:** Option A (monorepo fusion) per prior ecosystem analysis. Move `cloud_migration` into `/services/migrate/` + `/apps/migrate/`. Extract shared libs to `/packages/llm`, `/packages/spec-graph`, `/packages/agent-team`, `/packages/compliance`. Target: 6–8 weeks of integration after Phase A closes, before Phase B kicks off.

## 17. Phase A Unit Decomposition

Seven independently-buildable units. Units A → B → (C ∥ D) → E → F → G.

### Unit A — Spec Graph Persistence & Ops Foundation  *(the next work; see §18)*
**Scope:** Postgres schema for the mirror; `spec_graphs` table with `id`, `project_id`, `event_log: jsonb`, `version`, `synced_at`; file ↔ mirror sync contract; snapshot + tail compaction policy; custom Git merge driver for `.atlas/*`; connection pooling for hosted Postgres.
**Dependencies:** none (foundational).
**Effort:** M (2–3 weeks).
**Strategic value:** nothing else can start. Unblocks all downstream units.

### Unit B — Core Schema & Validation
**Scope:** 14 node types + 13 edge types as TypeScript types + JSON Schema artifact + L1 validator + structural invariants + Python (Pydantic) bindings. Publish `@atlas/spec-graph-schema` package.
**Dependencies:** Unit A (needs mirror schema).
**Effort:** M (3–4 weeks).
**Strategic value:** agents consume this; it must stabilize before skill authoring.

### Unit C — Skill Framework Scaffold + Test Generator Registry
**Scope:** Skill dispatcher (intent classification → skill activation); OSS library hosting on `github.com/atlas-labs/atlas-skills`; test-generator skill per node type (LLM-generated + human baseline); CI/CD for skill publishing; `.atlas/skills/pin.json` schema; nightly drift detection on calibration dataset.
**Dependencies:** Unit B.
**Effort:** M (3–4 weeks).
**Strategic value:** orthogonal to agent implementation; lands in parallel with Unit D.

### Unit D — Conductor + Orchestration Roles
**Scope:** Lightweight Conductor (holds graph, triage intent, dispatch). Four priority roles: Architect, Developer, Security, Accessibility. Inherit v2 agent infrastructure where possible.
**Dependencies:** Units A, B.
**Effort:** L (2–3 weeks shells; 4–5 weeks full).
**Strategic value:** core loop. Everything else is specialization.

### Unit E — Visualize → Agree → Build Ritual + UX Surfaces
**Scope:** Three-step flow. Visualize artifact emission. Agree artifact editing. Build deterministic generation. Persona-tiered rendering (Ama card / Diego checklist / Priya JSON). Dual-pane Canvas/Code sync.
**Dependencies:** Units A–D.
**Effort:** L (2–3 weeks).
**Strategic value:** the product. Everything else is enabler.

### Unit F — Bootstrap Review Checkpoint + Risk-Acceptance Gates
**Scope:** Human-in-the-loop gate before first ritual commits. Six-item checklist (persona-tiered UX). Risk-acceptance annotation schema (persona-gated, audit-logged, compliance-surfaced).
**Dependencies:** Units A–E.
**Effort:** S (1–2 weeks).
**Strategic value:** Council blind-spot #1 resolution. Launch-blocker.

### Unit G — Edit Semantics Tiering + Latency Optimization
**Scope:** Three edit classes with different gate activation. Measure and optimize L1+L2 for <200ms cosmetic edits (NFR-8). Async pyramid for structural edits.
**Dependencies:** Units A–E.
**Effort:** M (2–3 weeks).
**Strategic value:** unblocks user iteration experience; foundational quality signal.

**Phase A ship target: 10–12 weeks from Unit A start to Unit F close, assuming aggressive parallelism.**
Indicative schedule: Unit A weeks 1–3 · Units B, C, D in parallel weeks 3–7 · Unit E weeks 7–9 · Unit F weeks 9–10 · Unit G weeks 10–12 (overlapping with post-Unit-F polish). Unit G is iteration optimization but is a Phase A deliverable, not Phase B. Slippage on Unit A compresses every downstream window — protect that path.

## 18. Next Work Milestone — Unit A

**Unit A is the first implementation milestone.** It is the foundation that every other unit depends on. Everything in Phase A is gated on Unit A's completion.

### 18.1 Why Unit A first

- **No code runs without it.** Every agent, skill, and ritual reads or writes the Spec Graph. The Spec Graph has nowhere to live until Unit A ships the mirror schema, file-sync contract, and merge driver.
- **Council MUST-2 resolution.** The Postgres mirror replaces the Git-text-merge-corruption-prone JSONL coordination substrate the pre-Council v1 proposed. Unit A is how that decision lands in code.
- **Boring is correct.** The work is schemas, sync logic, merge drivers, compaction rules. No novel product surface. But skipping it or half-building it guarantees churn downstream.

### 18.2 Unit A deliverables

1. **Postgres schema** — `spec_graphs` table (primary), `spec_events` table (append-only event log), `spec_snapshots` table (point-in-time recovery). Connection pooling configured for hosted Postgres.
2. **File ↔ mirror sync daemon** — watches `.atlas/spec.graph.json` and `.atlas/events.jsonl`; propagates to mirror; regenerates file from mirror on demand. Latency SLO: p95 <500ms for single-event propagation.
3. **Custom Git merge driver** — installed as a Git attribute on `.atlas/*`. Defers to Postgres mirror for conflict resolution. Ships with documented install on `git clone`.
4. **Compaction policy** — snapshot + tail. Tail length, snapshot cadence, cold-storage archival cadence all documented and parameterized.
5. **Tenant isolation checks** — multi-project Postgres tenancy; every query scoped by `project_id`.
6. **Offline/local mode** — Docker-Compose Postgres spun up alongside E2B template; sync daemon works against local mirror identically.
7. **Observability** — OpenTelemetry spans on every sync operation; Prometheus metrics on propagation latency, conflict resolution, snapshot size.
8. **Tests** — unit tests on every component; integration tests covering the matrix of (single-user, multi-user, offline, reconnect, conflict, compaction-boundary).

### 18.3 After Unit A

The implementation plan for Unit A is authored via the `superpowers:writing-plans` skill — the successor to this PRD. That plan will decompose Unit A into concrete tasks, file paths, diffs, tests, and commit boundaries. Execution follows via `superpowers:executing-plans` or `superpowers:subagent-driven-development`.

## 19. Success Metrics

Phase A ship gate — the acceptance criterion for leaving Phase A:

1. **One real Atlas Build project** ships through the full ritual loop (create → feature → bug fix → dep upgrade → refactor).
2. **Three users at three technicality tiers** (Ama, Diego, Priya) successfully use it on the same project — each seeing the appropriate level of graph exposure, all producing the same underlying events, all passing L1–L5.
3. **Reliability ≥95%** on the 1,000-prompt weekly eval.
4. **All NFRs** in §13 met at p50 (p95 targets can trail by one sprint).

Product success metrics — what winning looks like at GA:

- **Correctness:** 97% browser-verification pass on first run (NFR-3).
- **Security:** 0 critical CVEs attributable to Atlas-generated defaults per quarter.
- **Accessibility:** 95%+ WCAG 2.2 AA pass on first generation (NFR-5).
- **Shipping:** 50%+ of projects reach a live deployed URL (vs. industry <15% for "apps that ever ship").
- **Ownership:** 100% of projects exportable to a Git repo that runs clean on a fresh clone (NFR-10).
- **Pricing trust:** NPS on billing clarity ≥ 50 (industry baseline negative).
- **Social impact:** 5,000 verified NGO / school / clinic projects shipped in year one.
- **Global:** 25+ UI languages, 10+ regional payment providers on launch (NFR-11).

## 20. In v1 vs Deferred

### 20.1 In v1 (must ship Phase A)

- 14 node types / 13 edge types / L1–L5 pyramid / 4 compliance classes
- 2 E2B templates (`atlas-next-ts`, `atlas-python-fastapi`)
- ~35 skills, Apache 2.0 library
- 3 personas (Ama / Diego / Priya)
- Claude Design importer (single importer)
- Nano Banana 2 image generation
- Motion v12+ animation
- Visualize → Agree → Build ritual at all six JTBDs
- Bootstrap review checkpoint
- Risk-acceptance overrides (persona-gated)
- Observability (operator + auditor planes)
- Deployment contract (Neon branching + Vercel/Fly + rollback + migration ordering + health checks)

### 20.2 Explicitly deferred to Phase B+

**Infrastructure & migration:**
- Infra nodes (Region, ComplianceClass as node, Runtime, Provider, DataResidency, WorkloadTopology) → Phase B
- Atlas Migrate product GA → Phase B–E
- Brownfield discovery / reverse-engineering → Phase F

**Media:**
- Video generation (Seedance, Kling, Veo, Runway) → Phase B
- Audio → Phase C
- Additional image providers (Flux, Ideogram, SDXL) → Phase B

**E2B templates (Phase B–D):** react-vite, astro, sveltekit, go-chi, expo, rust, elixir.

**Importers (Phase B+):** Figma, Stitch.

**Visual editing (Phase B):** AST-based visual edit mode, client-side Tailwind generator, 7 edit categories, bulk operations, drag-drop layout. v1 uses graph-mutation-driven regeneration only.

**Compliance classes (Phase B–D):** PCI-DSS, ITAR, FERPA, DPDP-India, COPPA, LGPD, POPIA, ISO27001.

**Testing & observability (Phase B+):** L6 UX/a11y as merge-blocking (advisory only in v1), L7 neurodivergent cognitive-load audit, mutation testing, fuzz testing, formal verification, chaos engineering.

**Multi-branch graph merge semantics (Phase B):** long-lived branch graph forking/merging; CRDT for collaborative editing.

**Run pipeline (Phase C–D per PRD_v3):** one-click deploy, observability dashboard, multi-region failover.

## 21. Risks & Open Questions

### 21.1 Still-live Council blind-spots to keep tracking

1. **Graph-chunking at 500+ nodes.** For large projects, how is the graph serialized into LLM prompts without lost-in-the-middle degradation? Options: graph-RAG with vector retrieval, node-count ceiling (e.g., 200) for v1, hybrid chunking with LLM-driven relevance. **Open.**
2. **Ambiguity classifier calibration dataset.** Async reconciliation depends on a classifier that gates high-confidence auto-merges vs human-review-queue. The calibration dataset (20–50 real projects) is a prerequisite. **Open.**
3. **Skill supply-chain attack surface.** Nightly drift detection is scoped, but governance needs a staffed owner; one bad skill update can cascade. **Scoped, not staffed.**
4. **Human-authored L4/L5 baseline authorship.** Who writes the initial baseline set? What is the review cadence? This is the single largest risk the Council itself missed. **Owner required before Phase A ship.**
5. **Postgres-mirror cost at scale.** The mirror is a live database per project. At 10k projects the operational bill is non-trivial. **Modeling required by end of Phase A.**

### 21.2 Product risks

1. **Scope is enormous.** Build + Run + Migrate is three products. Mitigation: phase ruthlessly; do not ship Migrate self-serve until Build reliability is ≥97%.
2. **Enterprise sales motion differs from PLG.** Build sells bottom-up ($29/mo); Migrate sells top-down (six figures). Separate playbooks required. Mitigation: hire enterprise leadership only after $1M ARR on Build.
3. **Unit economics at flat pricing.** Heavy agent users could tank margins. Mitigation: rigorous cost telemetry, soft throttles, transparent usage dashboards.
4. **Compliance evidence is legal, not just technical.** A mis-certified evidence pack is a lawsuit. Mitigation: evidence is *tooling to help auditors*, never a replacement. Clear disclaimers. Third-party partners (Drata, Vanta, Secureframe) integrate, do not substitute.

### 21.3 Still-open product questions

1. **Self-host posture at launch.** Do we offer open-core self-host for regulated industries at v1, or hold for Phase F? Default: hold.
2. **Agent-judge reliability.** Do we need human-in-the-loop spot-checks on the browser-verification judge in early phases? Default: yes, behind a feature flag.
3. **Brand loudness on sovereignty.** "Escape hyperscalers" narrative is a massive tailwind in EU/India/Africa markets and polarizing in US markets. Open: how hard do we lean?
4. **Integration timing.** Option A monorepo fusion is 6–8 weeks. Runs after Phase A closes. Alternative: start fusion work in parallel with later Phase A units to compress the calendar. Open.

## 22. Go-to-Market

### 22.1 Positioning

**"The AI Builder that ships real software."** Against v0/Bolt/Lovable/Emergent: we are not a demo factory. Against Cursor/Windsurf: we are not an IDE. Against Firebase/Vercel: we are a builder, not a runtime.

**The lifecycle line:** "Visualize → Build → Iterate → Maintain → Manage → Migrate. One platform. One bill. One team." This is the mission translated to GTM copy.

### 22.2 Launch shape

- **Soft launch at Phase A close:** invite-only beta for the three-persona test (§19). Target: one hero project per vertical (SaaS, internal tools, NGO, public-sector pilot).
- **Public launch at Phase B close:** open access + `github.com/atlas-labs/atlas-skills` goes public. Content: live-coded healthcare-clinic app in Hindi, end-to-end including RLS + HIPAA-baseline + Vercel deploy.
- **Enterprise outreach at Phase D close:** Atlas Migrate GA + Sovereign pilot program. India (CtrlS, Yotta, ESDS), EU (OVHcloud, Scaleway), Africa (Liquid Telecom).

### 22.3 Distribution

- **Open-source skill library as distribution.** Every skill is Apache 2.0, visible on GitHub, contributable by the community. Mirrors the [obra/superpowers](https://github.com/obra/superpowers) 121K-star playbook.
- **Public uptime + reliability dashboard** (like status.stripe.com) from day one. Trust as a distribution channel.
- **Social Impact program** drives verified-NGO and public-sector flywheel and produces the emotional case studies that convert enterprise buyers.
- **No influencer marketing, no launch tweet-storms, no credit hype cycles.** Atlas competes on substance.

### 22.4 Pricing message

"Flat. Capped. Transparent. No credit burn. No per-token surprises. Security and accessibility always on, always free. $29/mo builds you a real app. $0 if you're an NGO or a public clinic."

---

# Appendices

## Appendix A — Glossary

- **Atlas Ritual** — the three-step Visualize → Agree → Build interaction applied at every scope, from one-line edits to new apps to migrations.
- **Agree step** — the point-of-no-return where the user reviews and edits the Visualize artifact. The artifact is runnable in the Superpowers sense — exact file paths, exact diffs, exact tests.
- **Conductor + Swarm** — agent orchestration pattern. One lightweight Conductor holds the Spec Graph and dispatches work to specialized roles running in their own context windows.
- **Edit class** — the tier (cosmetic, structural, security/compliance-touching) that governs which merge-pyramid layers run synchronously vs. post-commit.
- **Human-authored baseline** — a static, non-LLM-generated assertion at L4 (Security) and L5 (Compliance) that skill updates cannot modify. Breaks LLM-validates-LLM circularity.
- **Living Spec Graph** — the typed, queryable, file-canonical structure that models every architectural concept in an Atlas app. 14 node types, 13 edge types.
- **Merge gate** — a pyramid layer that blocks merge on failure. L1–L5 in v1.
- **Mirror** — the hosted Postgres instance that is the live coordination substrate for the Spec Graph. `.atlas/*` files are the export/audit surface, regenerable from the mirror.
- **Ritual** — shorthand for the Atlas Ritual.
- **Risk-accepted commit** — a persona-gated, audit-logged override that lets a user explicitly accept a failing gate to unblock work.
- **Role** — a thin agent router that composes skills. Roles are the orchestration IP; skills are the OSS IP.
- **Ship Pipeline** — the one-click deploy orchestration that handles domain, DNS, TLS, DB, auth, payments, observability, and rollback.
- **Skill** — a markdown file containing instructions, checklists, and decision tables, auto-activated by the framework based on user intent. Apache 2.0.
- **Spec Graph** — see Living Spec Graph.
- **Superpowers** — the [obra/superpowers](https://github.com/obra/superpowers) skill framework that inspired the Atlas Skill Library.
- **TTFP** — Time To First Preview. NFR-1 target: <15s skeleton, <45s enriched.
- **Visualize artifact** — the structured output of the Visualize step. Shape depends on JTBD (spec graph for new app, diff plan for feature, debug report for bug, etc.).

## Appendix B — Archived Documents

Moved to `docs/archive/`:

- `PRD.md` (SiteForge v2, original baseline — superseded)
- `PRD1.md` (intermediate iteration — superseded)
- `PRD_v3.md` (Atlas Build canonical until 2026-04-18 — superseded by this document)
- `ECOSYSTEM_VISION.md` (four-pillar vision — content absorbed into Part I; kept for historical reference)

Still live (not archived):

- `docs/superpowers/specs/2026-04-18-spec-graph-v1-design.md` — canonical architecture reference. Part II §11 summarizes; this is the deep authority.
- `docs/council-review/2026-04-18-spec-graph-v1-pass1.md` — the LLM Council review that gated v1 revisions. Still live because its findings drive §21.1 follow-ups.
- `docs/CODEGEN_UPGRADE.md` — future-phase backlog for `iac/` service refactor (Phase B+ prerequisite for Migrate). Not part of Phase A.

## Appendix C — Reference Links

- Competitive analysis (April 2026 snapshot): see archived `PRD_v3.md` Appendix A for the full 16-product comparison matrix.
- `cloud_migration` repository: `github.com/birjushah1601/cloud_migration` — Atlas Migrate inheritance.
- OSS skill library (placeholder): `github.com/atlas-labs/atlas-skills`.
- [obra/superpowers](https://github.com/obra/superpowers) — the skill-framework pattern Atlas inherits.
- [GitHub Spec Kit](https://github.com/github/spec-kit) — spec-driven development movement Atlas extends.
- [CVE-2025-48757](https://mattpalmer.io/posts/2025/05/CVE-2025-48757/) — the Lovable/Supabase RLS failure pattern Atlas's Security merge gate blocks.
- [AI Code Sandbox Benchmark 2026](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026) — source for E2B microVM selection.
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) — primitives backing the Conductor + Swarm pattern.
- [BEON.tech 2026 Talent Report](https://beon.tech/blog/software-development-talent-shortage/) — P1 developer-scarcity source.
- [WebAIM Million 2025](https://webaim.org/projects/million/) — P4 accessibility-baseline source.

---

**End of Atlas PRD v1.**
