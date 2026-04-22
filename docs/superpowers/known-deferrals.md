# Known Deferrals

Engineering work that was consciously deferred during Phase A — tracked here so we don't forget. Each entry has a **trigger** (what condition makes us revisit) and an **owner-of-revisit** (who should pick it up).

This list is a complement to PRD §21 (which covers strategic risks); items here are tactical engineering follow-ups, not strategic uncertainties.

> **Note (2026-04-21):** Several Phase B/C entries below were rewritten following ADR-001 (OSS stack pivot — see `docs/adr/2026-04-21-oss-stack-pivot.md`). Closed-SaaS integrations (Stripe / Vercel / Neon / Sentry / Clerk) are no longer the default direction; their replacements are scoped per ADR-001.

---

## D1. E.5 Playwright e2e tests parse but don't actually run

**What:** The Playwright test suites authored in plan E.5 are syntactically valid but no run has executed them against the live atlas-web app. The CI workflow that would invoke them does not exist.

**Why deferred:** Requires (a) a CI environment with Clerk test-mode credentials, (b) a Postgres instance reachable from the runner, (c) a working E2B sandbox stub or fixture, (d) a Next.js dev server boot in the CI step. None of these were available at Phase A close.

**Risk if left:** Regressions in the ritual UI go undetected. The existing unit tests cover the components in isolation but not end-to-end flow.

**Trigger to revisit:** Either (a) when CI pipeline authoring lands in Phase B (likely first item), or (b) when a regression escapes to a beta tester.

**Owner-of-revisit:** Whoever takes the first Phase B "wire CI" task.

---

## D2. Postgres test flakiness in spec-graph-sync, spec-graph-ops, spec-graph-merge-driver

**What:** Periodic test failures in these three packages, observed across multiple branches during Phase A. Symptoms include connection reset errors, advisory-lock timeouts, and occasional row-version mismatches.

**Why deferred:** Each failure was reproducible only intermittently, and none blocked a merge (re-run usually passed). Root-causing required dedicated time we didn't have during plan execution.

**Risk if left:** Hides real concurrency bugs. CI signal becomes noisy and developers learn to ignore failures.

**Trigger to revisit:** Either (a) flake rate exceeds 1-in-5 runs on main, or (b) a real concurrency bug ships to production.

**Owner-of-revisit:** Owner of the package where the next confirmed failure lands. Suggested first investigation: connection-pool config + transaction-isolation level in test setup.

---

## ~~D3. ESLint warning in atlas-web~~ — CLOSED 2026-04-22

Closed by `77fc391`. `eslint.config.mjs` now uses `FlatCompat` from `@eslint/eslintrc` to bridge `eslint-config-next` 15's legacy configs into flat config, plus a `no-unused-vars` override honoring `_`-prefixed args/vars. Four real lint errors surfaced and fixed (`<a href="/">` → `<Link>`, unused `_projectId` / `_userId` params, one targeted `useEffect` deps suppression). `pnpm --filter atlas-web lint` reports clean.

---

## D4. drizzle-kit migrate hangs on Windows

**What:** `pnpm db:migrate` (and `npx drizzle-kit migrate`) hang indefinitely against the local Docker Postgres on Windows. Migrations 0004, 0005, 0006 had to be applied via direct psql / a one-off `pg.Pool` script.

**Why deferred:** Workaround exists (manual `psql < migration.sql`); investigating drizzle-kit internals on Windows wasn't worth blocking other work.

**Risk if left:** New team members on Windows hit the same wall. New migrations need manual application until fixed.

**Trigger to revisit:** Either (a) drizzle-kit ships a Windows-related bugfix in a future release, or (b) a new team member trips on it.

**Owner-of-revisit:** Whoever next runs into it. Workaround pattern is well-established now.

---

## D5. Skill-library OSS publish workflow not yet exercised end-to-end

**What:** Plan C.2 authored the GitHub Action that publishes `packages/skill-library/` to a public mirror on tag-push. The workflow has never run because no public mirror repo exists yet.

**Why deferred:** Creating the public `github.com/atlas-labs/atlas-skills` repo + setting up the deploy key + cutting the first tag is gated on the broader OSS launch decision (PRD §22.2 — "Public launch at Phase B close").

**Risk if left:** None until OSS launch. Workflow may have bugs that only surface on first real run.

**Trigger to revisit:** When the OSS launch decision is made (Phase B close per current roadmap).

**Owner-of-revisit:** Whoever owns the OSS launch.

---

## ~~D6. SpendReader exists but no spend events are recorded yet~~ — CLOSED 2026-04-22

Closed by `031c696`. `E2BLifecycle` now accepts an optional `SpendRecorder`; on terminate it computes duration × hourlyRateUsd and calls `record()`. Atlas-web `getSandboxFactory` wires `SandboxSpendRepo` (same pool as the reader) as the recorder. Hourly rate defaults to $0.017, overridable via `SANDBOX_HOURLY_RATE_USD`. Recorder failures are logged and swallowed so they never break terminate.

---

## D7. Python models.py regeneration for v1.1 schema

**What:** After merging B-1 (Spec Graph v1.1 — 5 new node kinds + 3 edges + 2 invariants), `packages/spec-graph-schema-py/src/spec_graph_schema/models.py` still reflects the v1.0 structure. The JSON Schema + invariant-codes artifacts in the Python package *are* synced to v1.1, so `drift-check` passes; only the generated Pydantic classes lag.

**Why deferred:** `pnpm py:gen` requires `uv` on PATH; the shell that executed B-1 didn't have uv available. Running `pnpm py:gen` from a shell with uv will regenerate models.py deterministically from the shared schema.

**Risk if left:** Python callers that import the new Region / DataResidency / Runtime / Provider / WorkloadTopology Pydantic classes will fail. v1.0 callers are unaffected.

**Trigger to revisit:** Either (a) a Python caller needs the new node kinds, or (b) next scheduled build on a machine with uv.

**Owner-of-revisit:** Whoever next touches `packages/spec-graph-schema-py/`. Command: `pnpm py:gen && pnpm py:check && pnpm py:test` from any shell with `uv` on PATH.

---

## ~~D8. AST mapping concrete implementation (TS Compiler API)~~ — CLOSED 2026-04-22

Closed by `031c696`. `buildTsCompilerMap` walks TS sources with the TypeScript compiler API; covers Page nodes (App Router `page.tsx` including `src/app/` and route-group variants) and Component nodes (exported function declarations whose name matches `component:<name>`). `buildTsCompilerAstMapper` convenience returns a `FileBackedAstMapper`. 14 tests pass. The atlas-web Canvas side panel will drop its "AST mapping not yet wired" notice when it's wired to consume this mapper (separate atlas-web follow-up).

Extension points for future mappers: Endpoint nodes (route.ts method exports), Model nodes (drizzle schema declarations), other framework layouts (Remix, Astro, SvelteKit).

---

## ~~D9. Postgres-branching adapter — schema-per-branch implementation~~ — CLOSED 2026-04-22

Closed by `0d53754` (C-1). `@atlas/postgres-branching` ships with `branchSchemaName` (deterministic hashed identifier), `PgBranchingAdapter` (ensure/drop/list, idempotent), and `replayMigrationsToSchema` (replays `.sql` files in numeric order against the branch schema's `search_path`). 9/9 tests pass.

---

## ~~D10. Deploy orchestrator — real KubernetesClient + CloudflareClient~~ — CLOSED 2026-04-22

Closed by `0d53754` (C-1 orchestrator + manifest emitters + Helm chart) and `031c696` (real HTTP clients).

- `K8sClientNodeClient` wraps `@kubernetes/client-node`'s `CustomObjectsApi` — apply/delete/argoApplicationHealth for Service + Application + Certificate. 12 tests.
- `HttpCloudflareClient` is a fetch-based Cloudflare v4 API wrapper for DNS record upsert/delete. 8 tests.
- `deploy/atlas-helm/` provisions namespaces + Cloudflare DNS-01 ClusterIssuer on top of Argo CD + Knative + cert-manager.

---

## ~~D11. Own monitoring stack — two layers per ADR-001 §4~~ — CLOSED 2026-04-22

Closed by `d61fde1` (C-2) + `031c696` (HttpGrafanaClient).

- **Platform telemetry:** `@atlas/observability` exports `initOtelSdk`, `initPromRegistry`, `createAtlasLogger` (pino + auto-stamped `trace_id` / `span_id`), canonical `ATLAS_ATTRS`. `deploy/atlas-helm/` Argo-reconciles kube-prometheus-stack + Loki + Tempo + Grafana with preconfigured data sources. OTel collector Deployment receives OTLP → fans out to Prom/Tempo/Loki.
- **User-app exception capture:** GlitchTip deployed via Argo CD; `deploy-orchestrator.orchestrator.glitchTipDsnFor(projectId)` injects `SENTRY_DSN` into the Knative Service env. Users opt out via `ATLAS_DISABLE_ERROR_TRACKING`.
- **Run dashboard:** `HttpGrafanaClient` (9 tests) is the real `GrafanaClient` implementation; the atlas-web Run page needs to instantiate it with a configured data-source proxy URL + Grafana API token (small atlas-web follow-up to replace the placeholder HealthSummary with a real query).

---

## D12. Keycloak self-host auth path — LIBRARY SHIPPED, atlas-web integration still pending

**Status 2026-04-22:** library landed in `77fc391`. `@atlas/auth-keycloak` provides `KeycloakAuthProvider` with OIDC code-flow (PKCE + refresh + `jose`-backed id_token verification). 15 tests pass.

**What remains:** atlas-web-side wiring to let the Clerk→Keycloak swap actually happen in self-host deployments. Specifically:
- Middleware that reads `ATLAS_FF_AUTH_KEYCLOAK` and routes `/auth/start` + `/auth/callback` to the Keycloak provider when enabled.
- Server helpers (`getCurrentUser`, `requireAuth`) that read from an encrypted session cookie in Keycloak mode instead of Clerk's context.
- Sign-in / sign-out pages that trigger the flow.
- Tests that the Clerk path still works when the flag is off (already true — default OFF).

**Why this split:** the library is genuinely provider-agnostic and testable today. The atlas-web wire-up is an opinionated refactor of routing + middleware + UI, best done as a focused plan when the first sovereign customer is imminent.

**Trigger to revisit:** when D-5 (Atlas Sovereign Helm) plan authoring begins, OR when the first sovereign customer signs.

**Owner-of-revisit:** Whoever owns the D-5 Helm-chart plan.

---

## D13. Kling video adapter (the only video provider for v1)

**What:** ADR-001 narrows the video-provider field from {Seedance, Kling, Veo, Runway} to **Kling only** for v1. Need a Kling SDK wrapper, gated by `ATLAS_FF_VIDEO_KLING`, plus the per-project cost cap.

**Why deferred:** Needs Kling API credentials + the cost-cap policy decision before any code lands.

**Risk if left:** B-6 (video generation adapter) cannot ship.

**Trigger to revisit:** When Kling API credentials are obtained.

**Owner-of-revisit:** Whoever owns B-6 implementation.

---

## How to use this file

- **When picking up a deferral:** delete its section once the work merges. Don't leave "completed" entries; this file is current state, not history.
- **When deferring something new:** append a section using the same template. Be explicit about the trigger — "someday" is not a trigger.
- **When reviewing the file:** if a deferral has been here > 6 months and no trigger has fired, that's a signal to either action it or accept it as permanent (and remove it).
