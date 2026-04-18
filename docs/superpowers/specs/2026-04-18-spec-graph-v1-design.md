# Spec Graph v1 — Design Spec

> Brainstormed via the `superpowers:brainstorming` skill.
> Date: 2026-04-18
> Companion to: `docs/PRD_v3.md`, `docs/ECOSYSTEM_VISION.md`
> Status: Design approved. Ready for `superpowers:writing-plans`.

---

## 0. Executive Summary

The **Living Spec Graph** is Atlas's architectural source of truth — a typed, queryable, file-canonical structure that models every page, route, component, data model, endpoint, flow, auth boundary, test, design token, dependency, compliance class, AI feature, and media asset in an application. It is the living contract between user intent (Visualize), approval ritual (Agree), and generated code (Build) — at every scale, from new-app creation to one-line maintenance fixes.

v1 is **app-only in scope**; infrastructure modeling is deferred to Phase B with Atlas Migrate. The schema carries 13 node types and 12 edge types, sufficient for every Build-scope ritual (new app, new feature, bug fix, dep upgrade, refactor) while remaining lean enough to stabilize quickly.

All v1 code passes a **7-layer test pyramid** (Static · Unit · Integration · API · Browser/Flow · Security+Compliance · UX+Accessibility) before the user ever sees output. Failure at any layer auto-retries up to three attempts with different approaches; persistent failure surfaces at persona-appropriate verbosity and **refuses to commit partial state**. "Works first time" is a contract, not a goal.

The graph lives in the user's repo under `.atlas/` as a Git-trackable file plus append-only event log. Atlas's hosted Postgres mirror is a cache, never a vault. Users can export, self-host, or go fully offline without losing functionality.

---

## 1. Canonical Scope Decisions

| Dimension | v1 decision |
|-----------|--------------|
| Graph scope | App-only (infra deferred to Phase B) |
| Truth model | Bidirectional, AI-graph-first |
| Schema language | JSON Schema → Zod (TS) + Pydantic (Python) codegen |
| Persistence | File-canonical (`.atlas/events.jsonl` + `.atlas/spec.graph.json`); Postgres as index |
| Node types | **13**: Page · Route · Component · Model · Endpoint · Flow · AuthBoundary · Test · DesignToken · Dependency · ComplianceClass · AIFeature · MediaAsset |
| Edge types | **12**: renders · fetches · reads · mutates · requires · covers · dependsOn · styledBy · subjectTo · supersedes · powers · displays |
| Merge gates | 7-layer pyramid (L1–L7) |
| ComplianceClass v1 set | baseline · HIPAA · PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · SOC2 · ISO27001 |
| AIFeature provider support | Anthropic · OpenAI · Gemini · self-hosted (Qwen / Llama / DeepSeek) |
| Media provider support | Nano Banana 2 · Flux · Ideogram · SDXL (image) · Seedance 2.0 · Kling 3.0 · Veo 3.1 · Runway Gen-4.5 (video) |
| Animation library | Motion (formerly Framer Motion) `motion/react` v12+ |
| Persona tiers | Ama (non-technical) · Diego (developer) · Priya (senior/reviewer) |
| OSS skill library at v1 ship | **~61 skills** (Apache 2.0, `github.com/atlas-labs/atlas-skills`) |
| DBaaS v1 | Dev = SQLite (in E2B) · Run = Neon/Supabase/PlanetScale · BYODB documented · Atlas Managed (OpenEverest on Atlas K8s) = Phase B · Atlas Sovereign (OpenEverest on user K8s) = Phase D |
| E2B prebuilt templates v1 | 7 templates: `atlas-next-ts` · `atlas-react-vite` · `atlas-astro` · `atlas-sveltekit` · `atlas-python-fastapi` · `atlas-go-chi` · `atlas-expo` (signed, weekly rebuilds, digest-pinned per project) |
| Web app preview v1 | Live HMR iframe · multi-viewport + throttling · dark/light + locale + RTL · shareable URL (public/password/auth/domain) with expiry · comment pins + review workflow · run-as-role simulation · ComplianceClass-aware preview modes · spec-graph-linked element selection |
| Visual edit mode v1 | AST-based (Babel/SWC) · click-to-select · optimistic < 200ms preview · 7 edit categories (text · style · component · media · content · layout · AI-assisted) · every edit produces a spec-graph event · all merge gates enforced · undo/redo via event log · bulk operations |

---

## 2. Cross-Cutting Principles (all four apply to every v1 surface)

### Principle 1 — Works the First Time

Every AI-generated or human-authored change passes a complete 7-layer test pyramid before the user sees output. TDD is mandatory: failing test first, then minimal implementation, then green. Tests are generated from the Spec Graph, not hand-written. On failure the skill iterates with a different approach (max 3 retries); persistent failure refuses to commit partial state. Users never debug something Atlas broke.

### Principle 2 — Secure by Default, Compliant Day One

Every Atlas-generated app ships with the full security baseline on the first commit: TLS 1.3, HSTS preload, strict nonce-based CSP, Argon2id hashing, RLS on every table, parameterized queries, Zod/Pydantic validation at every external boundary, CSRF + SSRF guards, secret scanning, CVE scanning, PII redaction in logs, immutable audit log on sensitive writes. Compliance classes (`baseline` · HIPAA · PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · SOC2 · ISO27001) are first-class graph nodes. Baseline is always present, always enforced, never a Pro-tier upsell. A `compliance-evidence/` folder emits on every build for auditors.

### Principle 3 — Proactively Brainstorm AI Features, Challenge Beyond Imagination

At Visualize, Atlas doesn't just accept the user's starting ask — it probes: "Should this form be a conversation? Could AI predict what the user needs before they click? What would make this app a moonshot in its category?" The `ai-features-brainstorm.md` skill runs a three-ceiling Socratic loop (table-stakes / differentiator / moonshot), grounded in an extensible Inspiration Library categorized by domain. `AIFeature` nodes are capability-abstract (no vendor lock-in) and provider-wired at Ship time.

### Principle 4 — Category-Leading UX by Default

The Designer role applies a coherent design system, hardware-accelerated animations (Motion v12+), grounded imagery (Nano Banana 2 / alternates via adapter), micro-interactions, emotional-design details, and neurodivergent-aware a11y. `MediaAsset` is a first-class graph node; prompts live in `.atlas/prompts/` as OSS-shareable templates. The L7 UX+a11y merge gate includes axe-core, keyboard reachability, WCAG contrast, RTL snapshots, reduced-motion respect, neurodivergent cognitive-load audit, Lighthouse ≥ 90, sustainability budget (≤100KB initial JS), and an LLM visual-judge against curated "delightful" references (soft-block v1, hard-block Phase B).

---

## 3. Overview & Goals

### 3.1 What Spec Graph v1 Is

A typed, queryable, file-canonical data structure that models an Atlas application's architecture. Every first-class concept in the application — a page, a component, a data model, an AI feature, a media asset — is a node. Relationships between them are edges. The graph is the living contract between user intent, the skill framework's work, and the code on disk.

### 3.2 Why It Exists (the Atlas promise it backs)

1. **Coherence at scale.** The agent reads and updates a structured model, not re-derived embeddings. Refactors don't regress prior work past 30+ files. This is Atlas's #1 differentiator against v0 / Bolt / Lovable / Emergent, all of which degrade past ~30-50 files.
2. **Visualize → Agree → Build.** The graph is the artifact the user approves at the Agree step. No code is written without a graph mutation first. The same ritual applies at every scale — new app, new feature, bug fix, dep upgrade, refactor.
3. **Auditability.** Every mutation carries provenance (which skill, which user action, timestamp, rationale). Enables telemetry, debugging, compliance evidence, and time-travel replay.
4. **Exportable ownership.** `.atlas/` lives in the user's repo, moves with them on export, works offline, is diffable in Git. Atlas's hosted infrastructure is a cache, never a vault.

### 3.3 Graph Is Always Present; Exposure Is Tiered by Persona

The underlying data is identical for all users. Only the UI surface adapts.

| Persona | What they see at "Visualize" | What they approve at "Agree" | Graph access |
|---------|------------------------------|------------------------------|---------------|
| **Ama** (non-technical) | Wireframes + plain-English summary ("5 pages, user login, save drafts, send email") | The summary; AI picks recommended defaults for every graph node | Hidden. Events logged silently. Reconciliation automatic. |
| **Diego** (developer) | Wireframes + structured graph editor (node/edge view, attribute panels) | The structured graph — overrides defaults, inspects events | Read/write via UI; opens raw JSON when wanted. |
| **Priya** (senior / reviewer) | Everything Diego sees + raw JSON + event log + branch/replay controls | Full graph diff; approves via PR-style review | Full read/write, raw edit, event stream, CRDT branching (Phase B). |

Users can switch tiers at any time (a profile flag) with no data migration. A non-technical user who wants to level up flips a toggle and gets Diego's view.

### 3.4 Non-Goals (explicit YAGNI for v1)

- Infrastructure nodes (Region · Runtime · Provider · DataResidency · WorkloadTopology) → Phase B with Migrate
- Multi-writer CRDT → Phase B
- Graph query language (Cypher/GraphQL) → v1 uses JSON traversal + SQL via Postgres index
- Brownfield reverse-engineering from arbitrary codebases → Phase F
- Time-travel UI (branch, fork, rewind) → mechanics exist via events; UI is Phase B
- Mutation testing, fuzz testing, formal verification, chaos engineering, record-replay → Phase B–D

### 3.5 Success Criterion (single sentence)

One real Atlas Build project ships through the full loop (create → feature → bug fix → dep upgrade → refactor) **with three users at three technicality tiers successfully using it on the same project** — each seeing the appropriate level of graph exposure, all producing the same underlying events, all passing the 7-layer pyramid.

Full measurable criteria are in §7.

---

## 4. Architecture, Components, Data Flow

### 4.1 File Layout (inside the user's repo)

```
.atlas/
  spec.graph.json           # materialized view — regenerable from events
  events.jsonl              # append-only log, authoritative history
  schema/
    spec.graph.v1.json      # JSON Schema pinned by version
  derived/                  # brownfield-discovered nodes (uncommitted by default)
  prompts/                  # AIFeature + MediaAsset prompt templates (Git-tracked)
  cache/
    media/                  # generated media assets keyed by contentHash
    manifest.json           # asset manifest
  telemetry/
    test-history.jsonl      # flaky-test quarantine data
  plan.md                   # human-readable narrative (Ama-facing, auto-regenerated)
compliance-evidence/        # emitted on every successful build
  auth-controls.md
  data-flow.md
  consent-inventory.md
  dependency-inventory.md
  access-audit.md
  <class>-evidence.md       # per declared ComplianceClass
```

All committed to Git by default except `.atlas/derived/` and `.atlas/cache/`. The `.atlas/` folder is the user's ownership boundary.

### 4.2 Components

1. **`@atlas/spec-graph-schema` (published package)**
   - Canonical JSON Schema → generates Zod (TS) and Pydantic (Python) bindings at build time
   - Consumed by: skill framework, orchestrator, merge gates, Atlas backend, user-authored skills
   - Ships with the OSS skill library under Apache 2.0
   - CI generators: `json-schema-to-zod`, `datamodel-code-generator`

2. **Atlas Daemon (local, shipped in the E2B template)**
   - **Watcher**: tree-sitter file-watcher on the user's source tree
   - **Applier**: validates events against schema, appends to `events.jsonl`, rebuilds materialized view
   - **Reconciler**: computes code→graph diffs on save
   - **Mirror**: forwards events to hosted Postgres when online (best-effort; offline-safe)
   - **Media resolver**: dispatches MediaAsset generation via provider adapters; caches by contentHash

3. **Atlas Backend (hosted service; optional for offline/sovereign users)**
   - Postgres jsonb index per project, rebuilt by consuming the event stream
   - REST + WebSocket query API for the frontend
   - Per-user/project RLS (dog-fooding our own Security Agent)
   - Claude Design / Figma / Stitch import endpoints

4. **Atlas Frontend — three renderers on identical data**
   - `NarrativeRenderer` (Ama): wireframes + plain-English plan, no graph surface
   - `StructuredRenderer` (Diego): node/edge canvas, attribute panels, event timeline
   - `RawRenderer` (Priya): JSON editor, event stream, branch/replay controls

### 4.3 Mutation Path (AI-driven ritual happy path)

```
Skill invocation (e.g., "add forgot-password + AI document summarizer")
  │
  ├─▶ Architect composes { brainstorm → ai-features-brainstorm → spec-graph → runnable-plan }
  │
  ├─▶ Proposed events batch (multiple nodes + edges across Page/Endpoint/Model/AIFeature/MediaAsset/...)
  │
  ├─▶ Reviewer critiques the batch (every non-trivial batch is reviewed before surfacing to the user)
  │
  ├─▶ Visualize renders per persona (Ama: narrative · Diego: canvas · Priya: raw JSON + events)
  │
  ├─▶ User Agrees
  │        (Ama: single "Approve" · Diego: per-node inline approve · Priya: PR-style review + comments)
  │
  ├─▶ L1 Static gate: schema-validate every event against JSON Schema v1
  │
  ├─▶ Events appended to .atlas/events.jsonl (immutable)
  │
  ├─▶ Materialized view .atlas/spec.graph.json regenerated
  │
  ├─▶ Postgres mirror updated (async, non-blocking; offline-safe)
  │
  ├─▶ TDD skill generates failing tests from affected nodes (registry in §6.2)
  │
  ├─▶ Media generation kicks off in parallel for new MediaAsset nodes (§4.6)
  │
  ├─▶ Developer roles emit code (edit-only-what-changed) in parallel per affected file
  │
  ├─▶ AIFeature adapters wired into generated code (§4.5)
  │
  ├─▶ Test pyramid runs (L1→L7) — layers parallelized where independent
  │
  ├─▶ Any red layer:
  │       ├─ skill auto-iterates (max N=3 retries with different approach)
  │       └─ persistent failure → surface at persona verbosity (§4.8)
  │
  └─▶ All green → HMR hot-patches preview · plan.md regenerated · compliance-evidence/ updated · event committed
```

**Key property:** media generation and AI feature wiring run in parallel with code emission — they join the pyramid at L5 when their artifacts are ready. Cache hits skip provider calls entirely.

### 4.4 Reconciliation Path (human-edits-code → graph catches up)

```
User saves file in IDE
  │
  ▼
Daemon watcher detects change
  │
  ▼
Tree-sitter re-parses touched files (incremental, cached ASTs)
  │
  ▼
Maps AST → candidate graph mutations
  │      - new default/named export → Component node
  │      - new route file → Page / Endpoint node
  │      - prisma.schema change → Model node update
  │      - new import → edge update (dependsOn / renders / etc.)
  │
  ▼
Diff against current .atlas/spec.graph.json
  │
  ▼
Ambiguity classifier (Haiku 4.5 for cost):
  │
  ├─ Confident (≥ 0.95): auto-generate reconciliation event
  │                      (source: "human-edit", confidence logged)
  │
  ├─ Uncertain (0.7–0.95):
  │    Ama    → silent; confident-enough match auto-applied with low-confidence annotation
  │    Diego  → non-blocking toast: "Rename detected — mark as rename? [Yes / Treat as new]"
  │    Priya  → sidebar shows two-way diff; user resolves
  │
  └─ Conflict (< 0.7): blocking banner; ritual invocations refuse until resolved
       (prevents "code and graph disagree, AI regenerates, chaos")
```

**Derived-node exception.** Brownfield discovery (Phase F) produces nodes from running systems without a prior ritual. Those land in `.atlas/derived/*.json` (uncommitted by default) and promote to the main graph only via an explicit "promote derived" ritual.

### 4.5 AIFeature Runtime — Capability Adapter Pattern

Design-time `AIFeature` nodes are **provider-abstract** (capability contract, not vendor). At code emit, a typed adapter is generated:

```ts
// Generated from spec graph — do not hand-edit
import { aiAdapter } from '@atlas/runtime/ai';

export const documentSummarizer = aiAdapter({
  capability: 'text-generation',
  inputModality: 'document',
  outputModality: 'text',
  grounding: 'none',
  safetyContract: ['moderation', 'hallucination-guard'],
  fallbackBehavior: 'graceful-degrade',
  provider: process.env.ATLAS_AI_PROVIDER ?? 'anthropic',
  promptTemplate: '.atlas/prompts/document-summarizer.md',
});
```

At runtime the adapter handles:
- **Provider routing**: Claude Opus 4.7 / OpenAI / Gemini / self-hosted (Qwen / Llama / DeepSeek for sovereignty)
- **Prompt caching**: inherits Atlas prompt-cache layer (>80% hit rate target per PRD_v3 NFR)
- **Timeouts + retries** with sensible per-feature defaults
- **Fallback behavior**: `graceful-degrade` returns a structured stub + telemetry ping
- **Safety enforcement**: moderation, PII redaction in logs, hallucination grounding
- **Cost telemetry**: per-call token usage + provider cost → metrics

Prompts live in `.atlas/prompts/*.md` (Git-tracked, skill-authorable, OSS-shareable). Users edit prompts without regenerating code.

### 4.6 Media Generation Runtime (MediaAsset)

```
New MediaAsset event
  │
  ▼
contentHash(generationPrompt + providerCapability + style tokens)
  │
  ├─ cache hit → symlink from public/ · done
  │
  └─ cache miss
         │
         ▼
     provider adapter (user-selected or default):
         image:        Nano Banana 2 → Flux → Ideogram → SDXL (sovereignty)
         video:        Seedance 2.0 → Kling 3.0 → Runway Gen-4.5 → Veo 3.1
         icon:         Nano Banana 2 with icon-style prompt augmentation
         illustration: same-stack with style-token injection
         │
         ▼
     Asset downloaded → .atlas/cache/media/<hash>.<ext>
         │
         ▼
     Post-generation:
         - autoAltText: LLM captions image (WCAG-compliant)
         - contentModeration: blocks merge if unsafe
         - licenseCheck: provider's license attached to node metadata
         - optimization: Sharp/Squoosh → webp/avif, multiple sizes
         │
         ▼
     Public path committed to public/assets/… · manifest updated
         │
         ▼
     `displays` edge resolved · Component emits <Image> with asset path
```

Provider selection is **ComplianceClass-aware**: `DPDP-India` routes image gen to in-country / self-hosted providers and blocks non-compliant ones with a friendly explanation. `baseline` allows any provider.

Video is opt-in: MediaAsset.kind=video triggers a confirmation at Agree ("Video assets add 5–30 min to build time and meaningful cost — confirm?") with per-persona verbosity.

### 4.7 Claude Design / Figma / Stitch Import (Phase A, optional skill)

For teams with existing designer workflows:

```
User clicks "Import from Claude Design" in Atlas
  │
  ▼
claude-design-import.md skill activates:
  │
  ├─ Authenticates to Claude Design API (user's Anthropic workspace)
  ├─ Fetches the project (artboards, components, tokens, prototype flows)
  │
  ├─ Maps to spec graph:
  │     artboard       → Page
  │     design token   → DesignToken
  │     component      → Component
  │     prototype flow → Flow (steps from prototype interactions)
  │     image / asset  → MediaAsset (license=user-uploaded)
  │
  ├─ Ambiguous / unmapped pieces → Visualize "review & resolve" checklist
  │
  ├─ User Agrees
  │
  └─ Events appended · code emitted · pyramid runs · HMR preview
```

Same pattern for `figma-import.md` and `stitch-import.md`. Three additional skills in the OSS library — any designer-tool plugs in via the same contract.

### 4.8 Failure Surfacing — Persona-Tiered Verbosity

| Layer failure | Ama sees | Diego sees | Priya sees |
|----------------|-----------|-------------|--------------|
| L1 schema | "Atlas couldn't save this — retrying…" | toast + structured error + auto-retry | full JSON Schema error + event diff |
| L2/L3 unit/integration | "The new feature is being tested — still working" | failing test list + last-green commit | full test output + seed + repro command |
| L4 API contract | silent retry | contract diff (expected vs actual) | swagger diff + curl repro |
| L5 browser/flow | "Atlas is trying the flow itself — one moment" | Playwright trace + screenshot + console | full video + network log + DOM snapshot |
| L6a auth bypass | "Security check running" | "Bypass succeeded with payload X — RLS fix needed" | full request/response + suggested Rego + OPA trace |
| L6d injection | silent retry | semgrep/tfsec output | full CVE provenance + AST location |
| L6e CVE on dep | silent retry with clean dep | "dep `foo` has CVE — trying `foo@2.5.3`" | full CVE + upgrade path + breaking-change matrix |
| L6f compliance non-match | "Your project needs data in India — adjusting" | compliance check label + remediation | full evidence-pack diff + auditor-readable reasoning |
| L7 a11y contrast | "Adjusting colors for readability" | token delta + affected components | full axe trace + WCAG-AA delta per Component |
| L7h visual-judge (soft) | nothing in v1 | warning + reference comparison | full LLM-judge rationale + overrideable |
| All green | "Done!" | "Deployed" + metrics link | PR summary + release notes + evidence-pack diff |

**Never-broken rule.** After N=3 retries with no green pyramid, **no code surfaces**. The user gets a clear "Atlas couldn't ship this — here's what happened and how we'd fix it" at their tier. They do not get a half-working app.

### 4.9 Database as a Service (DBaaS) — Tiered, Compliance-Aware, OpenEverest-Backed

When a project has `Model` nodes, Atlas takes full responsibility for database provisioning and Day-2 operations. Users choose a **DBaaS tier** at Ship time; tier upgrades do not require re-architecting (same Models, same migrations — only the connection string changes).

| Tier | Technology | Who it's for | ComplianceClass support |
|------|-------------|--------------|--------------------------|
| **Dev / Test** | SQLite embedded in the E2B sandbox (`dev.db`) | All users during Build + L3 integration tests | n/a (no PII in dev) |
| **Atlas Run (managed)** | Neon serverless Postgres (default) · Supabase · PlanetScale (MySQL) — user picks provider at Ship | Atlas Builder tier (default); most Ama + Diego workloads | baseline · GDPR · CCPA · LGPD (global regions) |
| **Atlas Managed Postgres** | Atlas-operated Postgres via **OpenEverest Operator** on Atlas's K8s fleet | Atlas Pro / Team where users want Atlas to run the DB end-to-end | baseline + regional variants (data stays in chosen Atlas region) |
| **Atlas Sovereign Postgres** | **OpenEverest Operator** on the user's own K8s cluster (cloud or on-prem) — Atlas ships the operator + Day-2 playbook; user owns the cluster and its data | Atlas Sovereign / Enterprise / regulated industries | all classes including HIPAA · PCI-DSS · DPDP-India · ITAR (data never leaves user's environment) |
| **BYODB (bring your own)** | User supplies a Postgres- or MySQL-compatible connection string | Teams with existing DB investments | determined by user's provider |

**Why OpenEverest as the backbone** (not RDS / Cloud SQL / managed-only): OpenEverest is the named choice in the existing `cloud_migration` repo's Phase 4-6 roadmap. It is K8s-native, cloud-provider-agnostic, and works identically on Atlas's fleet, a hyperscaler's managed K8s, or a user's bare-metal cluster. That continuity is what makes the `idea → private cloud` arc in `ECOSYSTEM_VISION.md` coherent: **the same Postgres Atlas ran for you at Managed tier is the same Postgres you run at Sovereign tier, just on a different cluster.** No vendor migration — only a cluster migration. This is the story nobody else in the AI-builder space can tell.

**v1 (this spec) scope:**
- Dev (SQLite) — embedded in every E2B template, used by L3 tests
- Atlas Run (Neon default; Supabase / PlanetScale optional) — wired by the Ship skill
- BYODB — documented path for users with existing DBs

**Phase B–D:**
- **Phase B:** Atlas Managed Postgres via OpenEverest on Atlas's K8s (tied to Atlas Run multi-region expansion)
- **Phase D:** Atlas Sovereign Postgres via OpenEverest on customer's K8s (tied to Atlas Migrate GA)
- **Phase D:** Cache tier (Redis via same OpenEverest pattern), blob tier (S3-compatible via MinIO or provider)

**Compliance routing at Ship time.** If the project declares `ComplianceClass.name = DPDP-India`, the Ship skill automatically constrains DBaaS options to providers/regions honoring in-country residency: blocks US-only Neon regions, offers `ap-south-1`, suggests Atlas Managed Mumbai (Phase B+), or BYODB-in-India. Same pattern for GDPR (EU regions), POPIA (South African regions), LGPD (Brazilian regions), etc.

**Schema graph impact — one project-level attribute, no new node type.** Adding to the graph root (§5.1):

```json
"databaseProvider": {
  "tier": "dev" | "atlas-run" | "atlas-managed" | "atlas-sovereign" | "byodb",
  "provider": "sqlite" | "neon" | "supabase" | "planetscale" | "openeverest-atlas" | "openeverest-user" | "custom",
  "region": "us-east-1" | "eu-west-1" | "ap-south-1" | ...,
  "connectionStringRef": "env:DATABASE_URL"     // never literal; always a reference
}
```

Models don't care which DB hosts them beyond schema dialect — so this is graph metadata, not a node. Cache and blob tiers get sibling attributes when Phase D introduces them.

### 4.10 Prebuilt E2B Sandbox Templates

Atlas ships **seven v1 prebuilt E2B templates**, one per primary stack. Each is a Firecracker microVM image with language runtime, package manager, common dependencies, test tooling, Atlas daemon, and Playwright browsers pre-installed. Cold-start target ≤ 150ms (E2B's published baseline per [superagent.sh sandbox benchmark](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026)).

| Template ID | Stack | Preinstalled highlights |
|-------------|-------|--------------------------|
| `atlas-next-ts` *(default)* | Next.js 15 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Prisma · SQLite · Playwright · Vitest · axe-core · Motion v12 | The golden path — ~80% of Ama projects |
| `atlas-react-vite` | React 19 · Vite · TypeScript · Tailwind · same tooling | SPA builds without SSR |
| `atlas-astro` | Astro 5 · MDX · Tailwind · content collections | Marketing sites, docs, blogs |
| `atlas-sveltekit` | SvelteKit 2 · TypeScript · Tailwind | Svelte audience |
| `atlas-python-fastapi` | Python 3.13 · FastAPI · SQLAlchemy · Pydantic · SQLite · pytest · Playwright · `uv` | Python backends |
| `atlas-go-chi` | Go 1.23 · Chi · sqlc · SQLite · Playwright · Ginkgo | Go backends |
| `atlas-expo` | Expo SDK 52 · React Native · TypeScript · EAS Build · Maestro (mobile E2E) | Cross-platform mobile |

**Phase B templates (requested + pending decisions):**
- `atlas-flutter` — Flutter 3.x for iOS + Android (Flutter vs Expo decision per Rocket research; open question)
- `atlas-python-django` — Python + Django + DRF
- `atlas-rails` — Ruby on Rails 8
- `atlas-phoenix` — Elixir + Phoenix LiveView
- `atlas-rust-axum` — Rust + Axum + sqlx
- `atlas-java-spring` — Java + Spring Boot (enterprise requests)

**Rebuild cadence and integrity:**
- **Weekly automatic rebuild** pulling latest security patches (pinned to Node 22 LTS, Python 3.13, Go 1.23, etc.)
- **CVE-triggered out-of-band rebuild** within 24 hours of critical disclosure
- **Signed** images (Sigstore / cosign); digest committed to `.atlas/e2b.toml` per project for reproducibility
- **90-day retention** of old digests so users can reproduce historical builds

**Template selection rubric:**
- The **Architect** skill reads Spec Graph stack signals (declared languages, framework Dependencies, Flow patterns) and picks a default
- **Ama** — invisible; the recommended template is used
- **Diego** — picked template + alternatives shown
- **Priya** — can pin exact template version per project; can supply a private template for enterprise needs

**Self-hosted template registry (Phase D).** Enterprise customers host their own E2B template registry with internally-hardened images (approved base images, internal package mirrors, pre-baked company credentials). Atlas's daemon supports a configurable registry endpoint from v1 even though Atlas's public registry is the default.

**Why this matters for v1:** the `Dependency` node's `cveScanStatus` is meaningful only if the **base image** is also scanned and versioned. The template digest lives on the graph root (`templateDigest: "sha256:..."`) so every spec-graph event is reproducible against a specific image, not a moving target.

### 4.11 Web App Preview

Live preview is first-class UX, not an afterthought. Every Atlas project has an interactive, running preview available at every step of the Visualize → Agree → Build ritual and throughout the app's life. Pattern is informed by Bolt.new (WebContainers + iframe), v0 (side-by-side code + preview), Vercel's Toolbar (in-browser review), and Lovable (split-pane preview + AST-linked).

#### Architecture

- The E2B sandbox (§4.10) runs the dev server (Vite / Turbopack / SvelteKit / etc.) and exposes a preview URL
- Atlas frontend renders preview in an `<iframe>`, split-pane with the Visualize canvas / code editor
- HMR connects through the iframe: code emit → file write → HMR event → preview reflects in < 500ms
- Source maps are wired end-to-end (Next.js 15.1+ ignoreList for 3rd-party frames, Turbopack source-map improvements)
- React 19 HMR re-uses fetch responses from previous renders for snappier dev

#### Feature tiers (all v1 unless marked)

**Tier 1 — Core preview (every persona)**
- Live HMR iframe with < 500ms p50 update on single-component changes
- Multi-viewport presets: mobile (375w) · tablet (768w) · desktop (1440w) · custom drag-to-resize
- Network + CPU throttling: fast-3G, slow-3G, offline, 4× CPU, 6× CPU (Chrome DevTools presets)
- Dark / light mode toggle on the preview chrome
- Locale switcher cycling through all i18n languages present
- RTL layout flip (for every Arabic / Hebrew / Urdu route)
- "Snapshot now" — PNG download + permalink (pinned to spec-graph event SHA)
- Error overlay (Next.js 15.1 style — ignoreList for 3rd-party frames, "Show ignored frames" toggle)
- Console panel (dev mode only; redacted for shared-link viewers)

**Tier 2 — Share & review (every persona)**
- Shareable preview URL with configurable access:
  - `public` (anyone with link)
  - `password` (link + passphrase)
  - `authenticated` (Atlas account required)
  - `domain-restricted` (email-domain matching, enterprise)
- Link expiry presets: 1h · 24h · 7d · 30d · never. Defaults: Ama 24h, Diego 30d, Priya never (revocable)
- Ephemeral signed tokens, revocable any time from settings
- Link permissions: view-only · comment · suggest-edit (full-edit delegation is Phase B)
- **Preview permalinks pinned to a specific spec-graph event SHA** — reviewer always sees the exact state that was reviewed, even as the author continues iterating
- Comment pins on preview (click → drop pin → thread); @mentions; resolve/reopen; approve / request-changes workflow
- Review activity rolls into the event log with provenance (who, when, what)

**Tier 3 — Authenticated simulation (Diego+)**
- Run-as-role: simulate a logged-in user with any AuthBoundary role (admin / user / guest / custom) — Atlas mints a preview-scoped session token for the sim
- Run-as-anonymous: simulate unauthenticated visitor
- Seed fixtures vs production-shaped data toggle
- Draft vs published content (Phase B, with CMS extension)

**Tier 4 — Dev tools (Diego+)**
- Live network inspector for preview requests/responses
- React component tree inspector
- Accessibility tree inspector (wired to L7a axe-core for live readout)
- Performance flame-graph (soft — Phase B)
- **Spec-graph link**: hover any preview element → highlights the corresponding `Component` / `Page` node in Diego's structured canvas, and vice versa

**Tier 5 — Compliance preview modes (ComplianceClass-driven)**
- Consent banner preview (exercise GDPR / CCPA / DPDP-India / LGPD cookie + consent flows explicitly)
- Permissioned-data visibility simulation (e.g. HIPAA role-based redaction)
- PII redaction preview — shows what logs look like to auditors
- Invoked automatically when the project declares the relevant ComplianceClass; no extra config

#### Non-functional requirements

- **NFR-PREVIEW-1**: HMR p50 latency < 500ms, p95 < 1500ms for single-component changes
- **NFR-PREVIEW-2**: Preview URL cold-start after sandbox suspend < 3s
- **NFR-PREVIEW-3**: Shared preview URL resolution < 200ms hot (CDN-backed)
- **NFR-PREVIEW-4**: Concurrent viewers on a shared preview ≥ 20 without degradation
- **NFR-PREVIEW-5**: 100% of shared preview URLs honor declared expiry + are revocable within 10s
- **NFR-PREVIEW-6**: No preview URL exposes dev-mode error overlay to non-authenticated viewers (principle #2)
- **NFR-PREVIEW-7**: Zero spec-graph state leaks through preview (even Priya's raw-graph view requires auth)

#### Out of scope for v1 (Phase B+)

- Fully interactive (not just commentable) editing from a shared link
- Real-time multi-user cursor co-presence in preview (Phase C; CRDT-backed)
- Video recording of preview sessions
- Full Chrome DevTools Protocol integration (remote-debug the preview from Atlas UI)
- Preview branch-forking (shared preview locked to SHA while author keeps working — Phase B ships the branching UX that's already mechanically enabled by events.jsonl)

### 4.12 Web App Management Edits (Visual-Edit Mode)

Atlas's answer to Lovable's Visual Edits and Framer's click-to-edit — but **every visual edit flows through the Spec Graph and all merge gates**. No edit bypasses Security, Accessibility, Browser Verification, or Compliance checks.

#### Architecture (AST-based, no regex)

- Source files parsed to AST (Babel for TS/JS, SWC where faster, acorn/escodegen as fallback)
- AST loaded into the Atlas frontend as a live data structure
- Client-side **Element Indexer** maps `DOM element → source file + AST location + Component node ID`
- Click → selection highlights simultaneously in (1) preview iframe, (2) code editor, (3) spec-graph canvas (Diego+)
- Edit → computes a typed AST mutation → **client-side Tailwind generator** (per Lovable's pattern) applies optimistically
- Preview reflects change in < 200ms *before* any save
- On save → AST mutation becomes a spec-graph event (`source: "visual-edit"`) → event appended → pyramid runs → green = committed, red = optimistic preview reverts with failure message

#### Edit categories (v1)

**1. Text edits**
- Double-click any text node → `contenteditable` toggle
- Plain text, rich text (bold / italic / link), or structured (headings, lists)
- AI-assist: highlight text → "rewrite as X" (shorter · friendlier · formal · translate · summarize)
- Saves as: literal string update in JSX if inline; i18n key update if localized

**2. Style edits**
- Color picker bound to `DesignToken` nodes — no raw hex unless Priya escape-hatches (enforces principle #4 palette discipline)
- Spacing (padding / margin) — visual handles, emits Tailwind class mutation
- Typography (font / size / weight / leading) — token-bound
- Border + shadow — token-bound
- Per-breakpoint variants (edit at mobile, tablet, desktop viewports with visible breakpoint indicator)
- Saves as: Tailwind class mutation in the Component's AST

**3. Component-level edits**
- Select Component → attribute panel (driven by the `propsSchema` on the Component node)
- Add / remove / reorder children (bounded by `renders` edge semantics)
- Duplicate; delete (with impact-analysis warning if other nodes reference it)
- Saves as: AST + graph edge mutations atomically

**4. Media edits**
- Click image → swap from MediaAsset library, upload, or AI-regenerate
- Regenerate via `generationPrompt` mutation (principle #4 flow)
- Alt-text editor with LLM suggestion
- Saves as: MediaAsset node update + `displays` edge retargeting

**5. Content / CMS edits (v1 baseline)**
- Double-click any content block → inline edit (Framer + DatoCMS-style)
- Plain text / rich text / image / date / reference fields
- For v1, content lives **inline** in the Component source — Phase B introduces a `Content` node type + true draft/published workflow

**6. Layout edits (bounded v1)**
- Move components within a parent (drag-to-reorder, sibling-only)
- Nest / unnest within same component boundaries (no structural chaos — e.g., can't drop a `<form>` inside a `<button>`)
- Saves as: AST reordering + graph edge updates

**7. AI-assisted edits**
- Right-click any element → "Ask Atlas to change this…" prompt panel
- Payload to the Developer role: selected Component node + current AST slice + resolved Tailwind classes + user prompt
- Response: an edit plan → user Agrees → applies via the same ritual
- This is the **Maintain-scope ritual** applied at component level (principle from earlier brainstorm — one ritual at every scale)

#### Edit → merge gate flow

```
User edits in visual mode
  │
  ▼
Client-side optimistic preview (< 200ms, Tailwind generator + AST patch)
  │
  ▼
User clicks "Save edit" (or auto-save after debounce in Ama mode)
  │
  ▼
AST mutation → Spec Graph event { source: "visual-edit", persona, elementSelector, astPath, diff }
  │
  ▼
Daemon validates against JSON Schema v1 (merge gate L1)
  │
  ▼
Pyramid L2–L7 runs on affected files only (fast path, cache-aware)
  │
  ▼
All green:  event committed · HMR confirms preview · edit done
Any red:    optimistic preview reverts · failure surfaced at persona verbosity · "retry / undo / ask Atlas" offered
```

#### Persona tiers for visual-edit

| Tier | What they can do |
|------|-------------------|
| **Ama** | Text, style (palette swatches + simple sliders, no raw Tailwind), component swap, media swap, AI-assisted. Hidden: Tailwind class editor, AST view, raw graph. |
| **Diego** | All Ama edits + Tailwind class editor + component attribute panel + layout edits (bounded) + AST inspector + impact-analysis before destructive edits. |
| **Priya** | All Diego edits + raw JSX inline editor + graph-level node/edge editing + bulk find-and-replace + full edit audit log inspection + override capability for destructive edits with explicit confirmation. |

#### Bulk operations (v1)

- Find-and-replace across files (text + class names)
- "Replace all uses of DesignToken X with DesignToken Y" — propagates to every node with `styledBy` X
- "Upgrade all Button variants to v2" — guided migration when a Component `supersedes` another
- Saves as a single batched event for atomicity + clean undo

#### Audit, undo, provenance

- Every visual edit emits one event with: `userId`, `personaTier`, `elementSelector`, `astPath`, `beforeDiff`, `afterDiff`, `timestamp`, `skillProvenance` (if AI-assisted)
- Undo / redo via event log (Ctrl+Z rewinds a single event; Ctrl+Shift+Z replays)
- Full event history browsable per persona tier — Priya sees JSON stream, Diego sees readable timeline, Ama sees a simple "last changes" list
- Every edit is subject to the same merge pyramid — **no edit path is a shortcut around Security / Accessibility / Browser Verification** (principle #2 teeth)

#### Non-functional requirements

- **NFR-EDIT-1**: Optimistic preview reflection < 200ms p95
- **NFR-EDIT-2**: Edit → pyramid-green committed < 10s p50 for single-component changes
- **NFR-EDIT-3**: 100% of visual edits produce a spec-graph event with full provenance (zero "ghost changes")
- **NFR-EDIT-4**: Visual edits honor every merge gate — no edit bypasses L1–L7
- **NFR-EDIT-5**: Undo works across arbitrary depth, never corrupts graph state
- **NFR-EDIT-6**: Bulk operations (DesignToken rename across 100+ refs) complete in < 5s
- **NFR-EDIT-7**: Visual-edit mode must not leak sensitive data to clients without auth — preview permissions gate which elements are editable

#### Out of scope for v1 (Phase B+)

- True drag-drop page-builder (moving components across arbitrary parents with structural changes)
- Visual editing from a shared preview link (requires preview-link auth extension)
- Collaborative real-time visual editing (two users editing same component simultaneously) — Phase C, CRDT-backed
- Full Figma-grade alignment/distribute tools
- Visual authoring of *new* components from scratch (creating a new component by composing primitives on a canvas)
- Absolute-positioning canvas layout / z-index manipulation (v1 is flow-based only)

#### New OSS skills added to the library (principle: library > 50 skills at v1 ship)

| Skill | Purpose |
|-------|---------|
| `preview-device-emulation.md` | Viewport + network + CPU emulation |
| `preview-share-link.md` | Shareable URL token generation, expiry, revocation |
| `preview-error-overlay.md` | Error surfacing (React boundaries + Next.js overlay + persona verbosity) |
| `preview-collaborative-review.md` | Comment pins, @mentions, approve/request-changes workflow |
| `preview-compliance-mode.md` | ComplianceClass-aware preview modes (consent banner, role-based visibility, PII redaction) |
| `preview-run-as-role.md` | Auth simulation for preview |
| `visual-edit-text.md` | contenteditable + AST update for text nodes |
| `visual-edit-style.md` | Token-bound style editing (color, spacing, typography, border, shadow) |
| `visual-edit-component.md` | Component attribute panel + children reorder |
| `visual-edit-media.md` | Media swap + regen via MediaAsset |
| `visual-edit-layout.md` | Bounded drag-to-reorder + nest/unnest |
| `visual-edit-ai-assist.md` | Right-click → ask-Atlas prompt flow |
| `visual-edit-bulk.md` | Find-and-replace + DesignToken rename propagation |
| `visual-edit-diff-to-spec.md` | AST mutation → spec-graph event translation |
| `inline-cms-v1.md` | Baseline inline content editing (Phase B introduces Content node + drafts) |

Library grows from ~46 → **~61 skills at v1 ship**.

---

## 5. Schema — 13 Node Types, 12 Edge Types, Invariants

### 5.1 Graph Root Object

Not a node. The graph file itself is the project.

```json
{
  "schemaVersion": "1.0.0",
  "projectId": "uuid",
  "name": "acme-app",
  "complianceClasses": ["baseline"],
  "databaseProvider": {
    "tier": "atlas-run",
    "provider": "neon",
    "region": "us-east-1",
    "connectionStringRef": "env:DATABASE_URL"
  },
  "templateDigest": "sha256:abc123...",
  "createdAt": "2026-04-18T12:00:00Z",
  "updatedAt": "...",
  "nodes": {
    "page:home": {...},
    "component:Button": {...}
  },
  "edges": [
    {"from": "page:home", "to": "component:Button", "type": "renders"}
  ]
}
```

Nodes keyed by `<type>:<id>` for uniqueness; edges self-describe their type. `databaseProvider` (§4.9) and `templateDigest` (§4.10) are project-level attributes, not nodes — they affect how the graph is built and run but have no graph-semantic edges to other nodes.

### 5.2 The 13 Node Types

| # | Node | Purpose | Key attributes |
|---|------|---------|-----------------|
| 1 | **Page** | A route-rendered page | path · title · layout · renderMode (SSR/SSG/CSR/ISR) · metadata · a11yAnnotations |
| 2 | **Route** | URL pattern (dynamic segments, API routes, middleware) | pattern · method · handlerType (page · endpoint · middleware) |
| 3 | **Component** | Reusable UI piece | name · propsSchema · isServerComponent · styleApproach · a11yAnnotations |
| 4 | **Model** | Data entity (Prisma/Drizzle-shaped) | name · fields · relations · indexes · rlsPolicies (select/insert/update/delete) · piiClassification · dataRetentionDays |
| 5 | **Endpoint** | API route or server action | name · routeRef · method · inputSchema · outputSchema · authRef · rateLimit |
| 6 | **Flow** | User journey spanning pages | name · steps (ordered) · entryPoints · successCriteria · failurePaths |
| 7 | **AuthBoundary** | Protected area | name · type (public · authenticated · role · permission) · roles · permissions · bypassConditions |
| 8 | **Test** | A test (generated or user-authored) | name · layer (L1–L7) · source (generated · user) · filepath · coversRef |
| 9 | **DesignToken** | Design-system token | name · category (color · spacing · typography · radius · shadow · motion) · value · scale (light/dark) · contrastGroup |
| 10 | **Dependency** | npm package | name · version (pinned exact) · purpose · license · cveScanStatus |
| 11 | **ComplianceClass** | A compliance regime | name (baseline · HIPAA · PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · SOC2 · ISO27001) · scope · attestation · effectiveDate |
| 12 | **AIFeature** | An AI capability the app offers | name · category (chat · search · generation · recommendation · classification · extraction · translation · moderation · agent · vision · audio · multimodal) · capabilityContract · inputModality · outputModality · grounding · personalization · privacyMode · safetyContract · fallbackBehavior · costTier |
| 13 | **MediaAsset** | A generated or user-uploaded media asset | kind (image · video · audio · icon · illustration) · providerCapability · generationPrompt · pathOrUrl · altText · licenseStatus · contentHash · personalizationContext |

**Always-present.** One `ComplianceClass` with `name: "baseline"` is auto-inserted on project creation. Users can escalate by adding additional classes; they cannot remove `baseline`.

### 5.3 The 12 Edge Types

| Edge | Allowed from → to | Meaning |
|------|--------------------|---------|
| `renders` | Page → Component · Component → Component | UI composition |
| `fetches` | Page → Endpoint · Component → Endpoint | Data fetch |
| `reads` | Endpoint → Model | Read-only DB access (distinct for RLS reasoning) |
| `mutates` | Endpoint → Model | Write access |
| `requires` | Page → AuthBoundary · Endpoint → AuthBoundary | Protection |
| `covers` | Test → {Page · Component · Endpoint · Model · Flow · AuthBoundary} | Test coverage |
| `dependsOn` | Component → Dependency · Endpoint → Dependency | Library usage |
| `styledBy` | Component → DesignToken | Design-system coupling |
| `subjectTo` | Model → ComplianceClass · Endpoint → ComplianceClass | Compliance scope |
| `supersedes` | any → same type | Rename/deprecation chain |
| `powers` | AIFeature → Component · AIFeature → Endpoint | Which surfaces use an AI capability |
| `displays` | Component → MediaAsset · Page → MediaAsset | Media usage |

### 5.4 Structural Invariants (enforced at L1 schema validation)

1. Every `Page` must carry a `routeRef` (Route nodes are referenced inline, not via edge — they're light enough to embed).
2. Every `Endpoint` must carry a `routeRef`.
3. Every `Page` with `authRequired: true` must `requires` an `AuthBoundary`.
4. Every `Endpoint` that `mutates` a `Model` with `piiClassification != "none"` must `requires` an `AuthBoundary` AND `subjectTo` at least one `ComplianceClass`.
5. Every `Model` with `piiClassification != "none"` must have RLS policies for all four actions (select/insert/update/delete).
6. Every `Dependency` with a critical CVE must carry `cveScanStatus.severity = "critical"` — merge-blocker until an `Upgrade` skill run resolves it.
7. Every `Component` referenced by `renders` must exist (no dangling refs).
8. Exactly one `ComplianceClass` with `name: "baseline"` must be present.
9. `covers` edges must exist from at least one `Test` to every `Page`, `Endpoint`, `Flow`, and `AuthBoundary`. Test gaps are merge-blockers (principle #1).
10. Every `AIFeature` with `personalization != "none"` must `subjectTo` at least one ComplianceClass that governs personal data (baseline includes this).
11. Every `MediaAsset` with `licenseStatus == "generated"` must carry a `providerCapability` attestation.

### 5.5 Concrete Example — "Add forgot-password flow"

One ritual invocation produces:

**Nodes added (11):**
- `page:ForgotPasswordPage` (path: `/forgot-password`)
- `page:ResetPasswordPage` (path: `/reset-password/[token]`)
- `endpoint:requestPasswordReset` (`POST /api/auth/forgot-password`)
- `endpoint:resetPassword` (`POST /api/auth/reset-password`)
- `model:PasswordResetToken` (pii: `token,userId`; retention: 1h; RLS policies for all 4 actions)
- `flow:ForgotPasswordFlow` (steps: enter-email → email-sent → click-link → set-password → signed-in)
- `authboundary:PublicWithRateLimit` (type: public, rate: 3/hour/IP)
- `test:ForgotPasswordFlow.e2e` (L5)
- `test:PasswordResetToken.rls` (L6a)
- `test:requestPasswordReset.api` (L4)
- `test:resetPassword.api` (L4)

**Edges added (≥10):**
- `page:ForgotPasswordPage` → `endpoint:requestPasswordReset` (`fetches`)
- `page:ResetPasswordPage` → `endpoint:resetPassword` (`fetches`)
- `endpoint:requestPasswordReset` → `model:PasswordResetToken` (`mutates`)
- `endpoint:resetPassword` → `model:PasswordResetToken` (`reads`, `mutates`)
- `endpoint:requestPasswordReset` → `authboundary:PublicWithRateLimit` (`requires`)
- `endpoint:resetPassword` → `authboundary:PublicWithRateLimit` (`requires`)
- `endpoint:requestPasswordReset` → `compliance:baseline` (`subjectTo`)
- `endpoint:resetPassword` → `compliance:baseline` (`subjectTo`)
- `test:*` → respective targets (`covers`)

**What each persona sees:**
- **Ama**: "Added forgot-password. Users can now reset via email." + wireframes.
- **Diego**: structured graph editor showing 11 new nodes grouped by type, with attribute panels.
- **Priya**: full JSON diff + event timeline entry with skill provenance.

### 5.6 Schema File Sketch

`.atlas/schema/spec.graph.v1.json` is a JSON Schema document published as `@atlas/spec-graph-schema`. Three CI generators:

- `json-schema-to-zod` → `packages/spec-graph-ts/index.ts`
- `datamodel-code-generator` → `packages/spec_graph_py/models.py`
- Markdown reference doc → `docs/spec-graph-reference.md` (OSS skill-author audience)

---

## 6. Testing, Security, Compliance (the teeth on principle #1 & #2)

### 6.1 The Test Pyramid — Seven Layers

All layers run on every ritual-approved change. L1 gates L2–L7; within L2–L7, layers parallelize where independent.

| Layer | Runner | Contract | Budget (p50 / p95) |
|-------|--------|-----------|----------------------|
| **L1 Static** | `tsc --noEmit` · Biome · `json-schema` validate · `prisma validate` · `socket.dev`/`snyk` CVE scan | No type errors, no lint errors, graph valid, no critical CVE | 5s / 20s |
| **L2 Unit** | Vitest on affected `*.test.{ts,tsx}` | All unit tests green; new code has ≥1 failing-then-green test per TDD | 10s / 45s |
| **L3 Integration** | Vitest + ephemeral SQLite-in-memory · `msw` | Schema applies cleanly, module boundaries honored, internal contract tests pass | 15s / 60s |
| **L4 API contract** | `supertest`/`hono/testing` · `ajv` vs OpenAPI | Request + response schemas honored, 401/403 on AuthBoundary'd endpoints, RLS effective on mutates | 15s / 45s |
| **L5 Browser/Flow** | Playwright on E2B preview · axe-core · visual diff | Every Page renders, every Flow completes, zero console errors, visual diff within threshold | 60s / 180s |
| **L6 Security + Compliance** | §6.1.1 sub-layers | All sub-layers green per declared ComplianceClass set | 30s / 120s |
| **L7 UX + Accessibility** | §6.1.2 sub-layers | axe clean, keyboard reachable, contrast AA, Lighthouse ≥ 90, motion respected, L7h soft-warn | 45s / 150s |

**Total budget targets (parallel execution):**

- Single-component iteration: **p50 < 60s · p95 < 180s**
- New feature (3–5 Pages, 2 Endpoints, 1 Flow): **p50 < 3min · p95 < 8min**
- Full new-app generation: **p50 < 6min · p95 < 15min**

#### 6.1.1 L6 Security + Compliance Sub-layers

```
L6a Auth               Playwright bypass suite (anon, wrong-role, expired session)
                       baseline: 401 anon, 403 wrong-role, session rotation on privilege change
                       + HIPAA/PCI/DPDP: stricter rate limits, shorter session, MFA on sensitive ops

L6b Data               gitleaks + trufflehog + PII-in-logs grep + schema PII assertion
                       baseline: no plaintext secrets, no PII in logs, encryption at rest for PII
                       + HIPAA: minimum-necessary access, BAA-eligible provider allowlist
                       + PCI:   cardholder data map, "no card-number anywhere" static+runtime

L6c Transport          headers assertion suite on E2B preview
                       baseline: HTTPS, HSTS preload, CSP strict-nonce, X-Frame, Referrer-Policy, Permissions-Policy

L6d Injection          semgrep (SQLi/XSS/SSRF) · tfsec · ZAP baseline on changed endpoints
                       baseline: parameterized queries only, CSRF on mutations, SSRF-safe HTTP client, no eval
                       + class-specific: OWASP ASVS L2 for HIPAA/PCI; L1 for baseline

L6e Dependencies       npm audit · socket.dev · SBOM via cyclonedx-bom
                       baseline: zero critical CVE, license allowlist (MIT/Apache/BSD/ISC/MPL), SBOM valid

L6f Compliance         class-aware runners:
                       baseline:     GDPR/CCPA consent + DSR endpoints functional; audit log on PII writes;
                                     SOC 2 control scaffolding present
                       + HIPAA:      PHI encryption at rest, BAA vendor check, minimum-necessary access test
                       + PCI-DSS:    no card data in schema/logs, scope minimization
                       + DPDP-India: data residency check, consent manager spec-compliant, breach scaffold
                       + LGPD:       DPO contact, processing record auto-generated
                       + COPPA/FERPA/ITAR/POPIA: class-specific tests
                       + AI-feature-specific: prompt-injection, hallucination guards, moderation
```

#### 6.1.2 L7 UX + Accessibility Sub-layers

```
L7a axe-core           WCAG 2.2 AA, all pages
L7b keyboard-nav       every interactive element reachable, focus order logical
L7c contrast           4.5:1 text / 3:1 UI / 7:1 if class includes a11y-AAA
L7d RTL snapshot       Arabic/Hebrew/Urdu layouts captured + visual-diff'd
L7e motion-respect     useReducedMotion honored (prefers-reduced-motion: reduce)
L7f neurodivergent     reading-level ≤ 10th grade (Flesch-Kincaid), cognitive-load audit, dyslexia-friendly fonts
L7g Lighthouse         Performance ≥ 90, Best Practices ≥ 95, SEO ≥ 90
L7h visual-judge       Claude Opus visual comparator vs curated "delightful reference" corpus per category
                       (v1: soft-block — warning only; Phase B: hard-block after calibration)
L7i sustainability     bundle ≤ 100KB initial JS, webp/avif images, no autoplay video, low-power-mode friendly
```

### 6.2 Test Generator Registry (per node type → exact emitted tests)

All generators are skill files (`test-generator-<node>.md`) in the OSS library. Projects can override via `.atlas/skills/test-generator-<node>.md`.

```
Page
  → tests/pages/<slug>.browser.spec.ts                          (L5)
        route loads, SSR HTML snapshot, hydration clean, no console errors, axe clean, mobile snapshot
        authRequired: anon → redirect to login, expired session handled

Component
  → src/components/<name>/__tests__/<name>.unit.test.tsx        (L2)
        default props, all variants, snapshot, a11y role, keyboard interactions
  → src/components/<name>/__tests__/<name>.a11y.test.tsx        (L7a)
        axe-core, contrast, focus order

Model
  → tests/models/<name>.integration.test.ts                     (L3)
        CRUD against ephemeral SQLite, indexes, relations, constraints, migration idempotence
  → tests/models/<name>.rls.test.ts                             (L6a)
        auth'd matching scope: reads + writes own rows
        auth'd non-matching scope: 0 visible, writes blocked
        anon: 0 visible, writes blocked
        admin escalation: correctly scoped

Endpoint
  → tests/api/<name>.contract.test.ts                           (L4)
        input schema enforced, output matches, 400/401/403 semantics, RLS honored, rate limit triggers
  → tests/api/<name>.injection.test.ts                          (L6d)
        SQLi/XSS/SSRF/command-injection payloads → safe response

Flow
  → tests/flows/<name>.e2e.spec.ts                              (L5)
        full happy path, failure paths per step, state persistence across steps

AuthBoundary
  → tests/auth/<name>.bypass.test.ts                            (L6a)
        anon → 401, wrong role → 403, expired session → refresh path, bypass conditions explicit

DesignToken
  → tests/design/tokens.contrast.test.ts                        (L7c)
        every token combination meets WCAG AA (or AAA if class requires)
        no hardcoded hex — every color resolves through a token

Dependency
  → handled by L6e CVE scan + license allowlist (no dedicated test file)

ComplianceClass
  → tests/compliance/<class>.assertion.test.ts                  (L6f)
        class-specific assertions per §6.1.1

Test (user-authored or generated)
  → itself; this is the Test node

AIFeature
  → tests/ai/<name>.contract.test.ts                            (L4 + L6-AI)
        prompt template loads & schema-validates
        prompt-injection battery (jailbreaks, schema escapes) → graceful refusal
        hallucination guard: if grounding=RAG, retrieval attributable; un-grounded claims blocked
        moderation: unsafe inputs flagged per safetyContract
        PII redaction: sensitive input redacted before provider; sensitive output flagged in log
        cost guard: runtime token limit enforced; abuse rate-limited
        fallback: provider outage → graceful-degrade verified
        personalization: user data scoped; no cross-user leakage

MediaAsset
  → tests/media/<hash>.assertion.test.ts                        (L7a + L6b)
        altText present, WCAG-readable
        content moderation pass
        license recorded, provider attestation valid
        optimization: webp+avif present, sizes progressive
        ComplianceClass routing honored (DPDP-India → in-country provider)
```

### 6.3 Runtime Semantics

**Parallelization.** L1 gates L2–L7. Within L2–L7, layers fan out by affected file set. Independent tests run in worker pools (Vitest native + Playwright workers, 4 by default on managed, configurable on self-hosted).

**Caching.** `vitest --changed` + baseline test-graph cached by file-hash. Untouched tests skip unless a Dependency, ComplianceClass, or shared utility changed. L5 visual baselines cached per spec-graph revision; HMR-scope diffs re-snapshot only affected viewports.

**Retry semantics.**
- Skill-level: **N = 3** attempts with **different approach** each retry. Approach attempted logged to events.jsonl.
- Flake-level: 2 automatic re-runs of a failing L3/L4/L5 test if failure signature matches known-flaky patterns (network timeout, DB race, LLM non-determinism within tolerance, Playwright element-timing).
- After 3 skill retries all fail: ritual surfaces failure at persona verbosity and refuses to commit events. No partial state.

**Flaky-test quarantine.** Every test's pass/fail history → `.atlas/telemetry/test-history.jsonl`. Test with < 95% pass rate over last 20 runs auto-quarantined: still runs, doesn't block merge, tagged "flaky — investigate." Quarantine lift via explicit `stabilize-flaky-test.md` skill run.

**Performance budgets enforced at skill level.** If a ritual's pyramid exceeds p95 budgets 3 runs in a row, the Architect flags a perf regression and suggests corrective action (test sharding, skipping unchanged, restructuring the graph).

---

## 7. Success Criteria (measurable; all eval'd on a 30-app evaluation suite across categories: landing page · SaaS dashboard · e-commerce · blog · internal tool · health intake form · educational platform · non-profit site)

| Metric | Target | Why |
|--------|--------|-----|
| Pyramid-green rate on first ritual | ≥ 90% | "Works first time" principle |
| Pyramid-green rate after ≤ 3 skill retries | ≥ 97% | Retry budget absorbs edge cases |
| Visualize→Agree→Build p50 (new app) | ≤ 6 min | User-facing speed |
| Reconciliation accuracy (ambiguity classifier) | ≥ 95% confident auto-reconcile | Drift-detection quality |
| Schema validation miss rate | 0 | No invalid graph states committed |
| AIFeature prompt-injection resistance | ≥ 99% block rate on the Atlas standard battery (payloads from OWASP LLM Top 10 2025 + HarmBench + PromptBench + our own regression corpus) | Principle #2 teeth |
| WCAG 2.2 AA compliance on first gen | ≥ 95% | Principle #4 baseline |
| HIPAA / PCI / DPDP compliance-pack completeness | 100% of required items present | Principle #2 extension |
| Event log completeness | 100% of graph mutations carry provenance | Auditability |
| LLM cost per full-app gen on baseline class | ≤ $0.40 | Flat-rate viability |
| OSS skill library external contributor PRs | ≥ 3 in first 6 weeks | Community health |
| Persona handoff: 3 tiers on same project | ≥ 5 projects in eval | Section 1 principle |

**Ship criterion:** hit 10+ of 12 at v1 release. If < 8, don't ship — iterate.

---

## 8. Out of Scope for v1 (explicit YAGNI list)

- Infrastructure nodes (Region · Runtime · Provider · DataResidency · WorkloadTopology) — **Phase B with Migrate**
- Atlas Managed Postgres via OpenEverest on Atlas's K8s fleet — **Phase B** (v1 uses Neon/Supabase/PlanetScale for Run tier; SQLite for Dev)
- Atlas Sovereign Postgres via OpenEverest on customer's K8s — **Phase D with Atlas Migrate GA**
- Cache (Redis) and Blob (S3-compatible) tiers via same OpenEverest pattern — **Phase D**
- Phase B E2B templates (`atlas-flutter` · `atlas-python-django` · `atlas-rails` · `atlas-phoenix` · `atlas-rust-axum` · `atlas-java-spring`) — v1 ships 7 templates (next-ts · react-vite · astro · sveltekit · python-fastapi · go-chi · expo); others pending Phase B
- Self-hosted E2B template registry for enterprise — **Phase D** (daemon supports the endpoint from v1; public registry is default)
- Fully interactive visual editing from a shared preview link — **Phase B** (v1 shares support view + comment + suggest; full delegated edit is Phase B)
- Real-time multi-user cursor co-presence in preview + collaborative visual editing (two users same component) — **Phase C** (CRDT-backed)
- Video recording of preview sessions · full Chrome DevTools Protocol integration · preview branch-forking UX — **Phase B**
- True drag-drop page-builder (move components across arbitrary parents with structural changes) · Figma-grade alignment tools · visual authoring of new components from primitives · absolute-positioning / z-index canvas — **Phase B–C**
- `Content` node type + full draft/published CMS workflow — **Phase B** (v1 does inline content editing only)
- Multi-writer CRDT — Phase B
- Graph query language (Cypher / GraphQL) — v1 uses JSON traversal + SQL via Postgres
- Brownfield reverse-engineering from arbitrary codebases — Phase F
- Time-travel UI (branch, fork, rewind) — mechanics exist via events, UI is Phase B
- Mutation testing (Stryker) — Phase B
- Fuzz testing on API contracts — Phase B
- Load testing — Phase C
- Formal verification (TLA+, lean4) — Phase D research
- Chaos engineering — Phase C
- Full active pentesting (Burp, ZAP active) — v1 runs ZAP baseline only; full active is Phase B
- Multi-model consensus voting for LLM judges — v1 uses Opus alone; ensemble is Phase B
- Record-replay test generation from real user sessions — Phase C (privacy-gated)
- Synthetic data generation at scale — Phase B
- On-device testing for PWA / mobile parity beyond emulator — Phase E (with Flutter/Expo decision)
- Fine-tuning flows for AIFeatures — users bring their own fine-tuned model; Phase C orchestration
- Real-time multi-user AI collaboration — Phase C
- Federated learning / on-tenant model isolation — Enterprise phase
- Agentic end-user task completion beyond a single feature boundary — Phase D research

---

## 9. Open Implementation Questions (to surface in `superpowers:writing-plans`)

1. **Tree-sitter coverage for v1 stacks** — verified solid for Next.js (App Router TS), Prisma schema, React Server Components. Need to confirm on Drizzle, TanStack Router, Astro, SvelteKit before shipping beyond Next.
2. **Ambiguity classifier accuracy** — Haiku 4.5 on file-level AST diffs needs calibration against a gold-standard dataset before we trust ≥0.95 = auto-apply.
3. **Event log compaction strategy** — `events.jsonl` grows forever. Snapshot-and-compact policy (every 1000 events?) needs design so Git doesn't bloat.
4. **Schema evolution (v1 → v2)** — how do we migrate existing graphs when we add infra nodes in Phase B? Answer likely: additive-only for minor versions; migration scripts for major.
5. **Brownfield derived-node promotion UX** — how does Priya promote discovered nodes from `.atlas/derived/` to the main graph without trampling invariants?
6. **Visual-judge corpus curation** — who maintains the "delightful reference" images per category? Proposed: starts as OSS-community RFC; grows with adoption.
7. **Test-generator skill versioning** — when a generator skill updates, do existing tests get regenerated? Default: yes, on next ritual invocation.
8. **Prompt template ownership** — user edits `.atlas/prompts/*.md` directly. Do we auto-sync edits back to the OSS library if users consent? (Optional "contribute upstream" button.)
9. **Cost telemetry privacy** — per-feature cost tracking may leak usage patterns. Default: telemetry aggregated to user-project level; raw provider calls stay local unless user opts into sharing.
10. **Concurrent-agent v1 behavior** — single-writer optimistic lock is simple but breaks if two parallel Developer roles emit on overlapping files. Mitigation: file-locking per Agent Teams primitive (already v2). Need to verify.
11. **OpenEverest v1 dependency readiness** — Atlas Managed Postgres is Phase B, but the decision to use OpenEverest as backbone commits us to its operator quality. Need a v1 eval: does the current OpenEverest release handle HA failover, point-in-time restore, encryption-at-rest, and multi-region replication at the quality Atlas promises? Plan B (fall back to managed Aurora / Cloud SQL with a thin OpenEverest-compatible adapter) in case of gaps.
12. **E2B template rebuild pipeline** — who owns the weekly rebuild automation? Suggest dedicated GitHub Actions workflow in the atlas-templates repo + Sigstore signing + digest publication to `registry.atlas.app/templates/*`. Decide repo layout before writing-plans phase.
13. **Flutter vs Expo as default mobile** — deferred from Rocket research. Resolve before publishing the `atlas-flutter` Phase B template. Likely: ship both, let Ama pick by persona cue ("native performance" → Flutter; "shared with web" → Expo).
14. **AST parser choice (Babel vs SWC in browser)** — Babel is mature and universally supported for visual-edit but slow on large files; SWC is 10-20× faster in Rust/WASM but its browser bundle is heavier. Plan: Babel for v1 (safer), SWC migration in Phase B after profiling real user sessions.
15. **Preview sandbox warm-pool sizing** — to hit NFR-PREVIEW-2 (<3s cold-start), we need warm E2B sandboxes waiting. Cost-vs-latency tradeoff TBD; plan to start at 50 warm on Atlas Run, autoscale up.
16. **Client-side Tailwind generator maturity** — Lovable's approach requires a working Tailwind-in-browser generator that reads the user's config. Plan: evaluate `tailwindcss-browser` / `@tailwindcss/oxide` WASM builds before committing; fallback is a server-round-trip with HMR, slower but correct.
17. **Comment-pin storage & privacy** — preview comments are sensitive (may reveal in-progress business logic). Store in `.atlas/reviews/<preview-sha>.jsonl` Git-tracked by default for ownership; redact PII; opt-in cloud-sync for cross-team coordination.

---

## 10. References

- `docs/PRD_v3.md` — Atlas Build product PRD (§6.2 Living Spec Graph, §6.1 Skill Framework)
- `docs/ECOSYSTEM_VISION.md` — Atlas ecosystem (Imagine / Build / Run / Migrate pillars; Spec Graph extension for infra in §4.1)
- `docs/CODEGEN_UPGRADE.md` — IaC emitter upgrade; downstream of this spec
- [obra/superpowers](https://github.com/obra/superpowers) — skill framework prior art (121K ★)
- [GitHub Spec Kit](https://github.com/github/spec-kit) — spec-driven development pattern
- [Claude Design (launched 2026-04-17)](https://claude.com/products/claude-design) — import-source for the `claude-design-import.md` skill
- [Google Stitch](https://stitch.withgoogle.com/) — AI UX canvas reference
- [Motion (formerly Framer Motion)](https://motion.dev/) — v1 animation primitive
- [Nano Banana 2 (Google DeepMind)](https://deepmind.google/models/gemini-image/) — default image provider
- [Seedance 2.0 (ByteDance)](https://seed.bytedance.com/en/seedance2_0) — default video provider (when opt-in)
- [Kling 3.0 (Kuaishou)](https://kling3.org/) — alternative video provider
- [Lovable CVE-2025-48757](https://mattpalmer.io/posts/2025/05/CVE-2025-48757/) — the category of failure Atlas must not reproduce
- [Percona OpenEverest](https://www.percona.com/software/open-source-databases/open-everest) — K8s-native DB-as-a-Service operator (the Atlas Managed + Sovereign Postgres backbone; from `cloud_migration` repo roadmap)
- [E2B Firecracker microVMs](https://e2b.dev/) — sandbox runtime underlying the Atlas template fleet
- [Sigstore / cosign](https://www.sigstore.dev/) — image signing for E2B template integrity
- [Neon · Supabase · PlanetScale](https://neon.tech/) — Atlas Run tier DB provider options
- [Lovable Visual Edits](https://lovable.dev/blog/visual-edits) — AST-based visual editor prior art (client-side Tailwind generator pattern)
- [StackBlitz WebContainers](https://webcontainers.io/) — in-browser dev environment reference (Bolt.new's preview foundation)
- [Vercel Visual Editing](https://vercel.com/blog/visual-editing) — click-to-edit for headless CMS pattern
- [Next.js 15.1 debugging improvements](https://nextjs.org/blog/next-15-1) — error overlay + source maps with ignoreList for 3rd-party frames
- [Framer Inline Content Editing](https://www.framer.com/updates/inline-content-editing) — double-click-to-edit CMS pattern
- [Chrome DevTools Device Mode](https://developer.chrome.com/docs/devtools/device-mode) — viewport + network + CPU throttling reference
- [Netlify Collaborative Deploy Previews](https://www.netlify.com/blog/2021/05/19/give-meaningful-feedback-with-collaborative-deploy-previews/) — comment-pin + review-workflow prior art

---

*This spec supersedes any prior Spec Graph discussion in PRD_v3 and ECOSYSTEM_VISION. Those documents will be updated post-brainstorm to reference this spec as canonical.*
