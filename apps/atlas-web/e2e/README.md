# Atlas Web — End-to-End Tests

Playwright integration tests covering the three Atlas persona flows (Ama / Diego / Priya) against a
real Clerk + E2B + Postgres stack.

## Local setup

1. Copy `.env.test.example` → `.env.test.local` and fill in secrets.
2. Start Postgres: `docker compose -f infra/docker-compose.yml up -d postgres`
3. Run DB migrations: `pnpm --filter @atlas/spec-graph-data migrate`
4. Start the app: `pnpm --filter @atlas/web dev`
5. In a second terminal: `pnpm --filter @atlas/web test:e2e`

## Required env vars

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string for the test DB |
| `CLERK_SECRET_KEY` | Clerk test-tenant secret key |
| `CLERK_PUBLISHABLE_KEY` | Clerk test-tenant publishable key |
| `E2B_API_KEY` | E2B API key (use the `atlas-test` template) |
| `ATLAS_TEST_PASSWORD` | Shared password for the three test Clerk users |
| `PLAYWRIGHT_BASE_URL` | Base URL of the running app (default: `http://localhost:3000`) |

## Running a single test

```bash
pnpm --filter @atlas/web test:e2e -- e2e/tests/ama-happy.spec.ts
```

## Cost notes

- Each test with `withSandbox: true` provisions one E2B sandbox (~$0.002/min at idle).
- Tests are serial (`workers: 1`); total wall-clock is ~5–8 min on a warm CI runner.
- The `atlas-test` E2B template is stripped to `node:22-alpine` + production deps only — no dev tooling.
- `global-teardown.ts` kills orphaned sandboxes older than 30 min; run `e2b sandbox list` to audit manually.
- Do **not** run E2E tests on every commit — the CI path filter (`apps/atlas-web/**`) limits runs to relevant PRs.
