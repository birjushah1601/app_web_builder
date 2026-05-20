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

## ~~D2. Postgres test flakiness in spec-graph-sync, spec-graph-ops, spec-graph-merge-driver~~ — CLOSED 2026-04-22

Closed by `aa781c9`. Root cause identified: all four DB-integration packages (`spec-graph-data`, `spec-graph-sync`, `spec-graph-merge-driver`, `spec-graph-ops`) were dropping and recreating the shared `public` schema in globalSetup. `pnpm -r test` runs them in parallel, so one package's DROP would land mid-way through another package's migration replay.

Fix: each package now migrates into a package-scoped schema (`test_spec_graph_data`, `test_spec_graph_sync`, etc.). globalSetup rewrites `DATABASE_URL_TEST` with `?options=-c search_path=<pkg_schema>,public` so downstream test code picks up the scoped schema automatically. `public` stays in search_path for extensions (pgcrypto/gen_random_uuid) and for `spec-graph-ops`'s SECURITY DEFINER helper.

Verified green: `pnpm -r test` now completes with 0 non-zero exits across all 32 packages (previously had 2–3 flaky failures in the three named packages).

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

## D5. Skill-library OSS publish workflow — AUTHORED 2026-04-22, awaiting public repo

**Authoring landed in `9d1d1c3`.** `.github/workflows/skill-library-release.yml` now does end-to-end mirroring when the push secret is present: validate source tree → build tarball → clone public repo → `rsync --delete` skills + LICENSE + README → commit (skipping empty diffs) → tag → push. Falls back to just the tarball artifact + a setup-reminder notice when `ATLAS_SKILLS_PUBLIC_PUSH` is absent, so PR runs and uninitialized public repos don't fail the job.

**What remains (credential-bound, not engineering):**
1. Create `github.com/atlas-labs/atlas-skills` as a public repo with an initial commit on `main`.
2. Generate a fine-grained PAT (or deploy key) with write access to the public repo.
3. Store it as secret `ATLAS_SKILLS_PUBLIC_PUSH` on this monorepo.
4. `workflow_dispatch` the release workflow once to exercise the path, OR cut a `skill-library-vX.Y.Z` tag.

**Trigger to revisit:** when the OSS launch decision is made (PRD §22.2 — public launch at Phase B close).

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

## ~~D12. Keycloak self-host auth path~~ — CLOSED 2026-04-22 (library + atlas-web wiring)

Library closed in `77fc391` (`@atlas/auth-keycloak`); atlas-web wiring closed in `579c258`:

- `apps/atlas-web/lib/auth/session-cookie.ts` — HMAC-SHA256 sealed cookie, 32-char min secret, `timingSafeEqual` compare. 8 tests.
- `apps/atlas-web/lib/auth/current-user.ts` — `getCurrentUser()` dispatcher: Clerk by default, Keycloak-cookie-backed when `ATLAS_FF_AUTH_KEYCLOAK=1`. 6 tests.
- `apps/atlas-web/app/auth/start/route.ts` — redirect to Keycloak authorize URL + transit cookies. 3 tests.
- `apps/atlas-web/app/auth/callback/route.ts` — state check, code exchange, seal session, clear transit cookies, same-origin `return_to` support. 8 tests.
- `apps/atlas-web/app/auth/logout/route.ts` — clear session, redirect `/`. 2 tests.

Feature flag default OFF — existing Clerk integration is untouched. Sovereign deploys set `ATLAS_FF_AUTH_KEYCLOAK=1`, `KEYCLOAK_*` envs, and a ≥32-char `ATLAS_SESSION_SECRET`.

**One follow-up (not a deferral, just mechanical cleanup):** existing Server Actions use Clerk's `auth()` directly instead of the new `getCurrentUser()`. A sweep to migrate ~30 call sites would make both backends work uniformly. Defer until the first sovereign customer — the dispatcher is already in place for all new code.

---

## D13. Kling video adapter — LIBRARY AUTHORED 2026-04-22, consumer-side wiring pending

**Library landed in `dc66a9d`.** `@atlas/video-kling` provides `KlingClient.submit/getJob` (injectable fetch, schema-validated), `checkKlingCostCap` (per-project monthly USD cap, warn + hard-cap thresholds), and the full error class hierarchy. 22 tests pass against mocks.

**What remains (external-credential-bound):**
1. Kling API credentials in hand (`KLING_API_KEY`).
2. atlas-web Server Action that submits + polls + records `usageUsd` into the spend ledger + persists the resulting `MediaAsset` node — gated behind `ATLAS_FF_VIDEO_KLING`.
3. atlas-web UI surface (prompt box, status streaming, preview) — gated behind the same flag.

**Trigger to revisit:** when Kling API credentials are obtained.

**Owner-of-revisit:** Whoever owns B-6 implementation.

---

## D14. Diff-parser writes next file's header into previous file's content

**What:** `apps/atlas-web/lib/sandbox/apply-diff.ts` (likely in `repairCreateHunkCounts` or via the `parse-diff` library's chunk attribution) sometimes writes the literal `diff --git a/<next-file> b/<next-file>` header into the PREVIOUS file's content when the developer emits a multi-file unified diff. Symptom: sandbox compile fails with `Expected ';', '}' or <eof>` and the line where the broken file ends with `}\ndiff --git a/...`. Captured 2026-05-20 on project `364a0b20-4e86-47ab-ad6d-c0d57ec6f237` (Saffron Table) — layout.tsx got globals.css's diff header appended verbatim. `parsed=4 failed=0 skipped=0` reported success even though the content was malformed.

**Why deferred:** Discovered late in a long session; needs (a) a captured real broken diff string from a future ritual to write a regression test, then (b) targeted fix in `collectAddedLines` / `repairCreateHunkCounts` to recognize and stop at the next file's `diff --git` boundary even when the LLM emits malformed chunk-line counts.

**Risk if left:** Every multi-file generation has a non-trivial chance of shipping a broken syntactic preview. The Plan L0 build gate (D15) catches the *symptom* but not the *root cause*; with build-gate ON, the auto-fix loop will eat the latency budget retrying because the developer can't "fix" code it didn't write incorrectly.

**Trigger to revisit:** Next session. This is the highest-priority bug from 2026-05-20.

**Owner-of-revisit:** Whoever picks up post-merge stabilization of the Plan L0 work.

---

## D15. ATLAS_FF_BUILD_GATE is OFF in .env.local pending dogfood

**What:** Plan L0 (Build Gate) merged 2026-05-20 (`b56a871`) but the flag is set to `false` in `apps/atlas-web/.env.local`. The gate code is wired, tested, and live in main; it just doesn't engage on local rituals until the flag is flipped. Default-in-code stays OFF (consistent with all Atlas flags).

**Why deferred:** During the 2026-05-20 smoke, the gate's adapter shipped with a `cd /code` fix (`c74b0e9`) AFTER the dev-server cache had been warm; rather than restart the dev server one more time to verify end-to-end with the fix, the session ended with the flag flipped OFF to restore the working baseline for the demo.

**Risk if left:** The build gate's main value (catching uncompilable code AS the model emits it) doesn't materialize until the flag is on. Closely coupled with D14 — fixing the diff-parser bug AND enabling the gate together would prevent the entire class of broken-preview failures.

**Trigger to revisit:** Next session. Enable concurrently with D14 fix to get one clean end-to-end verification.

**Owner-of-revisit:** Same as D14.

---

## D16. Designer schema rejects empty serifFamily — ~30% of rituals retry

**What:** `packages/role-designer/src/types.ts` defines `serifFamily: z.string().min(1)` in `DesignProposal.tokens.typeScale`. The model frequently emits an empty string for `serifFamily` (it correctly identifies that the chosen design has no serif font). Zod rejects → `role.failed` → Plan L auto-fix retries the entire designer 3-pass. Observed ~3 retries across 2026-05-19/20 smoke (Aureline, PulseFit, Saffron Table). Each retry adds 60-90s to the chain.

**Why deferred:** Out of build-gate scope; identified during the smoke as a pre-existing schema-strictness issue with the designer role. Quick fix is to change `.min(1)` → `.optional()` on `serifFamily` (and arguably also `monoFamily` since some designs are sans-only).

**Risk if left:** Every ritual has a ~30% chance of paying ~60-90s of designer-retry latency. Compounds with D15 (build-gate OFF means no auto-fix recovery on build-gate failures either) to make ritual latency unpredictable.

**Trigger to revisit:** Next session. ~5-line change.

**Owner-of-revisit:** Designer role maintainer.

---

## D17. Canvas hooks miss SSE events on reconnect — UI hydration is fragile

**What:** `useCanvasManifest` / `useDesignerProposal` (`apps/atlas-web/lib/canvas/`) read events from `useEventStream()` which subscribes to the EventBroker via EventSource. On page navigation, server restart, or HMR the EventSource reconnects with Last-Event-ID; if the broker's 200-event ring buffer has rolled past the relevant events, OR if the connection takes seconds to establish AND the events fired during that gap, the hooks return `null` for manifest/proposal even though the events were broadcast. Symptom: canvas shows EmptyCanvas / "Ritual not started" or no design-option cards, even though the conductor log confirms events emitted.

**Why deferred:** Investigated during 2026-05-20 smoke; the root fix (have the canvas page's server component fetch the latest snapshot from `SpecEventRepo` and pass `initialEvents` to `<EventSourceProvider>`) is a substantive change crossing the server/client boundary. Workaround for now: 2026-05-20 commit `9580d89` makes the manifest-mode ModeToggle ALWAYS visible (drops the `?canvas-modes=show` gate) so the user has manual recovery when auto-switch fails.

**Risk if left:** Every UX regression report ("I don't see the X") will start with "did the EventSource reconnect" diagnostic. UI feels flaky.

**Trigger to revisit:** When the canvas UX is the next-priority workstream. Probably after D14/D15/D16.

**Owner-of-revisit:** Whoever owns Plan S.4 / canvas-runtime maintenance.

---

## D18. Performance hotspots — designer 3-pass + developer + sandbox provisioning

**What:** End-to-end ritual latency on 2026-05-20 measured at Postgres: ~9 minutes total engine work per ritual (excluding user-click time). Three dominant phases: designer 3-pass (~150-220s, doubles to 300-400s on schema retry per D16), asset-gen + developer + sandbox provisioning (~230-300s — sandbox cold-start is the worst offender at 60-300s), and architect deep-plan + researcher brief (~30-50s). Detailed recommendations captured in the 2026-05-20 session transcript. Top single-action wins: pre-warm sandbox on project creation (saves 60-300s first-ritual-per-project), swap designer-revise from Sonnet 4.5 to Haiku 4.5 (saves 15-20s per ritual), move repo from `/mnt/f/` to native Linux filesystem (5-30× faster Turbopack compiles per route).

**Why deferred:** Perf workstream is separate from stabilization. Should land AFTER D14/D15/D16 fix the correctness bugs that currently mask perf signal.

**Risk if left:** User-perceived latency stays high; demoing to a customer requires lots of "this normally takes ~9 minutes" framing.

**Trigger to revisit:** Once the correctness bugs (D14-D17) are closed.

**Owner-of-revisit:** Performance workstream.

---

## How to use this file

- **When picking up a deferral:** delete its section once the work merges. Don't leave "completed" entries; this file is current state, not history.
- **When deferring something new:** append a section using the same template. Be explicit about the trigger — "someday" is not a trigger.
- **When reviewing the file:** if a deferral has been here > 6 months and no trigger has fired, that's a signal to either action it or accept it as permanent (and remove it).
