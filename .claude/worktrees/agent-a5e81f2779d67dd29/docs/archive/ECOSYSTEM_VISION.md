# Atlas Ecosystem Vision

> **"From idea to sovereign software — one platform covers imagine, build, run, and migrate."**
>
> Last updated: 2026-04-18
> Companion to: `docs/PRD_v3.md` (Atlas Build — the AI builder product)
> Integrates: [`birjushah1601/cloud_migration`](https://github.com/birjushah1601/cloud_migration) (AI-powered zero-downtime migration platform)

---

## 1. The One Sentence

**Atlas is the only platform on earth that takes you from "I have an idea" to "it runs in my own datacenter" — with AI doing the hard parts at every step.**

Every competitor either solves the first mile (v0, Bolt, Lovable, Emergent, Replit) or the last mile (Turbonomic, CloudFuze, Carbonite, traditional migration consultancies). Nobody does both, and nobody makes the journey continuous.

That's the moat.

---

## 2. The Two Worlds, and Why They Belong Together

### World 1: AI App Builders (Atlas Build)
Today's AI builders (v0, Bolt, Lovable, Emergent, Replit Agent, Firebase Studio) excel at **greenfield creation** — idea → running app in minutes. But every single one **traps you on their infrastructure**. Export quality is poor. Deploy options are narrow. The moment you outgrow their managed tier or hit a compliance requirement (data residency, sovereignty, on-prem mandate), you face a six-to-seven figure migration project with external consultants. "Vibe coded → cloud exit" is an industry-wide dead end.

### World 2: Cloud Migration Platforms (Atlas Migrate)
Your existing `cloud_migration` codebase already solves the hard second half: **AI-powered, zero-downtime migration** across AWS/Azure/GCP and into **OpenStack / VMware / bare-metal private clouds**. 62 REST endpoints, 63 backend services, real modules for `discovery/`, `planning/`, `migration/`, `openstack/`, `compliance/`, `cost_calculation/`, `terraform generation/`, `workflow/`, `execution/`, `deployment/`, `disaster_recovery/`. It's an infrastructure-as-a-product play for enterprises that need to leave the hyperscalers — for cost, compliance, or sovereignty.

### Why fuse them
An AI builder without a migration path is a trap. A migration platform without a builder is a consulting engagement. **Fused, they are the first continuous software-sovereignty pipeline.**

A founder in Bangalore builds a healthcare app on Atlas today. When India's DPDP Act mandates on-shore data residency next year, the **same platform** migrates it to a sovereign-cloud tenant. No re-architecture. No consultants. No downtime. Same spec graph, same observability, same team.

That is a product no one else can ship.

---

## 3. The Four Pillars (one umbrella, four products)

```
┌──────────────────────── ATLAS ────────────────────────────┐
│                                                           │
│  IMAGINE          BUILD            RUN             MIGRATE│
│  ─────────        ─────────        ─────────       ───────│
│  Spec Graph       Atlas Build      Atlas Run       Atlas  │
│  + Architect      (PRD_v3.md)      Managed         Migrate│
│  Agent                             hosting         (this  │
│                                                    codebase)│
│                                                           │
│  ┌─ Shared Platform Layer ──────────────────────────┐     │
│  │ Spec Graph (app + infra) • Agent Team • LLM     │     │
│  │ Identity • Billing • Observability • Compliance │     │
│  └──────────────────────────────────────────────────┘     │
│                                                           │
│  ┌─ Execution Layer ────────────────────────────────┐     │
│  │ E2B microVMs (build) • Vercel/Fly/Cloudflare    │     │
│  │ (managed run) • AWS/Azure/GCP (target) •        │     │
│  │ OpenStack/VMware/K8s bare-metal (sovereign)     │     │
│  └──────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────┘
```

### Pillar 1 — **Imagine**
The front door for everyone. A structured conversation that turns an idea into a **Living Spec Graph** (from PRD_v3 §6.2), extended to model not only the *app* but also its *infrastructure*: auth provider, DB choice, region, compliance class, eventual target cloud. One graph, full lifecycle.

### Pillar 2 — **Build** (Atlas Build)
Everything in `docs/PRD_v3.md`. AI agents generate a secure, accessible, production-grade app from the spec graph. Exportable TypeScript. Merge gates for security, a11y, browser verification. Flat pricing.

### Pillar 3 — **Run** (Atlas Run)
Managed hosting in the background (Vercel/Fly/Cloudflare Workers today; our own multi-region mesh tomorrow). Domain, TLS, DB, auth, payments already wired by the **Ship** agent. Observability and SLO dashboards included. This is the default for 95% of users — they never touch Migrate.

### Pillar 4 — **Migrate** (Atlas Migrate)
The `cloud_migration` platform, rebranded and integrated. Activated when a user has a reason to leave Atlas Run: **cost, compliance, sovereignty, scale, or acquisition**. The same spec graph that built the app now describes its target infrastructure. A **Migration Planner** agent produces a staged, zero-downtime plan; an **Execution** engine runs it against OpenStack / VMware / bare-metal K8s / another hyperscaler. Because we wrote the app, we can migrate it perfectly.

---

## 4. Unified Architecture (the shared primitives)

The fusion is not cosmetic. Several primitives **must** be shared:

### 4.1 The Living Spec Graph (extended)

In PRD_v3 the Spec Graph models the app (pages, routes, components, models, flows, auth boundaries, a11y contracts, tests). We extend it with **Infrastructure nodes**:

| Node type | Example |
|-----------|---------|
| `Region` | `ap-south-1`, `in-mumbai-sovereign` |
| `ComplianceClass` | `HIPAA`, `SOC2`, `DPDP-India`, `GDPR`, `ITAR` |
| `DataResidency` | `in-country`, `eu-only`, `us-only` |
| `Runtime` | `managed-serverless`, `k8s`, `openstack-vm`, `bare-metal` |
| `Dependency` | `postgres-15`, `redis-7`, `kafka-3.5` |
| `Provider` | `aws`, `azure`, `gcp`, `openstack-native`, `vmware` |
| `WorkloadTopology` | edges representing deployment placement |

Edges: `runsOn`, `requiresCompliance`, `storesDataIn`, `dependsOn`, `migratesTo`.

This means the same graph used by the **Developer** agent to generate `page.tsx` is read by the **Migration Planner** agent to produce a Terraform plan. Same source of truth. No translation layer.

### 4.2 The Unified Skill Framework (agents are thin, skills are the IP)

Atlas Build's Skill Framework (PRD_v3 §6.1) extends cleanly to Migrate. **Migration is not a new product with new agents — it is the same Visualize → Agree → Build ritual applied at infrastructure scope.** The same Conductor reads the Spec Graph. The same Reviewer critiques diffs. The same three merge gates apply. What migration adds is additional skills in the shared open-source library:

| Migrate-specific skill | Activates on | What it does |
|------------------------|--------------|--------------|
| `discover-cloud-workload.md` | Brownfield onboarding | Agentless inventory of AWS/Azure/GCP/VMware → Spec Graph infra nodes |
| `migration-plan.md` | "Migrate this to X" | Staged zero-downtime plan with cutover windows + rollback checkpoints |
| `cost-optimizer.md` | Any infra-scope conversation | Target vs current cost delta; savings projection; budget gate |
| `compliance-evidence.md` | ComplianceClass node present | Evidence pack for HIPAA / SOC2 / DPDP / GDPR / ITAR auditors |
| `terraform-generator.md` | Build step at infra scope | Deterministic HCL via the upgraded `iac/` service (see `CODEGEN_UPGRADE.md`) |
| `openstack-target.md` | Target = OpenStack | Keystone / Nova / Neutron / Cinder / Glance resource mapping |
| `zero-downtime-cutover.md` | Any migration | Dual-run → traffic-shift → verify → cut-over → decommission |
| `reverse-engineer-spec.md` | Brownfield without a Spec Graph | Infer a Spec Graph from a running system (research-grade, phased) |

These skills live in the **same OSS library** as the Build skills (`github.com/atlas-labs/atlas-skills`, Apache 2.0). Same governance. Same extensibility. An enterprise can author `acme-internal-datacenter.md` and the Migrate ritual routes to it automatically.

**Orchestration roles** (Conductor, Architect, Developer, Schema, Security, Accessibility, Browser Verification, Debugger, Refactor, Upgrade, Reviewer, Validator, Ship) remain unchanged across Build and Migrate. A new role — **Migration Orchestrator** — handles workflow and execution coordination, but it is thin like the others: it composes skills, it does not hardcode logic.

Every role reads and writes the Spec Graph. Every role runs in its own context window. Shared task list, peer messaging, file locks (Claude Code Agent Teams primitives; already proven pattern).

**The key insight.** Build and Migrate are not two separate products sharing infrastructure. They are **one product at two scopes**. The ritual is the same. The skills specialize. That is the real unification — not an API gateway or a shared identity service, but a shared discipline.

### 4.3 The LLM Layer

Both codebases already have `llm/` and `ai/` services. **Collapse them into one.** The shared stack:

- Anthropic Opus 4.7, Sonnet 4.6, Haiku 4.5
- Google Gemini 2.5 Pro/Flash (for parallel-heavy codegen)
- Optional self-hosted Qwen / DeepSeek for private-cloud customers who want zero data egress
- Prompt caching (target >80% hit rate on builder workflows)
- Circuit breaker + provider fallback (already in v2)
- Per-agent routing (Haiku for triage, Sonnet for codegen, Opus for security + planning)

### 4.4 The Execution Layer

A unified **target graph** of execution environments:

| Target | Used by | Purpose |
|--------|---------|---------|
| E2B Firecracker microVM | Build | Isolated dev sandbox |
| Vercel / Fly / Cloudflare Workers | Run | Default managed hosting |
| AWS / Azure / GCP | Migrate (source or target) | Hyperscaler support |
| **OpenStack** (Keystone/Nova/Neutron/Cinder/Glance) | **Migrate (target)** | **Sovereign cloud** |
| VMware (vSphere, Tanzu) | Migrate (target) | Enterprise on-prem |
| Bare-metal K8s + Cilium | Migrate (target) | Ultimate ownership |
| Regional sovereign clouds (CtrlS, ESDS, Yotta for India; OVHcloud, Scaleway for EU; MTN, Liquid Telecom for Africa) | Migrate (target) | Local data residency |

### 4.5 Identity, Billing, Observability

One account, one bill, one dashboard covering Build + Run + Migrate. Usage across pillars rolls up. SSO and audit logs at Team tier (both products already need this).

### 4.6 Compliance & Security as a First-Class Surface

The same **Security Agent** and **Compliance Agent** that gate merges on Atlas Build run during a migration. RLS policies, CORS, CSP, secrets, dep CVEs, HIPAA/SOC2/DPDP/GDPR/ITAR controls — one validation engine, used at build time and migration time. This is a selling point that existing AI builders simply cannot match: "we built your app, and we can prove it's compliant at rest, in motion, and in its new home."

---

## 5. The Canonical User Journeys

### Journey A — The Ama Path (non-dev → forever on Atlas Run)
1. Ama describes a clinic-intake app in Swahili.
2. Atlas builds it in 45 seconds. WCAG AA, HIPAA-ready RLS.
3. Ships to `clinic.atlas.app` on Atlas Run. $29/mo flat.
4. Atlas Run handles it for years. Ama never thinks about Migrate.

### Journey B — The Diego Path (dev → export + self-host)
1. Diego builds a SaaS MVP on Atlas Build.
2. Exports to his GitHub — real code, tests, CI, docs.
3. Self-hosts on Fly.io via Terraform emitted by Atlas.
4. Comes back to Atlas as a customer when he wants AI iteration again.

### Journey C — The Priya Path (scale-up → private cloud)
1. Priya's company built on Atlas two years ago. 4M monthly users. AWS bill is $80k/mo.
2. Compliance team says EU customer data must stay on EU sovereign cloud.
3. Priya clicks **Migrate** → chooses OVHcloud-OpenStack region.
4. Migration Planner produces a 7-stage plan: discovery, data mapping, cutover windows, rollback checkpoints.
5. Execution engine runs the plan, zero downtime, across three weekends.
6. New monthly infrastructure cost: $22k. Compliance: automated evidence packs exported to auditors.

### Journey D — The Sovereign Path (public sector / national champion)
1. A state government in India wants a unified citizen-services portal.
2. Describes it on Atlas with DPDP residency constraint set at Imagine.
3. Build pipeline chooses regional sovereign-cloud provider (CtrlS/Yotta) as the deploy target from day one — never touches hyperscalers.
4. Public CVE/compliance posture visible to the CISO dashboard in perpetuity.

### Journey E — The Legacy Rescue (pre-existing workloads, never built on Atlas)
1. A 15-year-old ERP running on AWS + on-prem VMware.
2. Atlas Migrate's **Discovery** agent inventories it (AWS boto3 + VMware API + agentless network scan).
3. AI Architecture Analysis reverse-engineers the spec graph from the running system — this is new and valuable even when you didn't build it with us.
4. Migration plan produced. Target: customer's OpenStack private cloud. Zero downtime.
5. Post-migration, the spec graph enables continuous modernization — "now add a modern React frontend" triggers Atlas Build on the already-migrated backend.

Journey E is the clever one: **Migrate becomes the on-ramp for Atlas Build**. Brownfield enterprises become greenfield-capable.

---

## 6. What This Combination Does That No One Else Does

| Capability | Atlas Build+Migrate | v0 | Bolt | Lovable | Emergent | Replit | Firebase | Vercel | AWS Migration Hub |
|------------|:-------------------:|:--:|:----:|:-------:|:--------:|:------:|:--------:|:------:|:-----------------:|
| AI app generation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ❌ |
| Merge-gated security + a11y | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Living Spec Graph | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Flat predictable pricing | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | ❌ | N/A |
| Full code export (Priya-grade) | ✅ | 🟡 | 🟡 | 🟡 | ✅ | 🟡 | 🟡 | N/A | N/A |
| Managed hosting | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Zero-downtime migration** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 |
| **OpenStack / private-cloud target** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 |
| **Compliance auto-evidence (HIPAA/DPDP/GDPR)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | ❌ | 🟡 |
| **Brownfield workload discovery + modernization** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 (discovery only) |
| **Sovereign-cloud partners (regional)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Row-by-row, every competitor has ~2–3 checkmarks. Atlas has 11. That is the category redefinition.

---

## 7. Code Integration Plan (three options, ranked)

### Option A — Monorepo fusion (recommended)
Move `birjushah1601/cloud_migration` into this repo as `/services/migrate/` (backend) and `/apps/migrate/` (frontend pages). Extract shared services (`/packages/llm/`, `/packages/spec-graph/`, `/packages/agent-team/`, `/packages/compliance/`) as workspace-level libs consumed by both Build and Migrate.

- **Pros:** single spec graph instance, no RPC between Build and Migrate, unified identity/billing, one CI, simpler cross-product refactors.
- **Cons:** large one-time refactor; two languages in one repo (TypeScript frontend + Python backend); Python Celery workers need to cohabit with Next.js.
- **Path:** pnpm workspace or turborepo + the Python backend as a sibling service under `/services/migrate-api/`. Keep FastAPI + Celery as-is.

### Option B — Federated (shared contracts)
Keep repos separate. Define shared OpenAPI + JSON Schema for the Spec Graph. One identity service, one billing service, published via gRPC/REST. Ship a unified frontend that proxies to both.

- **Pros:** no repo-merge blast radius; teams can move independently.
- **Cons:** two deploy pipelines, two CI systems; spec-graph sync issues; duplicated work in `/llm/` and `/ai/`.

### Option C — Atlas Build as a frontend on top of Migrate's backend
Atlas Build's backend folds into `cloud_migration`'s FastAPI. The entire ecosystem runs on Python. Atlas frontend becomes one of many UIs.

- **Pros:** inherits the more mature backend (63 services); Python-first matches the heavier ML/infra workloads.
- **Cons:** throws away the Atlas Node/TypeScript pipeline; Python is not the ideal host for Next.js HMR-aware codegen.

**Recommendation: Option A.** It's the most work up front but the only path that gives customers a truly unified product. Target: 6–8 weeks of integration work after PRD_v3 Phase A finishes, before Phase B kicks off.

---

## 8. Phased Roadmap (combined)

### Phase 0 — Alignment (now, Q2 2026)
- A-0-1: Approve combined vision (this doc)
- A-0-2: Pick integration option (recommend Option A)
- A-0-3: Brand decision: **Atlas** umbrella with Build / Run / Migrate pillars
- A-0-4: Unified Spec Graph schema draft covering app + infra nodes
- A-0-5: Repo merger plan with zero-downtime cutover for existing `cloud_migration` users

### Phase A — Atlas Build Foundation (Q2 2026)
See PRD_v3.md §9 Phase A–C. Continues on this repo.

### Phase B — Backend Fusion (Q3 2026)
- B-1: Move cloud_migration into `/services/migrate/`
- B-2: Extract `/packages/llm/` (consolidate duplicated LLM code)
- B-3: Extract `/packages/spec-graph/` (shared TS + Python bindings via Protobuf/JSON Schema)
- B-4: Single auth/identity/billing service
- B-5: Unified project model — a project can have an **app spec** and/or a **migration spec**

### Phase C — Spec Graph Infra Nodes (Q3 2026)
- C-1: Extend spec graph with Region, ComplianceClass, DataResidency, Runtime, Dependency, Provider, WorkloadTopology
- C-2: Architect agent emits infra nodes from Imagine conversation
- C-3: Migration Planner agent reads infra nodes, emits staged plan

### Phase D — Managed Run (Q3–Q4 2026)
- D-1: One-click deploy from Build → Atlas Run (Vercel/Fly/Cloudflare under the hood)
- D-2: Observability (Sentry + PostHog + OpenTelemetry → Atlas Dashboard)
- D-3: SLO + health dashboards
- D-4: Multi-region fail-over option (Pro tier)

### Phase E — Sovereign Targets (Q4 2026 → Q1 2027)
- E-1: OpenStack target GA (upgrade `openstack/` module; Keystone/Nova/Neutron/Cinder/Glance/Heat)
- E-2: VMware vSphere target
- E-3: Bare-metal K8s target (Cluster API + Cilium)
- E-4: Regional sovereign-cloud partners: CtrlS, ESDS, Yotta (India), OVHcloud, Scaleway (EU), Equinix, Liquid Telecom (Africa)
- E-5: HIPAA / SOC2 / DPDP / GDPR / ITAR compliance evidence generators

### Phase F — Brownfield Discovery (Q1 2027)
- F-1: Agentless discovery for AWS, Azure, GCP, VMware
- F-2: Reverse-engineer spec graph from running system ("what does this app actually do?")
- F-3: Brownfield → Atlas Build modernization ("add a React frontend to this legacy API")

### Phase G — Public Sector / National Champions (H2 2027)
- G-1: FedRAMP Moderate
- G-2: India DPDP Sovereign-Cloud Certified Partner program
- G-3: EU Cloud Services Scheme alignment
- G-4: Public-sector discount tier

---

## 9. Pricing (unified, flat)

The builder pricing from PRD_v3 holds. Migrate pricing is additive per workload migration and per managed fleet:

| Tier | Price | What you get |
|------|-------|--------------|
| Atlas Free | $0 | 3 projects, 30 iterations/mo, Atlas Run subdomain |
| Atlas Builder | **$29/mo flat** | Unlimited reasonable use, custom domains, GitHub export, **Atlas Run** managed hosting |
| Atlas Pro | **$99/mo flat** | Unlimited projects, team seats (3), background agents, **Atlas Migrate** entry tier (up to 10 migrations/quarter) |
| Atlas Team | **$39/seat/mo** | All Pro, SSO, audit logs, shared spec graphs |
| Atlas Migrate Enterprise | **Usage-based + annual** | Unlimited migrations, OpenStack/VMware/Bare-metal targets, compliance evidence, dedicated migration engineer on call |
| Atlas Sovereign | Custom | Self-host the entire platform; for regulated / public sector |
| Atlas Social Impact | Free (verified) | Full Builder + Run; Migrate at 90% discount for NGO/public health/public education |

Migrate Enterprise is where the real revenue is — enterprises will pay six figures annually for guaranteed-window migrations with a named engineer and compliance evidence on tap.

---

## 10. The Moat, Said Plainly

1. **Only platform where spec-graph coherence survives the full lifecycle** — from prompt to production to private cloud. Competitors re-derive context every turn; they can't even keep an app coherent across 50 files, let alone across 3 years.
2. **Only platform with merge-gated security + a11y + compliance on both greenfield and brownfield code.** One validation engine, two surfaces.
3. **Only platform that takes "cloud sovereignty" from a buzzword to a one-click action** for any app — whether you built it here or we're discovering it.
4. **Only platform with AI-native migration across hyperscalers and into OpenStack/VMware/bare-metal.** Everyone else does hyperscaler-to-hyperscaler or sells consulting.
5. **Only platform where the same subscription covers the entire arc.** Not "buy an AI builder, then buy a migration tool, then hire consultants."
6. **Only platform with a unified Visualize → Agree → Build ritual applied at every scale** — new app, new feature, bug fix, dep upgrade, refactor, migration. One disciplined conversation. Powered by an **open-source skill library** (Apache 2.0, Superpowers-influenced) that the industry contributes to and everyone benefits from — while the orchestrator, Spec Graph, merge gates, Ship Pipeline, and execution infrastructure remain proprietary. This is the Linux-of-skills / Red-Hat-of-orchestration split, applied to AI-native software engineering.

This is not 10x. This is a new category.

---

## 11. Risks & Honest Pushback

1. **Scope is enormous.** Build + Run + Migrate is three products. Mitigation: phase ruthlessly; don't ship Migrate to self-serve until Build reliability is ≥97%.
2. **Enterprise sales motion is different from PLG.** Atlas Build sells bottoms-up ($29/mo). Atlas Migrate sells top-down (six figures). Need both motions and they don't share a playbook. Mitigation: hire enterprise leadership only after $1M ARR on Build side.
3. **Unit economics at flat pricing.** Heavy agent users could tank margins. Mitigation: rigorous cost telemetry (already in v2 roadmap), soft throttles, transparent "your usage is 3x average" dashboards.
4. **Spec graph complexity.** Modeling an app is hard; modeling an app + its infra + compliance is harder. Mitigation: ship v1 with 10 node types, let real projects pressure-test, expand.
5. **Security + compliance are legal, not just technical.** A mis-certified compliance evidence pack is a lawsuit. Mitigation: Phase E compliance evidence is **tooling to help auditors**, never a replacement for them. Clear disclaimers. Named third-party partners (Drata, Vanta, Secureframe) as aggregator integrations.
6. **The brownfield discovery promise is technically ambitious.** Reverse-engineering a spec graph from a running system is a research-grade problem. Mitigation: Phase F is 2027+, not 2026. Deliver the simpler wins first.

---

## 12. Open Questions for You

1. **Brand commitment.** Are you willing to fold `cloud_migration` into the **Atlas** brand, or do you want to keep it independent (perhaps as "Atlas Migrate powered by [your brand]")?
2. **Integration option.** A (monorepo fusion) / B (federated) / C (merge up into Python)? My strong recommendation is A but I want your read on team capacity.
3. **Go-to-market sequence.** Do we lead with Build (PLG, viral) and add Migrate later? Or lead with Migrate (enterprise ARR, fewer but bigger customers) and let Build ride on top? I'd argue Build-first; migrations sell when users have something to migrate.
4. **Sovereignty positioning.** How hard do we lean on the "escape hyperscalers" narrative? There's a political dimension (India DPDP, EU sovereignty, Africa data localization). It's a massive tailwind but it's also polarizing in US markets.
5. **OSS posture (resolved).** The **Atlas Skill Library** (Build + Migrate skills, ~15 starter skills growing via community RFC) ships **Apache 2.0 on day one** at `github.com/atlas-labs/atlas-skills`. The **Spec Graph schema** and **compliance evidence generators** also ship OSS. The orchestrator, merge gates, Ship Pipeline, migration execution engine, IaC emitter, and hosted runtime remain proprietary. This mirrors what made Superpowers grow to 121K GitHub stars — the library is an industry commons, not a moat.
6. **Timeline.** Is 18 months to full pillar-parity realistic given current team? Or do we compress by hiring, and from where?

---

## 13. One Paragraph Summary

Atlas fuses an AI website/app builder with an AI-powered zero-downtime cloud-migration platform into a single lifecycle product. The same conversation that creates a spec graph also models its infrastructure, compliance class, and eventual sovereignty target. The same agents that write secure, accessible code can audit and migrate it to OpenStack, VMware, or bare-metal Kubernetes. The same flat subscription covers the arc from idea to deployed app to private-cloud workload. No competitor — AI-native builder, hyperscaler migration service, or traditional consultancy — spans this arc. By building it, we don't just win a category. We define one: the AI-native software-sovereignty pipeline.

---

*Read alongside `docs/PRD_v3.md` (Atlas Build detail) and the [`cloud_migration`](https://github.com/birjushah1601/cloud_migration) repository (Atlas Migrate inheritance). Integration cutover plan to be authored in a follow-up doc (`docs/INTEGRATION_PLAN.md`) once Option A/B/C is chosen.*
