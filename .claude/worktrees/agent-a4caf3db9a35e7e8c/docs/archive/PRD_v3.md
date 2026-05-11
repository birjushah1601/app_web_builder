# Product Requirements Document: SiteForge v3 (codename **Atlas**)

> The best AI Website & App Builder in the world — engineered to solve real software-engineering problems at global scale.
>
> Last updated: 2026-04-18
> Supersedes: `docs/PRD.md`, `docs/PRD1.md` (kept for historical reference)
> Priority order: **Correctness > Coherence > Security > Speed > Cost**

---

## 1. Vision

> **"Every person, team, clinic, school, NGO, and small business on earth should be able to ship production-grade, secure, accessible software as easily as writing a document."**

Today there is a ~4M–85M global software-engineer shortage ([BEON.tech, 2026](https://beon.tech/blog/software-development-talent-shortage/)), 95.9% of top sites fail basic WCAG ([WebAIM Million 2025](https://webaim.org/projects/million/)), 25% of LLM-generated code ships with known CVE patterns ([2026 study](https://dl.acm.org/doi/10.1145/3716848)), and 170+ AI-generated apps leaked real user data last year ([CVE-2025-48757](https://mattpalmer.io/posts/2025/05/CVE-2025-48757/)). AI builders today make demos fast — they don't make working software.

**Atlas exists to close that gap.** Not a "vibe coding" toy. A rigorous software factory that produces code a senior engineer would sign off on, apps that a security auditor would approve, and products a user in Nairobi on a 2G Android phone can actually use.

---

## 2. Mission: The Five World Problems We Are Solving

These are the explicit problems that shape every design decision. If a feature does not serve one of these, it does not ship.

| # | Problem | How Atlas Attacks It |
|---|---------|---------------------|
| **P1** | **Developer scarcity**: the world is short millions of engineers; local software for local problems (clinics, co-ops, regional govts, NGOs) never gets built because hiring is unaffordable. | Non-dev → working app in under an hour, at flat predictable cost. Output is real, exportable code — not a hosted trap. |
| **P2** | **AI code is insecure by default**: 25% vulnerability rate in LLM output; public incidents (Lovable/Supabase RLS) exposed 170+ apps. | A dedicated **Security Agent** audits every change: RLS, CORS, authz, secrets, CSP, dependency CVEs. No merge without a passing audit. |
| **P3** | **The last-mile deploy gap**: users generate apps but never ship. Domains, DNS, auth, payments, DB migrations, observability — all DIY and all blocking. | **Ship Pipeline** handles domain purchase, DNS, TLS, managed DB, auth provider, Stripe/Paystack/Razorpay wiring, CI, and 1-click rollback — as first-class product surface, not an afterthought. |
| **P4** | **Accessibility & localization debt**: the global web is unusable for billions — 95.9% WCAG fail rate, English-only React dominates. | WCAG 2.2 AA enforced by the Accessibility Agent on every component. First-class RTL, i18n, low-bandwidth, low-end Android modes as defaults, not options. |
| **P5** | **Code rot & maintenance burden**: AI builders lose architectural coherence past ~30 files; generated code is called "AI slop" and rewritten by pros. | **Living Spec Graph** — a persistent, structured representation of the app that the agent reads and updates, not re-derives every turn. Refactors don't regress. |

Every one of these is measurable. See §11.

---

## 3. Target Users

Three personas, one product. The handoff between them is a core feature, not an afterthought.

1. **Ama** — the non-dev founder / small-business owner / NGO operations lead. Describes an app in plain English (or Hindi, Swahili, Arabic, Portuguese). Wants a working product shipped to users, not a codebase.
2. **Diego** — the solo dev / frontend dev / designer who shortcuts boilerplate. Wants clean, editable code, iteration speed, real Git, and export.
3. **Priya** — the senior / staff engineer who inherits or reviews the app. Wants typed, tested, documented code with clear module boundaries — the kind she'd accept in a PR at her day job.

**Test:** A successful Atlas project goes Ama → Diego → Priya without anyone wanting to throw it out.

---

## 4. Core Principles (Hierarchy of Values)

In order. Earlier principles override later ones.

1. **Correctness** — the app works when a real user exercises it, verified by a headless browser, not by "the build succeeded."
2. **Coherence** — the codebase is architecturally consistent at 10 files, 100 files, and 1,000 files.
3. **Security & Privacy** — defaults are safe. RLS on by default. Secrets never leak. PII handled correctly. Audit logs.
4. **Accessibility & Inclusivity** — WCAG 2.2 AA, full i18n/RTL, works on low-end hardware/networks.
5. **Speed** — <15s to a working skeleton, <45s to an enriched full-stack preview.
6. **Cost** — flat, capped, predictable pricing. No "$20 gone in 40 minutes" ([common Bolt complaint](https://www.nxcode.io/resources/news/lovable-vs-bolt-new-2026-ai-app-builder-comparison)).
7. **Ownership** — the user's code is the user's code. Full export, self-host, portable.

---

## 5. What We Build That No One Else Does

The competitive gap analysis (from live research on v0, Bolt, Lovable, Replit Agent 3, Cursor, Windsurf, Devin, Firebase Studio, Claude Code, GitHub Spark, etc.) surfaced eight consistent weaknesses across the entire market. Atlas is the only product that addresses all eight.

| Market Gap (April 2026) | Atlas Differentiator |
|--------------------------|----------------------|
| Context amnesia past ~30–50 files | **Living Spec Graph** + tree-sitter code graph + symbol-level retrieval (see §7.2) |
| "Works-on-my-demo" pseudo-verification | **Browser Verification Agent** runs E2E + visual diff before every merge |
| Credit/token anxiety | **Flat-rate plans with real caps**, transparent cost dashboard, usage projections |
| Insecure defaults (CVE-2025-48757 epidemic) | **Security Agent** blocks merges on RLS, CORS, secrets, authz, CVE checks |
| Hosted traps, export = "AI slop" | **Priya-grade export**: TypeScript, tests, docs, CI, conventional commits, clean boundaries |
| Design fidelity OR backend power — never both | **v0-grade UI + Replit-grade runtime** in one pipeline |
| No real non-dev ↔ dev collaboration | **Dual-pane UX**: visual canvas for Ama, code editor for Diego, PR review for Priya — same project, real-time |
| Mobile parity is weak | **First-class Expo / React Native output** alongside web, shared design system |
| Iteration degrades at scale; "vibe coding" skips discipline | **Unified Visualize → Agree → Build ritual** at every scope (new app, feature, bug fix, upgrade, refactor), powered by an **open-source skill library** (Apache 2.0, Superpowers-influenced) |

---

## 6. Functional Requirements

### 6.1 Skill Framework + Orchestration Roles

Atlas is built as a **composable skill framework** in the tradition of [obra/superpowers](https://github.com/obra/superpowers) — not a fixed roster of monolithic agents. Skills are markdown files containing instructions, checklists, and process diagrams. They **auto-activate based on user intent** (no slash commands required for non-power users), **compose cleanly** (one skill invokes another), and are **authorable by anyone** — the entire library ships open-source under Apache 2.0 from day one (see §6.9).

On top of the skill library sit **orchestration roles** — thin context windows that compose skills into coherent workflows. Roles are *routers*, not *implementations*:

| Role | What it composes (representative skills) | Default model |
|------|-------------------------------------------|----------------|
| **Conductor** | Holds the Spec Graph, classifies user intent, dispatches roles, tracks checkpoints | Haiku 4.5 triage → Sonnet 4.6 |
| **Architect** | `brainstorm.md` + `spec-graph.md` + `runnable-plan.md`. Two-pass: ambiguity triage → deep plan | Haiku 4.5 → Opus 4.7 |
| **Designer** | design-token, responsive-grid, motion, dark-mode, brand skills | Sonnet 4.6 |
| **Developer** (parallel) | `tdd-feature.md`, `edit-only-what-changed.md`, `runnable-plan.md` | Sonnet 4.6 + Gemini 2.5 Flash |
| **Schema** | `prisma-schema.md`, `rls-first.md`, `safe-migration.md` | Sonnet 4.6 |
| **Security** | `audit-rls.md`, `cors-policy.md`, `secrets-scan.md`, `cve-check.md` — **merge gate** | Opus 4.7 |
| **Accessibility** | `wcag-audit.md`, `rtl-layout.md`, `keyboard-nav.md`, `contrast-check.md` — **merge gate** | Sonnet 4.6 + axe-core |
| **Browser Verification** | `playwright-plan.md`, `visual-diff.md`, `console-errors.md` — **merge gate** | Sonnet 4.6 + Playwright |
| **Debugger** | `four-phase-debug.md` — reproduce → isolate → hypothesize → verify. Never guesses | Sonnet 4.6 |
| **Refactor** | `refactor-without-regression.md`, `behavior-preservation.md` | Sonnet 4.6 |
| **Upgrade** | `upgrade-dependency-safely.md`, `breaking-change-matrix.md`, `rollback-ready.md` | Sonnet 4.6 |
| **Reviewer** | `reviewer-critique.md`, `pr-summary.md`, `release-notes.md` — critiques every non-trivial diff before it surfaces | Sonnet 4.6 |
| **Validator** | 3-layer code-level fixer (stream, AST, build-parse) — inherited from v2 | Haiku 4.5 |
| **Ship** | `domain-dns-tls.md`, `auth-wire.md`, `payments-wire.md`, `ship-with-rollback.md` | Sonnet 4.6 |

Orchestration follows the **Conductor + Swarm** pattern: one lightweight Conductor holds the Spec Graph and dispatches work; specialized roles run in their own context windows. Based on Claude Code's Agent Teams primitives (shared task list, peer messaging, file locks).

**Why this structure matters.** Roles are thin. Skills are the IP — and we give them away. That choice unlocks three compounding advantages:
1. Power users and enterprises author their own skills (`.atlas/skills/*.md`); the framework routes to them automatically.
2. The OSS community contributes patterns we haven't thought of; Atlas improves as the library grows.
3. Upgrading to a new model (e.g., Opus 5) does not require rewriting agents — skills describe intent, not implementation.

### 6.2 Living Spec Graph (the single hardest thing — the moat)

Not embeddings. A **structured, typed, queryable graph** of the app: pages, routes, components, data models, endpoints, user flows, auth boundaries, a11y contracts, test cases. Every agent reads from and writes to it. Every file in the repo is traceable back to spec nodes. Refactors update the graph first, then the code.

Enables:
- Refactors that don't regress prior work
- Incremental diffs ("change only this flow") without full regeneration
- Authoritative answers to "what does this app do?" — produces the README
- Impact analysis before any merge
- Real iteration at 100+ file scale

Informed by the rise of **spec-driven development** ([GitHub Spec Kit, 2026](https://github.com/github/spec-kit)): specs become executable, LLMs succeed past 10+ files only when the spec is authoritative.

### 6.3 The Atlas Ritual: Visualize → Agree → Build

Every change to software — greenfield app, new feature, bug fix, dep upgrade, refactor — flows through the **same three-step ritual**. This is the core UX of Atlas and the biggest differentiator against "vibe coding" tools that jump to code before the user knows what they're signing up for.

**1. Visualize** — user intent becomes a structured artifact. Never code. The artifact is scope-dependent:

| Scope | Visualize artifact |
|-------|--------------------|
| New app | Spec Graph + wireframes + data model + user flow diagrams + compliance class |
| New feature (e.g., "add forgot-password") | Impact analysis across the existing Spec Graph + diff plan showing exactly what changes |
| Bug fix ("login broken") | 4-phase debug report (reproduce → isolate → hypothesize → verify) with identified root cause |
| Dep upgrade (Next 15→16) | Breaking-change matrix + compatibility assessment + rollback plan |
| Refactor | Before/after Spec Graph + behavior-preservation contract + regression-test list |

**2. Agree** — the user reviews and edits the *artifact itself*, not code. Point of no return. The approved artifact is **runnable** in the Superpowers sense: exact file paths, exact diffs, exact tests that must fail then pass, exact commit messages, exact rollback trigger. Not prose. Not vibes. Same quality whether the scope is one line or ten thousand.

**3. Build** — deterministic generation from the approved artifact. Code is the output, not the conversation. All three merge gates (Security, Accessibility, Browser Verification) run automatically. The Reviewer critiques every non-trivial diff before the user sees it.

**The same ritual at every scale.** "Add a forgot-password flow" to a 2-year-old app triggers the same Visualize → Agree → Build loop that created the app on day one. "Upgrade Next.js 15 → 16" does too. "Fix this login bug" does too. The scope changes; the discipline doesn't. This is how Atlas handles maintenance and enhancement — not as a separate product, but as the same ritual applied to a living app.

**What this replaces.** The v2 "Plan Mode" (Architect emits blueprint → user approves → codegen) was the right idea but only covered the new-app case. The full Atlas Ritual is Plan Mode generalized to every moment in an app's life.

`plan.md` + `spec.graph.json` are checked into the repo and updated on every ritual loop — they are the **living history** of what was agreed, when, and why. Every enhancement, every fix, every refactor leaves an auditable trail.

### 6.4 Dual-Pane UX

One project, two views, synced live:
- **Canvas** (Ama): visual app map, drag-to-rearrange pages, click-to-edit components inline, chat-to-modify.
- **Code** (Diego/Priya): Monaco editor, real files, real Git, PR flow, terminal into the sandbox, test runner.

Clicking an element in either view highlights it in the other. Inherited visual-edit mode from v2, upgraded with spec-graph backing.

### 6.5 Universal Runtime

Not a browser sandbox ceiling ([Bolt's WebContainers can't run Python/Go/binaries](https://stackblitz.com/pricing)).

- **Frontend sandbox**: E2B Firecracker microVM (strongest isolation; the [CVE-2025-48757 epidemic](https://cursorguard.com/blog/170-lovable-apps-breach/) makes this non-negotiable).
- **Backend sandbox**: same E2B microVM with a managed sidecar Postgres (via Neon / Supabase / local for dev), queue (Redis), and storage.
- **Pre-warmed & prebuilt templates** (inherited from v2).
- **Polyglot**: TypeScript default, but Python, Go, Rust, Elixir all first-class — full-stack, not toy.
- **Offline/local mode**: the whole stack runs on the user's laptop via Docker Compose for privacy-sensitive work (health, gov, regulated industries).

### 6.6 Ship Pipeline (the last mile, finally solved)

Clicking **Ship** performs — in order, idempotently, with dry-run:
1. Domain purchase (Namecheap/Cloudflare Registrar API) or BYO domain
2. DNS + TLS (Cloudflare)
3. Managed DB provisioning (Neon/Supabase/PlanetScale; region-aware)
4. Auth provider (Clerk, Supabase Auth, or self-hosted Lucia) — user picks, we wire
5. Payments (Stripe global, Paystack for Africa, Razorpay for India, Mercado Pago for LATAM)
6. Email (Resend), observability (Sentry, PostHog), CI (GitHub Actions)
7. Deploy target (Vercel, Cloudflare Workers, Fly.io, or self-host via K8s/OpenEverest — inherited from v2 Phase 4)
8. Post-deploy smoke tests; automatic rollback on failure

Every step is a named, rerunnable task. Every step is free or pass-through pricing (we do not markup third parties).

### 6.7 Security Agent — Non-Negotiable Merge Gate

Runs on every generated file and every diff:
- RLS policies present and effective (not just enabled)
- No plaintext secrets, no `SUPABASE_SERVICE_ROLE_KEY` in client code
- CORS configured narrowly
- CSP headers present
- SQL parameterized, no string-interpolated queries
- Auth routes checked: `requireAuth()` on protected endpoints
- Dep CVE scan (Socket.dev / Snyk API)
- OWASP Top 10 lint pass

**Merge blocked on failure.** Auto-fix attempted first; escalated to user on second failure.

### 6.8 Accessibility Agent — Non-Negotiable Merge Gate

- axe-core + Playwright a11y run on every page
- Color contrast ratios validated against palette
- Keyboard nav path verified
- Screen-reader labels present
- RTL layout verified for Arabic/Hebrew/Urdu preview
- i18n scaffold: `en.json` generated, component strings extracted, machine-translated draft for top 10 world languages with human-review flag
- Low-bandwidth mode: target <100KB initial JS, image lazy-load, offline shell

### 6.9 The Atlas Skill Library (open-source, v1)

Atlas ships with a starter library of ~15 battle-tested skills, all open-sourced under **Apache 2.0 on day one** at `github.com/atlas-labs/atlas-skills` (placeholder). Each skill is a single markdown file — instructions, checklists, decision tables, process diagrams — auto-activated by the framework based on user intent.

| Skill | Activates on | What it does |
|-------|---------------|--------------|
| `brainstorm.md` | Any new conversation | Socratic requirements refinement before any plan. Never skips. |
| `spec-graph.md` | After brainstorm | Produces the editable Spec Graph (app + infra nodes). |
| `runnable-plan.md` | After spec-graph | Turns spec into concrete file paths, diffs, tests, commits, rollback trigger. |
| `tdd-feature.md` | Feature requests | Failing test first, then minimal implementation, then green. No exceptions. |
| `four-phase-debug.md` | "It's broken" / error reports | Reproduce → isolate → hypothesize → verify. Root cause before fix. |
| `refactor-without-regression.md` | Refactor requests | Before/after graph, behavior contract, regression-test gate. |
| `upgrade-dependency-safely.md` | Dep version bump | Breaking-change matrix, compatibility check, rollback-armed apply. |
| `edit-only-what-changed.md` | Every Developer role run | Minimal-diff discipline; no opportunistic rewrites. |
| `audit-rls.md` | Security phase | RLS policy completeness + effectiveness check. Merge gate. |
| `wcag-audit.md` | Accessibility phase | axe-core + keyboard-nav + contrast + RTL snapshot. Merge gate. |
| `visualize-diff.md` | Before user approval | Renders the diff plan in a form the user can read and edit. |
| `approve-or-reject.md` | At the Agree step | Captures explicit user sign-off; logs to `plan.md` with timestamp + rationale. |
| `ship-with-rollback.md` | Before deploy | Rollback trigger armed, canary plan, observability wired. |
| `reviewer-critique.md` | Every non-trivial diff | Independent critique before user sees output. |
| `incident-response.md` | Live alerts / user-reported outages | Structured incident playbook; post-mortem scaffolding. |

**Extensibility.** Users and teams author custom skills in `.atlas/skills/*.md` and the framework auto-routes to them based on intent classification. Enterprises can pin skill sets (`acme-internal-auth.md`, `acme-brand-guidelines.md`) that always activate for their projects.

**Governance.** A public RFC process at `github.com/atlas-labs/atlas-skills` accepts community contributions; Atlas maintainers review and merge. This mirrors what made Superpowers grow to 121K stars — the library is an industry commons, not a proprietary moat.

**The moat is not the skills.** The moat is (1) the orchestrator, (2) the Spec Graph, (3) the merge gates, (4) the Ship Pipeline, (5) the deployment and migration infrastructure, and (6) the hosted runtime. The skills are given back to the community — which compounds Atlas's credibility and adoption.

**Iteration / hot-patch behavior (inherited from v2).** When the Build step operates on a live app, it emits minimal file-diff patches (not whole-file rewrites), lets HMR hot-patch the preview, and runs the three merge gates on the diff. End-to-end p50 <10s for component-scoped changes. This is the Atlas Ritual at its smallest scope — still Visualize, still Agree, still Build — just fast.

### 6.10 Pricing (transparent, flat, no credit games)

| Tier | Price | Cap | Target |
|------|-------|-----|--------|
| **Atlas Free** | $0 | 3 projects, 30 iterations/mo, Atlas subdomain | Students, tinkerers |
| **Atlas Builder** | **$29/mo flat** | Unlimited reasonable use, 10 projects, custom domains, GitHub export | Ama & Diego |
| **Atlas Pro** | **$99/mo flat** | Unlimited projects, team seats (3), background agents, K8s self-deploy | Agencies, pro devs |
| **Atlas Team** | **$39/seat/mo** | All Pro features, SSO, audit logs, shared spec graphs | Startups, teams |
| **Atlas Social Impact** | **Free with verification** | Full Atlas Builder features | Verified NGOs, public schools, public clinics in LMICs |
| **Atlas Enterprise** | Contact | SOC 2, self-host, VPC, SLA | Regulated industries |

**No credit burn. No "premium requests." No per-token surprises.** If we blow our unit economics on heavy users, that's our problem — we'll fix the agents, not the user's wallet. This is a deliberate bet against the industry norm ([Cursor/Bolt/Lovable credit backlash](https://www.morphllm.com/comparisons/windsurf-vs-cursor)).

### 6.11 Social Impact Program

- **Free forever** for verified NGOs, public schools, and public health clinics in low/middle-income countries
- **Atlas for Classrooms**: free educator accounts, 50 student seats, explainable-code mode (agent annotates *why* a decision was made — teaching, not black-boxing)
- **Open-source the Spec Graph schema** and agent prompt library under Apache 2.0 so the industry rises with us

---

## 7. Technical Architecture

### 7.1 Frontend Stack (default, swappable)

- Next.js 15 App Router, React 19, TypeScript strict
- Tailwind 4, shadcn/ui, Framer Motion, Lucide icons
- TanStack Query, Zod, React Hook Form
- Playwright (test), Vitest (unit), axe-core (a11y)

### 7.2 Spec Graph (the moat)

- Persisted as versioned JSON + Postgres (jsonb) for queryability
- Node types: `Page`, `Route`, `Component`, `Model`, `Endpoint`, `Flow`, `AuthBoundary`, `A11yContract`, `Test`
- Edge types: `renders`, `fetches`, `mutates`, `requires`, `covers`, `supersedes`
- Tree-sitter code-graph layer maps every file → spec node
- Every agent tool call logs a spec-node mutation; full audit trail

### 7.3 Sandbox Layer

- E2B Firecracker microVMs (150ms cold start, hardware isolation per [AI Sandbox Benchmark 2026](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026))
- Prebuilt templates per stack (Next+TS+Postgres, Expo, Python+FastAPI, Go+Chi)
- Sidecar managed DB, Redis, S3-compatible storage
- Pre-warmed at T=0, reclaimed after 15 min inactivity with snapshot
- Local mode: identical stack via Docker Compose

### 7.4 LLM Orchestration

- Multi-provider: Anthropic (Opus 4.7, Sonnet 4.6, Haiku 4.5) + Google (Gemini 2.5 Pro/Flash) + optional self-hosted
- **Prompt caching** on Developer agent prefix — target >80% hit rate
- **Routing**: Haiku for triage/validation, Sonnet for codegen, Opus for security + ambiguous architecture
- **Circuit breaker** (inherited from v2): 3 failures → 5-min fallback
- **Speculative pre-generation**: deterministic skeleton at T=0, enrichment at T=2s

### 7.5 Verification Stack

- Layer A: streaming validator (v2)
- Layer B: AST autofixer (v2)
- Layer C: build-error parser (v2)
- **Layer D (new)**: Browser Verification — Playwright script generated from spec, run against the sandbox preview, screenshot + console + accessibility snapshot captured, LLM judges pass/fail
- **Layer E (new)**: Security Agent gate
- **Layer F (new)**: Accessibility Agent gate

A merge requires D + E + F green. "Green" is adjudicated by an LLM judge against captured evidence, not vibes.

### 7.6 Observability

- Per-agent tracing (inherited)
- Token spend dashboard per user, per project, per iteration
- Fix telemetry (inherited): `pipeline_fixes.jsonl`
- Public uptime + success-rate page (like [status.stripe.com](https://status.stripe.com))

---

## 8. Non-Functional Requirements

| ID | Requirement | Target | Measurement |
|----|-------------|--------|-------------|
| NFR-1 | TTFP (skeleton) | <15s | p50 / p95 per /api/metrics |
| NFR-2 | Time to enriched preview | <45s | p50 / p95 |
| NFR-3 | Reliability (working preview) | >97% | 1000-prompt eval suite, weekly |
| NFR-4 | Security gate fail rate on generated code | <1% of merges | Security agent telemetry |
| NFR-5 | WCAG 2.2 AA pass rate on first gen | >95% | axe-core on 100-prompt eval |
| NFR-6 | Average cost per project generation | <$0.30 (Builder tier) | Token spend / project count |
| NFR-7 | Iteration p50 latency | <10s | iterate endpoint traces |
| NFR-8 | Spec-graph coherence at 100 files | 0 dangling refs | Graph validator |
| NFR-9 | Export correctness (fresh clone → runs) | 100% | Nightly eval |
| NFR-10 | Supported languages (UI) | 25+ | i18n scaffold |
| NFR-11 | Low-bandwidth profile initial JS | <100KB | Lighthouse on generated apps |

---

## 9. Phased Roadmap

### Phase A — Foundation (Q2 2026)
Inherit v2's Phase 1–3 work (multi-agent pipeline, E2B, HMR, plan mode, dashboard). Harden and re-baseline reliability to 95%. **Refactor the v2 agent pipeline into the Skill Framework + orchestration roles model** (§6.1). **Publish Atlas Skill Library v1** (§6.9) as Apache 2.0 on `github.com/atlas-labs/atlas-skills`. Implement the Visualize → Agree → Build ritual as the single unified flow (§6.3) — replacing v2's Plan Mode for new-app-only scope.

### Phase B — Living Spec Graph (Q2–Q3 2026)
- A1: Spec Graph schema + persistence
- A2: Architect emits graph (not flat blueprint)
- A3: Developer reads graph per file
- A4: Tree-sitter code-graph mapping
- A5: Refactor-via-graph (impact analysis)

### Phase C — The Two Merge Gates (Q3 2026)
- B1: Security Agent + merge gate
- B2: Accessibility Agent + merge gate
- B3: Browser Verification Agent (Playwright + visual diff)
- B4: Public eval suite + status page

### Phase D — Ship Pipeline (Q3–Q4 2026)
- C1: Domain + DNS + TLS
- C2: Auth wiring (Clerk, Supabase, Lucia)
- C3: Payments (Stripe, Paystack, Razorpay, Mercado Pago)
- C4: Managed DB provisioning
- C5: One-click deploy (Vercel / Cloudflare / Fly / self-host K8s)

### Phase E — Universal Runtime (Q4 2026)
- D1: Polyglot sandboxes (Python, Go, Rust)
- D2: Mobile (Expo) first-class
- D3: Offline/local Docker Compose mode

### Phase F — Global & Inclusive (Q4 2026 → Q1 2027)
- E1: Full i18n + RTL
- E2: Social Impact verification + onboarding
- E3: Classrooms / explainable-code mode
- E4: Public launch of the Spec Graph open standard

---

## 10. What We Are NOT Building (explicitly)

- A hosted-only platform with no export (Base44, Create.xyz trap)
- A token-metered pricing model disguised as "credits"
- A "clone any website" tool (IP risk, niche)
- A general-purpose IDE competing with Cursor/Windsurf (we're a builder, not an IDE)
- A Figma replacement
- Anything that defers security, a11y, or verification as a Pro-tier upsell — those are mission-critical and therefore always on, always free

---

## 11. Success Metrics (what winning looks like)

- **Correctness**: 97% of generated apps pass browser-verification on first run
- **Security**: 0 critical CVEs attributable to Atlas-generated defaults per quarter
- **Accessibility**: 95%+ WCAG 2.2 AA pass on first generation
- **Shipping**: 50%+ of projects reach a live, deployed URL (vs. industry <15% estimates for "apps that ever ship")
- **Ownership**: 100% of projects exportable to a Git repo that runs clean on a fresh clone
- **Pricing trust**: NPS on billing clarity ≥ 50 (industry baseline negative, per [Cursor backlash](https://www.morphllm.com/comparisons/windsurf-vs-cursor))
- **Social impact**: 5,000 verified NGO / school / clinic projects shipped in year one
- **Global**: 25+ UI languages, 10+ regional payment providers on launch

---

## 12. Open Questions

1. **Spec Graph v1 schema** — how much structure is enough without becoming a prison? Prototype with 3 real apps before locking down.
2. **Model mix economics at $29/mo flat** — can we hold margin with unlimited reasonable use? Needs cost modeling against NFR-6.
3. **Self-host vs hosted** — do we offer an open-core self-hosted Atlas for regulated industries on day one, or Phase F?
4. **Brand** — keep "SiteForge" lineage or relaunch as "Atlas"? (leaning Atlas — broader than sites, evokes the global mission)
5. **Agent judge reliability** — do we need human-in-the-loop spot-checks on the browser-verification judge in early phases?
6. **OSS posture (resolved).** The **Atlas Skill Library** ships Apache 2.0 on day one at `github.com/atlas-labs/atlas-skills`. The **Spec Graph schema** and **compliance evidence generators** also ship OSS. The orchestrator, merge gates, Ship Pipeline, migration execution engine, and hosted runtime remain proprietary. Mirrors what made Superpowers successful — library as industry commons, product as orchestration.

---

## 13. One-Paragraph Summary

**Atlas is an AI website and full-stack app builder designed to ship correct, secure, accessible, ownable software at global scale.** It is the first builder with a persistent Spec Graph that keeps large codebases coherent, the first with merge-gating Security and Accessibility agents that treat CVE-2025-48757-class failures as unacceptable by construction, and the first with a flat, credit-free pricing model that respects users' wallets. It closes the last-mile gap (domains, auth, payments, deploy) that traps every current tool's output as a demo. It treats non-developers, working developers, and senior reviewers as collaborators on the same project. And it is free forever for NGOs, schools, and clinics in the parts of the world that need software most and can afford it least. The goal is not to generate more code. The goal is to generate the right software — and to put it in the hands of every person who needs one.

---

*For the technical research that informed this document, see `docs/research/` (to be populated). For the prior product baseline, see `docs/PRD.md` and `docs/PRD1.md`.*

---

## Appendix A — Competitive Landscape Snapshot (April 2026)

Atlas is positioned explicitly against every serious entrant. The table below captures what each one does best, their pricing model, and the specific gap Atlas closes.

| Product | Positioning | Stack / Runtime | Pricing model | Core gap Atlas closes |
|---------|-------------|-----------------|---------------|------------------------|
| **Vercel v0** | UI-component generator, shadcn-grade polish | Proprietary v0 models + frontier routing; browser preview | Credits; $20–30/mo | No real backend; loses coherence past ~5–10 files |
| **Bolt.new** (StackBlitz) | In-browser full-stack via WebContainers | Claude Sonnet + WebContainers (JS only) | Token-metered; $20–$200/mo | Token burn anxiety; can't run Python/Go/native; brittle past a few dozen files |
| **Lovable** | Non-dev SaaS MVPs, Supabase-native | Claude + Supabase + Vite | Credits; $25/mo Pro | CVE-2025-48757 RLS epidemic; UI polish without security/a11y gates |
| **Replit Agent 3** | Real Linux VM, any language | Multi-agent + Nix sandbox | $20/mo + usage; easy overspend | Code quality is "competent junior"; Agent loops are expensive |
| **Cursor** | Pro dev IDE + Background Agents | Multi-model; cloud VM agents | $20–$200/mo; credit backlash mid-2025 | Not a builder; no hosted preview/deploy; requires dev skills |
| **Windsurf/Cascade** (Cognition) | Agentic IDE, SWE-1.5 family | Proprietary SWE-1.5 (fast but 40% SWE-bench vs Opus 4.7 ~81%) | $15–$30/mo; post-acquisition uncertainty | IDE, not a builder; no non-dev path |
| **Devin** (Cognition) | Autonomous long-horizon SWE | Multi-agent; own VM; Slack/Linear entry | $20 Core → $500 Team | Greenfield-weak; slow; best on maintenance, not creation |
| **Firebase Studio** | Google-stack app prototyping | Gemini 2.5/3 + Firebase + Nix | Free tier + Firebase/GCP usage | Gemini trails Claude on code quality; Firebase lock-in |
| **GitHub Spark** | Micro-apps on GitHub runtime | Claude/GPT + proprietary Spark runtime | Bundled in Copilot Pro ($10/$39) | Scope-limited to micro-apps; opinionated runtime |
| **Builder.io Fusion** | Figma→code with design-system mapping | Proprietary Mitosis + LLM | $19/user to 4-figure enterprise | Setup friction; less agentic than Lovable/Bolt |
| **Claude Artifacts / Code** | Gold-standard code quality | Claude Opus/Sonnet | $20–$200/mo | No hosted preview/deploy; no non-dev UX |
| **Base44** (Wix) | Hosted non-dev apps | Proprietary + Claude | $20–$200/mo credits | Total lock-in; no real export |
| **Emergent.sh** | "Autonomous dev team" — full-stack SaaS builder | Multi-agent (architect/code/test/deploy); third-party integrations (Stripe, Airtable, Slack, Sheets) built-in; mobile app + enterprise tier | Credits; Free (10), $20 (100), $200 (750), $300 team (1250); **50 credits/mo just to keep a deployment alive** | Strong integrations but no merge-gate security/a11y; weaker UI polish than Lovable; credit burn is aggressive (deploy alone is metered); no spec graph → coherence degrades on iteration |
| **Same.new** | Pixel-accurate website cloning | Claude + screenshot/DOM pipeline | ~$20/mo credits | Niche; can't clone logic; IP concerns |
| **a0.dev / Magic Patterns / Create.xyz** | Niche (mobile / components / non-dev) | Varied | $19–$30/mo | Narrow scope; no full lifecycle |

### Why Emergent is the closest to Atlas's vision — and why it still doesn't win

Emergent is the only existing product whose *pitch* ("describe → autonomous team builds/tests/deploys") mirrors the Atlas pitch. It is the natural benchmark. But it fails on four of Atlas's core principles:

1. **Credit-based pricing with deployment metering** — Atlas refuses to charge users just to keep their app online.
2. **No merge-gate Security or Accessibility agent** — same CVE-class risk as Lovable.
3. **No Living Spec Graph** — iteration-driven context drift once apps grow.
4. **UI polish is behind Lovable and v0** — Emergent optimizes for "it works," not "it looks right."

Atlas's differentiation against Emergent specifically: **same autonomous-team model, with flat pricing, non-negotiable security + a11y gates, spec-graph coherence at scale, and first-class visual polish.**

---

## Appendix B — Sources

Key references that directly shaped this PRD (not exhaustive):

- [Best AI App Builder 2026 comparison (getmocha.com)](https://getmocha.com/blog/best-ai-app-builder-2026/)
- [V0 vs Bolt vs Lovable (nxcode.io)](https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025)
- [Emergent AI Review 2026 (nocode.mba)](https://www.nocode.mba/articles/ai-app-builder-emergent)
- [Emergent vs Lovable vs Replit (closefuture.io)](https://www.closefuture.io/blogs/emergent-vs-lovable-vs-replit)
- [Emergent Pricing (emergent.sh)](https://emergent.sh/pricing)
- [Replit vs Firebase Studio (replit.com)](https://replit.com/discover/replit-vs-firebase-studio)
- [Windsurf vs Cursor 2026 (morphllm.com)](https://www.morphllm.com/comparisons/windsurf-vs-cursor)
- [AI Code Sandbox Benchmark 2026 (superagent.sh)](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026)
- [Daytona vs E2B (northflank.com)](https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes)
- [Claude Code Agent Teams (code.claude.com)](https://code.claude.com/docs/en/agent-teams)
- [Software Developer Talent Shortage 2026 (beon.tech)](https://beon.tech/blog/software-development-talent-shortage/)
- [AI-Generated Code Security Risks 2026 (appsecsanta.com)](https://appsecsanta.com/api-ai-security/ai-code-security)
- [CVE-2025-48757 writeup (mattpalmer.io)](https://mattpalmer.io/posts/2025/05/CVE-2025-48757/)
- [170 Vibe-Coded Apps Leaked User Data (cursorguard.com)](https://cursorguard.com/blog/170-lovable-apps-breach/)
- [GitHub Spec Kit (github.com)](https://github.com/github/spec-kit)
- [Spec-Driven Development (github.blog)](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)
- [Global Web Accessibility Laws 2026 (testparty.ai)](https://testparty.ai/blog/global-web-accessibility-laws-2026)
- [The Last Mile Problem in AI (sonatype.com)](https://www.sonatype.com/blog/the-last-mile-problem-ai-can-write-code-but-only-policy-can-ship-it)
- [Playwright AI Ecosystem 2026 (testdino.com)](https://testdino.com/blog/playwright-ai-ecosystem/)
