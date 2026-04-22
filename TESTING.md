# Atlas Testing Runbook

How to verify every piece of Atlas yourself. Read top-to-bottom, or jump to the section that covers what you just changed.

---

## TL;DR — the one command

```bash
pnpm -r test
```

Runs every package's unit tests in parallel. The Postgres-integration tests in `@atlas/spec-graph-data` and `@atlas/postgres-branching` need a running local Postgres (see Section 2); everything else is pure Node.

---

## 0. First-time setup

```bash
# from repo root
pnpm install
docker compose up -d postgres
pnpm --filter @atlas/spec-graph-data db:migrate    # applies 0000..0006 to atlas_test
```

If `db:migrate` hangs (drizzle-kit on Windows), apply the remaining migrations via psql — see D4 in `docs/superpowers/known-deferrals.md`.

**Required env vars for integration tests:**

```bash
# .env (or export before running)
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5433/atlas_test
```

The rest of this document assumes `DATABASE_URL_TEST` is set. For PowerShell: `$env:DATABASE_URL_TEST = "postgresql://atlas:atlas@localhost:5433/atlas_test"`.

---

## 1. Quick per-package test commands

| Package | Command | Needs DB | Notes |
|---|---|---|---|
| `@atlas/spec-graph-schema` | `pnpm -F @atlas/spec-graph-schema test` | No | 204 tests — nodes, edges, 16 invariants, JSON Schema artifact |
| `@atlas/spec-graph-schema-py` | `pnpm py:test` | No | Python — needs `uv` on PATH (see D7) |
| `@atlas/spec-graph-data` | `pnpm -F @atlas/spec-graph-data test` | **Yes** | Drizzle + repos + integration |
| `@atlas/spec-graph-sync` | `pnpm -F @atlas/spec-graph-sync test` | **Yes** | File ↔ DB sync daemon |
| `@atlas/spec-graph-merge-driver` | `pnpm -F @atlas/spec-graph-merge-driver test` | **Yes** | Git merge driver |
| `@atlas/spec-graph-ops` | `pnpm -F @atlas/spec-graph-ops test` | **Yes** | Compaction + offline mode |
| `@atlas/skill-runtime` | `pnpm -F @atlas/skill-runtime test` | No | Skill loader + registry |
| `@atlas/skill-library` | `pnpm validate:skills` | No | Frontmatter validator over all 52 skills |
| `@atlas/test-generator-registry` | `pnpm -F @atlas/test-generator-registry test` | No | Human-baseline assertions |
| `@atlas/conductor` | `pnpm -F @atlas/conductor test` | No | Orchestrator + LLM provider abstraction |
| `@atlas/llm-provider` | `pnpm -F @atlas/llm-provider test` | No | Anthropic + Google stubs with retry + circuit breaker |
| `@atlas/role-architect` | `pnpm -F @atlas/role-architect test` | No | Two-pass Architect role |
| `@atlas/role-developer` | `pnpm -F @atlas/role-developer test` | No | Parallel Sonnet+Gemini voting |
| `@atlas/role-security` | `pnpm -F @atlas/role-security test` | No | L4 gate |
| `@atlas/role-accessibility` | `pnpm -F @atlas/role-accessibility test` | No | L5 gate |
| `@atlas/role-browser-verification` | `pnpm -F @atlas/role-browser-verification test` | No | L3 gate |
| `@atlas/role-migration-planner` | `pnpm -F @atlas/role-migration-planner test` | No | Migration Planner alpha |
| `@atlas/ritual-engine` | `pnpm -F @atlas/ritual-engine test` | No | Visualize→Agree→Build state machine |
| `@atlas/bootstrap-checkpoint` | `pnpm -F @atlas/bootstrap-checkpoint test` | **Yes** | 6-item checklist |
| `@atlas/gate-scheduler` | `pnpm -F @atlas/gate-scheduler test` | No | Edit classifier + sync/async gate scheduler |
| `@atlas/latency-harness` | `pnpm -F @atlas/latency-harness test` | No | P50/P95 sliding window |
| `@atlas/sandbox-e2b` | `pnpm -F @atlas/sandbox-e2b test` | No | E2B lifecycle + spend recorder |
| `@atlas/slo-engine` | `pnpm -F @atlas/slo-engine test` | No | Burn-rate calculator |
| `@atlas/payments-hardening` | `pnpm -F @atlas/payments-hardening test` | No | Idempotency + webhook signature |
| `@atlas/audit-log` | `pnpm -F @atlas/audit-log test` | No | Audit event sink |
| `@atlas/postgres-branching` | `pnpm -F @atlas/postgres-branching test` | **Yes** | Schema-per-branch adapter |
| `@atlas/deploy-orchestrator` | `pnpm -F @atlas/deploy-orchestrator test` | No | K8s + Cloudflare clients + orchestrator |
| `@atlas/observability` | `pnpm -F @atlas/observability test` | No | OTel + Prom bootstraps |
| `@atlas/run-dashboard` | `pnpm -F @atlas/run-dashboard test` | No | Health + endpoint stats + HttpGrafana |
| `@atlas/auth-keycloak` | `pnpm -F @atlas/auth-keycloak test` | No | OIDC code-flow provider |
| `@atlas/ast-mapper` | `pnpm -F @atlas/ast-mapper test` | No | TS Compiler AST mapper |
| `atlas-web` | `pnpm -F atlas-web test` | No | Vitest component + unit tests |
| `atlas-web` e2e | `pnpm -F atlas-web test:e2e` | **Yes** | Playwright — see Section 6 |

Typecheck everything: `pnpm -r typecheck`. Build everything: `pnpm -r build`.

---

## 2. Local Postgres for integration tests

```bash
docker compose up -d postgres        # starts atlas-postgres container on :5433
docker compose ps                    # should show atlas-postgres (healthy)
docker compose exec postgres psql -U atlas -d atlas_test -c "\dt"
# Expected tables:
#   bootstrap_checkpoints | sandbox_spend_log | spec_events
#   spec_graphs           | spec_snapshots    | user_project_preferences
```

If tables are missing, run migrations:

```bash
# happy path
DATABASE_URL=postgresql://atlas:atlas@localhost:5433/atlas_test \
  pnpm -F @atlas/spec-graph-data db:migrate
```

**Windows workaround (drizzle-kit hangs):**
```bash
for f in packages/spec-graph-data/drizzle/0*.sql; do
  docker compose exec -T postgres psql -U atlas -d atlas_test < "$f"
done
```

**Clean slate:** `docker compose down -v && docker compose up -d postgres` then re-migrate.

---

## 3. Testing specific features end-to-end

### 3.1 Spec Graph invariants (I01–I16)

```bash
pnpm -F @atlas/spec-graph-schema build           # emits dist/schema/spec-graph.v1.schema.json
pnpm -F @atlas/spec-graph-schema test            # 204 tests; includes all 16 invariant checks
cat packages/spec-graph-schema/dist/schema/invariant-codes.json
# Expected: 19 codes (I01..I16 with I04+I07+I08 each contributing 2 codes)
```

### 3.2 Human-authored baseline assertions (C.3)

```bash
pnpm -F @atlas/test-generator-registry build
node tools/test-gen-cli.mjs baseline list
# Expected:
#   authboundary: 3 assertions
#   compliance: 1 assertions
#   pii-model: 2 assertions

node tools/test-gen-cli.mjs baseline show authboundary
```

### 3.3 Atlas Run deploy orchestrator (C-1) — in-memory smoke

```bash
# The orchestrator tests run entirely against InMemoryKubernetesClient + InMemoryCloudflareClient.
pnpm -F @atlas/deploy-orchestrator test
# 53 tests — includes happy-path, rollback-on-Degraded, SENTRY_DSN injection,
# K8s client patch/create/delete/404 handling, Cloudflare upsert/delete/zone-caching.
```

Against a real cluster (optional, requires `k3d` + a kubeconfig):

```bash
# 1. Spin up local K8s
k3d cluster create atlas-local --servers 1
k3d kubeconfig get atlas-local > ~/.kube/atlas-local.kubeconfig
export KUBECONFIG=~/.kube/atlas-local.kubeconfig

# 2. Install Argo CD + Knative + cert-manager (see deploy/atlas-helm/README.md)

# 3. Install the Atlas cluster glue
helm install atlas-cluster ./deploy/atlas-helm

# 4. Smoke-test the orchestrator via a short script using K8sClientNodeClient:
#    See packages/deploy-orchestrator/test/integration-k3d.test.ts (skip-by-default,
#    enable by setting ATLAS_K3D_CONTEXT=atlas-local)
ATLAS_K3D_CONTEXT=atlas-local pnpm -F @atlas/deploy-orchestrator test
```

### 3.4 Postgres schema-per-branch (C-1)

```bash
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5433/atlas_test \
  pnpm -F @atlas/postgres-branching test
# 9 tests: branchSchemaName determinism + safety, ensureBranch idempotent,
# dropBranch idempotent, replayMigrationsToSchema creates spec_graphs in br_*.

# Inspect branches Postgres-side:
docker compose exec postgres psql -U atlas -d atlas_test -c \
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'br_%';"
```

### 3.5 Observability stack (C-2) — platform telemetry

```bash
pnpm -F @atlas/observability test                # 10 tests — OTel, Prom registry, atlas logger
pnpm -F @atlas/run-dashboard test                # 26 tests — dashboard computers + HttpGrafanaClient
```

Against a real Grafana (optional):

```bash
# point HttpGrafanaClient at a live Grafana datasource proxy
# (requires a Grafana service account token with read on the Prometheus datasource)
node -e '
  import("@atlas/run-dashboard").then(async ({ HttpGrafanaClient }) => {
    const c = new HttpGrafanaClient({
      baseUrl: "https://grafana.example.com/api/datasources/proxy/uid/prometheus",
      token: process.env.GRAFANA_TOKEN
    });
    console.log(await c.queryInstant({ query: "up" }));
  });
'
```

### 3.6 Sandbox spend recording (D6)

```bash
pnpm -F @atlas/sandbox-e2b test                  # 28 tests incl. 5 spend-recording
# Look for: "E2BLifecycle spend recording > records spend on terminate when spendRecorder is configured"
```

Verify end-to-end against real Postgres:

```bash
DATABASE_URL=postgresql://atlas:atlas@localhost:5433/atlas_dev pnpm -F @atlas/spec-graph-data test sandbox-spend-repo
# Inspect recorded spend:
docker compose exec postgres psql -U atlas -d atlas_dev -c \
  "SELECT project_id, sandbox_id, usd_amount, occurred_at FROM sandbox_spend_log ORDER BY occurred_at DESC LIMIT 10;"
```

### 3.7 AST mapper (D8)

```bash
pnpm -F @atlas/ast-mapper test                   # 23 tests — 14 for TsCompilerAstMapper
```

Smoke-test against atlas-web itself (the mapper should find Pages + Components):

```bash
node -e '
  import("@atlas/ast-mapper").then(async ({ buildTsCompilerMap }) => {
    const { readFile } = await import("node:fs/promises");
    // Build a fake graph with one Page at path "/" and see if it maps.
    const graph = {
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "H", renderMode: "ssr" }
      }
    };
    const file = await buildTsCompilerMap({
      projectRoot: "apps/atlas-web",
      graphJson: JSON.stringify(graph)
    });
    console.log(JSON.stringify(file.mappings, null, 2));
  });
'
```

### 3.8 Keycloak auth (D12)

```bash
pnpm -F @atlas/auth-keycloak test                # 15 tests — no Keycloak required
```

Against a real Keycloak (optional, run one with `docker run quay.io/keycloak/keycloak`):

```bash
node -e '
  import("@atlas/auth-keycloak").then(async ({ KeycloakAuthProvider }) => {
    const p = new KeycloakAuthProvider({
      baseUrl: "http://localhost:8080",
      realm: "master",
      clientId: "atlas-web",
      redirectUri: "http://localhost:3000/auth/callback"
    });
    console.log("authorize URL:", p.getAuthorizeUrl({ state: "x", nonce: "y" }));
  });
'
```

### 3.9 Atlas-web UI

```bash
pnpm -F atlas-web test                 # ≈30 component + unit tests
pnpm -F atlas-web lint                 # should report "No ESLint warnings or errors"
pnpm -F atlas-web typecheck            # clean
pnpm -F atlas-web dev                  # http://localhost:3000
```

Key surfaces to click through manually:

- `/projects/<id>/canvas` — Canvas with click-to-select; side panel surfaces node metadata.
- `/projects/<id>/code` — Monaco editor + file tree + PR pane.
- `/projects/<id>/run?persona=ama|diego|priya` — observability dashboard; expect "No data yet" with a health-light circle until a real Grafana client is wired.

---

## 4. Feature flags

All flags default OFF and are env-driven:

| Flag | Env var | What it gates |
|---|---|---|
| `figma-importer` | `ATLAS_FF_FIGMA_IMPORTER` | Figma importer UI action |
| `stripe-payments` | `ATLAS_FF_STRIPE_PAYMENTS` | Stripe as a payments option |
| `video-kling` | `ATLAS_FF_VIDEO_KLING` | Kling video adapter |
| `auth-keycloak` | `ATLAS_FF_AUTH_KEYCLOAK` | Keycloak auth path (replaces Clerk) |

Truthy values: `1`, `true`, `TRUE`, `yes`, `on` (whitespace-trimmed).

```bash
pnpm -F atlas-web test feature-flags   # 6 tests
```

---

## 5. Typecheck + lint the whole repo

```bash
pnpm -r typecheck       # every package's tsc --noEmit
pnpm -F atlas-web lint  # Next.js ESLint over atlas-web
```

Both should exit 0 with no warnings.

---

## 6. Playwright e2e (atlas-web, Phase A E.5)

```bash
# one-time
pnpm -F atlas-web exec playwright install

# run headless
pnpm -F atlas-web test:e2e

# debug with UI
pnpm -F atlas-web test:e2e:ui
```

**E.5 status:** tests parse but require a running atlas-web + Clerk test-mode credentials + Postgres. Tracked as D1 deferral.

---

## 7. Benchmarks / non-CI checks

These live alongside their packages and are skip-by-default:

- `packages/deploy-orchestrator/test/integration-k3d.test.ts` — real-cluster deploy (enable with `ATLAS_K3D_CONTEXT`)
- `pnpm tg:baseline list` — smoke-test CLI for C.3 baselines (no test required, just prints)
- `pnpm tg:drift check <calibration.json>` — drift detector

---

## 8. What "green" means right now

Run this from a freshly pulled main:

```bash
docker compose up -d postgres
export DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5433/atlas_test
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -F atlas-web lint
```

Expected totals (2026-04-22 snapshot):

- ~32 packages, ~700+ tests passing
- 0 typecheck errors
- 0 ESLint warnings
- 5 Python tests pending (D7 — needs `uv`)
- Playwright e2e not run (D1 — needs CI creds)

---

## 9. Where things go when they break

| Symptom | Likely cause | Fix |
|---|---|---|
| `SASL: client password must be a string` | `DATABASE_URL_TEST` not set | Export the env var |
| Migration replay fails on 0003 | Parallel test files stepping on schema cleanup | Add `fileParallelism: false` to that package's `vitest.config.ts` (already done for `postgres-branching`) |
| Drizzle-kit migrate hangs on Windows | Known upstream issue (D4) | Apply SQL via psql directly |
| Next `lint` says "Cannot find module 'eslint-config-next/core-web-vitals'" | Stale config shape | Already fixed (D3 closed); `pnpm install` and retry |
| `resourceFromAttributes is not a function` | OpenTelemetry v2-shape code against v1 package | Use `new Resource(attrs)` — already corrected in `@atlas/observability` |
| Component test fails with "Target container is not a DOM element" | Missing jsdom in vitest.config.ts | atlas-web ships jsdom; other packages are node-only |

---

## 10. How deferrals map to test commands

| Deferral | Verify it's closed by running |
|---|---|
| D3 (ESLint) | `pnpm -F atlas-web lint` → "No ESLint warnings or errors" |
| D6 (SpendRecorder) | `pnpm -F @atlas/sandbox-e2b test spend-recording` → 5 passed |
| D8 (AST mapper) | `pnpm -F @atlas/ast-mapper test ts-compiler-mapper` → 9 passed |
| D9 (Postgres branching) | `pnpm -F @atlas/postgres-branching test` → 9 passed |
| D10 (K8s + Cloudflare clients) | `pnpm -F @atlas/deploy-orchestrator test http-cloudflare k8s-client-node` → 20 passed |
| D11 (Monitoring + HttpGrafana) | `pnpm -F @atlas/run-dashboard test http-grafana` → 9 passed |
| D12 (Keycloak library) | `pnpm -F @atlas/auth-keycloak test` → 15 passed |

For the remaining open deferrals (D1, D2, D4, D5, D7, D13), see `docs/superpowers/known-deferrals.md` — each has a concrete trigger + owner.
