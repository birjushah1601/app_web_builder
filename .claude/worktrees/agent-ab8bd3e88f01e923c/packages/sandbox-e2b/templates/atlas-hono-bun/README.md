# atlas-hono-bun E2B template

Bun 1.2+ runtime + Hono 4.x web framework + Drizzle ORM 0.36+ + Zod 3.x + postgres-js.

Used by Atlas's developer role when the user pins a project to this template via
`ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-hono-bun` (or, in a future plan, when the
architect emits a TypeScript-native runtime hint for `backend-rest-api` projects).

By default, T.1's `templateForArtifactKind` continues to route `backend-rest-api`
projects to `atlas-fastapi`. atlas-hono-bun is opt-in.

## Pre-installed runtime deps

- **hono** 4.6+ — web framework (Bun-first, runtime-agnostic)
- **@hono/zod-validator** — typed request validation hooks
- **zod** 3.23+ — schemas
- **drizzle-orm** 0.36+ — SQL-first ORM (no codegen step)
- **postgres** 3.4+ — postgres-js driver
- **drizzle-kit** (dev) — migration CLI: `bun run drizzle:generate` / `drizzle:migrate`
- **@types/bun** (dev) — Bun runtime types
- **typescript** (dev) — strict, ES2022, bundler resolution

## Out-of-the-box endpoints

- `GET /` — app metadata `{ name, version, stack }`
- `GET /health` — `{"status": "ok", "stack": "hono-bun", "atlas": "sandbox-ready"}`

## File layout

```
src/
  index.ts          # Hono app, smoke endpoints, Bun.serve bootstrap
  routes/
    example.ts      # example feature router (NOT mounted by default)
tests/
  index.test.ts     # bun:test smoke
```

To enable the example router, in `src/index.ts` add:

```ts
import exampleRouter from "./routes/example.ts";
app.route("/example", exampleRouter);
```

## Embedded SQLite alternative (optional)

The default driver is `postgres-js` (serverful Postgres). For demos / offline dev,
swap to libsql (Turso-compatible, embedded SQLite):

```bash
bun add @libsql/client
bun remove postgres
```

Then update Drizzle imports to use `drizzle-orm/sqlite-core` and configure
`drizzle.config.ts` (if/when added) with `dialect: "sqlite"`.

## Local smoke test (no E2B credit)

If Bun is installed locally:

```bash
cd packages/sandbox-e2b/templates/atlas-hono-bun
bun install
bun test
```

Or with Docker (no Bun required):

```bash
cd packages/sandbox-e2b/templates/atlas-hono-bun
./scripts/smoke-test-local.sh
```

## Build + push to E2B (republish)

```bash
cd packages/sandbox-e2b/templates/atlas-hono-bun
export E2B_API_KEY=e2b_...
./scripts/build-template.sh
# Capture the printed template ID; add it to e2b.toml's template_id; commit.
```

## Wire into atlas-web

Per-project pin (current path):

```bash
# In your project's env or Atlas project settings:
ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-hono-bun
```

The sandbox factory's `resolveTemplateForRitual` already honours this env var
above the artifactKind router (T.1). No code change needed for opt-in users.
