# ADR-001 — OSS Stack Pivot

**Status:** Accepted
**Date:** 2026-04-21
**Decider:** Birju (founder)
**Supersedes:** Original Phase B–F roadmap defaults that named Stripe / Vercel / Neon / Sentry as primary integrations.

## Context

PRD §22.1 positions Atlas as the "Escape hyperscalers" platform for sovereign + OSS-friendly customers. The Phase B–F roadmap as originally written named several closed-SaaS providers as primary integration targets:

- **Neon** as the managed Postgres + branching layer
- **Vercel** as the deploy target for the Ship pipeline
- **Stripe** as the default payments processor in the Ship wiring
- **Sentry** as the error-tracking surface
- **Figma** as the second design importer (after Claude Design)
- **Clerk** for atlas-web auth (already shipped in E.2)
- A panel of **video providers** (Seedance / Kling / Veo / Runway) for B-6

A platform whose pitch is sovereignty cannot simultaneously default to closed-SaaS infrastructure. Sovereign-cloud customers (Phase D entry criteria — CtrlS / OVHcloud / Liquid Telecom) will not adopt a Neon/Vercel-locked stack. The original choices reflected expedience, not strategy.

## Decision

| Original | Replacement | Rationale |
|---|---|---|
| **Neon** | Plain OSS Postgres (already in use for `@atlas/spec-graph-data`); Neon's branching feature replaced by a Postgres-branching adapter (schema-per-branch initially; container-per-branch for full isolation when needed) | Postgres is universal; sovereign customers already operate it |
| **Vercel** | Own infrastructure — Kubernetes-based PaaS. Specific OSS PaaS choice (Coolify / Dokploy / CapRover) deferred to a dedicated investigation; near-term path is K8s + Caddy + Cloudflare-or-OSS CDN | Vercel's edge runtime is a lock-in vector; own infra preserves portability |
| **Stripe (default)** | Provider-abstract payments layer; Stripe is one option behind the abstraction, **feature-flagged**, never the only choice | `@atlas/payments-hardening` already provider-abstract; integration follows |
| **Sentry** | Own monitoring stack — OpenTelemetry collector + Prometheus + Grafana + Loki + a Sentry-compatible OSS error sink (GlitchTip is the obvious candidate; final choice deferred) | Aligns with the existing `prom-client` patterns in Atlas role packages |
| **Figma importer** | Feature-flag only — UI present, action gated. Do not implement now | User explicitly deferred Figma; Claude Design importer covers the v1 case |
| **Video providers (4)** | **Kling only** for v1 | Single-provider path keeps cost-cap math tractable |
| **Clerk** | **Keycloak** as the OSS path; Clerk may remain for hosted-dev convenience but is **not** the sovereign deployment's auth provider | Keycloak is the de-facto OSS OIDC/SAML choice for self-host |

## Consequences

### Positive
- Atlas Sovereign (Phase D-5) becomes realistic — no closed-SaaS dependency in the critical path.
- The "Escape hyperscalers" pitch is technically defensible.
- License-clean: every component below the orchestrator can ship Apache 2.0.

### Negative
- More infrastructure to operate. Atlas Run loses the "Vercel handles it" leverage; the team owns build + runtime + CDN policy.
- Auth migration (Clerk → Keycloak in self-host) is non-trivial. Hosted-dev keeps Clerk for now to avoid disrupting Phase A users.
- Single video provider (Kling) is a single point of failure. Mitigation: keep the adapter interface generic so a second provider can be added when the cap-economics question is settled.

### Schedule impact
- B-2 (cloud_migration fusion) gets larger because the fused codebase needs to interop with the OSS stack rather than the cloud_migration's existing assumptions.
- C-1 (one-click deploy) shifts from "wire Vercel" to "build a deploy orchestrator over our own K8s + CDN". Larger scope; accept the slip.
- D-5 (Atlas Sovereign Helm chart) gets faster because the OSS-first stack is the same chart used for hosted Atlas.

## Open questions

1. **Which K8s PaaS layer?** Coolify, Dokploy, CapRover, or roll-our-own. Decision before C-1 plan authoring.
2. **CDN choice.** Caddy + Cloudflare-OSS, or BunnyCDN, or self-hosted Varnish at the regional partners. Decision before C-2 plan authoring.
3. **Postgres branching strategy.** Schema-per-branch is cheap but leaks shared catalog locks. Container-per-branch is clean but expensive. Hybrid (schema-per-dev-branch, container-per-prod-branch) is likely correct. Decision before the Postgres-branching adapter plan.
4. **GlitchTip vs roll-our-own error sink.** Decision before C-2 plan authoring.

These are **plan-authoring questions**, not implementation blockers — they need answers before the relevant Phase C plan is written.

## Implementation today (this commit)

1. **Memory persisted** — `stack_oss_pivot.md` records this decision for future Claude sessions.
2. **`known-deferrals.md` updated** — D2/D3/D5 entries replaced; new entries reflect the OSS direction with concrete next-step triggers.
3. **Feature flag scaffold** — `apps/atlas-web/lib/feature-flags.ts` introduces FIGMA_IMPORTER and STRIPE_PAYMENTS flags wired to env. Defaults: both off.
4. **No code removed.** Existing Stripe / Neon / Vercel references in shipped Phase A code stay. New work follows the new direction.
