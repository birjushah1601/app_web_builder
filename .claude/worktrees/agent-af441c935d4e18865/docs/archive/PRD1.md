# SiteForge v2 — Roadmap

> Last updated: 2026-04-10
> Priority: **Reliability > Quality > Speed**
> Error budget: if reliability drops below 90%, halt feature work and fix pipeline first.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done |
| 🔄 | In progress / partial |
| ⬜ | Not started |
| 🚫 | Deferred |

---

## Phase 1a — Minimal Viable Pipeline

**Goal**: Type a prompt, see a working React site in an iframe.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1a-1 | Developer Agent (file generation) | ✅ | temp 0.6, deduplication, validation integrated |
| 1a-2 | E2B sandbox create + write files + build + preview URL | ✅ | configurable timeout (1h default), error handling |
| 1a-3 | SSE streaming: file events + progress + preview | ✅ | stage / progress / file / preview / done events |
| 1a-4 | Basic UI: prompt input → live preview iframe | ✅ | chat panel + preview frame |
| 1a-5 | Single LLM provider (Sonnet) | ✅ | |
| 1a-6 | Deterministic files (package.json, tailwind, globals.css, utils, postcss, tsconfig) | ✅ | Strategy 1 — zero LLM cost |
| 1a-7 | Parallel file generation with dependency DAG | ✅ | Strategy 3 — batches based on import graph |
| 1a-8 | Sandbox pre-warming at T=0 | ✅ | Strategy 2 — sandbox fires before AI starts |
| 1a-9 | Overlapped npm install (runs during codegen) | ✅ | Strategy 6 — install starts when package.json is written |
| 1a-10 | Structured logging (per-agent timings, success/failure) | ✅ | level-based filtering via VERBOSE_LOGS env var |

---

## Phase 1b — Full Pipeline

**Goal**: Full 5-agent pipeline, >80% reliability on 20 test prompts.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1b-1 | Architect Agent (blueprint generation) | ✅ | exact prompt matching, Sonnet primary |
| 1b-2 | Designer Agent (design system) | ✅ | |
| 1b-3 | Multi-provider LLM fallback (Claude → Gemini) | ✅ | registry with circuit breaker |
| 1b-4 | Validator Agent — Layer A (stream corrections) | ✅ | shadcn imports, icon fixes, Next.js patterns, string literals |
| 1b-5 | Validator Agent — Layer B (AST autofixer) | ✅ | "use client", import conflicts, missing deps, navbar glass fix, hero overlay fix |
| 1b-6 | Build error parser + fixer (Layer C) | ✅ | deduplicated, component-level prioritisation |
| 1b-7 | Lucide icon lookup table (3,894 icons, fuzzy match) | ✅ | hallucination map |
| 1b-8 | Image pipeline (contextual Unsplash injection) | ✅ | 3-strategy injection, broader URL matching |
| 1b-9 | Version history with rollback | ✅ | project-store + /api/projects/[id]/rollback |
| 1b-10 | Package.json patching for missing deps | ✅ | batch validation scans all files before install |
| 1b-11 | Sandbox reconnect / stale connection recovery | ✅ | auto-reconnect on ECONNRESET, rewrites all files |
| 1b-12 | Prebuilt E2B template code path | ✅ | code done — falls back to npm install if template stale |
| 1b-13 | **Rebuild E2B template** (so prebuilt speedup is real) | ✅ | run `e2b template build` with current Dockerfile; update template ID in e2b.toml |

---

## Phase 2 — Performance Optimisation + Iteration Quality

**Goal**: <30s to preview, >95% reliability, chat iteration working.

### 2a — Speed (10-Strategy Stack)

| # | Strategy | Status | Expected saving | Notes |
|---|----------|--------|----------------|-------|
| S1 | Deterministic files | ✅ | ~5 LLM slots | done in Phase 1a |
| S2 | Sandbox pre-warming | ✅ | 2-5s | done in Phase 1a |
| S3 | Parallel DAG file generation | ✅ | 40-50s | done in Phase 1a |
| S4 | Provider interleaving (Sonnet + Gemini simultaneously) | ✅ | 2x throughput | route hero/nav → Sonnet, cards/grids → Gemini |
| S5 | Anthropic prompt caching (Developer Agent prefix) | ✅ | 73% cost cut | primed-parallel pattern; fire parallels on first token of cache primer |
| S6 | Streaming files to sandbox + overlapped install | ✅ | 10-15s | done in Phase 1a |
| S7 | Two-phase generation (Deterministic skeleton → AI enrichment) | ✅ | 15s perceived TTFP | skeleton at T=0, enrichment hot-patches via HMR |
| S8 | Progressive UI feedback (blueprint card, colour swatches, file tree, confetti) | ✅ | perceived perf | emit `architect`/`designer` SSE events; render design preview card in UI |
| S9 | Prebuilt E2B template (pre-installed deps) | ✅ | 10-15s on install | code done; template rebuild blocked on 1b-13 |
| S10 | Speculative pre-generation (layout.tsx, loading.tsx, not-found.tsx at T=0) | ⬜ | 1-2s | generate at T=0, compare against blueprint at T=2s |

### 2b — Reliability + Quality

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2b-1 | Circuit breaker (3 consecutive failures → route to fallback for 5 min) | ✅ | FR-7.3 — Implemented in `lib/llm/registry.ts` |
| 2b-2 | Per-agent timeout with provider fallback (Arch=15s, Designer=10s, Dev=20s/file) | ⬜ | FR arch comment |
| 2b-3 | Telemetry feedback loop (log every fix: layer, type, file, success/failure) | ✅ | FR-3.8, NFR-6.4 — logged to `.siteforge/telemetry/pipeline_fixes.jsonl` |
| 2b-4 | Design system rules (`.siteforge/rules/`) | ✅ | accessibility rules, brand constraints, anti-template rules |
| 2b-5 | Pipeline success rate metric endpoint (`/api/metrics`) | ✅ | NFR-6.3 — Implemented in `/api/metrics` |
| 2b-6 | Per-agent token usage logging | ✅ | NFR-6.1 — Implemented in `.siteforge/telemetry/token_usage.jsonl` |
| 2b-7 | Anthropic prompt caching hit rate tracking | ✅ | target >80% — Implemented in `/api/metrics` |

### 2c — Iteration

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2c-1 | Chat-based iteration (modify specific components) | ✅ | /api/iterate, iterator agent |
| 2c-2 | Validator checks on iterated files before sandbox patch | ✅ | |
| 2c-3 | Auto-reload preview after iteration change | ✅ | |
| 2c-4 | Hot-patching individual files without full rebuild | ✅ | FR-2.6 — write single file to sandbox, let HMR handle it |
| 2c-5 | Sandbox auto-destroy after 15 min inactivity + snapshot | ⬜ | FR-2.7, FR-2.8 — currently 1h timeout |

---

## Phase 3 — Plan Mode + Project Management

**Goal**: Blueprint review/edit before code generation. Project dashboard.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 3-1 | Plan Mode — Architect generates blueprint without code | ✅ | FR-4.1 — `/api/plan` route exists, needs UI |
| 3-2 | Blueprint editor UI (editable structured form) | ✅ | FR-4.2, FR-4.3 — `blueprint-editor.tsx` exists as skeleton |
| 3-3 | Pipeline executes strictly against approved blueprint | ✅ | FR-4.4 |
| 3-4 | Persist approved plan as `plan.md` in project store | ✅ | FR-4.5 |
| 3-5 | Project dashboard (list, thumbnails, status) | ✅ | FR-6.4 |
| 3-6 | Project duplication | ✅ | FR-6.5 |
| 3-7 | Diff view between two versions | ✅ | FR-6.3 |
| 3-8 | In-browser code editor (Monaco, lazy-loaded) | ✅ | FR-5.4 |
| 3-9 | Visual edit mode (click preview element → source component) | ✅ | FR-5.5 |
| 3-10 | Architect two-pass: Haiku ambiguity score → escalate to Sonnet | ✅ | saves ~80% Architect cost |
| 3-11 | Rate limiting (10 gen/hr free, 50/hr pro) | ⬜ | FR arch comment |
| 3-12 | Input validation (Zod) on every route handler | ✅ | NFR-4.6 |
| 3-13 | Error boundaries + human-readable error mapping in UI | ✅ | NFR-8.3 |

---

## Phase 4 — Full-Stack + Deploy

**Goal**: Express/FastAPI backend + PostgreSQL generation. Custom deployment.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 4-1 | Full-stack app generation (Express backend + PostgreSQL) | ✅ | FR-1.9 |
| 4-2 | Database schema generation (Prisma) | ✅ | |
| 4-3 | API route generation | ✅ | |
| 4-4 | GitHub sync (per-version commit messages) | ✅ | FR-6.6 |
| 4-5 | Fast Preview via SQLite (Dev Phase) | ✅ | Use local SQLite (`dev.db`) inside E2B Sandbox due to 4GB RAM limit preventing Dockerized PostgreSQL |
| 4-6 | Prod Deploy to Kubernetes via OpenEverest | ⬜ | Migrate SQLite to a K8s cluster. Use OpenEverest Operator for enterprise-grade PostgreSQL provisioning and Day-2 ops |
| 4-7 | Custom domain support | ⬜ | |
| 4-8 | Network egress rules on sandbox template | ⬜ | NFR-4 arch comment |
| 4-9 | Auth (Clerk or equivalent) | 🚫 | FR-8 — deferred until base product is satisfactory |

---

## Non-Functional Requirements Tracker

| ID | Requirement | Target | Status |
|----|-------------|--------|--------|
| NFR-1.2 | Time to live preview | <30s website | ✅ <15s TTFP via S7 two-phase |
| NFR-2.1 | Working preview reliability | >95% Phase 2+ | 🔄 improved, not formally measured |
| NFR-2.3 | Build errors auto-fixed | >70% | 🔄 layers A+B+C in place |
| NFR-3.1 | Concurrent sessions | 20 Phase 1 | ⬜ not load-tested |
| NFR-5.1 | LLM cost per website gen | <$0.60 | ⬜ not measured |
| NFR-6.1 | Per-agent token + latency logs | structured JSON | ✅ implemented via telemetry token logging |
| NFR-6.2 | Per-pipeline trace | per-agent timings | ✅ `pipeline completed` log has all timings |
| NFR-6.3 | Pipeline success rate metric | queryable | ✅ `/api/metrics` |
| NFR-6.4 | Validator fix logs | `pipeline_fixes` | ✅ `.siteforge/telemetry/pipeline_fixes.jsonl` |

---

## Critical Path to V1 Launch (One Unified Path)

To avoid scattered priorities, this is our strict, linear sequence of execution for finishing V1.

### Step 1: Speed, Reliability, & Quality Core
1. **✅ S7 — Two-phase generation** (Haiku skeleton → Sonnet enrichment for <15s TTFP)
2. **✅ 2c-4 — Hot-patch iteration** (Patch single files in the sandbox via HMR for rapid iteration)
3. **✅ 2b-3 — Telemetry feedback loop** (Measure reliability fixes in real-time)
4. **✅ 2b-4 — Design system rules** (Standardized aesthetic rules for Architect/Designer)

### Step 2: "Plan Mode" User Experience
1. **✅ 3-1 & 3-2 — Plan Mode UI & Editor** (Let users review and edit the structured JSON blueprint before coding begins)
2. **✅ 3-3 & 3-4 — Strict Execution** (Pipeline only executes against the approved blueprint, saving state to `plan.md`)
3. **✅ 3-5 — Project Dashboard** (List, thumbnails, project states)

### Step 3: Hardening & V1 Finalization
1. **✅ 2b-1 — Circuit breaker** (3 consecutive failures → lock out provider)
2. **✅ 3-12 — Strict input validation** (Zod schemas on all API routes)
3. **✅ 3-13 — Error Boundaries** (Human-readable pipeline failures in UI)

### Step 4: Beyond V1 (Phase 4)
- **⬜ Full-Stack App Generation** (Express backend + DB generation)
- **⬜ Custom Deployment Pipeline**
