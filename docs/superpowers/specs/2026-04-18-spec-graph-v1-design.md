# Spec Graph v1 — Design Spec

> Brainstormed via the `superpowers:brainstorming` skill.
> Date: 2026-04-18
> Companion to: `docs/PRD_v3.md`, `docs/ECOSYSTEM_VISION.md`
> Status: **Revised per Karpathy-style LLM Council review (2026-04-18) — see `docs/council-review/2026-04-18-spec-graph-v1-pass1.md`.** Ready for `superpowers:writing-plans`.

---

## 0. Executive Summary

The **Living Spec Graph** is Atlas's architectural source of truth — a typed, queryable, file-canonical structure that models every page, route, component, data model, endpoint, flow, auth boundary, test, design token, dependency, compliance class, AI feature, media asset, and client state in an application. It is the living contract between user intent (Visualize), approval ritual (Agree), and generated code (Build) — at every scale, from new-app creation to one-line maintenance fixes.

v1 is **app-only in scope**; infrastructure modeling is deferred to Phase B with Atlas Migrate. The schema carries **14 node types and 12 edge types**, sufficient for every Build-scope ritual (new app, new feature, bug fix, dep upgrade, refactor) while remaining lean enough to stabilize quickly.

The graph is authoritative for **architectural intent**. Code is authoritative for implementation details. Reconciliation between the two is **explicitly lossy and asynchronous** — automatic for high-confidence matches after a calibration dataset validates the classifier, surfaced in a human-review queue otherwise. This replaces the v1-pre-council "bidirectional, AI-graph-first" framing after four Council reviewers flagged it as dual-write with reconciliation, not a single source of truth.

All v1 code passes a **5-layer test pyramid** (Static · Unit+Integration · Browser/E2E · Security · Compliance-baseline) with **three edit classes** governing which layers run synchronously vs asynchronously: *cosmetic* edits get fast-path L1+L2 sync with the rest async post-commit; *structural* edits get the full pyramid sync; *security/compliance-touching* edits get full pyramid plus human confirmation. **Partial commits are allowed** behind an explicit `risk-accepted` annotation that is audit-logged, persona-gated (Ama cannot override security; Priya can override aesthetic with audit trail), and surfaced in compliance evidence. The previous "refuses to commit partial state" absolute was user-hostile; the new policy trades purity for honesty about real engineering workflows.

The graph lives in the user's repo under `.atlas/` as a Git-trackable snapshot. Atlas's hosted **Postgres mirror is the live coordination substrate** for concurrent writes — the file snapshot is the **export/audit surface**, regenerated from the mirror on demand. This replaces the pre-council "append-only JSONL in Git as live coordination" design after Council reviewers unanimously predicted Git-text-merge corruption on multi-branch collaboration. A custom Git merge driver and documented compaction policy (snapshot + tail) ship with v1; users can still export, self-host, or go fully offline without losing functionality — the mirror is recreatable from the file + events.

**Every L6 security and L6f compliance check carries a human-authored, static, non-LLM-generated baseline assertion** that cannot be modified by skill updates. This is Chairman-flagged as the single largest risk the Council itself missed: LLM-generated tests validating LLM-generated code is circular; a systematic prompt flaw that omits RLS will also omit its RLS test. The human baseline breaks the circularity.

---

## 1. Canonical Scope Decisions (post-Council revision)

| Dimension | v1 decision |
|-----------|--------------|
| Graph scope | App-only (infra deferred to Phase B) |
| Truth model | **Graph authoritative for architectural intent; code authoritative for implementation details. Reconciliation is explicitly lossy and async.** |
| Schema language | JSON Schema → Zod (TS) + Pydantic (Python) codegen |
| Persistence | **Postgres mirror is live coordination substrate. `.atlas/spec.graph.json` + `.atlas/events.jsonl` are export/audit surface (regenerable).** Custom Git merge driver + compaction policy ship with v1. |
| Node types | **14**: Page · Route · Component · **ClientState** · Model · Endpoint · Flow · AuthBoundary · Test · DesignToken · Dependency · ComplianceClass · AIFeature · MediaAsset |
| Edge types | **13**: renders · fetches · reads · mutates · requires · covers · dependsOn · styledBy · subjectTo · supersedes · powers · displays · **manages** |
| Merge gates | **5-layer pyramid** (L1 Static · L2 Unit+Integration · L3 Browser/E2E · L4 Security · L5 Compliance-baseline). L6 UX/A11y runs post-commit as an advisory gate. **Every L4/L5 check has a human-authored baseline assertion.** |
| Edit classes | **3 tiers** — (a) cosmetic: L1+L2 sync, L3–L5 async post-commit; (b) structural: full pyramid sync; (c) security/compliance-touching: full pyramid + human confirmation |
| Partial-state policy | **Allowed behind explicit `risk-accepted` annotation** — persona-gated (Ama cannot override security; Priya can override aesthetic/sustainability with audit trail), logged, surfaced in compliance evidence |
| ComplianceClass v1 set | **4 classes**: baseline · GDPR · HIPAA · SOC2-lite (PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · ISO27001 deferred to Phase B) |
| AIFeature provider support | Anthropic · OpenAI · Gemini · self-hosted (Qwen / Llama / DeepSeek) |
| Media provider support | **Nano Banana 2 only for v1** (image); video providers entirely deferred (cut Seedance · Kling · Veo · Runway from v1); Phase B expands to Flux · Ideogram · SDXL |
| Animation library | Motion (formerly Framer Motion) `motion/react` v12+ |
| Persona tiers | Ama (non-technical) · Diego (developer) · Priya (senior/reviewer) |
| OSS skill library at v1 ship | **~35 skills** (down from 61 — cut all 15 visual-edit skills + 7 compliance-class-specific skills + 4 video-gen skills). Apache 2.0, `github.com/atlas-labs/atlas-skills` |
| DBaaS v1 | Dev = SQLite (in E2B) · Run = Neon/Supabase · BYODB documented · Atlas Managed (OpenEverest on Atlas K8s) = Phase B · Atlas Sovereign (OpenEverest on user K8s) = Phase D (PlanetScale cut — Postgres-first semantics conflict) |
| E2B prebuilt templates v1 | **2 templates**: `atlas-next-ts` + `atlas-python-fastapi` (cut react-vite · astro · sveltekit · go-chi · expo to Phase B). Signed, weekly rebuilds, digest-pinned per project. |
| Importers v1 | **1 or 0** — Claude Design import only (Figma · Stitch deferred to Phase B) |
| Web app preview v1 | Live HMR iframe · multi-viewport + throttling · dark/light + locale + RTL · shareable URL (public/password/auth) with expiry · comment pins · run-as-role simulation · ComplianceClass-aware preview modes · spec-graph-linked element selection. **Branch-forked previews pinned to event SHA.** |
| Visual edit mode v1 | **Graph-mutation-driven regeneration only.** Click-to-select reveals Spec Graph node; edits happen at Agree step as typed graph mutations. **No** AST inspector · **no** bulk operations · **no** client-side WASM Tailwind generator · **no** raw JSX inline editing · **no** drag-drop layout editing. Phase B reintroduces AST-based editing after v1 graph-mutation UX is proven. |
| Observability | Operator plane (OpenTelemetry traces, structured logs, SLOs for daemon + mirror + ambiguity-classifier drift) + auditor plane (compliance-evidence folder per build) — both v1 |
| Deployment contract | Neon branching + Vercel promotion + documented rollback procedure tied to event SHA. Migration ordering explicit. Post-deploy health checks required. |

---

## 2. Cross-Cutting Principles (all four apply to every v1 surface)

### Principle 1 — Works the First Time (with tiered edit semantics and risk-accepted overrides)

Every AI-generated change passes the appropriate test-pyramid layers before the user sees output. TDD is mandatory for structural and security-touching edits: failing test first, then minimal implementation, then green. **Tests are generated from the Spec Graph, but every L4 (Security) and L5 (Compliance) check also carries a human-authored baseline assertion** that skill updates cannot modify — this breaks the circularity of LLM-generated tests validating LLM-generated code.

**Edit classes govern which layers are synchronous**:
- *Cosmetic* edits (Tailwind class, copy, color token swap): **L1 + L2 sync**; L3–L5 async post-commit with rollback-on-red
- *Structural* edits (new node/edge, flow change, schema change): **full pyramid sync** blocks until green
- *Security/compliance-touching* edits (AuthBoundary, RLS, ComplianceClass, PII classification): **full pyramid sync + explicit human confirmation**

On failure, the skill iterates with a different approach (max 3 retries). Persistent failure surfaces at persona verbosity with three next-action options: *retry with hint*, *undo*, or **`risk-accepted` commit** (persona-gated). Risk-accepted commits are logged with full provenance, surfaced in compliance evidence, and cannot bypass the baseline human-authored assertions at L4/L5.

Users do not debug things Atlas silently broke. Users *can* explicitly accept risk and move forward, which is honest about real engineering workflows.

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

1. **Coherence of architectural intent.** The agent reads and updates a structured model of *intent* (what the app should do and how it's organized), not re-derived embeddings. Refactors don't regress prior intent-level decisions past 30+ files. This is Atlas's #1 differentiator against v0 / Bolt / Lovable / Emergent, which degrade past ~30-50 files. **Important nuance (post-Council):** the graph does not claim to capture every implementation detail. Code is authoritative for implementation; graph is authoritative for intent. Drift between the two is surfaced in a human-review queue, not silently reconciled.
2. **Visualize → Agree → Build.** The graph is the artifact the user approves at the Agree step for AI-driven changes. The same ritual applies at every scale — new app, new feature, bug fix, dep upgrade, refactor. Human-initiated code edits flow into a **reconciliation queue** (§4.4) and update the graph asynchronously after review — not via blocking synchronous auto-sync.
3. **Auditability.** Every graph mutation carries provenance (which skill, which user action, timestamp, rationale, risk-accepted annotations). Enables telemetry, debugging, compliance evidence, and time-travel replay.
4. **Exportable ownership.** `.atlas/` lives in the user's repo, moves with them on export, works offline (with local Postgres from the E2B template), is diffable in Git via the custom merge driver. Atlas's hosted Postgres mirror is the live coordination substrate; the file snapshot is the export / audit surface — regenerable from the mirror at any time.

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
  spec.graph.json           # snapshot — export/audit surface; regenerated from mirror
  events.jsonl              # append-only log — export/audit; coordination happens in mirror
  merge-driver.js           # custom Git merge driver for graph files (required on clone)
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
  risk-accepted-log.md      # every risk-accepted commit, with persona + rationale
```

**Coordination primitive split (post-Council):** The file snapshot + event log are the **export/audit surface** — regenerable from the hosted Postgres mirror. The **mirror is the live coordination substrate** for concurrent writes. This replaces the pre-Council design that tried to make the Git-tracked JSONL authoritative, which would have corrupted on first multi-branch merge.

On `git push`: the snapshot + events are written from the mirror. On `git pull`: the custom merge driver (`.atlas/merge-driver.js`, registered via `.gitattributes` on clone) resolves graph conflicts semantically instead of by text merge. On clone without mirror (offline-first / sovereignty mode): a local SQLite replica substitutes for the hosted mirror — same API, same coordination semantics, writeback when online.

**Compaction policy (shipped v1):** after every 1,000 events, the daemon writes a new snapshot, archives older events as `events-<timestamp>.jsonl.archive` (kept in `.atlas/archive/`, Git-tracked), and continues a fresh `events.jsonl` tail. Event SHA provenance chains across snapshots so time-travel and audit remain intact.

All committed to Git by default except `.atlas/derived/` and `.atlas/cache/`. The `.atlas/` folder is the user's ownership boundary.

### 4.2 Components

1. **`@atlas/spec-graph-schema` (published package)**
   - Canonical JSON Schema → generates Zod (TS) and Pydantic (Python) bindings at build time
   - Consumed by: skill framework, orchestrator, merge gates, Atlas backend, user-authored skills
   - Ships with the OSS skill library under Apache 2.0
   - CI generators: `json-schema-to-zod`, `datamodel-code-generator`

2. **Atlas Daemon (local, shipped in the E2B template)**
   - **Watcher**: tree-sitter file-watcher on the user's source tree (feeds reconciliation queue; **does not block**)
   - **Applier**: validates events against schema, writes to Postgres mirror (primary) and appends to local `events.jsonl` snapshot (secondary). Offline mode: writes to local SQLite replica, syncs to hosted mirror on reconnect.
   - **Reconciler**: computes code→graph diffs on save, queues them as **reconciliation candidates** — async, non-blocking, human-reviewable when below confidence threshold
   - **Mirror sync**: bidirectional with hosted Postgres; last-writer-wins on mirror with optimistic-concurrency event IDs; conflict-resolution via Git merge driver when Git-based distribution is in play
   - **Media resolver**: dispatches MediaAsset generation via provider adapters; caches by contentHash
   - **Skill sandbox**: skills execute in a restricted VM (no raw filesystem, no network by default) — prerequisite for the skill supply-chain trust model (§6.5)

3. **Atlas Backend (hosted service — primary coordination substrate; optional for sovereign users who self-host)**
   - **Postgres live-state store** (not a cache): authoritative for concurrent multi-writer coordination. Per-tenant RLS. Event-sourced.
   - **Mirror API**: exposes event stream + snapshot views for daemon sync
   - REST + WebSocket query API for the frontend
   - Claude Design import endpoint (Figma · Stitch deferred to Phase B)
   - **Ambiguity-classifier service**: serves the Haiku 4.5 reconciliation classifier with a calibration harness (§4.4)

4. **Atlas Frontend — three renderers on identical data**
   - `NarrativeRenderer` (Ama): wireframes + plain-English plan, no graph surface
   - `StructuredRenderer` (Diego): node/edge canvas, attribute panels, event timeline
   - `RawRenderer` (Priya): JSON editor, event stream, branch/replay controls

### 4.3 Mutation Path (AI-driven ritual, tiered by edit class)

The mutation path is **tiered by edit class**. Cosmetic edits optimize for latency; structural edits optimize for correctness; security-touching edits optimize for safety. Every path writes to the **Postgres mirror first** (live coordination), then asynchronously snapshots to the file.

```
Skill invocation (e.g., "add forgot-password + AI document summarizer")
  │
  ├─▶ Architect composes { brainstorm → ai-features-brainstorm → spec-graph → runnable-plan }
  │
  ├─▶ Proposed events batch classified:
  │        cosmetic (Tailwind, copy, token swap)     → Path A
  │        structural (new node/edge, schema change) → Path B
  │        security/compliance-touching              → Path C
  │
  ├─▶ Reviewer critiques the batch (every structural + security-touching batch is reviewed)
  │
  ├─▶ Visualize renders per persona
  │
  ├─▶ Bootstrap checkpoint (§4.14): if this is the very first ritual on a greenfield prompt, a
  │    human-review checkpoint is mandatory before any code generates — prevents poisoned-foundation
  │    events from entering the log.
  │
  ├─▶ User Agrees
  │
  ├─▶ L1 Static gate: schema-validate every event against JSON Schema v1 — ALWAYS sync, all paths
  │
  ├─▶ Events written to Postgres mirror (authoritative live state)
  │
  ├─▶ Async: events.jsonl snapshot updated; spec.graph.json materialized view regenerated
  │
  ├─▶ TDD skill generates tests from affected nodes
  │    — for L4/L5 (security + compliance) the human-authored baseline assertions are loaded
  │      from atlas-skills/baselines/*.ts (non-LLM-generated) and run as a non-overridable floor
  │
  ├─▶ Media generation kicks off in parallel for new MediaAsset nodes (§4.6)
  │
  ├─▶ Developer roles emit code in parallel per affected file
  │
  ├─▶ Test pyramid runs:
  │
  │    ┌─── Path A (cosmetic) ────────────────────────────────────────┐
  │    │  L1 Static + L2 Unit+Integration run sync                   │
  │    │  L3 Browser + L4 Security + L5 Compliance run async         │
  │    │  HMR shows preview immediately after L2 green               │
  │    │  If async L3/L4/L5 red: auto-rollback + user notification    │
  │    └───────────────────────────────────────────────────────────────┘
  │
  │    ┌─── Path B (structural) ──────────────────────────────────────┐
  │    │  Full pyramid L1–L5 sync before HMR                         │
  │    │  L6 UX/A11y runs as advisory post-commit                    │
  │    └───────────────────────────────────────────────────────────────┘
  │
  │    ┌─── Path C (security/compliance-touching) ───────────────────┐
  │    │  Full pyramid L1–L5 sync + explicit human confirmation      │
  │    │  Human-authored baseline assertions at L4/L5 are blocking   │
  │    │  Priya-tier confirmation required; Ama/Diego cannot approve │
  │    └───────────────────────────────────────────────────────────────┘
  │
  ├─▶ Any red layer:
  │       ├─ skill auto-iterates (max N=3 retries with different approach)
  │       └─ persistent failure → three choices surfaced at persona verbosity:
  │             (1) retry with hint · (2) undo · (3) risk-accepted commit (persona-gated)
  │
  └─▶ Committed: event SHA published · HMR · plan.md regenerated · compliance-evidence/ updated
      · risk-accepted-log updated if applicable
```

**Key properties:**
- Cosmetic edits hit HMR in ~200ms–2s (L1+L2 sync only). Async layers rollback on red.
- Structural edits take 10–60s depending on affected file count.
- Security-touching edits always block on human confirmation (Priya-tier only).
- **The human-authored baseline assertions at L4/L5 are non-overridable** — not even Priya can bypass them with `risk-accepted`. The only way to change them is to update `atlas-skills/baselines/*.ts` via a signed PR, which itself runs through a review process (§6.5).
- Media generation and AI feature wiring run in parallel with code emission; they join the pyramid at L3 when their artifacts are ready.

### 4.4 Reconciliation Path (human-edits-code → graph catches up) — Async, Lossy, Calibrated

**The previous synchronous auto-reconcile design was wrong.** Four Council reviewers flagged it: Haiku 4.5 at 0.95 confidence is an untested load-bearing LLM call that would block on any real IDE refactor (40-file rename, Cursor/Copilot edits) and could silently auto-apply semantically wrong mutations at 0.94 confidence. The redesign:

1. **Reconciliation is always async and non-blocking.** File save never blocks on graph update.
2. **Reconciliation is explicitly lossy.** The graph captures *architectural intent*, not every code detail. Implementation-level edits (variable renames, import reorderings, minor refactors) may not map to any graph change and that is OK.
3. **The 0.95 auto-apply threshold ships only after a calibration dataset validates it.** Pre-calibration, all candidates go to the human-review queue regardless of classifier confidence.
4. **No blocking banners on ritual invocations.** Unresolved drift is a warning, not a wall. Drift is displayed per persona; ritual invocations can proceed with drift by adding a `drift-accepted` annotation that logs what wasn't reconciled.

```
User saves file in IDE
  │
  ▼
Daemon watcher detects change (never blocks the save)
  │
  ▼
Tree-sitter re-parses touched files (incremental, cached ASTs)
  │
  ▼
Maps AST → candidate graph mutations (only the intent-level mappings):
       - new default/named export → Component node candidate
       - new route file → Page / Endpoint candidate
       - prisma.schema change → Model update candidate
       - auth-related imports → AuthBoundary candidate
       - PII-classified field add → ComplianceClass-relevant candidate
   (other changes — variable renames, formatting, minor refactors — are simply not mapped)
  │
  ▼
Each candidate enqueued to reconciliation-queue.jsonl (persona-scoped)
  │
  ▼
Classifier service (Haiku 4.5) scores each candidate in the background
  │
  ├─ Pre-calibration (default at v1 ship):
  │     ALL candidates → human-review queue regardless of confidence
  │
  └─ Post-calibration (after 1000 annotated examples validate ≥0.95 threshold):
        Confident (≥0.95): auto-apply ← ONLY after a project ships the calibration flag
        Sub-threshold     : human-review queue (persona-scoped UX per §3.3)
        Conflicting       : surfaced in drift dashboard, not blocking
```

**Calibration dataset.** A required v1 deliverable before enabling auto-apply: 1,000 manually-annotated (human-reconciled AST→graph) examples across the 10 most common refactor patterns (rename, move, extract, inline, split, merge, reparent, convert, wrap, unwrap). The classifier's 0.95-threshold precision is measured against this set; auto-apply stays off until measured precision ≥99.0% on the calibration set. Ships as a JSONL file in `atlas-skills/calibration/reconciliation-v1.jsonl` (Apache 2.0; extensible by community).

**Derived-node exception.** Brownfield discovery (Phase F) produces nodes from running systems without a prior ritual. Those land in `.atlas/derived/*.json` (uncommitted by default) and promote to the main graph only via an explicit "promote derived" ritual.

**Intentional lossy boundary examples** (not everything is reconciled):
- A developer refactors `useEffect` to `useLayoutEffect` in a Component — not a graph event (implementation detail).
- A developer adds a private helper function inside a Component — not a graph event.
- A developer renames a file from `SignUp.tsx` to `Register.tsx` with no other changes — graph update: Component `id` attribute; no structural change.
- A developer adds a new `<input type="password">` to a Component — **is** a graph event (potentially PII-touching; flagged for review even at cosmetic tier).

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

### 4.6 Media Generation Runtime (MediaAsset) — v1 scope-cut

**v1 scope (post-Council):** **image generation only**, **one provider** (Nano Banana 2). Video generation is entirely deferred to Phase B — the latency, moderation, licensing, and cost complexity is not worth it for v1 launch. Per-provider adapter pattern is preserved for Phase B expansion.

```
New MediaAsset event (v1: kind = image · icon · illustration only)
  │
  ▼
contentHash(generationPrompt + style tokens)
  │
  ├─ cache hit → symlink from public/ · done
  │
  └─ cache miss
         │
         ▼
     provider adapter → Nano Banana 2 (v1 only)
         │
         ▼
     Asset downloaded → .atlas/cache/media/<hash>.<ext>
         │
         ▼
     Post-generation:
         - autoAltText: LLM captions image (WCAG-compliant)
         - contentModeration: blocks merge if unsafe
         - licenseCheck: provider's license attached to node metadata
         - optimization: Sharp → webp/avif, multiple sizes
         │
         ▼
     Public path committed to public/assets/… · manifest updated
         │
         ▼
     `displays` edge resolved · Component emits <Image> with asset path
```

**Phase B expansion:** Flux · Ideogram · SDXL (for sovereignty) for images; Seedance 2.0 · Kling 3.0 · Veo 3.1 · Runway Gen-4.5 for video. Provider selection becomes ComplianceClass-aware in Phase B (e.g., DPDP-India routes to in-country providers).

**v1 simplification:** `MediaAsset.kind` in v1 = one of {`image`, `icon`, `illustration`}. Video kinds land a validation error at L1 with a clear "deferred to Phase B" message. Phase B reintroduces the video path without schema migration (`kind` is a string enum; adding values is backward-compatible).

### 4.7 Claude Design Import (v1 — only importer; Figma + Stitch deferred to Phase B)

For teams with existing designer workflows on Claude Design:

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

**v1 scope-cut.** Figma and Stitch importers are deferred to Phase B. The same importer contract pattern is used; `figma-import.md` and `stitch-import.md` are not shipped in the v1 OSS library. Rationale: v1 ships with ≤1 importer; we prove the contract with Claude Design first, then expand.

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

### 4.10 Prebuilt E2B Sandbox Templates — v1 scope-cut

**v1 ships two templates only** (down from seven). More templates multiply parser, test, and reconciliation risk; v1 proves the model on the two stacks that cover ~90% of Ama use cases. Each template is a Firecracker microVM image with language runtime, package manager, common dependencies, test tooling, Atlas daemon, Playwright browsers, and the L4 human-authored security baselines pre-installed. Cold-start target ≤ 150ms (E2B's published baseline per [superagent.sh sandbox benchmark](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026)).

| Template ID | Stack | Preinstalled highlights |
|-------------|-------|--------------------------|
| `atlas-next-ts` *(default)* | Next.js 15 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Prisma · SQLite · Playwright · Vitest · axe-core · Motion v12 · L4 security baseline suite | Golden path — Ama default |
| `atlas-python-fastapi` | Python 3.13 · FastAPI · SQLAlchemy · Pydantic · SQLite · pytest · Playwright · `uv` · L4 security baseline suite | Python backends |

**Phase B templates (deferred; originally in v1, now cut):**
- `atlas-react-vite` — React + Vite (SPA without SSR)
- `atlas-astro` — content sites
- `atlas-sveltekit` — Svelte audience
- `atlas-go-chi` — Go backends
- `atlas-expo` — cross-platform mobile
- `atlas-flutter` — Flutter iOS+Android (Flutter vs Expo decision per Rocket research)
- `atlas-python-django` — Python + Django + DRF
- `atlas-rails` — Ruby on Rails 8
- `atlas-phoenix` — Elixir + Phoenix LiveView
- `atlas-rust-axum` — Rust + Axum + sqlx
- `atlas-java-spring` — Java + Spring Boot (enterprise)

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

### 4.12 Web App Management Edits — v1: Graph-Mutation-Driven Only

**Major scope cut per Council consensus.** The ambitious AST-based visual-edit mode (client-side Tailwind generator, 7 edit categories, bulk operations, raw JSX editor, drag-drop layout) is deferred to Phase B. The v1 edit experience is **graph-mutation-driven regeneration only** — simpler, honest about what v1 can ship reliably, and preserves the "every edit is a tracked graph event" invariant.

#### v1 edit loop (simplified)

```
User clicks an element in the preview (cross-persona)
  │
  ▼
Atlas highlights the corresponding Component / Page node in the Spec Graph view
  │
  ▼
User picks an intent from a curated menu:
  - "Change this text" (opens a modal with the current literal + edited value)
  - "Change this color" (palette picker bound to DesignToken nodes)
  - "Swap this image" (MediaAsset library + AI-regenerate option)
  - "Add a child component" (Component picker from the library or AI-generate)
  - "Remove this" (with impact-analysis warning)
  - "Ask Atlas to change this…" (free-form prompt → Maintain-scope ritual)
  │
  ▼
Atlas proposes a typed graph-mutation batch
  │
  ▼
Visualize renders the proposed diff (persona-tiered per §3.3)
  │
  ▼
User Agrees
  │
  ▼
Mutation path §4.3 runs (edit class auto-classified):
  - text change + color/token swap → cosmetic (L1+L2 sync)
  - add/remove component, swap media → structural (full pyramid sync)
  - auth/compliance-touching → security (full pyramid + Priya confirmation)
  │
  ▼
HMR updates preview · event committed
```

**What we gain:** every edit is a first-class Spec Graph event with full provenance — no AST-only mutations that bypass the graph. Undo/redo works at the event level. The edit path is identical to the new-feature ritual, at a smaller scope. This is the "one ritual at every scale" invariant the Council validated as strongest.

**What we lose in v1:**
- No client-side WASM Tailwind generator (latency optimization deferred; v1 pays HMR round-trip cost)
- No AST inspector for power users
- No raw JSX inline editor
- No bulk find-and-replace across files
- No drag-to-reorder layout editing
- No client-side optimistic preview under 200ms (HMR is the preview)

**What we keep:**
- Click-to-select maps DOM → Component node (the core spec-graph-linked UX)
- Every edit produces a typed Spec Graph event
- Persona tiering (§3.3) on what the curated intent menu shows
- AI-assisted "ask Atlas to change this" that invokes the Maintain-scope ritual
- Undo/redo via the event log

#### Non-functional requirements (v1)

- **NFR-EDIT-1**: Edit → committed event < 15s p50 for cosmetic class (HMR round-trip, no client-side Tailwind)
- **NFR-EDIT-2**: Edit → pyramid-green committed < 30s p50 for structural class
- **NFR-EDIT-3**: 100% of edits produce a Spec Graph event with full provenance
- **NFR-EDIT-4**: Every edit honors the appropriate merge-gate path (§4.3) — cosmetic async layers must rollback on red
- **NFR-EDIT-5**: Undo via event log works across arbitrary depth; never corrupts graph state

#### Out of scope for v1 (explicitly pushed to Phase B)

All 7 AST-based edit categories: Text/Style/Component/Media/Content/Layout/AI-assisted beyond the curated-intent menu · client-side WASM Tailwind generator · AST inspector · raw JSX editor · bulk find-and-replace · DesignToken-rename propagation · drag-drop layout editing · collaborative real-time co-editing (Phase C, CRDT-backed).

#### OSS skills in v1 (drastically reduced)

The 15 visual-edit skills originally scoped for v1 are mostly deferred to Phase B. v1 ships only:

| Skill | Purpose |
|-------|---------|
| `edit-text-literal.md` | Text-in-JSX edit via graph mutation (no contenteditable) |
| `edit-color-token.md` | DesignToken swap via graph mutation |
| `edit-media-swap.md` | MediaAsset swap or regenerate |
| `edit-component-add.md` | Add child Component via graph mutation |
| `edit-component-remove.md` | Remove Component with impact analysis |
| `edit-ai-assist.md` | "Ask Atlas to change this" — Maintain-scope ritual entry |

**Six skills instead of fifteen.** Library total drops from ~61 → **~35 skills at v1 ship** (also includes the scope cut of 7 compliance-class-specific skills for PCI/ITAR/etc. and 4 video-gen skills).

### 4.13 Production Deployment / Runtime Contract (v1, new per Council)

The spec was entirely build-time and preview-time before Council review. For a tool claiming HIPAA-readiness, absence of deployment semantics is disqualifying. v1 ships a minimal-but-real contract:

#### Deploy targets (v1)
- **Atlas Run (default)**: Vercel for frontend, Neon for DB with branching, Resend for email
- **BYOD (bring-your-own-deploy)**: export target = any Vercel-compatible host + any Postgres/SQLite-compatible DB; Atlas emits the deploy artifacts (Dockerfile, vercel.json, Prisma migration files)
- **Sovereign / self-host**: deferred to Phase D with Atlas Migrate GA

#### Artifact promotion
- Preview → Staging → Production, each pinned to a specific event SHA
- Staging uses Neon branching (cheap DB clones with isolated RLS)
- Production promotion requires:
  - All L4 + L5 merge-gate layers green on the target event SHA
  - Schema migration dry-run against a Neon branch before apply
  - Priya-tier confirmation (Ama and Diego tiers can promote preview → staging but not staging → production)

#### Migration ordering
- Prisma migrations run in strict order: backward-compatible schema change → app deploy → schema cleanup (in separate event)
- Atlas emits a **three-step migration plan** for every breaking schema change; tooling enforces the order
- Rollback: every migration emits both `up.sql` and `down.sql`; rollback to any prior event SHA is a single action

#### Rollback procedure
- Pinned to event SHA (not arbitrary Git commit)
- Rollback reverts the event log tail to the target SHA, re-materializes the snapshot, rolls back Prisma migrations in reverse order, redeploys the prior build artifact
- **Post-deploy health check required**: smoke test suite runs against the live deploy; auto-rollback if any critical path fails within 5 minutes
- Full rollback from "red smoke test" to "prior stable" target: < 2 minutes for Atlas Run

#### Secrets and env lifecycle
- Secrets never in events.jsonl or spec.graph.json (enforced at L1 schema validation)
- Per-environment secret stores (Vercel env vars for Atlas Run; BYOD uses user's secret manager)
- Secret rotation scaffolding shipped in the `atlas-next-ts` template (rotation events are first-class Spec Graph events)

#### v1 NFRs
- **NFR-DEPLOY-1**: Staging promotion < 60s p95
- **NFR-DEPLOY-2**: Production promotion < 5 min p95 (includes migration + smoke test)
- **NFR-DEPLOY-3**: Rollback < 2 min p95 from trigger to prior-stable
- **NFR-DEPLOY-4**: Zero-data-loss rollback across at most N=1 schema migration

### 4.14 Bootstrap Review Checkpoint (v1, new per Council blind-spot #1)

**The problem Council identified:** when a user types "Build a healthcare CRM," the AI zero-shots ~50 nodes and edges on an empty graph. If that initial graph is structurally flawed, every subsequent ritual validates against a poisoned foundation. There is no L0 for the first ritual.

**The fix:** the first ritual on a greenfield prompt runs through a **mandatory human-review checkpoint** before any code generates:

```
First ritual on greenfield prompt
  │
  ▼
Architect emits initial graph draft (typical 30-100 nodes)
  │
  ▼
Visualize renders the full draft per persona — expanded view
  │
  ▼
Bootstrap review checklist (non-skippable for first ritual):
  - [ ] Top-level user flows make sense (list + preview)
  - [ ] Auth boundaries cover all sensitive paths (list)
  - [ ] ComplianceClass matches stated domain (e.g., healthcare → HIPAA suggested)
  - [ ] Data models + PII classifications are reasonable
  - [ ] AIFeatures and their safety contracts align with scope
  - [ ] No obvious missing pieces for stated goal
  │
  ▼
User explicitly Agrees each checklist item (Ama: "looks right" button per area;
   Diego: per-item checkbox; Priya: detailed review + inline graph edits)
  │
  ▼
ONLY THEN: initial graph events are written to the log; code generation begins
```

**After the first ritual**, subsequent rituals use the standard §4.3 path (no repeated bootstrap checkpoint). The bootstrap checkpoint is identified by `graph.nodes` being empty at ritual start.

**For Ama**, the checkpoint is softened: the six checklist items are presented as reassuring summary cards with "looks right" / "something's off" buttons. For Diego, it's a checkbox list. For Priya, it's an editable graph preview. Same gate, different UX.

### 4.15 Skill Supply-Chain Governance (v1, new per Council blind-spot #2)

**The problem:** the spec elevates 35 OSS skills and `.atlas/prompts/*.md` to first-class architectural surface with AST-level write access. Without governance, a malicious skill update is a supply-chain compromise with the severity of a compromised build system.

**v1 governance model:**

1. **Version pinning.** Every skill in the library is version-pinned in a project's `.atlas/skills.lock.json` (analogous to `package-lock.json`). Skill upgrades require an explicit ritual, which itself runs the full merge pyramid against the target project.

2. **Signature verification.** The OSS skill library (`github.com/atlas-labs/atlas-skills`) signs every release with Sigstore/cosign. The daemon verifies signatures on load; unsigned or mismatched skills are rejected.

3. **Trust levels.** Three tiers:
   - `atlas-official` (published by the atlas-labs org): loaded by default
   - `atlas-community` (third-party, signed, passes governance review): opt-in per project via `.atlas/skills.json`
   - `atlas-local` (user-authored skills in `.atlas/skills/`): allowed only for the owning project, never inherited from dependencies

4. **Skill-regression test harness.** Every skill carries a `*.test.md` companion that asserts behavior against canonical inputs. On skill update, the regression suite runs in CI before the skill is published. Projects can pin to a specific skill version until they explicitly update.

5. **Prompt drift detection.** The daemon runs a weekly "prompt drift" check: canonical skill behavior against the current model (Opus 4.7 → 4.8 upgrade, etc.). Any behavior drift > threshold surfaces as a skill-update advisory — auto-pinning kicks in.

6. **Capability restrictions.** Skills declare their required capabilities (filesystem read/write, network, LLM call, etc.) in frontmatter. The skill sandbox enforces these at runtime — a skill that only needs LLM calls cannot silently exfiltrate filesystem data.

**Ship-blocker:** v1 does not ship without signature verification + version pinning + the skill sandbox. These are in the v1 ship criteria (§7).

---

## 5. Schema — 14 Node Types, 13 Edge Types, Invariants

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

### 5.2 The 14 Node Types

| # | Node | Purpose | Key attributes |
|---|------|---------|-----------------|
| 1 | **Page** | A route-rendered page | path · title · layout · renderMode (SSR/SSG/CSR/ISR) · metadata · a11yAnnotations |
| 2 | **Route** | URL pattern (dynamic segments, API routes, middleware) | pattern · method · handlerType (page · endpoint · middleware) |
| 3 | **Component** | Reusable UI piece | name · propsSchema · isServerComponent · styleApproach · a11yAnnotations |
| 4 | **ClientState** *(new per Council SHOULD-1)* | Client-side state primitive (React context, Zustand store, multi-step form state, cart state) | name · kind (context · zustand-store · reducer · query-cache · form-state · route-state) · schema · persistence (none · sessionStorage · localStorage · url) · scope (page · layout · app · flow) · piiClassification |
| 5 | **Model** | Data entity (Prisma/Drizzle-shaped) | name · fields · relations · indexes · rlsPolicies (select/insert/update/delete) · piiClassification · dataRetentionDays |
| 6 | **Endpoint** | API route or server action | name · routeRef · method · inputSchema · outputSchema · authRef · rateLimit |
| 7 | **Flow** | User journey spanning pages | name · steps (ordered) · entryPoints · successCriteria · failurePaths |
| 8 | **AuthBoundary** | Protected area | name · type (public · authenticated · role · permission) · roles · permissions · bypassConditions |
| 9 | **Test** | A test (generated or user-authored) | name · layer (L1–L5) · source (generated · user · **baseline**) · filepath · coversRef |
| 10 | **DesignToken** | Design-system token | name · category (color · spacing · typography · radius · shadow · motion) · value · scale (light/dark) · contrastGroup |
| 11 | **Dependency** | npm package | name · version (pinned exact) · purpose · license · cveScanStatus |
| 12 | **ComplianceClass** | A compliance regime | name (**baseline · GDPR · HIPAA · SOC2-lite** for v1; more in Phase B) · scope · attestation · effectiveDate |
| 13 | **AIFeature** | An AI capability the app offers | name · category · capabilityContract · inputModality · outputModality · grounding · personalization · privacyMode · safetyContract · fallbackBehavior · costTier |
| 14 | **MediaAsset** | A generated or user-uploaded media asset | kind (**v1: image · icon · illustration**; video deferred) · providerCapability · generationPrompt · pathOrUrl · altText · licenseStatus · contentHash · personalizationContext |

**Always-present.** One `ComplianceClass` with `name: "baseline"` is auto-inserted on project creation. Users can escalate by adding `GDPR`, `HIPAA`, or `SOC2-lite` in v1; they cannot remove `baseline`. Other compliance classes (PCI-DSS, DPDP-India, LGPD, POPIA, COPPA, FERPA, ITAR, ISO27001) are Phase B.

**ClientState rationale (Council SHOULD-1):** React context, Zustand stores, multi-step form state, cart state, and router state are invisible to the pre-Council 13-node model. Without ClientState the AI would generate untracked state management that silently diverges on every refactor — directly breaking the "graph is architectural truth" thesis for the most common frontend pattern. `ClientState` makes this first-class.

**Test node `baseline` source (Council blind-spot #3):** Tests now have three sources. `baseline` tests are **human-authored, static, non-LLM-generated** and live in `atlas-skills/baselines/*.ts`. Skill updates cannot modify them. They are the non-overridable floor at L4 (security) and L5 (compliance).

### 5.3 The 13 Edge Types

| Edge | Allowed from → to | Meaning |
|------|--------------------|---------|
| `renders` | Page → Component · Component → Component | UI composition |
| `fetches` | Page → Endpoint · Component → Endpoint | Data fetch |
| `reads` | Endpoint → Model | Read-only DB access (distinct for RLS reasoning) |
| `mutates` | Endpoint → Model | Write access |
| `requires` | Page → AuthBoundary · Endpoint → AuthBoundary | Protection |
| `covers` | Test → {Page · Component · ClientState · Endpoint · Model · Flow · AuthBoundary} | Test coverage |
| `dependsOn` | Component → Dependency · Endpoint → Dependency | Library usage |
| `styledBy` | Component → DesignToken | Design-system coupling |
| `subjectTo` | Model → ComplianceClass · Endpoint → ComplianceClass · **ClientState → ComplianceClass** | Compliance scope (ClientState with PII is subject to compliance) |
| `supersedes` | any → same type | Rename/deprecation chain |
| `powers` | AIFeature → Component · AIFeature → Endpoint | Which surfaces use an AI capability |
| `displays` | Component → MediaAsset · Page → MediaAsset | Media usage |
| `manages` *(new)* | Component → ClientState · Page → ClientState · Flow → ClientState | Which UI surface owns or consumes a client-state primitive |

### 5.4 Structural Invariants (enforced at L1 schema validation)

1. Every `Page` must carry a `routeRef` (Route nodes are referenced inline, not via edge — they're light enough to embed).
2. Every `Endpoint` must carry a `routeRef`.
3. Every `Page` with `authRequired: true` must `requires` an `AuthBoundary`.
4. Every `Endpoint` that `mutates` a `Model` with `piiClassification != "none"` must `requires` an `AuthBoundary` AND `subjectTo` at least one `ComplianceClass`.
5. Every `Model` with `piiClassification != "none"` must have RLS policies for all four actions (select/insert/update/delete).
6. Every `Dependency` with a critical CVE must carry `cveScanStatus.severity = "critical"` — merge-blocker until an `Upgrade` skill run resolves it.
7. Every `Component` referenced by `renders` must exist (no dangling refs).
8. Exactly one `ComplianceClass` with `name: "baseline"` must be present.
9. `covers` edges must exist from at least one `Test` to every `Page`, `ClientState`, `Endpoint`, `Flow`, and `AuthBoundary`. Test gaps are merge-blockers (principle #1).
10. Every `AIFeature` with `personalization != "none"` must `subjectTo` at least one ComplianceClass that governs personal data (baseline includes this).
11. Every `MediaAsset` with `licenseStatus == "generated"` must carry a `providerCapability` attestation.
12. **(new per Council)** Every `ClientState` with `piiClassification != "none"` must `subjectTo` at least one `ComplianceClass` — PII in client-side state is subject to the same controls as PII in the DB.
13. **(new per Council blind-spot #3)** Every `AuthBoundary`, every `Model` with PII, and every `ComplianceClass != "baseline"` must have **at least one `Test` with `source: "baseline"`** (human-authored, non-LLM-generated). This is the non-overridable security floor.
14. **(new per Council)** `MediaAsset.kind` for v1 must be one of `image · icon · illustration`. `video · audio` land validation errors with Phase B messaging.

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

### 6.1 The Test Pyramid — Five Layers (post-Council, was seven)

All layers run on every ritual-approved change according to the **edit class** (§4.3): cosmetic edits run L1+L2 sync with L3-L5 async; structural run L1-L5 sync; security-touching add human confirmation. L1 gates L2-L5. **L6 UX/A11y** runs post-commit as an advisory gate (not merge-blocking in v1).

| Layer | Runner | Contract | Budget (p50 / p95) |
|-------|--------|-----------|----------------------|
| **L1 Static** | `tsc --noEmit` · Biome · `json-schema` validate · `prisma validate` · `socket.dev`/`snyk` CVE scan | No type errors, no lint errors, graph valid, no critical CVE | 5s / 20s |
| **L2 Unit + Integration** *(merged from pre-Council L2+L3)* | Vitest (Node + jsdom) on affected `*.test.{ts,tsx}` · ephemeral SQLite-in-memory for Prisma · `msw` for HTTP | Unit + integration green; new code has ≥1 failing-then-green test per TDD; schema applies cleanly; module boundaries honored | 20s / 90s |
| **L3 Browser / E2E** *(was L5)* | Playwright on E2B preview · axe-core · visual diff · `supertest`/`hono/testing` for API contract | Every Page renders; every Flow completes; zero console errors; API contracts honored (401/403 on AuthBoundary'd endpoints; RLS effective on mutates) | 60s / 180s |
| **L4 Security** *(was L6a-e)* | §6.1.1 sub-layers **+ human-authored baselines (non-overridable)** | All sub-layers green; baseline assertions pass (unskippable) | 30s / 120s |
| **L5 Compliance** *(was L6f)* | Per declared ComplianceClass · **human-authored baselines per class** | All class-specific assertions green; baseline assertions pass (unskippable) | 15s / 60s |
| **L6 UX + Accessibility (advisory)** *(was L7; downgraded)* | §6.1.2 sub-layers | Runs post-commit; warnings surfaced but non-blocking in v1 (becomes blocking in Phase B after calibration) | async, 60s / 180s |

**Cut per Council MUST-5:**
- L7h visual-judge (Opus-as-judge per build): cost theater, deferred to Phase B after calibration
- L7f neurodivergent cognitive-load audit: deferred to Phase B (weakly specified; needs research)
- Pre-Council L4 API contract split: merged into L3 Browser/E2E

**Total v1 budget targets (edit-class-tiered):**
- **Cosmetic**: L1+L2 sync < 45s p50 · L3-L5 async in background
- **Structural**: L1-L5 sync < 3 min p50 for single-feature change
- **Security-touching**: L1-L5 sync + Priya confirmation; < 5 min p50 plus human decision time

**Total budget targets (parallel execution):**

- Single-component iteration: **p50 < 60s · p95 < 180s**
- New feature (3–5 Pages, 2 Endpoints, 1 Flow): **p50 < 3min · p95 < 8min**
- Full new-app generation: **p50 < 6min · p95 < 15min**

#### 6.1.1 L4 Security Sub-layers (post-Council)

**Every sub-layer carries a human-authored baseline assertion in `atlas-skills/baselines/security/*.ts`** — non-LLM-generated, skill-update-immutable, always-run. LLM-generated tests are additive; baselines are the floor.

```
L4a Auth               Playwright bypass suite (anon, wrong-role, expired session)
                       BASELINE (human-authored): 401 on anon, 403 on wrong-role, session rotation on privilege change
                       Generated (LLM): rate-limit triggers, lockout behavior, MFA on sensitive ops (for HIPAA-class)

L4b Data               gitleaks + trufflehog + PII-in-logs grep + schema PII assertion
                       BASELINE: no plaintext secrets anywhere; no PII appears in any log; encryption-at-rest assertion
                       Generated: minimum-necessary access test for HIPAA; BAA vendor check

L4c Transport          headers assertion suite on E2B preview
                       BASELINE: HTTPS enforced, HSTS preload, CSP with strict-nonce, X-Frame=DENY, Referrer-Policy,
                                 Permissions-Policy — every page
                       Generated: per-class header policy variations

L4d Injection          semgrep (SQLi/XSS/SSRF) · ZAP baseline on changed endpoints
                       BASELINE: parameterized queries only (AST assertion), CSRF on mutations, SSRF-safe HTTP client,
                                 no eval/Function constructor
                       Generated: OWASP ASVS L1 for baseline, L2 for HIPAA

L4e Dependencies       npm audit · socket.dev · SBOM via cyclonedx-bom
                       BASELINE: zero critical CVE, license allowlist (MIT/Apache/BSD/ISC/MPL), SBOM valid,
                                 no packages from blocklist (hash-pinned)
                       Generated: license-specific conformance for enterprise classes
```

#### 6.1.2 L5 Compliance (v1: 4 classes)

**v1 compliance set cut from 11 to 4** per Council MUST-5. Every class has a baseline assertion floor that LLM-generated tests cannot override.

```
baseline      BASELINE: GDPR+CCPA consent banner present; DSR endpoints (data-export, data-delete) respond 200
              BASELINE: audit log emitted on every write to a PII-classified Model
              BASELINE: SOC 2 control scaffolding files present (access review, change management, incident response)
              Generated: project-specific compliance narrative in compliance-evidence/

GDPR          BASELINE: explicit consent capture on first PII collection; consent withdraw flow functional
              BASELINE: DPO contact endpoint present; lawful-basis declared for every PII Model
              Generated: processing record coverage for the specific data flows

HIPAA         BASELINE: PHI encryption-at-rest verified (runtime assertion); BAA-eligible vendor allowlist enforced
              BASELINE: minimum-necessary access proved via test (role cannot read fields outside scope)
              Generated: PHI-flow-specific audit trails

SOC2-lite     BASELINE: access-control matrix emitted; change-management log captures every deploy event;
                        incident-response scaffold present
              Generated: control-mapping narrative per Trust Services Criteria

(Phase B: PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · ISO27001)
```

**L5 AI-feature-specific tests (baseline):** every AIFeature carries a baseline prompt-injection battery (OWASP LLM Top 10 2025 payloads, PromptBench, Atlas regression corpus), a hallucination-guard check (if grounding=RAG), and PII-redaction assertions. These are in `atlas-skills/baselines/ai-features/*.ts` and are immutable across skill updates.

#### 6.1.3 L6 UX + Accessibility (advisory, post-commit in v1)

**Runs advisory post-commit, not as a merge gate, in v1.** Warnings surface in the persona-tiered UI. Becomes blocking in Phase B after the reference corpora + calibration exist.

```
L6a axe-core           WCAG 2.2 AA, all pages
L6b keyboard-nav       every interactive element reachable, focus order logical
L6c contrast           4.5:1 text / 3:1 UI / 7:1 if class includes a11y-AAA
L6d RTL snapshot       Arabic/Hebrew/Urdu layouts captured + visual-diff'd
L6e motion-respect     useReducedMotion honored (prefers-reduced-motion: reduce)
L6f Lighthouse         Performance ≥ 90, Best Practices ≥ 95, SEO ≥ 90
L6g sustainability     bundle ≤ 100KB initial JS, webp/avif images, no autoplay video, low-power-mode friendly
```

**Cut per Council MUST-5:**
- **L7h visual-judge (Claude Opus visual comparator)** — Opus-as-judge on every build is cost theater without a calibrated "delightful reference" corpus. Deferred to Phase B when the corpus exists and LLM-judge precision is measured.
- **L7f neurodivergent cognitive-load audit** — reading-level/cognitive-load is weakly specified at v1; deferred to Phase B with proper research input from lived-experience contributors.

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

### 6.4 Operator Observability Plane (v1, new per Council SHOULD-2)

The spec pre-Council had auditor-facing compliance evidence but no operator-facing signal. Atlas could not know when the ambiguity classifier was drifting, when the pyramid was systematically slow, or when media generation was degrading. v1 ships an observability plane alongside the auditor plane.

**Traces** (OpenTelemetry, OTLP):
- Every ritual is one trace; every skill invocation is a span
- Every LLM call is a span with model, input-tokens, output-tokens, cost, latency, provider
- Every test-pyramid layer execution is a span with layer, result, duration
- Classifier decisions (§4.4) are spans with confidence + mapped-candidate + ground-truth (if calibrated)

**Structured logs** (`atlas.log.jsonl`):
- Per-project, per-persona, per-ritual
- Privacy-classified: PII is redacted at log emit; logs ship to OTel collector with redaction already applied

**SLOs (v1):**
| Signal | SLO | Alert threshold |
|--------|-----|------------------|
| Pyramid-green rate on first ritual | ≥ 90% | < 85% for 24h |
| Reconciliation classifier precision (calibrated) | ≥ 99.0% | < 97% for 24h |
| Media-gen provider p95 | < 30s | > 45s for 1h |
| Daemon → mirror sync lag | < 5s p95 | > 15s for 5 min |
| Mirror availability | 99.9% | any 5-min drop |
| Ritual cost overrun vs budget | < 10% variance | > 25% variance for any project for a week |

**Operator dashboard (v1):** one Grafana-compatible board per tenant surfacing the SLOs. On-call rotation with paging on amber-threshold breaches.

**Classifier drift detection:** the reconciliation ambiguity classifier (§4.4) runs against the calibration dataset nightly. Any precision drop > 0.5% triggers an immediate auto-pin of the current classifier version until investigated.

### 6.5 Graph-Scale Context Strategy (v1, new per Council blind-spot #4)

**The problem Council flagged:** as projects grow (500+ nodes), serializing the full Spec Graph into an LLM prompt produces "lost-in-the-middle" degradation and silently erodes AI reasoning quality.

**v1 strategy:**

1. **Documented node-count ceiling.** v1 supports projects up to **500 nodes** with full-graph-in-prompt context. Projects above 500 nodes trigger a chunking strategy.
2. **Graph-RAG for large projects (>500 nodes).** The Architect role retrieves only the subgraph relevant to the current ritual scope:
   - The nodes being modified + their 2-hop neighborhood
   - Plus always: the root ComplianceClass set, the active AuthBoundary set, the project-level attributes (databaseProvider, templateDigest)
   - Plus: narrative summaries of un-retrieved subgraphs (auto-generated nightly by a compaction skill)
3. **Retrieval quality metric.** Every ritual on a >500-node project logs a "retrieval precision" score — what fraction of retrieved nodes were actually referenced in the mutation. Tracked in observability plane.
4. **Graph size warning.** Projects approaching 500 nodes get an advisory in Priya's view: "Your graph is at X nodes; at 500 Atlas will switch to chunked retrieval which may affect reasoning quality for cross-cutting refactors. Consider modularizing."

**Phase B:** push the ceiling via better retrieval + hierarchical graph representations + model context windows (by Phase B, 10M+ context models may make chunking unnecessary for most projects).

---

## 7. Success Criteria (post-Council revision; measurable; all eval'd on a 30-app evaluation suite across: landing page · SaaS dashboard · e-commerce · blog · internal tool · health intake form · educational platform · non-profit site)

| # | Metric | Target | Why |
|---|--------|--------|-----|
| 1 | Pyramid-green rate on first ritual (cosmetic edit class) | ≥ 92% | "Works first time" principle + edit-class tiering |
| 2 | Pyramid-green rate on first ritual (structural edit class) | ≥ 85% | Higher bar, stricter checks |
| 3 | Pyramid-green rate after ≤ 3 skill retries (any class) | ≥ 97% | Retry budget absorbs edge cases |
| 4 | Visualize→Agree→Build p50 (new app, Bootstrap Checkpoint included) | ≤ 8 min | Bootstrap adds time but avoids poisoned foundation |
| 5 | Reconciliation classifier precision on calibration set (pre-auto-apply) | ≥ 99.0% on 1,000-example set | Ship-blocker for auto-apply; stays in human queue until met |
| 6 | Schema validation miss rate | 0 | No invalid graph states committed |
| 7 | AIFeature prompt-injection resistance — **human-authored baseline assertions** | 100% pass rate (baseline assertions are non-overridable) | Council blind-spot #3 — floor below which skill updates cannot drop |
| 8 | AIFeature prompt-injection resistance — LLM-generated + baseline combined | ≥ 99% block rate on Atlas standard battery (OWASP LLM Top 10 2025 + PromptBench + regression corpus) | Principle #2 teeth |
| 9 | WCAG 2.2 AA compliance on first gen (L6 advisory) | ≥ 90% | Principle #4 baseline (advisory not blocking in v1) |
| 10 | baseline + GDPR + HIPAA + SOC2-lite evidence-pack completeness | 100% of required items present for each declared class | Principle #2 extension |
| 11 | Event log completeness | 100% of graph mutations carry provenance | Auditability |
| 12 | Risk-accepted commits with complete audit trail | 100% (name, persona, rationale, overrideable-layer) | New partial-state policy (MUST-4) |
| 13 | LLM cost per full-app gen on baseline class | ≤ $0.60 (raised from $0.40 — honest about pyramid cost) | Flat-rate viability |
| 14 | Bootstrap checkpoint human-confirmation rate | 100% on first ritual of every greenfield project | Council blind-spot #1 |
| 15 | Skill signature verification pass rate | 100% (unsigned skills never load) | Council blind-spot #2 / §4.15 |
| 16 | Operator SLO — pyramid p95 vs budget | all ≤ 10% variance | Council SHOULD-2 |
| 17 | Graph-scale test — reasoning quality on 500-node project | ≥ 90% of reasoning quality on 50-node project (eval'd on standardized refactor tasks) | Council blind-spot #4 |
| 18 | OSS skill library external contributor PRs | ≥ 3 in first 6 weeks | Community health |
| 19 | Persona handoff: 3 tiers on same project | ≥ 5 projects in eval | Section 1 principle |
| 20 | Deployment contract — rollback from red smoke test to prior stable | ≤ 2 min p95 (Atlas Run) | Council SHOULD-3 / §4.13 |

**Ship criterion:** hit **17+ of 20** at v1 release. If < 14, don't ship — iterate. Critical blockers (must all pass): #5 (classifier precision), #7 (baseline pass rate), #15 (skill signatures). No flexibility on these three.

---

## 8. Out of Scope for v1 (post-Council YAGNI list — expanded after scope cuts)

### Schema + runtime deferrals
- Infrastructure nodes (Region · Runtime · Provider · DataResidency · WorkloadTopology) — **Phase B with Migrate**
- `Content` node type + full draft/published CMS workflow — **Phase B**
- Multi-writer CRDT — **Phase B**
- Graph-level forking/merge semantics beyond the custom Git driver (Council blind-spot #5) — **Phase B**
- Graph query language (Cypher / GraphQL) — **Phase B** (v1 uses JSON traversal + SQL via Postgres)
- Brownfield reverse-engineering from arbitrary codebases — **Phase F**
- Time-travel UI (branch, fork, rewind) — mechanics exist via events, UI is **Phase B**

### ComplianceClass deferrals (cut from 11 to 4 per Council MUST-5)
- PCI-DSS · DPDP-India · LGPD · POPIA · COPPA · FERPA · ITAR · ISO27001 — all **Phase B**
- Class-specific skills for the 8 deferred classes — **Phase B**

### DBaaS deferrals
- Atlas Managed Postgres via OpenEverest on Atlas's K8s fleet — **Phase B**
- Atlas Sovereign Postgres via OpenEverest on customer's K8s — **Phase D with Atlas Migrate GA**
- Cache (Redis) and Blob (S3-compatible) tiers — **Phase D**
- PlanetScale DB option (Postgres-first semantics conflict) — dropped; revisit in Phase B if demand exists

### E2B template deferrals (cut from 7 to 2 per Council MUST-5)
- `atlas-react-vite` · `atlas-astro` · `atlas-sveltekit` · `atlas-go-chi` · `atlas-expo` — **Phase B**
- `atlas-flutter` · `atlas-python-django` · `atlas-rails` · `atlas-phoenix` · `atlas-rust-axum` · `atlas-java-spring` — **Phase B**
- Self-hosted E2B template registry for enterprise — **Phase D** (daemon supports the endpoint from v1)

### Media provider deferrals (cut to 1 per Council MUST-5)
- Flux · Ideogram · SDXL (image alternatives) — **Phase B**
- Seedance 2.0 · Kling 3.0 · Veo 3.1 · Runway Gen-4.5 (all video) — **Phase B entirely**

### Importer deferrals
- Figma import · Stitch import — **Phase B** (v1 ships Claude Design only)

### Visual-edit deferrals (Council MUST-5 — 90% of original scope deferred)
- AST-based click-to-edit with client-side WASM Tailwind generator — **Phase B**
- 7 edit categories (text · style · component · media · content · layout · AI-assisted) at AST level — **Phase B** (v1 does graph-mutation-driven only)
- Bulk operations (find-and-replace, DesignToken rename propagation) — **Phase B**
- Raw JSX inline editor — **Phase B**
- Drag-to-reorder layout editing — **Phase B**
- Visual editing from a shared preview link — **Phase B**
- Collaborative real-time co-editing (two users same component) — **Phase C** (CRDT-backed)

### Testing deferrals
- L6h visual-judge (Claude Opus visual comparator) — **Phase B** after reference corpora exist + calibration
- L6f neurodivergent cognitive-load audit — **Phase B** with lived-experience research input
- Mutation testing (Stryker) — **Phase B**
- Fuzz testing on API contracts — **Phase B**
- Load testing — **Phase C**
- Formal verification (TLA+, Lean4) — **Phase D research**
- Chaos engineering — **Phase C**
- Full active pentesting (Burp, ZAP active) — **Phase B** (v1 runs ZAP baseline only)
- Multi-model consensus voting for LLM judges — **Phase B** (v1 uses Opus alone where judging is needed)
- Record-replay test generation from real user sessions — **Phase C** (privacy-gated)

### Preview deferrals
- Video recording of preview sessions — **Phase B**
- Full Chrome DevTools Protocol integration — **Phase B**
- Preview branch-forking UX — **Phase B** (mechanics via events.jsonl are v1)
- Real-time multi-user cursor co-presence in preview — **Phase C**

### AI feature deferrals
- Fine-tuning flows for AIFeatures — users bring their own fine-tuned model; **Phase C**
- Real-time multi-user AI collaboration — **Phase C**
- Federated learning / on-tenant model isolation — **Enterprise phase**
- Agentic end-user task completion beyond a single feature boundary — **Phase D research**
- Synthetic data generation at scale — **Phase B**

### Observability deferrals
- Full user-session replay / heatmaps — **Phase C**
- Cross-tenant comparative analytics — **Phase C**

---

## 9. Open Implementation Questions (post-Council; to surface in `superpowers:writing-plans`)

**Resolved by Council review** (closed, included in spec):
- ~~§9.2 Ambiguity classifier accuracy~~ → resolved: require calibration on 1,000-example set before auto-apply (§4.4)
- ~~§9.3 Event log compaction~~ → resolved: snapshot + archive every 1,000 events (§4.1)
- ~~§9.10 Concurrent-agent behavior~~ → resolved: Postgres mirror is live coordination (§4.2)
- ~~§9.16 Client-side Tailwind generator~~ → moot: visual-edit mode cut from v1 (§4.12)
- ~~§9.14 Babel vs SWC AST parser~~ → moot: AST-based edit mode deferred to Phase B
- ~~Visual-judge corpus curation~~ → moot: L7h visual judge deferred to Phase B

**Still open:**

1. **Tree-sitter coverage for v1 stacks** — verified solid for Next.js (App Router TS), Prisma schema, React Server Components, FastAPI (Python). Need to confirm on Prisma v6+ schema extensions and Python 3.13 type syntax.

2. **Schema evolution (v1 → v2)** — how do we migrate existing graphs when we add infra nodes in Phase B? Answer: additive-only for minor versions; migration scripts for major. Design migration-plan skill before Phase B.

3. **Brownfield derived-node promotion UX** — how does Priya promote discovered nodes from `.atlas/derived/` to the main graph without trampling invariants?

4. **Test-generator skill versioning** — when a generator skill updates, do existing tests get regenerated? Default: yes, on next ritual invocation. Baseline assertions are immutable (§4.15).

5. **Prompt template ownership** — user edits `.atlas/prompts/*.md` directly. Do we auto-sync edits back to the OSS library if users consent? (Optional "contribute upstream" button.)

6. **Cost telemetry privacy** — per-feature cost tracking may leak usage patterns. Default: telemetry aggregated to user-project level; raw provider calls stay local unless user opts into sharing.

7. **OpenEverest v1 dependency readiness** — Atlas Managed Postgres is Phase B, but commits us to OpenEverest operator quality. Need eval: does current release handle HA failover, point-in-time restore, encryption-at-rest, multi-region replication at Atlas-promise quality? Plan B (fall back to Aurora/Cloud SQL via OpenEverest-compatible adapter).

8. **E2B template rebuild pipeline** — who owns the weekly rebuild automation? Suggest: dedicated GitHub Actions workflow in `atlas-templates` + Sigstore signing + digest publication to `registry.atlas.app/templates/*`.

9. **Flutter vs Expo as default mobile** — Phase B decision; ship both, let Ama pick by persona cue.

10. **Preview sandbox warm-pool sizing** — NFR-PREVIEW-2 (<3s cold-start) needs warm E2B sandboxes waiting. Cost-vs-latency tradeoff TBD; start at 50 warm on Atlas Run, autoscale.

11. **Comment-pin storage & privacy** — preview comments may reveal in-progress business logic. Store in `.atlas/reviews/<preview-sha>.jsonl` Git-tracked by default; redact PII; opt-in cloud-sync.

12. **Custom Git merge driver UX** — the merge driver needs to be registered on `git clone`. Plan: post-clone setup script that `git config`s the driver + `.gitattributes` entry. If a user clones without running setup, they see a friendly error on first graph conflict. Design the error → one-command-fix path.

13. **Calibration dataset curation** — the 1,000-example reconciliation dataset needs to be built. Plan: Atlas team + community contributors; 100 examples per refactor pattern × 10 patterns. Labeled by at least 2 humans with conflict resolution. Publish as `atlas-skills/calibration/reconciliation-v1.jsonl`.

14. **Baseline assertion review process** — human-authored L4/L5 baseline assertions are high-value attack surface if compromised. Plan: require 2-person review + Sigstore signing for any baseline PR; monthly red-team exercise targeting baselines; never accept anonymous contributions.

15. **500-node ceiling eval methodology** — success criterion #17 requires measuring reasoning quality on 500-node vs 50-node projects. Design the standardized-refactor-task set before v1 ship.

16. **Skill trust-level promotion** — how does a `atlas-community` skill become `atlas-official`? Governance model: documented RFC + 3-month bake-in period + committee review.

17. **Risk-accepted audit analytics** — patterns in risk-accepted commits may reveal systematic spec gaps. Plan: weekly analysis of risk-accepted log across tenants; if >5% of commits are risk-accepted for the same category, the spec needs updating (not the policy).

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
- [karpathy/llm-council](https://github.com/karpathy/llm-council) — multi-model consensus protocol used to review this spec (see `docs/council-review/2026-04-18-spec-graph-v1-pass1.md`)
- [OpenTelemetry](https://opentelemetry.io/) — operator observability plane backbone (§6.4)
- [Sigstore / cosign](https://www.sigstore.dev/) — already referenced for E2B templates (§4.10); now also for skill library signing (§4.15)

---

*This spec supersedes any prior Spec Graph discussion in PRD_v3 and ECOSYSTEM_VISION. Those documents will be updated post-brainstorm to reference this spec as canonical.*

*Revised 2026-04-18 per the LLM Council review at `docs/council-review/2026-04-18-spec-graph-v1-pass1.md`. All 5 MUST-changes, all 3 SHOULD-changes, and all 5 Chairman-flagged blind-spots were applied. Chairman's verdict: "Ship the chapel in six months; earn the cathedral over the next two years." This revision is the chapel.*
