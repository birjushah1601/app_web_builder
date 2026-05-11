# Spec Graph Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Postgres mirror and typed data-access layer for the Living Spec Graph. This is Plan A.1 of Unit A in Phase A — the foundation that every other Atlas service reads from and writes to.

**Architecture:** pnpm-workspace monorepo. One package (`packages/spec-graph-data`) owns the Postgres schema (`spec_graphs`, `spec_events`, `spec_snapshots`), Drizzle ORM migrations, typed repositories, session-local tenant isolation via Postgres RLS, and observability (OpenTelemetry spans + Prometheus counters/histograms). The graph payload is stored opaquely as `jsonb` — Plan A.1 does not parse it. The spec-graph *schema* (node types, edge types, validators) is Unit B; A.1 is purely the data substrate.

**Tech Stack:** TypeScript 5.5+ · Node 22 LTS · pnpm workspaces · Drizzle ORM + drizzle-kit · `pg` (node-postgres) · Postgres 16 (Docker Compose locally; Neon/managed in staging) · Vitest 2.x · `@opentelemetry/api` · `prom-client`.

**Prerequisites the implementing engineer needs installed before starting:**
- Node 22 LTS (`node --version` ≥ v22.0.0)
- pnpm 9+ (`pnpm --version` ≥ 9.0.0) — install via `corepack enable && corepack prepare pnpm@latest --activate`
- Docker Desktop (Windows/macOS) or Docker Engine + Compose plugin (Linux), with the daemon running
- `psql` client on PATH (for verification commands; on Windows comes with the Postgres installer or via Chocolatey `choco install postgresql`)

---

## File Structure

Files this plan creates. Paths are relative to the repo root `f:/claude/ai_builder/`.

```
package.json                                        # root workspace manifest
pnpm-workspace.yaml                                 # workspace glob
tsconfig.base.json                                  # shared TS config
docker-compose.yml                                  # Postgres 16 for local dev
.env.example                                        # documented env vars
packages/
  spec-graph-data/
    package.json                                    # package manifest
    tsconfig.json                                   # extends base
    vitest.config.ts                                # test runner config
    drizzle.config.ts                               # drizzle-kit config
    README.md                                       # package docs
    src/
      index.ts                                      # public exports
      client.ts                                     # pg Pool + drizzle factory
      tenant.ts                                     # withProjectContext helper
      observability.ts                              # OTel + prom-client
      schema/
        index.ts                                    # schema barrel
        spec-graphs.ts                              # spec_graphs table
        spec-events.ts                              # spec_events table
        spec-snapshots.ts                           # spec_snapshots table
      repo/
        spec-graph.repo.ts                          # graph CRUD
        spec-event.repo.ts                          # event append + query
        spec-snapshot.repo.ts                       # snapshot CRUD
    drizzle/                                        # generated migrations (committed)
    test/
      setup.ts                                      # per-run DB setup
      helpers.ts                                    # test fixtures
      client.test.ts                                # pool smoke test
      tenant.test.ts                                # RLS enforcement
      spec-graph.repo.test.ts
      spec-event.repo.test.ts
      spec-snapshot.repo.test.ts
      observability.test.ts
      integration.test.ts                           # full end-to-end
```

**Why this shape.** One package, one responsibility (the data substrate). Schema / repos / observability split into directories so Unit B can publish `@atlas/spec-graph-schema` alongside without churning this package. `drizzle/` migrations are committed so a fresh clone can `pnpm db:migrate` against any Postgres.

**What Plan A.1 does NOT build.** The file ↔ mirror sync daemon (Plan A.2). The Git merge driver (Plan A.3). Compaction + offline mode (Plan A.4). The graph schema types (Unit B). The repos accept and return `unknown` for `graph_data` / `payload` — the public API deliberately avoids committing to the graph's internal type shape until Unit B.

---

## Database Design

Three tables, all scoped by `project_id`. RLS enforces tenant isolation at the database boundary; every repo also accepts `projectId` as an explicit parameter for defense in depth.

### `spec_graphs`
One row per project. Holds the current materialized graph state and a pointer to the highest event applied.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `project_id` | `uuid` | **unique**, indexed |
| `schema_version` | `integer` | default `1` (bumped when Unit B evolves the shape) |
| `graph_data` | `jsonb` | the current snapshot of nodes + edges; opaque to A.1 |
| `current_event_seq` | `bigint` | highest `spec_events.id` applied; `0` for empty |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()`, bumped by `update_graph_data` |

### `spec_events`
Append-only. Every mutation logged. Used by sync daemon (A.2), reconciliation queue, and audit.

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` | PK, global monotonic (good enough for v1 ordering) |
| `project_id` | `uuid` | indexed |
| `event_type` | `text` | e.g. `node.created`, `edge.deleted`, `graph.snapshot_applied` |
| `payload` | `jsonb` | event data; opaque to A.1 |
| `actor` | `text` | skill name, user id, or `system`; nullable |
| `created_at` | `timestamptz` | default `now()` |

Indexes: `(project_id, id DESC)` for "events since cursor", `(project_id, created_at DESC)` for time-window queries.

### `spec_snapshots`
Point-in-time snapshot rows. Used by compaction (A.4) and recovery.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `project_id` | `uuid` | indexed |
| `up_to_event_id` | `bigint` | last event id included in this snapshot; **no FK** (so event-log compaction can proceed without cascade) |
| `graph_data` | `jsonb` | snapshot payload |
| `reason` | `text` | `manual` · `compaction` · `recovery` |
| `created_at` | `timestamptz` | default `now()` |

Index: `(project_id, created_at DESC)` for "latest snapshot".

**RLS policies (applied in Task 8).** All three tables enable row-level security. A single policy per table allows reads and writes only when `current_setting('app.project_id', true)::uuid = project_id`. The app must call `SET LOCAL app.project_id = '<uuid>'` at the top of every transaction — the `withProjectContext` helper in `src/tenant.ts` enforces this.

---

## Task List (21 tasks)

Each task is TDD-shaped: write the failing test, run it red, write minimal code, run it green, commit. Every task commits. Commits use Conventional Commits prefixes.

---

### Task 1: Monorepo scaffold + Docker Compose Postgres

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "atlas",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:psql": "docker compose exec postgres psql -U atlas -d atlas_dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "services/*"
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: atlas-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: atlas
      POSTGRES_PASSWORD: atlas
      POSTGRES_DB: atlas_dev
    ports:
      - "5432:5432"
    volumes:
      - atlas-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atlas -d atlas_dev"]
      interval: 2s
      timeout: 5s
      retries: 20

volumes:
  atlas-postgres-data:
```

- [ ] **Step 5: Write `.env.example`**

```bash
# Spec Graph data layer
DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas_dev
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5432/atlas_test
```

- [ ] **Step 6: Bring up Postgres and verify**

Run:
```bash
pnpm db:up
# wait for healthcheck (≤ 10s)
docker compose ps postgres
```

Expected: status column shows `healthy`.

Run:
```bash
docker compose exec postgres psql -U atlas -d atlas_dev -c "SELECT version();"
```

Expected: prints `PostgreSQL 16.x ...`.

- [ ] **Step 7: Create the test database**

Run:
```bash
docker compose exec postgres psql -U atlas -d atlas_dev -c "CREATE DATABASE atlas_test;"
```

Expected: `CREATE DATABASE`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json docker-compose.yml .env.example
git commit -m "chore: scaffold pnpm monorepo and Postgres 16 via Docker Compose"
```

---

### Task 2: `packages/spec-graph-data` package scaffold

**Files:**
- Create: `packages/spec-graph-data/package.json`
- Create: `packages/spec-graph-data/tsconfig.json`
- Create: `packages/spec-graph-data/vitest.config.ts`
- Create: `packages/spec-graph-data/drizzle.config.ts`
- Create: `packages/spec-graph-data/src/index.ts`

- [ ] **Step 1: Write `packages/spec-graph-data/package.json`**

```json
{
  "name": "@atlas/spec-graph-data",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "drizzle"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@opentelemetry/api": "1.9.0",
    "drizzle-orm": "0.35.3",
    "pg": "8.13.1",
    "prom-client": "15.1.3"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@types/pg": "8.11.10",
    "drizzle-kit": "0.28.1",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Write `packages/spec-graph-data/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "drizzle"]
}
```

- [ ] **Step 3: Write `packages/spec-graph-data/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallel: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
```

**Why single-fork.** The tests mutate a shared Postgres DB. Running in a single worker avoids cross-test interference without needing per-test schemas.

- [ ] **Step 4: Write `packages/spec-graph-data/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://atlas:atlas@localhost:5432/atlas_dev"
  },
  strict: true,
  verbose: true
});
```

- [ ] **Step 5: Write `packages/spec-graph-data/src/index.ts`** (minimal)

```ts
export const PACKAGE_NAME = "@atlas/spec-graph-data";
```

- [ ] **Step 6: Install deps and verify build**

Run:
```bash
pnpm install
pnpm -F @atlas/spec-graph-data build
```

Expected: exit 0; `packages/spec-graph-data/dist/index.js` exists.

Run:
```bash
pnpm -F @atlas/spec-graph-data typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-data pnpm-lock.yaml
git commit -m "feat(spec-graph-data): scaffold package with drizzle + vitest"
```

---

### Task 3: `spec_graphs` table schema + first migration

**Files:**
- Create: `packages/spec-graph-data/src/schema/spec-graphs.ts`
- Create: `packages/spec-graph-data/src/schema/index.ts`
- Create: `packages/spec-graph-data/drizzle/0000_*.sql` (generated)

- [ ] **Step 1: Write the schema file**

`packages/spec-graph-data/src/schema/spec-graphs.ts`:
```ts
import { bigint, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const specGraphs = pgTable(
  "spec_graphs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    graphData: jsonb("graph_data").notNull().default({}),
    currentEventSeq: bigint("current_event_seq", { mode: "bigint" }).notNull().default(0n),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    uqProject: uniqueIndex("uq_spec_graphs_project_id").on(table.projectId)
  })
);

export type SpecGraphRow = typeof specGraphs.$inferSelect;
export type NewSpecGraphRow = typeof specGraphs.$inferInsert;
```

- [ ] **Step 2: Write the schema barrel**

`packages/spec-graph-data/src/schema/index.ts`:
```ts
export * from "./spec-graphs.js";
```

- [ ] **Step 3: Generate the migration**

Run (from repo root):
```bash
pnpm -F @atlas/spec-graph-data db:generate
```

Expected: a file `packages/spec-graph-data/drizzle/0000_*.sql` appears, containing `CREATE TABLE "spec_graphs"`.

- [ ] **Step 4: Apply the migration to the dev database**

Run:
```bash
pnpm -F @atlas/spec-graph-data db:migrate
```

Expected: logs `[✓] Done` or similar.

- [ ] **Step 5: Verify via psql**

Run:
```bash
docker compose exec postgres psql -U atlas -d atlas_dev -c "\d spec_graphs"
```

Expected: output shows columns `id`, `project_id`, `schema_version`, `graph_data`, `current_event_seq`, `created_at`, `updated_at`, and the unique index `uq_spec_graphs_project_id`.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-data/src/schema packages/spec-graph-data/drizzle
git commit -m "feat(spec-graph-data): add spec_graphs table schema and migration"
```

---

### Task 4: `spec_events` table schema + migration

**Files:**
- Create: `packages/spec-graph-data/src/schema/spec-events.ts`
- Modify: `packages/spec-graph-data/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

`packages/spec-graph-data/src/schema/spec-events.ts`:
```ts
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const specEvents = pgTable(
  "spec_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    projectId: uuid("project_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    idxProjectIdDesc: index("idx_spec_events_project_id_desc").on(table.projectId, table.id),
    idxProjectCreatedAtDesc: index("idx_spec_events_project_created_at_desc").on(table.projectId, table.createdAt)
  })
);

export type SpecEventRow = typeof specEvents.$inferSelect;
export type NewSpecEventRow = typeof specEvents.$inferInsert;
```

- [ ] **Step 2: Update the barrel**

`packages/spec-graph-data/src/schema/index.ts`:
```ts
export * from "./spec-graphs.js";
export * from "./spec-events.js";
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
pnpm -F @atlas/spec-graph-data db:generate
pnpm -F @atlas/spec-graph-data db:migrate
```

- [ ] **Step 4: Verify via psql**

Run:
```bash
docker compose exec postgres psql -U atlas -d atlas_dev -c "\d spec_events"
```

Expected: columns `id` (bigint), `project_id`, `event_type`, `payload`, `actor`, `created_at`. Indexes `idx_spec_events_project_id_desc` and `idx_spec_events_project_created_at_desc` present.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/schema packages/spec-graph-data/drizzle
git commit -m "feat(spec-graph-data): add spec_events table schema and migration"
```

---

### Task 5: `spec_snapshots` table schema + migration

**Files:**
- Create: `packages/spec-graph-data/src/schema/spec-snapshots.ts`
- Modify: `packages/spec-graph-data/src/schema/index.ts`

- [ ] **Step 1: Write the schema file**

`packages/spec-graph-data/src/schema/spec-snapshots.ts`:
```ts
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const specSnapshots = pgTable(
  "spec_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    upToEventId: bigint("up_to_event_id", { mode: "bigint" }).notNull(),
    graphData: jsonb("graph_data").notNull().default({}),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    idxProjectCreatedAtDesc: index("idx_spec_snapshots_project_created_at_desc").on(table.projectId, table.createdAt)
  })
);

export type SpecSnapshotRow = typeof specSnapshots.$inferSelect;
export type NewSpecSnapshotRow = typeof specSnapshots.$inferInsert;
```

- [ ] **Step 2: Update the barrel**

`packages/spec-graph-data/src/schema/index.ts`:
```ts
export * from "./spec-graphs.js";
export * from "./spec-events.js";
export * from "./spec-snapshots.js";
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
pnpm -F @atlas/spec-graph-data db:generate
pnpm -F @atlas/spec-graph-data db:migrate
```

- [ ] **Step 4: Verify via psql**

Run:
```bash
docker compose exec postgres psql -U atlas -d atlas_dev -c "\d spec_snapshots"
```

Expected: columns `id`, `project_id`, `up_to_event_id` (bigint), `graph_data`, `reason`, `created_at`. Index present.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/schema packages/spec-graph-data/drizzle
git commit -m "feat(spec-graph-data): add spec_snapshots table schema and migration"
```

---

### Task 6: Postgres client factory + test setup

**Files:**
- Create: `packages/spec-graph-data/src/client.ts`
- Create: `packages/spec-graph-data/test/setup.ts`
- Create: `packages/spec-graph-data/test/helpers.ts`
- Create: `packages/spec-graph-data/test/client.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-data/test/client.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";

describe("createDatabase", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("connects to Postgres and runs a trivial query", async () => {
    const result = await db.pool.query("SELECT 1 AS one");
    expect(result.rows).toEqual([{ one: 1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/client.test.ts
```

Expected: FAIL. Error mentions `../src/client.js` not found.

- [ ] **Step 3: Write the client factory**

`packages/spec-graph-data/src/client.ts`:
```ts
import { Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type DrizzleDb = NodePgDatabase<Schema>;

export interface Database {
  pool: Pool;
  db: DrizzleDb;
}

export function createDatabase(connectionString: string, overrides?: Partial<PoolConfig>): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
```

- [ ] **Step 4: Write the test setup (applies migrations to the test DB)**

`packages/spec-graph-data/test/setup.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const TEST_URL = "postgresql://atlas:atlas@localhost:5432/atlas_test";
process.env.DATABASE_URL_TEST = TEST_URL;

export async function setup() {
  const pool = new Pool({ connectionString: TEST_URL });
  const client = await pool.connect();
  try {
    // Drop and recreate the public schema for a clean slate
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO atlas");

    // Apply all migrations in lexical order
    const migrationDir = join(__dirname, "..", "drizzle");
    const files = readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), "utf8");
      // drizzle writes statement-breakpoint markers; split on them
      const statements = sql.split(/--> statement-breakpoint/g).map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
```

- [ ] **Step 5: Write test helpers**

`packages/spec-graph-data/test/helpers.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Database } from "../src/client.js";

export function uniqueProjectId(): string {
  return randomUUID();
}

export async function truncateAllTables(db: Database): Promise<void> {
  await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
}
```

**Why `RESTART IDENTITY`.** Resets `spec_events.id` serial so event ids are predictable across tests.

- [ ] **Step 6: Wire setup into vitest**

Modify `packages/spec-graph-data/vitest.config.ts` — add `globalSetup`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    globalSetup: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    fileParallel: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
```

- [ ] **Step 7: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/client.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add packages/spec-graph-data/src/client.ts \
        packages/spec-graph-data/test/setup.ts \
        packages/spec-graph-data/test/helpers.ts \
        packages/spec-graph-data/test/client.test.ts \
        packages/spec-graph-data/vitest.config.ts
git commit -m "feat(spec-graph-data): add pg Pool + drizzle client factory with test harness"
```

---

### Task 7: Tenant isolation — `withProjectContext` helper

**Files:**
- Create: `packages/spec-graph-data/src/tenant.ts`
- Create: `packages/spec-graph-data/test/tenant.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-data/test/tenant.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { withProjectContext } from "../src/tenant.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("withProjectContext", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("sets app.project_id as a session-local setting for the duration of the callback", async () => {
    const projectId = uniqueProjectId();
    const inside = await withProjectContext(db.pool, projectId, async (client) => {
      const { rows } = await client.query<{ value: string }>("SELECT current_setting('app.project_id', true) AS value");
      return rows[0]?.value;
    });
    expect(inside).toBe(projectId);
  });

  it("does not leak the setting outside the transaction", async () => {
    const projectId = uniqueProjectId();
    await withProjectContext(db.pool, projectId, async () => {
      /* inside; setting active */
    });
    const { rows } = await db.pool.query<{ value: string | null }>("SELECT current_setting('app.project_id', true) AS value");
    // current_setting with missing_ok=true returns '' (or null) when unset or after a SET LOCAL txn commits
    expect(rows[0]?.value === null || rows[0]?.value === "").toBe(true);
  });

  it("propagates errors from the callback and does not swallow them", async () => {
    const projectId = uniqueProjectId();
    await expect(
      withProjectContext(db.pool, projectId, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/tenant.test.ts
```

Expected: FAIL. Error: cannot find `../src/tenant.js`.

- [ ] **Step 3: Implement `withProjectContext`**

`packages/spec-graph-data/src/tenant.ts`:
```ts
import type { Pool, PoolClient } from "pg";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function withProjectContext<T>(
  pool: Pool,
  projectId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!UUID_RE.test(projectId)) {
    throw new Error(`withProjectContext: projectId must be a UUID, got "${projectId}"`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config(name, value, is_local) with is_local=true scopes to the transaction
    await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* swallow — original error is the important one */
    });
    throw error;
  } finally {
    client.release();
  }
}
```

**Why `set_config(..., true)` instead of `SET LOCAL`.** `set_config` accepts a parameterized value; `SET LOCAL` does not support parameters. Same effect (local to transaction).

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/tenant.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/tenant.ts packages/spec-graph-data/test/tenant.test.ts
git commit -m "feat(spec-graph-data): add withProjectContext for session-local tenant scope"
```

---

### Task 8: Enable Postgres RLS on all three tables

**Files:**
- Create: `packages/spec-graph-data/drizzle/000X_enable_rls.sql` (generated, then edited)
- Create: `packages/spec-graph-data/test/rls.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-data/test/rls.test.ts`:
```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { specGraphs } from "../src/schema/index.js";
import { withProjectContext } from "../src/tenant.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("Postgres RLS enforcement", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("blocks reads when no app.project_id is set", async () => {
    const projectA = uniqueProjectId();
    // Insert as projectA via context
    await withProjectContext(db.pool, projectA, async (client) => {
      await client.query(
        `INSERT INTO spec_graphs (project_id, graph_data) VALUES ($1, '{}'::jsonb)`,
        [projectA]
      );
    });
    // Read outside any project context → should return 0 rows
    const { rowCount } = await db.pool.query("SELECT * FROM spec_graphs");
    expect(rowCount).toBe(0);
  });

  it("isolates projects: project A cannot see project B's rows", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await withProjectContext(db.pool, projectA, async (client) => {
      await client.query(
        `INSERT INTO spec_graphs (project_id, graph_data) VALUES ($1, '{}'::jsonb)`,
        [projectA]
      );
    });
    const seenByB = await withProjectContext(db.pool, projectB, async (client) => {
      const { rows } = await client.query("SELECT id FROM spec_graphs");
      return rows;
    });
    expect(seenByB).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/rls.test.ts
```

Expected: FAIL. The `SELECT * FROM spec_graphs` outside context returns the row because RLS is not enabled yet.

- [ ] **Step 3: Generate an empty migration slot and fill it with RLS SQL**

Run:
```bash
pnpm -F @atlas/spec-graph-data exec drizzle-kit generate --custom --name enable_rls
```

Expected: a file `packages/spec-graph-data/drizzle/000X_enable_rls.sql` appears (empty, awaiting custom SQL).

Open that file and replace its contents with:

```sql
-- Enable RLS and install per-table policies that filter on the session-local
-- app.project_id setting. The helper `withProjectContext` is the only
-- supported caller.

ALTER TABLE spec_graphs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_snapshots  ENABLE ROW LEVEL SECURITY;

ALTER TABLE spec_graphs     FORCE ROW LEVEL SECURITY;
ALTER TABLE spec_events     FORCE ROW LEVEL SECURITY;
ALTER TABLE spec_snapshots  FORCE ROW LEVEL SECURITY;

-- current_setting with missing_ok=true returns NULL when unset, which the cast
-- will reject. Wrap in a defensive expression that returns a zero UUID when
-- unset so comparisons never error but also never match a real row.
CREATE OR REPLACE FUNCTION atlas_current_project_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.project_id', true), ''), '00000000-0000-0000-0000-000000000000')::uuid
$$;

CREATE POLICY spec_graphs_tenant ON spec_graphs
  USING (project_id = atlas_current_project_id())
  WITH CHECK (project_id = atlas_current_project_id());

CREATE POLICY spec_events_tenant ON spec_events
  USING (project_id = atlas_current_project_id())
  WITH CHECK (project_id = atlas_current_project_id());

CREATE POLICY spec_snapshots_tenant ON spec_snapshots
  USING (project_id = atlas_current_project_id())
  WITH CHECK (project_id = atlas_current_project_id());
```

**Why `FORCE ROW LEVEL SECURITY`.** The default behaviour exempts table owners (which the `atlas` role is in dev). `FORCE` makes RLS apply uniformly.

**Why a helper function.** Inline `current_setting(...)::uuid` would throw on NULL or empty. The helper coerces both to a sentinel UUID so unprivileged calls return zero rows instead of raising an error — the app-layer defense-in-depth still catches missing context via an explicit error in the repos (Task 9).

- [ ] **Step 4: Apply the migration**

Run:
```bash
pnpm -F @atlas/spec-graph-data db:migrate
```

- [ ] **Step 5: Re-run the RLS test**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/rls.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Update the test setup to apply the RLS migration too**

The setup in Task 6 already walks every `.sql` file in `drizzle/` in lexical order, so no change is needed — verify by re-running all tests:
```bash
pnpm -F @atlas/spec-graph-data test
```

Expected: PASS (5 tests so far).

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-data/drizzle packages/spec-graph-data/test/rls.test.ts
git commit -m "feat(spec-graph-data): enable and enforce RLS on all three tables"
```

---

### Task 9: `SpecGraphRepo.create`

**Files:**
- Create: `packages/spec-graph-data/src/repo/spec-graph.repo.ts`
- Create: `packages/spec-graph-data/test/spec-graph.repo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-data/test/spec-graph.repo.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecGraphRepo } from "../src/repo/spec-graph.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("SpecGraphRepo.create", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("creates a spec graph and returns the inserted row", async () => {
    const projectId = uniqueProjectId();
    const row = await repo.create(projectId, { nodes: [], edges: [] });
    expect(row.projectId).toBe(projectId);
    expect(row.graphData).toEqual({ nodes: [], edges: [] });
    expect(row.currentEventSeq).toBe(0n);
    expect(row.schemaVersion).toBe(1);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects duplicate project_id", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    await expect(repo.create(projectId, {})).rejects.toThrow(/duplicate|unique/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-graph.repo.test.ts
```

Expected: FAIL (cannot find `spec-graph.repo.js`).

- [ ] **Step 3: Implement the repo**

`packages/spec-graph-data/src/repo/spec-graph.repo.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { specGraphs, type SpecGraphRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";

export class SpecGraphRepo {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, graphData: unknown): Promise<SpecGraphRow> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specGraphs } });
      const [row] = await db
        .insert(specGraphs)
        .values({ projectId, graphData: graphData as never })
        .returning();
      if (!row) {
        throw new Error("SpecGraphRepo.create: insert returned no row");
      }
      return row;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-graph.repo.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-graph.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecGraphRepo.create with RLS + unique-project guard"
```

---

### Task 10: `SpecGraphRepo.findByProjectId`

**Files:**
- Modify: `packages/spec-graph-data/src/repo/spec-graph.repo.ts`
- Modify: `packages/spec-graph-data/test/spec-graph.repo.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/spec-graph.repo.test.ts`:
```ts
describe("SpecGraphRepo.findByProjectId", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the row for the given project", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, { marker: "alpha" });
    const row = await repo.findByProjectId(projectId);
    expect(row?.graphData).toEqual({ marker: "alpha" });
  });

  it("returns null when the project has no graph", async () => {
    const row = await repo.findByProjectId(uniqueProjectId());
    expect(row).toBeNull();
  });

  it("does not leak across projects (RLS)", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await repo.create(projectA, { marker: "A" });
    const seenByB = await repo.findByProjectId(projectB);
    expect(seenByB).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-graph.repo.test.ts
```

Expected: FAIL on the three new tests (`findByProjectId is not a function`).

- [ ] **Step 3: Add the method**

Edit `src/repo/spec-graph.repo.ts` — extend the `SpecGraphRepo` class:
```ts
  async findByProjectId(projectId: string): Promise<SpecGraphRow | null> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specGraphs } });
      const rows = await db.select().from(specGraphs).where(eq(specGraphs.projectId, projectId)).limit(1);
      return rows[0] ?? null;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-graph.repo.test.ts
```

Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-graph.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecGraphRepo.findByProjectId"
```

---

### Task 11: `SpecGraphRepo.updateGraphData`

**Files:**
- Modify: `packages/spec-graph-data/src/repo/spec-graph.repo.ts`
- Modify: `packages/spec-graph-data/test/spec-graph.repo.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/spec-graph.repo.test.ts`:
```ts
describe("SpecGraphRepo.updateGraphData", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("replaces graph_data and current_event_seq atomically", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, { v: 1 });
    const originalRow = await repo.findByProjectId(projectId);
    const originalUpdatedAt = originalRow!.updatedAt;
    await new Promise((r) => setTimeout(r, 10));

    const updated = await repo.updateGraphData(projectId, { v: 2 }, 42n);
    expect(updated.graphData).toEqual({ v: 2 });
    expect(updated.currentEventSeq).toBe(42n);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it("throws when the project has no existing graph", async () => {
    await expect(repo.updateGraphData(uniqueProjectId(), {}, 1n)).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-graph.repo.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the method**

Edit `src/repo/spec-graph.repo.ts`:
```ts
  async updateGraphData(
    projectId: string,
    graphData: unknown,
    currentEventSeq: bigint
  ): Promise<SpecGraphRow> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specGraphs } });
      const [row] = await db
        .update(specGraphs)
        .set({
          graphData: graphData as never,
          currentEventSeq,
          updatedAt: sql`now()`
        })
        .where(eq(specGraphs.projectId, projectId))
        .returning();
      if (!row) {
        throw new Error(`SpecGraphRepo.updateGraphData: no spec graph found for project ${projectId}`);
      }
      return row;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-graph.repo.test.ts
```

Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-graph.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecGraphRepo.updateGraphData"
```

---

### Task 12: `SpecEventRepo.append`

**Files:**
- Create: `packages/spec-graph-data/src/repo/spec-event.repo.ts`
- Create: `packages/spec-graph-data/test/spec-event.repo.test.ts`

- [ ] **Step 1: Write failing test**

`packages/spec-graph-data/test/spec-event.repo.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecEventRepo } from "../src/repo/spec-event.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("SpecEventRepo.append", () => {
  let db: Database;
  let repo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns an event with a positive id, timestamp, and echoed fields", async () => {
    const projectId = uniqueProjectId();
    const event = await repo.append(projectId, {
      eventType: "node.created",
      payload: { nodeId: "n1", kind: "Page" },
      actor: "architect"
    });
    expect(event.id).toBeGreaterThan(0n);
    expect(event.projectId).toBe(projectId);
    expect(event.eventType).toBe("node.created");
    expect(event.payload).toEqual({ nodeId: "n1", kind: "Page" });
    expect(event.actor).toBe("architect");
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it("accepts a null actor for system events", async () => {
    const projectId = uniqueProjectId();
    const event = await repo.append(projectId, {
      eventType: "graph.snapshot_applied",
      payload: { reason: "compaction" },
      actor: null
    });
    expect(event.actor).toBeNull();
  });

  it("assigns monotonically increasing ids per project", async () => {
    const projectId = uniqueProjectId();
    const first = await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const second = await repo.append(projectId, { eventType: "b", payload: {}, actor: null });
    expect(second.id).toBeGreaterThan(first.id);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-event.repo.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repo**

`packages/spec-graph-data/src/repo/spec-event.repo.ts`:
```ts
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { specEvents, type NewSpecEventRow, type SpecEventRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";

export interface AppendEventInput {
  eventType: string;
  payload: unknown;
  actor: string | null;
}

export class SpecEventRepo {
  constructor(private readonly pool: Pool) {}

  async append(projectId: string, input: AppendEventInput): Promise<SpecEventRow> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specEvents } });
      const insertRow: NewSpecEventRow = {
        projectId,
        eventType: input.eventType,
        payload: input.payload as never,
        actor: input.actor
      };
      const [row] = await db.insert(specEvents).values(insertRow).returning();
      if (!row) {
        throw new Error("SpecEventRepo.append: insert returned no row");
      }
      return row;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-event.repo.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-event.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecEventRepo.append"
```

---

### Task 13: `SpecEventRepo.listSince`

**Files:**
- Modify: `packages/spec-graph-data/src/repo/spec-event.repo.ts`
- Modify: `packages/spec-graph-data/test/spec-event.repo.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/spec-event.repo.test.ts`:
```ts
describe("SpecEventRepo.listSince", () => {
  let db: Database;
  let repo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns events with id > cursor in ascending id order", async () => {
    const projectId = uniqueProjectId();
    const a = await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const b = await repo.append(projectId, { eventType: "b", payload: {}, actor: null });
    const c = await repo.append(projectId, { eventType: "c", payload: {}, actor: null });
    const rows = await repo.listSince(projectId, a.id);
    expect(rows.map((r) => r.eventType)).toEqual(["b", "c"]);
    expect(rows[0]!.id).toBe(b.id);
  });

  it("returns an empty array when cursor >= latest event", async () => {
    const projectId = uniqueProjectId();
    const a = await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const rows = await repo.listSince(projectId, a.id);
    expect(rows).toEqual([]);
  });

  it("does not leak other projects' events (RLS)", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await repo.append(projectA, { eventType: "a", payload: {}, actor: null });
    await repo.append(projectB, { eventType: "b", payload: {}, actor: null });
    const aRows = await repo.listSince(projectA, 0n);
    expect(aRows.map((r) => r.eventType)).toEqual(["a"]);
  });

  it("honours the optional limit parameter", async () => {
    const projectId = uniqueProjectId();
    for (let i = 0; i < 5; i++) {
      await repo.append(projectId, { eventType: `e${i}`, payload: {}, actor: null });
    }
    const rows = await repo.listSince(projectId, 0n, { limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-event.repo.test.ts
```

Expected: FAIL (`listSince is not a function`).

- [ ] **Step 3: Add the method**

Edit `src/repo/spec-event.repo.ts`:
```ts
  async listSince(
    projectId: string,
    cursor: bigint,
    opts: { limit?: number } = {}
  ): Promise<SpecEventRow[]> {
    const limit = opts.limit ?? 1000;
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specEvents } });
      return db
        .select()
        .from(specEvents)
        .where(and(eq(specEvents.projectId, projectId), gt(specEvents.id, cursor)))
        .orderBy(asc(specEvents.id))
        .limit(limit);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-event.repo.test.ts
```

Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-event.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecEventRepo.listSince with limit + RLS"
```

---

### Task 14: `SpecEventRepo.getLatest`

**Files:**
- Modify: `packages/spec-graph-data/src/repo/spec-event.repo.ts`
- Modify: `packages/spec-graph-data/test/spec-event.repo.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/spec-event.repo.test.ts`:
```ts
describe("SpecEventRepo.getLatest", () => {
  let db: Database;
  let repo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the highest-id event for the project", async () => {
    const projectId = uniqueProjectId();
    await repo.append(projectId, { eventType: "a", payload: {}, actor: null });
    const b = await repo.append(projectId, { eventType: "b", payload: {}, actor: null });
    const latest = await repo.getLatest(projectId);
    expect(latest?.id).toBe(b.id);
  });

  it("returns null when the project has no events", async () => {
    expect(await repo.getLatest(uniqueProjectId())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-event.repo.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the method**

Edit `src/repo/spec-event.repo.ts`:
```ts
  async getLatest(projectId: string): Promise<SpecEventRow | null> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specEvents } });
      const rows = await db
        .select()
        .from(specEvents)
        .where(eq(specEvents.projectId, projectId))
        .orderBy(desc(specEvents.id))
        .limit(1);
      return rows[0] ?? null;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-event.repo.test.ts
```

Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-event.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecEventRepo.getLatest"
```

---

### Task 15: `SpecSnapshotRepo.create`

**Files:**
- Create: `packages/spec-graph-data/src/repo/spec-snapshot.repo.ts`
- Create: `packages/spec-graph-data/test/spec-snapshot.repo.test.ts`

- [ ] **Step 1: Write failing test**

`packages/spec-graph-data/test/spec-snapshot.repo.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecSnapshotRepo } from "../src/repo/spec-snapshot.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("SpecSnapshotRepo.create", () => {
  let db: Database;
  let repo: SpecSnapshotRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecSnapshotRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("creates a snapshot and returns the inserted row", async () => {
    const projectId = uniqueProjectId();
    const row = await repo.create(projectId, {
      upToEventId: 42n,
      graphData: { nodes: [{ id: "n1" }] },
      reason: "manual"
    });
    expect(row.projectId).toBe(projectId);
    expect(row.upToEventId).toBe(42n);
    expect(row.reason).toBe("manual");
    expect(row.graphData).toEqual({ nodes: [{ id: "n1" }] });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-snapshot.repo.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repo**

`packages/spec-graph-data/src/repo/spec-snapshot.repo.ts`:
```ts
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { specSnapshots, type NewSpecSnapshotRow, type SpecSnapshotRow } from "../schema/index.js";
import { withProjectContext } from "../tenant.js";

export interface CreateSnapshotInput {
  upToEventId: bigint;
  graphData: unknown;
  reason: "manual" | "compaction" | "recovery";
}

export class SpecSnapshotRepo {
  constructor(private readonly pool: Pool) {}

  async create(projectId: string, input: CreateSnapshotInput): Promise<SpecSnapshotRow> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specSnapshots } });
      const insertRow: NewSpecSnapshotRow = {
        projectId,
        upToEventId: input.upToEventId,
        graphData: input.graphData as never,
        reason: input.reason
      };
      const [row] = await db.insert(specSnapshots).values(insertRow).returning();
      if (!row) {
        throw new Error("SpecSnapshotRepo.create: insert returned no row");
      }
      return row;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-snapshot.repo.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-snapshot.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecSnapshotRepo.create"
```

---

### Task 16: `SpecSnapshotRepo.findLatest`

**Files:**
- Modify: `packages/spec-graph-data/src/repo/spec-snapshot.repo.ts`
- Modify: `packages/spec-graph-data/test/spec-snapshot.repo.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/spec-snapshot.repo.test.ts`:
```ts
describe("SpecSnapshotRepo.findLatest", () => {
  let db: Database;
  let repo: SpecSnapshotRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecSnapshotRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the most recent snapshot for the project", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, { upToEventId: 1n, graphData: { v: 1 }, reason: "manual" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await repo.create(projectId, { upToEventId: 5n, graphData: { v: 2 }, reason: "compaction" });
    const latest = await repo.findLatest(projectId);
    expect(latest?.id).toBe(second.id);
    expect(latest?.upToEventId).toBe(5n);
  });

  it("returns null when the project has no snapshots", async () => {
    expect(await repo.findLatest(uniqueProjectId())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-snapshot.repo.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the method**

Edit `src/repo/spec-snapshot.repo.ts`:
```ts
  async findLatest(projectId: string): Promise<SpecSnapshotRow | null> {
    return withProjectContext(this.pool, projectId, async (client) => {
      const db = drizzle(client, { schema: { specSnapshots } });
      const rows = await db
        .select()
        .from(specSnapshots)
        .where(eq(specSnapshots.projectId, projectId))
        .orderBy(desc(specSnapshots.createdAt))
        .limit(1);
      return rows[0] ?? null;
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-data test -- test/spec-snapshot.repo.test.ts
```

Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-data/src/repo packages/spec-graph-data/test/spec-snapshot.repo.test.ts
git commit -m "feat(spec-graph-data): add SpecSnapshotRepo.findLatest"
```

---

### Task 17: OpenTelemetry spans on repo methods

**Files:**
- Create: `packages/spec-graph-data/src/observability.ts`
- Create: `packages/spec-graph-data/test/observability.test.ts`
- Modify: `packages/spec-graph-data/src/repo/spec-graph.repo.ts`
- Modify: `packages/spec-graph-data/src/repo/spec-event.repo.ts`
- Modify: `packages/spec-graph-data/src/repo/spec-snapshot.repo.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-data/test/observability.test.ts`:
```ts
import { type Span, SpanKind, context, trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecGraphRepo } from "../src/repo/spec-graph.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("observability: repo methods emit spans", () => {
  let db: Database;
  let repo: SpecGraphRepo;
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    exporter.reset();
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("emits a span for SpecGraphRepo.create with the right name and attributes", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    const spans = exporter.getFinishedSpans();
    const createSpan = spans.find((s) => s.name === "SpecGraphRepo.create");
    expect(createSpan).toBeDefined();
    expect(createSpan!.kind).toBe(SpanKind.INTERNAL);
    expect(createSpan!.attributes["atlas.project_id"]).toBe(projectId);
    expect(createSpan!.status.code).toBe(0); // UNSET on success
  });
});
```

Add `@opentelemetry/sdk-trace-base` as a dev dep:
```bash
pnpm -F @atlas/spec-graph-data add -D @opentelemetry/sdk-trace-base@1.28.0
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-data test -- test/observability.test.ts
```

Expected: FAIL (no spans found).

- [ ] **Step 3: Implement the observability helper**

`packages/spec-graph-data/src/observability.ts`:
```ts
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Counter, Histogram, Registry } from "prom-client";

const TRACER_NAME = "@atlas/spec-graph-data";
export const tracer = trace.getTracer(TRACER_NAME);

export const registry = new Registry();

export const repoOpCounter = new Counter({
  name: "atlas_spec_graph_repo_ops_total",
  help: "Total spec-graph repo operations",
  labelNames: ["operation", "status"],
  registers: [registry]
});

export const repoOpDuration = new Histogram({
  name: "atlas_spec_graph_repo_op_duration_seconds",
  help: "Duration of spec-graph repo operations in seconds",
  labelNames: ["operation"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry]
});

export async function withSpan<T>(
  operationName: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const start = process.hrtime.bigint();
  return tracer.startActiveSpan(operationName, async (span) => {
    for (const [key, value] of Object.entries(attrs)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.UNSET });
      repoOpCounter.inc({ operation: operationName, status: "ok" });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      repoOpCounter.inc({ operation: operationName, status: "error" });
      throw error;
    } finally {
      const durationNs = process.hrtime.bigint() - start;
      repoOpDuration.observe({ operation: operationName }, Number(durationNs) / 1e9);
      span.end();
    }
  });
}
```

- [ ] **Step 4: Wrap the repo methods with `withSpan`**

Edit `src/repo/spec-graph.repo.ts`, wrapping every public method body. Example for `create`:
```ts
import { withSpan } from "../observability.js";

// ...

  async create(projectId: string, graphData: unknown): Promise<SpecGraphRow> {
    return withSpan("SpecGraphRepo.create", { "atlas.project_id": projectId }, async () =>
      withProjectContext(this.pool, projectId, async (client) => {
        const db = drizzle(client, { schema: { specGraphs } });
        const [row] = await db
          .insert(specGraphs)
          .values({ projectId, graphData: graphData as never })
          .returning();
        if (!row) {
          throw new Error("SpecGraphRepo.create: insert returned no row");
        }
        return row;
      })
    );
  }
```

Wrap `findByProjectId` (span name `SpecGraphRepo.findByProjectId`) and `updateGraphData` (span name `SpecGraphRepo.updateGraphData`) the same way.

Similarly wrap:
- `SpecEventRepo.append` → `SpecEventRepo.append`
- `SpecEventRepo.listSince` → `SpecEventRepo.listSince`
- `SpecEventRepo.getLatest` → `SpecEventRepo.getLatest`
- `SpecSnapshotRepo.create` → `SpecSnapshotRepo.create`
- `SpecSnapshotRepo.findLatest` → `SpecSnapshotRepo.findLatest`

Every span carries `atlas.project_id` as an attribute.

- [ ] **Step 5: Run the observability test**

```bash
pnpm -F @atlas/spec-graph-data test -- test/observability.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 6: Re-run the full suite**

```bash
pnpm -F @atlas/spec-graph-data test
```

Expected: all previous tests still pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-data/src packages/spec-graph-data/test/observability.test.ts packages/spec-graph-data/package.json pnpm-lock.yaml
git commit -m "feat(spec-graph-data): wrap repos with OpenTelemetry spans"
```

---

### Task 18: Prometheus metrics exposure

**Files:**
- Modify: `packages/spec-graph-data/test/observability.test.ts`
- Modify: `packages/spec-graph-data/src/index.ts`

- [ ] **Step 1: Add failing test**

Append to `test/observability.test.ts`:
```ts
import { registry } from "../src/observability.js";

describe("observability: prometheus metrics", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    registry.resetMetrics();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("increments the ops counter on every successful call", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/atlas_spec_graph_repo_ops_total\{operation="SpecGraphRepo\.create",status="ok"\} 1/);
  });

  it("records a duration observation", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/atlas_spec_graph_repo_op_duration_seconds_count\{operation="SpecGraphRepo\.create"\} 1/);
  });

  it("tracks error status on failure", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    await expect(repo.create(projectId, {})).rejects.toThrow();
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/atlas_spec_graph_repo_ops_total\{operation="SpecGraphRepo\.create",status="error"\} 1/);
  });
});
```

- [ ] **Step 2: Run to confirm failure / identify any regressions**

```bash
pnpm -F @atlas/spec-graph-data test -- test/observability.test.ts
```

If Task 17's implementation is correct, these should already pass because metrics are emitted alongside spans. If not (metrics never incremented), inspect the `withSpan` implementation.

- [ ] **Step 3: Expose the registry from the public API**

Edit `src/index.ts`:
```ts
export { registry as metricsRegistry, repoOpCounter, repoOpDuration } from "./observability.js";
```

Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-data/src packages/spec-graph-data/test/observability.test.ts
git commit -m "feat(spec-graph-data): expose Prometheus metrics registry for scraping"
```

---

### Task 19: Public index — typed public API

**Files:**
- Modify: `packages/spec-graph-data/src/index.ts`

- [ ] **Step 1: Write the full public API surface**

`packages/spec-graph-data/src/index.ts`:
```ts
export { PACKAGE_NAME } from "./identity.js";

export { createDatabase } from "./client.js";
export type { Database, DrizzleDb, Schema } from "./client.js";

export { withProjectContext } from "./tenant.js";

export { SpecGraphRepo } from "./repo/spec-graph.repo.js";
export { SpecEventRepo } from "./repo/spec-event.repo.js";
export type { AppendEventInput } from "./repo/spec-event.repo.js";
export { SpecSnapshotRepo } from "./repo/spec-snapshot.repo.js";
export type { CreateSnapshotInput } from "./repo/spec-snapshot.repo.js";

export {
  specGraphs,
  specEvents,
  specSnapshots
} from "./schema/index.js";
export type {
  SpecGraphRow,
  NewSpecGraphRow,
  SpecEventRow,
  NewSpecEventRow,
  SpecSnapshotRow,
  NewSpecSnapshotRow
} from "./schema/index.js";

export {
  metricsRegistry,
  repoOpCounter,
  repoOpDuration,
  withSpan
} from "./observability.js";
```

Create a tiny `identity.ts` file that holds the package name (keeps `index.ts` import-only, a convention that plays well with tree-shaking):

`packages/spec-graph-data/src/identity.ts`:
```ts
export const PACKAGE_NAME = "@atlas/spec-graph-data";
```

- [ ] **Step 2: Run build + typecheck**

```bash
pnpm -F @atlas/spec-graph-data build
pnpm -F @atlas/spec-graph-data typecheck
```

Expected: both exit 0. `dist/index.d.ts` contains every exported name.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-data/src/index.ts packages/spec-graph-data/src/identity.ts
git commit -m "feat(spec-graph-data): finalize public API exports"
```

---

### Task 20: End-to-end integration test

**Files:**
- Create: `packages/spec-graph-data/test/integration.test.ts`

- [ ] **Step 1: Write the integration test**

`packages/spec-graph-data/test/integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SpecEventRepo,
  SpecGraphRepo,
  SpecSnapshotRepo,
  createDatabase,
  type Database
} from "../src/index.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("integration: full spec-graph lifecycle across two projects with RLS", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let snapshots: SpecSnapshotRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
    snapshots = new SpecSnapshotRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("creates → mutates → snapshots two isolated projects", async () => {
    const pA = uniqueProjectId();
    const pB = uniqueProjectId();

    // Create graphs for both projects
    await graphs.create(pA, { name: "alpha" });
    await graphs.create(pB, { name: "beta" });

    // Append events to each
    const eA1 = await events.append(pA, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    const eA2 = await events.append(pA, { eventType: "edge.created", payload: { from: "n1", to: "n2" }, actor: "architect" });
    const eB1 = await events.append(pB, { eventType: "node.created", payload: { id: "m1" }, actor: "developer" });

    // Update graph payloads + current_event_seq
    await graphs.updateGraphData(pA, { nodes: ["n1", "n2"], edges: [["n1", "n2"]] }, eA2.id);
    await graphs.updateGraphData(pB, { nodes: ["m1"] }, eB1.id);

    // Take snapshots
    await snapshots.create(pA, { upToEventId: eA2.id, graphData: { nodes: ["n1", "n2"] }, reason: "manual" });
    await snapshots.create(pB, { upToEventId: eB1.id, graphData: { nodes: ["m1"] }, reason: "manual" });

    // Verify RLS: A cannot see B's events, snapshots, or graph
    const aEvents = await events.listSince(pA, 0n);
    expect(aEvents.map((e) => e.eventType)).toEqual(["node.created", "edge.created"]);
    expect(aEvents.every((e) => e.projectId === pA)).toBe(true);

    const aSnap = await snapshots.findLatest(pA);
    expect(aSnap?.projectId).toBe(pA);
    expect(aSnap?.graphData).toEqual({ nodes: ["n1", "n2"] });

    const aGraph = await graphs.findByProjectId(pA);
    expect(aGraph?.currentEventSeq).toBe(eA2.id);

    // Confirm B's events are untouched and also isolated
    const bEvents = await events.listSince(pB, 0n);
    expect(bEvents.map((e) => e.eventType)).toEqual(["node.created"]);
    expect(bEvents.every((e) => e.projectId === pB)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
pnpm -F @atlas/spec-graph-data test -- test/integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full suite to confirm no regressions**

```bash
pnpm -F @atlas/spec-graph-data test
```

Expected: all tests pass (approximately 22+ tests).

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-data/test/integration.test.ts
git commit -m "test(spec-graph-data): add end-to-end integration across two projects"
```

---

### Task 21: Package README

**Files:**
- Create: `packages/spec-graph-data/README.md`

- [ ] **Step 1: Write the README**

`packages/spec-graph-data/README.md`:
````markdown
# @atlas/spec-graph-data

Postgres mirror for the Atlas Living Spec Graph.

This package owns the data substrate: table schemas, migrations, repositories, tenant isolation, and observability. It does **not** parse or validate the graph payload — that is `@atlas/spec-graph-schema` (Unit B).

## Tables

- `spec_graphs` — one row per project; current materialized graph.
- `spec_events` — append-only event log (one row per mutation).
- `spec_snapshots` — point-in-time snapshots for recovery and compaction.

All three tables have Row-Level Security enabled. Access must go through `withProjectContext` (which sets a session-local `app.project_id` inside a transaction) or the repos (which do this for you).

## Usage

```ts
import { createDatabase, SpecGraphRepo, SpecEventRepo } from "@atlas/spec-graph-data";

const db = createDatabase(process.env.DATABASE_URL!);
const graphs = new SpecGraphRepo(db.pool);
const events = new SpecEventRepo(db.pool);

await graphs.create(projectId, { nodes: [], edges: [] });
await events.append(projectId, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
```

## Environment

```
DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas_dev
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5432/atlas_test
```

## Developing

```bash
# From repo root
pnpm db:up                                       # bring up Postgres 16
pnpm -F @atlas/spec-graph-data db:generate       # generate a new migration from schema diff
pnpm -F @atlas/spec-graph-data db:migrate        # apply migrations to $DATABASE_URL
pnpm -F @atlas/spec-graph-data test              # run the suite (requires Postgres up)
pnpm -F @atlas/spec-graph-data build             # emit dist/
```

## Observability

Every repo method emits an OpenTelemetry span named `<RepoClass>.<method>` with `atlas.project_id` attribute, and increments:

- `atlas_spec_graph_repo_ops_total{operation, status}` (counter)
- `atlas_spec_graph_repo_op_duration_seconds{operation}` (histogram)

Consumers scrape via `metricsRegistry.metrics()`.
````

- [ ] **Step 2: Commit**

```bash
git add packages/spec-graph-data/README.md
git commit -m "docs(spec-graph-data): add package README"
```

---

## Completion Checklist

After finishing all 21 tasks, verify:

- [ ] `pnpm -F @atlas/spec-graph-data test` — all tests green
- [ ] `pnpm -F @atlas/spec-graph-data build` — exits 0, `dist/` populated
- [ ] `pnpm -F @atlas/spec-graph-data typecheck` — exits 0
- [ ] `docker compose down && docker compose up -d && pnpm -F @atlas/spec-graph-data db:migrate && pnpm -F @atlas/spec-graph-data test` — full cold-start works
- [ ] `pnpm install` on a fresh clone (or `git clean -xfd && pnpm install`) succeeds without manual steps
- [ ] `packages/spec-graph-data/README.md` documents the package

## Handoff to Plan A.2

Plan A.2 (file ↔ mirror sync daemon) depends on:

- `createDatabase`, `SpecGraphRepo`, `SpecEventRepo`, `SpecSnapshotRepo` — public API from this plan.
- RLS helpers — the daemon uses the same repos, so tenant isolation is inherited.
- Observability — A.2 extends the Prometheus registry with its own counters (watch events, propagation latency, conflict count).

Nothing in A.2 should add new Postgres tables; any new persistence needs are an extension of one of the three tables above. If A.2 discovers a schema gap, that is a change to this package, not an additional table.
