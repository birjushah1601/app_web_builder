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

## D3. ESLint warning in atlas-web for `eslint-config-next/core-web-vitals`

**What:** Cosmetic ESLint warning during atlas-web lint, originating from a config-resolution edge case in `eslint-config-next`.

**Why deferred:** Cosmetic only; lint passes overall. Fix requires either a Next.js minor bump or a workaround in `.eslintrc`.

**Risk if left:** None functionally. New developers may waste time chasing the warning.

**Trigger to revisit:** Next time atlas-web's Next.js version is bumped, or when a developer files an issue about it.

**Owner-of-revisit:** atlas-web maintainer.

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

## D6. SpendReader exists but no spend events are recorded yet

**What:** `SandboxSpendRepo.record()` is implemented and wired into atlas-web's factory, but nothing in the codebase calls `record()` after a sandbox provision. The cap check therefore always sees 0 spend.

**Why deferred:** Recording spend requires either polling E2B's billing API (rate-limited, no real-time hook) or instrumenting the lifecycle.terminate path with a duration estimate. Neither was scoped into E.4.

**Risk if left:** Spend cap is non-functional in practice. A runaway project could accumulate real E2B charges with no cap enforcement.

**Trigger to revisit:** Before atlas-web admits real (non-internal) users, OR when E2B billing API integration is scoped.

**Owner-of-revisit:** Whoever owns the next sandbox-related plan (likely a Phase B "billing + cap enforcement" unit).

---

## D7. Python models.py regeneration for v1.1 schema

**What:** After merging B-1 (Spec Graph v1.1 — 5 new node kinds + 3 edges + 2 invariants), `packages/spec-graph-schema-py/src/spec_graph_schema/models.py` still reflects the v1.0 structure. The JSON Schema + invariant-codes artifacts in the Python package *are* synced to v1.1, so `drift-check` passes; only the generated Pydantic classes lag.

**Why deferred:** `pnpm py:gen` requires `uv` on PATH; the shell that executed B-1 didn't have uv available. Running `pnpm py:gen` from a shell with uv will regenerate models.py deterministically from the shared schema.

**Risk if left:** Python callers that import the new Region / DataResidency / Runtime / Provider / WorkloadTopology Pydantic classes will fail. v1.0 callers are unaffected.

**Trigger to revisit:** Either (a) a Python caller needs the new node kinds, or (b) next scheduled build on a machine with uv.

**Owner-of-revisit:** Whoever next touches `packages/spec-graph-schema-py/`. Command: `pnpm py:gen && pnpm py:check && pnpm py:test` from any shell with `uv` on PATH.

---

## D8. AST mapping concrete implementation (TS Compiler API)

**What:** B-3 ships the architectural skeleton for AST visual edit mode: the `@atlas/ast-mapper` package interfaces, `AstMapFile` schema, `MutationProposal` schema, and a `NullAstMapper` that returns `undefined` for every node. The Canvas UI surfaces an explicit "AST mapping not yet wired" notice in the SelectedNodePanel. The concrete `TsCompilerAstMapper` that walks `tsc` AST + maps source ranges → graph nodes is not yet built.

**Why deferred:** Building the TS Compiler integration is a substantial task in its own right — it needs a heuristic that maps Page nodes to App Router file paths, Component nodes to JSX export sites, Endpoint nodes to route handler signatures, etc. Each language/framework gets its own concrete mapper. Doing this well requires its own plan (~15 tasks). Shipping the skeleton + Canvas selection now unblocks the UX iteration.

**Risk if left:** Atlas users see "AST mapping not yet wired" in the side panel. The full B-3 promise — "edits at Agree become typed graph mutations that regenerate just the affected component" — is not yet executable.

**Trigger to revisit:** When the UX validates that click-to-select is the right interaction (which we'll learn from the first 5–10 hero projects), prioritize the concrete mapper.

**Owner-of-revisit:** Whoever owns the next atlas-web canvas iteration. Suggested first concrete mapper: TS + Next.js App Router (the dominant Atlas template).

---

## D9. Postgres-branching adapter (Neon replacement)

**What:** ADR-001 replaces Neon with plain OSS Postgres. Neon's killer feature was per-branch ephemeral databases. We need an equivalent: a `BranchingPostgresAdapter` interface with at least one concrete implementation (schema-per-branch is the cheap path; container-per-branch is the clean-isolation path).

**Why deferred:** Adapter design is plan-authoring work, not implementation. Needs the open question from ADR-001 §"Open questions" #3 answered first.

**Risk if left:** Phase C-1 (one-click deploy) cannot ship until preview-branch databases work.

**Trigger to revisit:** Before authoring the C-1 plan.

**Owner-of-revisit:** Whoever owns C-1 plan authoring.

---

## D10. K8s PaaS layer choice (Vercel replacement)

**What:** ADR-001 replaces Vercel with own infrastructure on K8s. Need a decision on whether to use an OSS PaaS (Coolify / Dokploy / CapRover) or build a thin orchestration layer over plain K8s + Caddy + a CDN.

**Why deferred:** This is an architecture-investigation task, not implementation. ADR-001 §"Open questions" #1.

**Risk if left:** C-1 (one-click deploy) cannot be scoped without this decision.

**Trigger to revisit:** Before authoring the C-1 plan.

**Owner-of-revisit:** Founder + tech lead. Recommend a 1-week spike comparing the three OSS PaaS options + a "DIY on K8s" option.

---

## D11. Own monitoring stack (Sentry replacement)

**What:** ADR-001 replaces Sentry with an own-monitoring stack: OpenTelemetry collector + Prometheus + Grafana + Loki + a Sentry-compatible OSS error sink (GlitchTip is the candidate). Needs concrete deployment + Atlas integration plan.

**Why deferred:** Decision-and-deploy task, not implementation in atlas-web. ADR-001 §"Open questions" #4.

**Risk if left:** C-2 (Atlas Run observability dashboard) cannot ship without telemetry pipes wired.

**Trigger to revisit:** Before authoring the C-2 plan.

**Owner-of-revisit:** Whoever owns C-2 plan authoring. The `prom-client` patterns already in role-* packages give a starting point.

---

## D12. Keycloak self-host auth path (alongside Clerk)

**What:** ADR-001 keeps Clerk for hosted-dev convenience but mandates Keycloak (or another OSS OIDC/SAML provider) for sovereign / self-host deployments. Need a Keycloak adapter for atlas-web's auth surface, gated by `ATLAS_FF_AUTH_KEYCLOAK`.

**Why deferred:** Auth swap is a substantial atlas-web refactor (Clerk middleware, session helpers, user-management UI). Worth doing as a focused unit.

**Risk if left:** Atlas Sovereign (D-5) cannot ship without OSS auth.

**Trigger to revisit:** When D-5 plan authoring begins, OR when the first sovereign customer signs.

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
