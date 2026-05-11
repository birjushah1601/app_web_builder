# Phases B–F Directional Roadmap

> Successor to `2026-04-18-phase-a-units-b-through-g.md`.
> Scope: the five phases of Atlas that follow Phase A (foundation).
> Purpose: directional. Entry criteria, milestones, exit criteria, known risks. No task-level detail — requirements will shift as Phase A reveals constraints.
> **Read this to plan hiring, partnerships, capital, and communications. Do not read this to write code.**

---

## Why no task-level detail below

The further out a phase is, the higher the cost of false precision. Writing Playwright test steps today for a Phase F (2027+) brownfield-discovery feature is waste work — the stack, the SDKs, the LLMs, and the legal landscape will all have shifted by the time that code is executed.

The right unit at this horizon is the **milestone**: a named, externally-visible outcome with clear entry and exit criteria. Milestones get decomposed into executable plans at T-minus-12-weeks, not today.

The roadmap below names every milestone and specifies its entry/exit gates. It does not pretend to prescribe implementation.

---

## Phase B — Build Polish + Migrate Alpha (Q3 2026)

**Mission:** Reintroduce the Phase A scope cuts where they've earned their seat, and stand up the first pieces of Atlas Migrate as an alpha behind a feature flag.

### Entry criteria

- Phase A exit checklist (all eight items) passed.
- `apps/atlas-web` has ≥ 20 real projects shipped end-to-end (mixed persona tiers).
- NFR-3 (reliability) at ≥ 97% on the 1,000-prompt eval four weeks running.
- One regulated-industry pilot (healthcare or financial) signed on with Atlas Builder Pro.
- `cloud_migration` codebase assessed for fusion — Option A monorepo plan drafted and owners named.

### Milestones

**B-1 — Infra nodes in Spec Graph.** Extend `@atlas/spec-graph-schema` with Region, DataResidency, Runtime, Provider, WorkloadTopology, plus edges `runsOn`, `requiresCompliance`, `storesDataIn`, `dependsOn`, `migratesTo`. Architect role emits these nodes from the Imagine conversation. Unit B schema minor version bumps to v1.1.

**B-2 — `cloud_migration` monorepo fusion (Option A).** Move `birjushah1601/cloud_migration` into `services/migrate/` + `apps/migrate/`. Extract `packages/llm/`, `packages/spec-graph-schema-py/` (already shipped), `packages/agent-team/`, `packages/compliance/`. One CI. Unified identity + billing service (stubs first). 6–8 weeks of integration work per PRD §22.

**B-3 — AST visual edit mode.** Click-to-select in Canvas now surfaces the spec-graph node *and* the exact AST range; edits at Agree become typed graph mutations that regenerate just the affected component. Replaces Phase A's "graph-mutation-driven regeneration only" posture with the richer Phase B approach. Keeps the security model (mutations pass through L4/L5 gates) intact.

**B-4 — Additional E2B templates.** `atlas-react-vite`, `atlas-astro`, `atlas-sveltekit`, `atlas-expo`. Each signed, digest-pinned, weekly-rebuilt. Template selection happens at the Visualize step.

**B-5 — Figma importer.** The second importer after Claude Design (which shipped Phase A). Reads Figma via their API, translates frames to Page nodes, components to Component nodes, tokens to DesignToken nodes. Fidelity target: 80%+ of tokens preserved; layout approximated, not pixel-replicated.

**B-6 — Video generation adapter.** Plug-in for Seedance + Kling + Veo + Runway. MediaAsset node gains `mediaKind: "video"`. Prompts live in `.atlas/prompts/video/`. Gate: a hard cap on video generation cost per project to keep flat-pricing unit economics viable.

**B-7 — Additional compliance classes.** Add PCI-DSS, DPDP-India, LGPD to the v1 four. Each is a first-class ComplianceClass node with a human-authored baseline assertion set (continuing the discipline from Phase A's Chairman-flagged blind-spot).

**B-8 — Browser Verification role.** The L3 gate moves from Phase A's advisory mode to full merge-gate in Phase B. Plays alongside Security (L4) and Accessibility (L5).

**B-9 — Migration Planner alpha.** New role `packages/role-migration-planner/`. Reads infra nodes, emits a staged zero-downtime migration plan (dual-run → traffic shift → verify → cutover → decommission). **Alpha:** behind a feature flag, exposed only to the healthcare pilot from entry criteria. Not generally available.

### Exit criteria

- Spec-graph v1.1 shipped with infra nodes.
- `cloud_migration` folded into monorepo; CI + one-click local bring-up work.
- At least three additional E2B templates live; Figma importer usable.
- Compliance classes count goes from 4 → 7 (PCI, DPDP, LGPD added).
- Migration Planner alpha successfully produces a plan for one real workload (the pilot); plan is dry-run-validated; no execution yet.
- Video generation capped pricing model validated on a 30-project sample.
- Council-style re-review: run the LLM Council tool (`tools/council.mjs`) against the Phase B deliverables document before shipping general access.

### Known risks

- **Fusion blast radius.** `cloud_migration` is Python FastAPI + Celery. Monorepo fusion means Python + TypeScript + Next.js in one workspace. Build tooling and dev ergonomics are non-trivial.
- **Video cost tail.** A single hostile or enthusiastic user could burn 100× average media cost. Gate: per-project + per-month caps; telemetric alarm at 3×.
- **Migration Planner alpha scope creep.** The temptation to rush toward GA is real. Hold the line: alpha is 1 pilot, 1 workload.

---

## Phase C — Run Managed Hosting GA (Q3–Q4 2026)

**Mission:** Ship Atlas Run as a first-class pillar. Deploying an app becomes a one-click action from Atlas Build; observability and SLOs become first-class product surface.

### Entry criteria

- Phase B exit criteria met.
- Public uptime + reliability dashboard (stripe.com/status equivalent) live from Phase A stays at ≥ 99.9% for the prior quarter.
- Pricing NPS ≥ 50 (PRD target) — flat-pricing discipline is working.
- Deployment contract (Neon branching + Vercel/Fly promotion + rollback + migration ordering + post-deploy health checks) is executing cleanly for ≥ 95% of ships (inherited from Phase A E-4 + Ship role).

### Milestones

**C-1 — One-click deploy to managed targets.** Click **Ship**; Atlas Run provisions Neon branch, Vercel deploy, domain/DNS/TLS, auth wiring, payments wiring (Stripe default; Paystack / Razorpay / Mercado Pago selectable), email (Resend), observability (Sentry + PostHog). Uses the Ship role's composed skills from Phase A.

**C-2 — Atlas Run observability dashboard.** Integrated view of app health, per-route latency, error budget, alert configuration. Built on top of OpenTelemetry traces collected via OTLP + Prometheus metrics scraped from the app. Persona-tiered: Ama sees traffic lights; Diego sees per-endpoint p95 + error rate; Priya sees full trace explorer + alerting policy editor.

**C-3 — SLO + error-budget management.** Per-project SLOs default from template; users can edit. Burn-rate alerts. Auto-pause of non-critical deploys when error budget depleted.

**C-4 — Multi-region failover (Pro tier).** For Builder tier, single-region. For Pro+, automatic multi-region primary/secondary with health-driven failover. Neon multi-region branching + Vercel edge routing.

**C-5 — Payments hardening.** The Ship pipeline's payments wiring gains idempotency keys, webhook signature verification, reconciliation playbooks, fraud-flag signals. This closes a known gap in v2.

**C-6 — Usage telemetry + cost dashboards.** User-facing dashboard showing "you're at 67% of your flat-plan reasonable-use envelope". Internal dashboard for unit-economics measurement — critical for defending flat pricing against heavy users.

**C-7 — SSO + audit logs (Team tier).** OIDC / SAML; per-event audit log exported to user-configured sink (S3, Datadog, Splunk). Precondition for Enterprise deals.

### Exit criteria

- `atlas.app` subdomain deploys + custom-domain deploys both functional for ≥ 1,000 live apps.
- Observability dashboard reached MVP (C-2 feature-complete, usability-tested with 5 Priya-tier users).
- Multi-region failover demonstrated in a chaos test — healthy failover in < 30 seconds.
- SSO + audit log path certified against SOC 2 Type I.
- Unit-economics model validated: 90th-percentile user cost within the Builder-tier margin envelope.

### Known risks

- **Payments regulatory complexity.** Each regional provider has its own KYC/AML requirements. Partner with a payments consultancy for the Africa + LATAM rollouts rather than DIY.
- **Multi-region consistency.** Neon branching is not globally replicated out of the box. Confirm replication semantics + RPO/RTO targets before C-4 ships.
- **Observability data volume.** OTLP at full trace sample rate is expensive at scale. Sampling policy must be defined before C-2 ships (head-sampling for high-volume endpoints; tail-sampling for errors).

---

## Phase D — Sovereign / On-Prem (Q4 2026 → Q1 2027)

**Mission:** Turn the sovereignty story from marketing copy into a shipped capability. Atlas Sovereign (self-host) and regional sovereign-cloud partners come online.

### Entry criteria

- Phase C exit criteria met.
- At least 3 enterprise customers verbally committed to sovereign-cloud deployment pending platform readiness.
- Regional partners identified and MoU'd: CtrlS / ESDS / Yotta (India), OVHcloud / Scaleway (EU), Liquid Telecom / MTN (Africa).
- Atlas Migrate Planner (B-9) matured — at least 3 pilot workloads successfully dry-run-planned.

### Milestones

**D-1 — OpenStack target GA.** The `services/migrate/openstack/` module (from Phase B fusion) hardened for production. Keystone / Nova / Neutron / Cinder / Glance / Heat all covered. Migration Planner emits Terraform + Heat templates for the target. Zero-downtime cutover validated against three real OpenStack deployments.

**D-2 — VMware vSphere target.** Parallel to D-1; VMware-specific adapter (datacenter, cluster, datastore, network, VM, template concepts). Partner with VMware/Broadcom for certification.

**D-3 — Bare-metal Kubernetes target.** Cluster API + Cilium. For customers who want ultimate ownership. Talks to the user's existing K8s or provisions new via Cluster API.

**D-4 — Regional sovereign-cloud partnerships (tier 1).** CtrlS (India) and OVHcloud (EU) as launch partners. Atlas deploys directly; billing flows through Atlas's unified bill; data resides in-region with documented residency guarantees.

**D-5 — Atlas Sovereign self-host.** The entire Atlas platform (conductor, roles, mirror, sandboxes) ships as a Helm chart the customer runs on their own Kubernetes. Skill library + compliance-evidence generators remain OSS; orchestrator and merge gates ship as a licensed container image. Price: custom, contact sales.

**D-6 — Compliance-evidence generators extended.** HIPAA + SOC2 Type II + DPDP-India + GDPR + ITAR evidence packs emit per build for sovereign-target workloads. Third-party integrations: Drata, Vanta, Secureframe receivers.

**D-7 — Atlas Migrate Enterprise tier launches.** Usage-based + annual contract. Unlimited migrations, named migration engineer, 24/7 pager. Pricing floor: ~$250K ARR per enterprise customer.

### Exit criteria

- At least one real customer migrated from hyperscaler → OpenStack sovereign target with zero downtime.
- Atlas Sovereign Helm chart deployed by ≥ 2 customers into their own infra.
- Three compliance-evidence packs accepted by real auditors (HIPAA + SOC2 + DPDP).
- Atlas Migrate Enterprise ARR ≥ $1M.

### Known risks

- **Partner dependency.** Regional clouds will be slower than hyperscalers. Atlas's pitch depends on not letting this become user-visible latency. Pre-commit to an SLA framework with each partner before go-live.
- **Licensing tension.** OSS skills + closed-source orchestrator is a common but fragile split. Clear written contributor license (Apache 2.0 for skills; separate commercial license for orchestrator) must be in place before D-5 public launch.
- **Regulatory variance.** DPDP-India is still being implemented; the ruleset could change before D-4 GA. Bake in a quarterly compliance-review cadence with regional legal counsel.

---

## Phase E — Migrate GA (Q1 2027)

**Mission:** Atlas Migrate exits alpha/enterprise-only and becomes broadly available for non-pilot customers with workloads on AWS / Azure / GCP / on-prem who want to move.

### Entry criteria

- Phase D exit criteria met.
- Three successful end-to-end real-customer migrations logged, including at least one hyperscaler-to-sovereign.
- Compliance-evidence auditor acceptance validated across HIPAA, SOC2, DPDP, GDPR.
- Migration Planner achieves ≥ 95% plan-success on the internal eval suite (100 synthetic migrations).
- Named migration-engineer bench of 5+ hires.

### Milestones

**E-1 — Migrate self-serve for Atlas-built apps.** Users who built their app on Atlas Build can click **Migrate** → choose target → confirm → go. The spec graph already describes the app; migration is "compile the graph against a different execution layer." Zero downtime by construction.

**E-2 — Migrate for non-Atlas-built apps (Brownfield onboarding, alpha).** Agentless discovery (AWS boto3 + Azure SDK + GCP client libs + VMware API + agentless network scan) inventories a running app. Reverse-engineering to a full spec graph is Phase F; in Phase E the agentless scan produces an **infra-only** spec graph (Region, Runtime, Dependency, Provider) sufficient for migration planning.

**E-3 — Migration playbook library.** Named playbooks per migration shape: hyperscaler-to-sovereign, on-prem-to-hyperscaler, Oracle-to-Postgres-on-OpenStack, Kafka-to-Redpanda, etc. Each playbook is a composition of skills (`discover-cloud-workload.md`, `migration-plan.md`, `zero-downtime-cutover.md`, `rollback-trigger.md`). OSS.

**E-4 — Cost optimiser integration.** The `cost-optimizer.md` skill runs during Visualize at migration scope — projects cost delta against target infra vs current, surfaces top 3 optimisation opportunities (right-sizing, reserved instances, storage tiering).

**E-5 — Migrate pricing GA.** Atlas Pro tier gets 10 migrations/quarter included. Atlas Migrate Enterprise pricing finalised with usage-based + annual hybrid.

**E-6 — Public-sector discount tier.** 70% discount for verified public-sector customers (government, public health, public education). Social Impact verification process from Phase A Builder tier is extended to Migrate tier.

### Exit criteria

- ≥ 50 real-customer migrations completed since GA.
- ≥ 5 migration playbooks published + adopted by community (external contributions merged).
- Cost optimiser surfaces average savings ≥ 25% per migration.
- Public-sector discount tier has ≥ 3 verified customers.
- Migrate Enterprise ARR ≥ $10M.

### Known risks

- **Self-serve edge cases.** Atlas-built apps self-serve is tractable; non-Atlas brownfield is not. Guard with clear UX: "we can migrate your app; complex environments may require an engagement."
- **Migration-engineer bench sustainability.** Enterprise migrations require people. At scale this is a services business with product tooling, not a pure-play product. Keep the bench sized such that tooling is always improving faster than customer count.
- **Regulatory divergence across migrations.** A SaaS migrating from EU to India has two regulatory contexts simultaneously. Compliance-evidence must cover both; review workflows must handle dual-jurisdiction cases.

---

## Phase F — Brownfield Discovery GA (H1 2027+)

**Mission:** Close the last gap. Legacy workloads that never touched Atlas can be reverse-engineered into a full spec graph and modernised continuously.

### Entry criteria

- Phase E exit criteria met.
- Brownfield infra-only discovery (from Phase E's E-2 alpha) has 95%+ accuracy on a 30-system eval.
- Research investment lane staffed with 2+ FTEs for 18 months.
- Named design-partner customers willing to provide legacy workloads as test subjects.

### Milestones

**F-1 — Full brownfield spec-graph inference.** AI Architecture Analysis reverse-engineers a spec graph from a running system. Accuracy targets:
- Infra nodes: 98%+ (already achieved in Phase E)
- App-layer nodes (Page, Route, Model, Endpoint): 85%+
- Flow + AuthBoundary inference: 75%+
- ComplianceClass inference: flagged-for-human-review (not auto-inferred)

F-1 is the research-grade milestone: it may ship in tiers (first with 60% accuracy as a preview; later with 85%+ as GA).

**F-2 — Brownfield-to-Atlas Build modernisation.** Once a brownfield system has a spec graph, users can run Atlas Build against it: "add a React frontend to this legacy API" invokes the Developer role against the existing spec, which emits diffs that land in the customer's repo via real Git. The modernisation arc is now a continuous path, not a rewrite.

**F-3 — FedRAMP Moderate.** The compliance authorisation that unlocks US federal public-sector contracts. Multi-quarter work. Atlas Sovereign customers get this inherited.

**F-4 — India DPDP Sovereign-Cloud Certified Partner programme.** Formal partnership with one or more Indian sovereign-cloud providers where Atlas is certified as a DPDP-compliant deployment path. Unlocks state-government contracts.

**F-5 — EU Cloud Services Scheme alignment.** Parallel to F-4; EUCS certification readiness.

**F-6 — Public launch of the Spec Graph open standard.** The Spec Graph schema (already OSS from Phase A) is formalised as an open standard through a working group (ideally under a neutral foundation like the Linux Foundation). Invite peers in the space (GitHub, Anthropic, Vercel, Hugging Face, CNCF) to adopt. Atlas benefits from standard gravity even while competing on orchestration.

### Exit criteria

- At least one real legacy workload reverse-engineered, modernised via Atlas Build, and shipped to production.
- FedRAMP Moderate obtained.
- DPDP + EUCS certifications obtained.
- Spec Graph open-standard working group formed with ≥ 3 external members.
- Brownfield discovery referenced in a Gartner / Forrester market analysis as a named capability.

### Known risks

- **Research unknowns.** F-1 is genuinely uncertain. It is listed as Phase F precisely because we do not know today whether 85% app-layer accuracy is achievable. If it isn't, F-1 ships as a co-pilot tool (human-in-the-loop) rather than an autonomous inference engine.
- **Certification timelines slip.** FedRAMP averages 18-24 months. Start the paperwork at Phase D, not Phase F.
- **Open-standard politics.** Peers may prefer their own format. The standard succeeds only if Atlas is willing to compromise the schema (e.g., accept edits from a working group) — which is a business decision, not just a technical one.

---

## Cross-phase themes

### Pricing discipline

Flat pricing survives only if unit economics do. Every phase must validate the margin envelope on heavy users. The usage telemetry + cost dashboards (Phase C) are the instrument; quarterly business-model reviews are the cadence. If a feature can't hold its margin at flat pricing, it becomes a Pro tier upsell — not a tier-gated scramble.

### Open-source cadence

The Atlas Skill Library is the flywheel. Every phase ships new skills OSS. Weekly patch releases, monthly minors. Community RFCs in the `atlas-skills` repo drive the roadmap for skill additions — a form of distributed product management that scales beyond Atlas's own engineering count.

### Compliance posture as product

Compliance evidence is not paperwork; it is a first-class feature that surfaces in the product UI, the export surface, and the enterprise sales motion. Every new compliance class added (Phase B adds 3; Phases D–F add more) follows the same pattern: human-authored baseline assertions + generator skill + evidence pack template. This discipline is the moat.

### Model-agnosticism

Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5 are today's models. Phase C will likely ship Opus 5 / Sonnet 5. The role dispatch (Phase A Unit D) must stay thin enough that a model rev is a config change, not a rewrite. Quarterly model-portfolio reviews assess whether defaults should rotate.

### The migration-as-selling-motion inversion

The conventional model is "acquire users with the builder; monetise with migration." Atlas's model is stronger: **migration itself acquires users**. Brownfield enterprises who can't move cheaply today will sign on for Atlas Migrate → and then find that Atlas Build can modernise their apps. The flywheel: Migrate draws in legacy; Build runs on top; Run hosts the result; Migrate is available if they outgrow Run.

This inversion is only possible because all four pillars share the Spec Graph. Without that, Migrate would be a separate tool with separate billing, and the flywheel would stall.

---

## The PRD-roadmap-plan loop

This roadmap lives under `docs/superpowers/plans/`. It is **not** the PRD. The PRD (`docs/ATLAS_PRD.md`) is the what + why; this roadmap is the when + sequence. Plans (`docs/superpowers/plans/2026-*-<unit>.md`) are the how.

When a phase approaches (T-minus-12-weeks), the relevant unit-level plans get authored from this roadmap, using `superpowers:writing-plans`. Open questions in the unit's section below get resolved before execution. New risks discovered during execution feed back into the PRD's §21 risk register.

The loop is: **PRD** (what) → **this roadmap** (when) → **unit plan** (how, near-term) → **execution** (subagent-driven-development or executing-plans) → **lessons** (back into PRD + roadmap).

Do not write task-level plans for phases beyond the next one. The cost of staleness exceeds the benefit.
