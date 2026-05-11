# Spec Graph Compaction + Offline/Local Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Unit A by shipping (a) a compaction policy for the Spec Graph mirror that keeps `spec_events` bounded via a snapshot-plus-tail model with cold-storage archival, and (b) an offline/local export-and-import pipeline that makes the whole stack run on a user's laptop against a Docker-Compose Postgres — the PRD's explicit requirement for "privacy-sensitive work (health, gov, regulated industries)." This is Plan A.4 of Unit A in Phase A.

**Architecture:** A single new workspace package (`packages/spec-graph-ops`, published as `@atlas/spec-graph-ops`) owns both responsibilities. Compaction is triggered by a standalone CLI (`atlas-compactor`) with `run` (one-shot) and `daemon` (long-lived loop) subcommands. Offline mode is driven by a second CLI (`atlas-offline`) with `export` and `import` subcommands. The package depends on `@atlas/spec-graph-data` (workspace:\*) for the pool/schema/repos from Plan A.1 and extends the same Prometheus registry with its own metrics. S3 is an optional cold-storage target; default is a local filesystem directory. Compaction runs under a Postgres advisory lock per project — it never blocks appenders because it uses `SELECT … FOR UPDATE SKIP LOCKED` on old event rows.

**Tech Stack:** TypeScript 5.5+ · Node 22 LTS · pnpm workspaces · `pg` (node-postgres, transitively via `@atlas/spec-graph-data`) · `commander` (CLIs) · `tar` (node-tar) · `zlib` (Node built-in) · `zod` (manifest validation, local to this package) · `@aws-sdk/client-s3` (optional peer, loaded lazily when `ATLAS_COLD_STORAGE_S3_URL` is set) · Vitest 2.x · `@opentelemetry/api` · `prom-client` (shared registry from A.1).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan A.1 (`@atlas/spec-graph-data`) merged and green.
- Plan A.2 (file ↔ mirror sync daemon) merged and green.
- Node 22 LTS (`node --version` ≥ v22.0.0) and pnpm 9+ (`corepack prepare pnpm@latest --activate`).
- Docker Desktop (or Docker Engine + Compose plugin), with the daemon running — the A.1 `docker-compose.yml` at the repo root provides Postgres 16.
- `psql` client on PATH (for verification commands).
- Optionally, `minio` running locally (or real AWS creds) for the S3 adapter test — tests skip cleanly when `ATLAS_COLD_STORAGE_S3_URL` is unset.

---

## File Structure

Files this plan creates. Paths are relative to the repo root `f:/claude/ai_builder/`.

```
packages/
  spec-graph-ops/
    package.json                                    # package manifest
    tsconfig.json                                   # extends base
    vitest.config.ts                                # test runner config
    README.md                                       # package docs
    src/
      index.ts                                      # public exports
      logger.ts                                     # pino-style structured logger
      observability.ts                              # OTel tracer + new counters/histograms
      compaction/
        compactor.ts                                # core compaction logic
        cold-storage.ts                             # fs + lazy-S3 archival adapter
        advisory-lock.ts                            # Postgres advisory lock helper
      offline/
        manifest.ts                                 # manifest schema + zod validators
        exporter.ts                                 # project → .tar.gz
        importer.ts                                 # .tar.gz → project
      cli/
        compactor.cli.ts                            # commander program for atlas-compactor
        offline.cli.ts                              # commander program for atlas-offline
    bin/
      atlas-compactor.js                            # thin shim loading cli/compactor.cli.js
      atlas-offline.js                              # thin shim loading cli/offline.cli.js
    test/
      setup.ts                                      # reuse A.1's Postgres bootstrap pattern
      helpers.ts                                    # project seeder + tar inspection helpers
      advisory-lock.test.ts
      cold-storage-fs.test.ts
      cold-storage-s3.test.ts                       # skipped if S3 env not set
      compactor.test.ts
      compactor-idempotent.test.ts
      manifest.test.ts
      exporter.test.ts
      importer.test.ts
      roundtrip.test.ts
      compactor.cli.test.ts
      offline.cli.test.ts
      integration.test.ts                           # seed → compact → export → wipe → import → verify
```

**Why this shape.** One package, two related operational concerns that share the same A.1-anchored substrate (advisory locks, cold storage, observability registry). Compaction and offline export both need to serialize batches of events and snapshots — sharing a module tree avoids duplication. CLIs live next to their library code; thin `bin/` shims keep `package.json#bin` entries simple.

**What Plan A.4 does NOT build.** Schedule orchestration (cron/systemd/k8s Jobs — left to ops). Any UI around compaction policy. Sync-daemon changes (A.2 already works unchanged against a Docker-Compose Postgres the user imports into). Graph-schema awareness — `graph_data` and `payload` remain opaque here, exactly as in A.1.

---

## Design Notes

### Compaction model: snapshot + tail

- The **tail** is the last N events per project retained in `spec_events`. Default N = 1000, configurable via `ATLAS_EVENT_TAIL_LENGTH`.
- Events older than the tail are **rolled up** into a row in `spec_snapshots` with `reason = 'compaction'`, whose `graph_data` is the materialized graph state at `up_to_event_id = <last-compacted-event-id>`.
- The compacted events are then **archived** to cold storage as `.jsonl.gz` batches and **deleted** from `spec_events`.
- Compaction is **idempotent**: if a project already has ≤ N events, the compactor no-ops without writing a snapshot or archive.
- **Materialization strategy:** the snapshot payload is derived by taking the `spec_graphs.graph_data` for the project as of the most recent event being compacted — i.e. we snapshot the authoritative graph state, not replay events. The event log is history, not truth; the `spec_graphs` row is truth. `up_to_event_id` records where history was trimmed.

### Concurrency safety

- Each compaction acquires a Postgres advisory lock keyed on `hashtext('atlas.compact:' || project_id)` via `pg_try_advisory_lock(bigint)`. If the lock is held, the compactor skips that project (and emits the `skipped-no-work` metric path). Only one compaction per project runs concurrently.
- Writers (event appenders, graph updaters in A.1 / A.2) do **not** acquire the lock. They continue unimpeded.
- The compactor's row-level selection uses `SELECT … FOR UPDATE SKIP LOCKED` so a long-running appender's unrelated locks never block compaction.

### Cold-storage layout

- Local filesystem root: `ATLAS_COLD_STORAGE_DIR` (default `./atlas-cold-storage`).
- File naming: `<projectId>/<fromEventId>-<toEventId>.jsonl.gz` (inclusive range, zero-padded to 20 digits for lexical sort).
- Each `.jsonl.gz` contains one JSON-encoded `SpecEventRow` per line (decompressed).
- S3 target: when `ATLAS_COLD_STORAGE_S3_URL` is set (e.g. `s3://atlas-cold/prod`), the adapter uses the same key structure under the given prefix. The `@aws-sdk/client-s3` import is lazy — if the env var is unset, the SDK is never loaded and does not need to be installed for local development.

### Offline archive format

- `.tar.gz` containing:
  - `manifest.json` — export metadata, schema version (`1`), table of contents, SHA-256 of each included blob.
  - `spec_graph.json` — single object `{ projectId, schemaVersion, graphData, currentEventSeq, createdAt, updatedAt }`.
  - `events.jsonl` — newline-delimited `SpecEventRow` rows currently in the DB (the tail).
  - `snapshots.jsonl` — newline-delimited `SpecSnapshotRow` rows.
  - `archives/<from>-<to>.jsonl.gz` — every cold-storage archive the snapshots reference, shipped verbatim so the import side does not need cold-storage access.

### Docker-Compose cohabitation

The PRD calls out: "Offline/local mode: the whole stack runs on the user's laptop via Docker Compose for privacy-sensitive work." A user runs `docker compose up -d postgres` from the Atlas repo root (A.1's Compose file), runs `pnpm -F @atlas/spec-graph-data db:migrate` against `postgresql://atlas:atlas@localhost:5432/atlas_dev`, then `atlas-offline import --archive <file.tar.gz> --database-url postgresql://atlas:atlas@localhost:5432/atlas_dev`. The sync daemon from A.2 works unchanged against this local Postgres. Task 15 documents the full recipe in the README.

---

## Task List (15 tasks)

Each task is TDD-shaped: write the failing test, run it red, write minimal code, run it green, commit. Every task commits. Commits use Conventional Commits prefixes.

---

### Task 1: `packages/spec-graph-ops` package scaffold

**Files:**
- Create: `packages/spec-graph-ops/package.json`
- Create: `packages/spec-graph-ops/tsconfig.json`
- Create: `packages/spec-graph-ops/vitest.config.ts`
- Create: `packages/spec-graph-ops/src/index.ts`
- Create: `packages/spec-graph-ops/bin/atlas-compactor.js`
- Create: `packages/spec-graph-ops/bin/atlas-offline.js`

- [ ] **Step 1: Write `packages/spec-graph-ops/package.json`**

```json
{
  "name": "@atlas/spec-graph-ops",
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
  "bin": {
    "atlas-compactor": "./bin/atlas-compactor.js",
    "atlas-offline": "./bin/atlas-offline.js"
  },
  "files": ["dist", "bin"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/spec-graph-data": "workspace:*",
    "@opentelemetry/api": "1.9.0",
    "commander": "12.1.0",
    "prom-client": "15.1.3",
    "tar": "7.4.3",
    "zod": "3.23.8"
  },
  "peerDependencies": {
    "@aws-sdk/client-s3": "^3.670.0"
  },
  "peerDependenciesMeta": {
    "@aws-sdk/client-s3": { "optional": true }
  },
  "devDependencies": {
    "@aws-sdk/client-s3": "3.670.0",
    "@types/node": "22.9.0",
    "@types/tar": "6.1.13",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Write `packages/spec-graph-ops/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "bin"]
}
```

- [ ] **Step 3: Write `packages/spec-graph-ops/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    globalSetup: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    fileParallel: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
```

**Why single-fork.** Same reason as A.1: shared Postgres DB across tests; cold-storage filesystem root is also shared within a run.

- [ ] **Step 4: Write the placeholder public entrypoint**

`packages/spec-graph-ops/src/index.ts`:
```ts
export const PACKAGE_NAME = "@atlas/spec-graph-ops";
```

- [ ] **Step 5: Write the bin shims**

`packages/spec-graph-ops/bin/atlas-compactor.js`:
```js
#!/usr/bin/env node
import("../dist/cli/compactor.cli.js").then((m) => m.main(process.argv));
```

`packages/spec-graph-ops/bin/atlas-offline.js`:
```js
#!/usr/bin/env node
import("../dist/cli/offline.cli.js").then((m) => m.main(process.argv));
```

- [ ] **Step 6: Install and verify build**

Run:
```bash
pnpm install
pnpm -F @atlas/spec-graph-ops build
pnpm -F @atlas/spec-graph-ops typecheck
```

Expected: all three exit 0. `packages/spec-graph-ops/dist/index.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-ops pnpm-lock.yaml
git commit -m "feat(spec-graph-ops): scaffold package with commander + tar + zod + optional S3 peer"
```

---

### Task 2: Logger + observability module

**Files:**
- Create: `packages/spec-graph-ops/src/logger.ts`
- Create: `packages/spec-graph-ops/src/observability.ts`
- Create: `packages/spec-graph-ops/test/setup.ts`
- Create: `packages/spec-graph-ops/test/helpers.ts`
- Create: `packages/spec-graph-ops/test/observability.test.ts`

- [ ] **Step 1: Write the test setup (mirrors A.1)**

`packages/spec-graph-ops/test/setup.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "pg";

const TEST_URL = "postgresql://atlas:atlas@localhost:5432/atlas_test";
process.env.DATABASE_URL_TEST = TEST_URL;

export async function setup() {
  const pool = new Pool({ connectionString: TEST_URL });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO atlas");

    // Reuse the A.1 migrations verbatim.
    const migrationDir = resolve(__dirname, "..", "..", "spec-graph-data", "drizzle");
    const files = readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationDir, file), "utf8");
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

- [ ] **Step 2: Write shared test helpers**

`packages/spec-graph-ops/test/helpers.ts`:
```ts
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type Database } from "@atlas/spec-graph-data";

export function uniqueProjectId(): string {
  return randomUUID();
}

export function createTestDb(): Database {
  return createDatabase(process.env.DATABASE_URL_TEST!);
}

export async function truncateAll(db: Database): Promise<void> {
  await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
}

export function makeTempColdStorageDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "atlas-cold-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
```

- [ ] **Step 3: Write the failing observability test**

`packages/spec-graph-ops/test/observability.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  compactionRuns,
  compactionEventsCompacted,
  compactionSnapshotBytes,
  compactionDuration,
  offlineExportRuns,
  offlineExportArchiveBytes,
  offlineImportRuns,
  opsRegistry
} from "../src/observability.js";

describe("observability: compaction + offline metrics", () => {
  it("exposes all required counters and histograms with exact names", async () => {
    compactionRuns.inc({ result: "ok" });
    compactionEventsCompacted.inc(42);
    compactionSnapshotBytes.observe(1024);
    compactionDuration.observe(0.5);
    offlineExportRuns.inc({ result: "ok" });
    offlineExportArchiveBytes.observe(2048);
    offlineImportRuns.inc({ result: "ok" });

    const out = await opsRegistry.metrics();
    expect(out).toMatch(/atlas_compaction_runs_total\{result="ok"\} 1/);
    expect(out).toMatch(/atlas_compaction_events_compacted_total 42/);
    expect(out).toMatch(/atlas_compaction_snapshot_bytes_count 1/);
    expect(out).toMatch(/atlas_compaction_duration_seconds_count 1/);
    expect(out).toMatch(/atlas_offline_export_runs_total\{result="ok"\} 1/);
    expect(out).toMatch(/atlas_offline_export_archive_bytes_count 1/);
    expect(out).toMatch(/atlas_offline_import_runs_total\{result="ok"\} 1/);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run:
```bash
pnpm -F @atlas/spec-graph-ops test -- test/observability.test.ts
```

Expected: FAIL (cannot find `../src/observability.js`).

- [ ] **Step 5: Implement the logger and observability module**

`packages/spec-graph-ops/src/logger.ts`:
```ts
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields)
};
```

`packages/spec-graph-ops/src/observability.ts`:
```ts
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Counter, Histogram, Registry } from "prom-client";

const TRACER_NAME = "@atlas/spec-graph-ops";
export const tracer = trace.getTracer(TRACER_NAME);

export const opsRegistry = new Registry();

export const compactionRuns = new Counter({
  name: "atlas_compaction_runs_total",
  help: "Total compaction runs",
  labelNames: ["result"], // ok | skipped-no-work | error
  registers: [opsRegistry]
});

export const compactionEventsCompacted = new Counter({
  name: "atlas_compaction_events_compacted_total",
  help: "Total events rolled up into snapshots + archived",
  registers: [opsRegistry]
});

export const compactionSnapshotBytes = new Histogram({
  name: "atlas_compaction_snapshot_bytes",
  help: "Size in bytes of each compaction snapshot payload",
  buckets: [1024, 10_240, 102_400, 1_048_576, 10_485_760, 104_857_600],
  registers: [opsRegistry]
});

export const compactionDuration = new Histogram({
  name: "atlas_compaction_duration_seconds",
  help: "Duration of a single compaction run in seconds",
  buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [opsRegistry]
});

export const offlineExportRuns = new Counter({
  name: "atlas_offline_export_runs_total",
  help: "Total offline-export runs",
  labelNames: ["result"],
  registers: [opsRegistry]
});

export const offlineExportArchiveBytes = new Histogram({
  name: "atlas_offline_export_archive_bytes",
  help: "Size in bytes of each offline-export archive",
  buckets: [102_400, 1_048_576, 10_485_760, 104_857_600, 1_073_741_824],
  registers: [opsRegistry]
});

export const offlineImportRuns = new Counter({
  name: "atlas_offline_import_runs_total",
  help: "Total offline-import runs",
  labelNames: ["result"],
  registers: [opsRegistry]
});

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.UNSET });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 6: Run to verify pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/observability.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-ops/src/logger.ts \
        packages/spec-graph-ops/src/observability.ts \
        packages/spec-graph-ops/test/setup.ts \
        packages/spec-graph-ops/test/helpers.ts \
        packages/spec-graph-ops/test/observability.test.ts
git commit -m "feat(spec-graph-ops): add logger and Prometheus registry for compaction + offline"
```

---

### Task 3: Advisory-lock helper

**Files:**
- Create: `packages/spec-graph-ops/src/compaction/advisory-lock.ts`
- Create: `packages/spec-graph-ops/test/advisory-lock.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/advisory-lock.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withAdvisoryLock, projectLockKey } from "../src/compaction/advisory-lock.js";
import { createTestDb, truncateAll, uniqueProjectId } from "./helpers.js";
import type { Database } from "@atlas/spec-graph-data";

describe("withAdvisoryLock", () => {
  let db: Database;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("runs the callback when the lock is free and returns its value", async () => {
    const key = projectLockKey(uniqueProjectId());
    const result = await withAdvisoryLock(db.pool, key, async () => "done");
    expect(result).toEqual({ acquired: true, value: "done" });
  });

  it("returns acquired=false without running the callback if the lock is held", async () => {
    const projectId = uniqueProjectId();
    const key = projectLockKey(projectId);

    // Acquire outside the helper on a dedicated connection and hold it.
    const holder = await db.pool.connect();
    await holder.query("SELECT pg_advisory_lock($1)", [key]);

    try {
      let ran = false;
      const result = await withAdvisoryLock(db.pool, key, async () => {
        ran = true;
        return "nope";
      });
      expect(result).toEqual({ acquired: false });
      expect(ran).toBe(false);
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1)", [key]);
      holder.release();
    }
  });

  it("releases the lock even if the callback throws", async () => {
    const key = projectLockKey(uniqueProjectId());
    await expect(
      withAdvisoryLock(db.pool, key, async () => {
        throw new Error("kaboom");
      })
    ).rejects.toThrow("kaboom");

    // Lock should be free: a second attempt acquires.
    const second = await withAdvisoryLock(db.pool, key, async () => "ok");
    expect(second).toEqual({ acquired: true, value: "ok" });
  });

  it("projectLockKey is deterministic and fits in a bigint", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const a = projectLockKey(id);
    const b = projectLockKey(id);
    expect(a).toBe(b);
    expect(typeof a).toBe("number");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/advisory-lock.test.ts
```

Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement the helper**

`packages/spec-graph-ops/src/compaction/advisory-lock.ts`:
```ts
import type { Pool } from "pg";

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Compute a stable 32-bit lock key for a project. Postgres advisory locks
 * accept a single bigint or a pair of ints; we use the single-bigint form,
 * populated from hashtext on the server side when called via SQL. For the
 * client-side helper we pre-compute a JS integer hash to avoid a round-trip.
 */
export function projectLockKey(projectId: string): number {
  const input = `atlas.compact:${projectId}`;
  // FNV-1a 32-bit; deterministic, dependency-free, fits in a Postgres int4.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Map to signed 32-bit so pg's int conversion is happy.
  return hash | 0;
}

export async function withAdvisoryLock<T>(
  pool: Pool,
  key: number,
  fn: () => Promise<T>
): Promise<LockResult<T>> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ got: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS got",
      [key]
    );
    if (!rows[0]?.got) {
      return { acquired: false };
    }
    try {
      const value = await fn();
      return { acquired: true, value };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {
        /* swallow — the connection release below will reset state anyway */
      });
    }
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/advisory-lock.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-ops/src/compaction/advisory-lock.ts \
        packages/spec-graph-ops/test/advisory-lock.test.ts
git commit -m "feat(spec-graph-ops): add per-project Postgres advisory-lock helper"
```

---

### Task 4: Cold-storage filesystem adapter

**Files:**
- Create: `packages/spec-graph-ops/src/compaction/cold-storage.ts`
- Create: `packages/spec-graph-ops/test/cold-storage-fs.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/cold-storage-fs.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { makeTempColdStorageDir, uniqueProjectId } from "./helpers.js";

describe("cold-storage filesystem adapter", () => {
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeEach(() => {
    workspace = makeTempColdStorageDir();
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it("writes a .jsonl.gz archive at <dir>/<projectId>/<from>-<to>.jsonl.gz", async () => {
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const projectId = uniqueProjectId();
    const lines = [
      JSON.stringify({ id: "1", event_type: "x" }),
      JSON.stringify({ id: "2", event_type: "y" })
    ];

    const { key, bytes } = await storage.putArchive({
      projectId,
      fromEventId: 1n,
      toEventId: 2n,
      jsonl: lines.join("\n") + "\n"
    });

    expect(key).toMatch(/^[0-9a-f-]{36}\/00000000000000000001-00000000000000000002\.jsonl\.gz$/);
    expect(bytes).toBeGreaterThan(0);

    const path = join(workspace.dir, key);
    expect(existsSync(path)).toBe(true);
    const decompressed = gunzipSync(readFileSync(path)).toString("utf8");
    expect(decompressed).toBe(lines.join("\n") + "\n");
  });

  it("reads an archive back via getArchive", async () => {
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const projectId = uniqueProjectId();
    const payload = "{\"a\":1}\n{\"b\":2}\n";

    const { key } = await storage.putArchive({
      projectId,
      fromEventId: 10n,
      toEventId: 20n,
      jsonl: payload
    });
    const result = await storage.getArchive(key);
    expect(result).toBe(payload);
  });

  it("deleteArchive removes the file", async () => {
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const projectId = uniqueProjectId();
    const { key } = await storage.putArchive({ projectId, fromEventId: 1n, toEventId: 1n, jsonl: "{}\n" });
    await storage.deleteArchive(key);
    expect(existsSync(join(workspace.dir, key))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/cold-storage-fs.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the cold-storage adapter**

`packages/spec-graph-ops/src/compaction/cold-storage.ts`:
```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export interface PutArchiveInput {
  projectId: string;
  fromEventId: bigint;
  toEventId: bigint;
  jsonl: string;
}

export interface PutArchiveResult {
  key: string;   // relative key (projectId/<from>-<to>.jsonl.gz)
  bytes: number; // compressed size
}

export interface ColdStorage {
  putArchive(input: PutArchiveInput): Promise<PutArchiveResult>;
  getArchive(key: string): Promise<string>;
  deleteArchive(key: string): Promise<void>;
}

export type ColdStorageConfig =
  | { kind: "fs"; dir: string }
  | { kind: "s3"; url: string };

function archiveKey(projectId: string, fromEventId: bigint, toEventId: bigint): string {
  const pad = (n: bigint) => n.toString().padStart(20, "0");
  return `${projectId}/${pad(fromEventId)}-${pad(toEventId)}.jsonl.gz`;
}

function createFsStorage(dir: string): ColdStorage {
  return {
    async putArchive(input) {
      const key = archiveKey(input.projectId, input.fromEventId, input.toEventId);
      const fullPath = join(dir, key);
      mkdirSync(dirname(fullPath), { recursive: true });
      const compressed = gzipSync(Buffer.from(input.jsonl, "utf8"));
      writeFileSync(fullPath, compressed);
      return { key, bytes: compressed.byteLength };
    },
    async getArchive(key) {
      return gunzipSync(readFileSync(join(dir, key))).toString("utf8");
    },
    async deleteArchive(key) {
      rmSync(join(dir, key), { force: true });
    }
  };
}

export function createColdStorage(config: ColdStorageConfig): ColdStorage {
  if (config.kind === "fs") return createFsStorage(config.dir);
  // S3 is implemented in Task 5 via lazy import.
  return createS3StorageLazy(config.url);
}

function createS3StorageLazy(url: string): ColdStorage {
  let inner: ColdStorage | null = null;
  async function load(): Promise<ColdStorage> {
    if (inner) return inner;
    const mod = await import("./cold-storage-s3.js");
    inner = mod.createS3Storage(url);
    return inner;
  }
  return {
    async putArchive(input) { return (await load()).putArchive(input); },
    async getArchive(key)   { return (await load()).getArchive(key); },
    async deleteArchive(k)  { return (await load()).deleteArchive(k); }
  };
}

export function coldStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ColdStorage {
  if (env.ATLAS_COLD_STORAGE_S3_URL) {
    return createColdStorage({ kind: "s3", url: env.ATLAS_COLD_STORAGE_S3_URL });
  }
  return createColdStorage({ kind: "fs", dir: env.ATLAS_COLD_STORAGE_DIR ?? "./atlas-cold-storage" });
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/cold-storage-fs.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-ops/src/compaction/cold-storage.ts \
        packages/spec-graph-ops/test/cold-storage-fs.test.ts
git commit -m "feat(spec-graph-ops): add filesystem cold-storage adapter with gzip + lazy S3 shim"
```

---

### Task 5: Cold-storage S3 adapter

**Files:**
- Create: `packages/spec-graph-ops/src/compaction/cold-storage-s3.ts`
- Create: `packages/spec-graph-ops/test/cold-storage-s3.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/cold-storage-s3.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { uniqueProjectId } from "./helpers.js";

const S3_URL = process.env.ATLAS_COLD_STORAGE_S3_URL;
const skip = !S3_URL;

describe.skipIf(skip)("cold-storage S3 adapter", () => {
  it("round-trips an archive through S3", async () => {
    const storage = createColdStorage({ kind: "s3", url: S3_URL! });
    const projectId = uniqueProjectId();
    const payload = "{\"a\":1}\n";

    const { key } = await storage.putArchive({
      projectId,
      fromEventId: 1n,
      toEventId: 1n,
      jsonl: payload
    });
    try {
      const result = await storage.getArchive(key);
      expect(result).toBe(payload);
    } finally {
      await storage.deleteArchive(key);
    }
  });
});
```

- [ ] **Step 2: Run (without S3 env) to confirm it skips**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/cold-storage-s3.test.ts
```

Expected: 1 test **skipped** (no failures).

- [ ] **Step 3: Implement the S3 adapter**

`packages/spec-graph-ops/src/compaction/cold-storage-s3.ts`:
```ts
import { gunzipSync, gzipSync } from "node:zlib";
import type { ColdStorage } from "./cold-storage.js";

// Parse s3://bucket/prefix into { bucket, prefix }
function parseS3Url(url: string): { bucket: string; prefix: string } {
  const match = /^s3:\/\/([^/]+)(?:\/(.*))?$/.exec(url);
  if (!match) throw new Error(`Invalid S3 URL: ${url}`);
  const bucket = match[1]!;
  const prefix = (match[2] ?? "").replace(/\/+$/, "");
  return { bucket, prefix };
}

export function createS3Storage(url: string): ColdStorage {
  // Lazy require so the SDK is only loaded when the S3 adapter is actually used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    require("@aws-sdk/client-s3") as typeof import("@aws-sdk/client-s3");

  const client = new S3Client({});
  const { bucket, prefix } = parseS3Url(url);
  const fullKey = (key: string) => (prefix ? `${prefix}/${key}` : key);

  function archiveKey(projectId: string, fromEventId: bigint, toEventId: bigint): string {
    const pad = (n: bigint) => n.toString().padStart(20, "0");
    return `${projectId}/${pad(fromEventId)}-${pad(toEventId)}.jsonl.gz`;
  }

  return {
    async putArchive(input) {
      const key = archiveKey(input.projectId, input.fromEventId, input.toEventId);
      const compressed = gzipSync(Buffer.from(input.jsonl, "utf8"));
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: fullKey(key), Body: compressed }));
      return { key, bytes: compressed.byteLength };
    },
    async getArchive(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) }));
      const chunks: Buffer[] = [];
      const stream = result.Body as NodeJS.ReadableStream;
      for await (const c of stream) chunks.push(c as Buffer);
      return gunzipSync(Buffer.concat(chunks)).toString("utf8");
    },
    async deleteArchive(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(key) }));
    }
  };
}
```

- [ ] **Step 4: Run with S3 env set to confirm it passes**

If you have a MinIO running locally:
```bash
export ATLAS_COLD_STORAGE_S3_URL=s3://atlas-cold-test/prefix
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_ENDPOINT_URL=http://localhost:9000
export AWS_REGION=us-east-1
pnpm -F @atlas/spec-graph-ops test -- test/cold-storage-s3.test.ts
```

Expected: PASS (1 test) when S3 env is set; skipped otherwise.

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-ops/src/compaction/cold-storage-s3.ts \
        packages/spec-graph-ops/test/cold-storage-s3.test.ts
git commit -m "feat(spec-graph-ops): add optional S3 cold-storage adapter via lazy SDK load"
```

---

### Task 6: Compactor core

**Files:**
- Create: `packages/spec-graph-ops/src/compaction/compactor.ts`
- Create: `packages/spec-graph-ops/test/compactor.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/compactor.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { compactProject } from "../src/compaction/compactor.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("compactProject: snapshot + tail + archive", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("compacts old events into a snapshot + archive, leaving N in the tail", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { marker: "initial" });

    const total = 250;
    const tailLength = 100;
    for (let i = 0; i < total; i++) {
      await events.append(projectId, {
        eventType: "node.created",
        payload: { i },
        actor: "test"
      });
    }

    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const result = await compactProject({
      pool: db.pool,
      projectId,
      tailLength,
      storage
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.eventsCompacted).toBe(total - tailLength);
    expect(result.archiveKey).toMatch(/\.jsonl\.gz$/);

    // Tail: exactly tailLength events remain
    const tail = await events.listSince(projectId, 0n, total);
    expect(tail).toHaveLength(tailLength);

    // A compaction snapshot row exists
    const { rows } = await db.pool.query<{ reason: string; up_to_event_id: string }>(
      "SELECT reason, up_to_event_id FROM spec_snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
      [projectId]
    );
    expect(rows[0]?.reason).toBe("compaction");
    expect(BigInt(rows[0]!.up_to_event_id)).toBe(BigInt(total - tailLength));

    // Archive present at the expected key
    const roundtrip = await storage.getArchive(result.archiveKey);
    const lines = roundtrip.trim().split("\n");
    expect(lines).toHaveLength(total - tailLength);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/compactor.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the compactor**

`packages/spec-graph-ops/src/compaction/compactor.ts`:
```ts
import type { Pool, PoolClient } from "pg";
import { logger } from "../logger.js";
import {
  compactionDuration,
  compactionEventsCompacted,
  compactionRuns,
  compactionSnapshotBytes,
  withSpan
} from "../observability.js";
import { projectLockKey, withAdvisoryLock } from "./advisory-lock.js";
import type { ColdStorage } from "./cold-storage.js";

export interface CompactProjectInput {
  pool: Pool;
  projectId: string;
  tailLength: number;
  storage: ColdStorage;
}

export type CompactProjectResult =
  | { status: "ok"; eventsCompacted: number; archiveKey: string; snapshotId: string; upToEventId: bigint }
  | { status: "skipped-no-work"; reason: "under-tail-length" | "lock-held" };

export async function compactProject(input: CompactProjectInput): Promise<CompactProjectResult> {
  const { pool, projectId, tailLength, storage } = input;
  const start = process.hrtime.bigint();
  return withSpan("atlas.compaction", { "atlas.project_id": projectId }, async () => {
    try {
      const lock = await withAdvisoryLock(pool, projectLockKey(projectId), () =>
        runCompaction(pool, projectId, tailLength, storage)
      );
      if (!lock.acquired) {
        compactionRuns.inc({ result: "skipped-no-work" });
        return { status: "skipped-no-work", reason: "lock-held" };
      }
      const result = lock.value;
      if (result.status === "skipped-no-work") {
        compactionRuns.inc({ result: "skipped-no-work" });
      } else {
        compactionRuns.inc({ result: "ok" });
        compactionEventsCompacted.inc(result.eventsCompacted);
      }
      return result;
    } catch (error) {
      compactionRuns.inc({ result: "error" });
      logger.error("compaction failed", { projectId, error: (error as Error).message });
      throw error;
    } finally {
      const durationNs = process.hrtime.bigint() - start;
      compactionDuration.observe(Number(durationNs) / 1e9);
    }
  });
}

async function runCompaction(
  pool: Pool,
  projectId: string,
  tailLength: number,
  storage: ColdStorage
): Promise<CompactProjectResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);

    // Find the id cutoff: keep the top-N newest events in the tail.
    const cutoff = await findCutoff(client, projectId, tailLength);
    if (cutoff === null) {
      await client.query("COMMIT");
      return { status: "skipped-no-work", reason: "under-tail-length" };
    }

    // Select old events under FOR UPDATE SKIP LOCKED so concurrent appenders
    // and unrelated locks never block us.
    const { rows: toArchive } = await client.query<{
      id: string;
      project_id: string;
      event_type: string;
      payload: unknown;
      actor: string | null;
      created_at: string;
    }>(
      `SELECT id, project_id, event_type, payload, actor, created_at
         FROM spec_events
        WHERE project_id = $1 AND id <= $2
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED`,
      [projectId, cutoff.toString()]
    );

    if (toArchive.length === 0) {
      await client.query("COMMIT");
      return { status: "skipped-no-work", reason: "under-tail-length" };
    }

    const fromEventId = BigInt(toArchive[0]!.id);
    const toEventId = BigInt(toArchive[toArchive.length - 1]!.id);

    // Snapshot the current graph state as truth.
    const { rows: graphRows } = await client.query<{ graph_data: unknown }>(
      "SELECT graph_data FROM spec_graphs WHERE project_id = $1",
      [projectId]
    );
    const graphData = graphRows[0]?.graph_data ?? {};
    const snapshotPayload = JSON.stringify(graphData);
    compactionSnapshotBytes.observe(Buffer.byteLength(snapshotPayload, "utf8"));

    const { rows: insertedSnap } = await client.query<{ id: string }>(
      `INSERT INTO spec_snapshots (project_id, up_to_event_id, graph_data, reason)
       VALUES ($1, $2, $3::jsonb, 'compaction')
       RETURNING id`,
      [projectId, toEventId.toString(), snapshotPayload]
    );
    const snapshotId = insertedSnap[0]!.id;

    // Archive the rows (outside the transaction would lose atomicity; doing it
    // inside is fine because the filesystem/S3 op is independent of the txn).
    const jsonl = toArchive.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const { key: archiveKey } = await storage.putArchive({
      projectId,
      fromEventId,
      toEventId,
      jsonl
    });

    // Delete compacted events.
    await client.query(
      "DELETE FROM spec_events WHERE project_id = $1 AND id <= $2",
      [projectId, toEventId.toString()]
    );

    await client.query("COMMIT");
    logger.info("compaction complete", {
      projectId,
      eventsCompacted: toArchive.length,
      snapshotId,
      archiveKey
    });
    return {
      status: "ok",
      eventsCompacted: toArchive.length,
      archiveKey,
      snapshotId,
      upToEventId: toEventId
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findCutoff(
  client: PoolClient,
  projectId: string,
  tailLength: number
): Promise<bigint | null> {
  // Take the id of the (tailLength+1)-th newest event. If fewer than that
  // exist, the project is under the tail length and compaction is a no-op.
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM spec_events
       WHERE project_id = $1
       ORDER BY id DESC
       OFFSET $2 LIMIT 1`,
    [projectId, tailLength]
  );
  if (rows.length === 0) return null;
  return BigInt(rows[0]!.id);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/compactor.test.ts
```

Expected: PASS (1 test). 250 events appended, 100 left in tail, 150 compacted into an archive and a snapshot.

- [ ] **Step 5: Verify via psql**

```bash
docker compose exec postgres psql -U atlas -d atlas_test \
  -c "SELECT reason, up_to_event_id FROM spec_snapshots;"
```

Expected: shows one row with `reason = compaction` and `up_to_event_id = 150`.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-ops/src/compaction/compactor.ts \
        packages/spec-graph-ops/test/compactor.test.ts
git commit -m "feat(spec-graph-ops): implement snapshot+tail compactor with advisory-lock isolation"
```

---

### Task 7: Compactor idempotency

**Files:**
- Create: `packages/spec-graph-ops/test/compactor-idempotent.test.ts`

- [ ] **Step 1: Write the test**

`packages/spec-graph-ops/test/compactor-idempotent.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecEventRepo, SpecGraphRepo, type Database } from "@atlas/spec-graph-data";
import { compactProject } from "../src/compaction/compactor.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("compactProject idempotency", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("running compaction twice does not duplicate work", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    for (let i = 0; i < 150; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const first = await compactProject({ pool: db.pool, projectId, tailLength: 100, storage });
    expect(first.status).toBe("ok");

    const second = await compactProject({ pool: db.pool, projectId, tailLength: 100, storage });
    expect(second.status).toBe("skipped-no-work");

    // Exactly one compaction snapshot exists
    const { rows } = await db.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM spec_snapshots WHERE project_id = $1 AND reason = 'compaction'",
      [projectId]
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("no-ops when the project has fewer events than the tail", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    for (let i = 0; i < 10; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const result = await compactProject({ pool: db.pool, projectId, tailLength: 100, storage });
    expect(result.status).toBe("skipped-no-work");
  });
});
```

- [ ] **Step 2: Run and confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/compactor-idempotent.test.ts
```

Expected: PASS (2 tests). No implementation changes needed — the cutoff check in Task 6 already guarantees this.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-ops/test/compactor-idempotent.test.ts
git commit -m "test(spec-graph-ops): confirm compactor idempotency and under-tail no-op"
```

---

### Task 8: Compactor CLI (`run` and `daemon`)

**Files:**
- Create: `packages/spec-graph-ops/src/cli/compactor.cli.ts`
- Create: `packages/spec-graph-ops/test/compactor.cli.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/compactor.cli.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecEventRepo, SpecGraphRepo, type Database } from "@atlas/spec-graph-data";
import { main } from "../src/cli/compactor.cli.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("atlas-compactor CLI", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
    process.env.ATLAS_EVENT_TAIL_LENGTH = "50";
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("run --project-id <id> compacts a single project", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    for (let i = 0; i < 80; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    await main(["node", "atlas-compactor", "run", "--project-id", projectId]);

    const { rows } = await db.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM spec_events WHERE project_id = $1",
      [projectId]
    );
    expect(Number(rows[0]!.count)).toBe(50);
  });

  it("run --all compacts every project above the tail", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await graphs.create(projectA, {});
    await graphs.create(projectB, {});
    for (let i = 0; i < 80; i++) {
      await events.append(projectA, { eventType: "e", payload: { i } });
      await events.append(projectB, { eventType: "e", payload: { i } });
    }

    await main(["node", "atlas-compactor", "run", "--all"]);

    const { rows } = await db.pool.query<{ project_id: string; c: string }>(
      "SELECT project_id, COUNT(*)::text AS c FROM spec_events GROUP BY project_id"
    );
    for (const r of rows) expect(Number(r.c)).toBe(50);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/compactor.cli.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the CLI**

`packages/spec-graph-ops/src/cli/compactor.cli.ts`:
```ts
import { Command } from "commander";
import { createDatabase } from "@atlas/spec-graph-data";
import { compactProject } from "../compaction/compactor.js";
import { coldStorageFromEnv } from "../compaction/cold-storage.js";
import { logger } from "../logger.js";

function tailLengthFromEnv(): number {
  const raw = process.env.ATLAS_EVENT_TAIL_LENGTH;
  const parsed = raw ? Number.parseInt(raw, 10) : 1000;
  if (!Number.isFinite(parsed) || parsed <= 0) return 1000;
  return parsed;
}

async function listAllProjectIds(pool: import("pg").Pool): Promise<string[]> {
  const { rows } = await pool.query<{ project_id: string }>(
    "SELECT DISTINCT project_id FROM spec_graphs ORDER BY project_id"
  );
  return rows.map((r) => r.project_id);
}

async function runOnce(projectIds: string[]): Promise<void> {
  const db = createDatabase(process.env.DATABASE_URL!);
  const storage = coldStorageFromEnv();
  const tailLength = tailLengthFromEnv();
  try {
    for (const projectId of projectIds) {
      const result = await compactProject({ pool: db.pool, projectId, tailLength, storage });
      logger.info("compactor.run", { projectId, result });
    }
  } finally {
    await db.pool.end();
  }
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("atlas-compactor").description("Spec Graph compaction tool");

  program
    .command("run")
    .description("Run compaction once and exit")
    .option("--project-id <uuid>", "compact a single project")
    .option("--all", "compact every project")
    .action(async (opts: { projectId?: string; all?: boolean }) => {
      const db = createDatabase(process.env.DATABASE_URL!);
      try {
        const ids = opts.all ? await listAllProjectIds(db.pool) : opts.projectId ? [opts.projectId] : [];
        if (ids.length === 0) {
          throw new Error("atlas-compactor run: pass --project-id <uuid> or --all");
        }
        await db.pool.end();
        await runOnce(ids);
      } catch (error) {
        await db.pool.end().catch(() => {});
        throw error;
      }
    });

  program
    .command("daemon")
    .description("Run compaction in a loop with a configurable interval")
    .option("--interval-ms <ms>", "interval between passes", "3600000") // 1h default
    .action(async (opts: { intervalMs: string }) => {
      const intervalMs = Number.parseInt(opts.intervalMs, 10);
      let stopped = false;
      const stop = () => { stopped = true; };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);

      logger.info("compactor.daemon.start", { intervalMs });
      while (!stopped) {
        const db = createDatabase(process.env.DATABASE_URL!);
        try {
          const ids = await listAllProjectIds(db.pool);
          await db.pool.end();
          await runOnce(ids);
        } catch (error) {
          await db.pool.end().catch(() => {});
          logger.error("compactor.daemon.error", { error: (error as Error).message });
        }
        if (stopped) break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, intervalMs);
          t.unref?.();
        });
      }
      logger.info("compactor.daemon.stop");
    });

  await program.parseAsync(argv);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/compactor.cli.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Smoke-test the built CLI**

Run:
```bash
pnpm -F @atlas/spec-graph-ops build
DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas_dev \
  node packages/spec-graph-ops/bin/atlas-compactor.js --help
```

Expected: prints commander help with `run` and `daemon` subcommands.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-ops/src/cli/compactor.cli.ts \
        packages/spec-graph-ops/test/compactor.cli.test.ts
git commit -m "feat(spec-graph-ops): add atlas-compactor CLI with run and daemon subcommands"
```

---

### Task 9: Offline manifest schema

**Files:**
- Create: `packages/spec-graph-ops/src/offline/manifest.ts`
- Create: `packages/spec-graph-ops/test/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/manifest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseManifest, MANIFEST_SCHEMA_VERSION, type Manifest } from "../src/offline/manifest.js";

describe("offline manifest", () => {
  const good: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: "2026-04-18T10:00:00.000Z",
    projectId: "11111111-1111-1111-1111-111111111111",
    tocoEntries: [
      { name: "spec_graph.json", sha256: "a".repeat(64), bytes: 100 },
      { name: "events.jsonl", sha256: "b".repeat(64), bytes: 200 },
      { name: "snapshots.jsonl", sha256: "c".repeat(64), bytes: 50 }
    ],
    archives: [
      { name: "archives/00000000000000000001-00000000000000000050.jsonl.gz", sha256: "d".repeat(64), bytes: 300 }
    ]
  };

  it("parses a valid manifest", () => {
    expect(parseManifest(good)).toEqual(good);
  });

  it("rejects an unknown schema version", () => {
    expect(() => parseManifest({ ...good, schemaVersion: 99 })).toThrow();
  });

  it("rejects a malformed sha256", () => {
    expect(() =>
      parseManifest({ ...good, tocoEntries: [{ ...good.tocoEntries[0]!, sha256: "nope" }] })
    ).toThrow();
  });

  it("rejects a non-UUID projectId", () => {
    expect(() => parseManifest({ ...good, projectId: "not-a-uuid" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/manifest.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the manifest module**

`packages/spec-graph-ops/src/offline/manifest.ts`:
```ts
import { z } from "zod";

export const MANIFEST_SCHEMA_VERSION = 1 as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 hex chars");
const uuid = z.string().uuid();

const entry = z.object({
  name: z.string().min(1),
  sha256,
  bytes: z.number().int().nonnegative()
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  exportedAt: z.string().datetime(),
  projectId: uuid,
  tocoEntries: z.array(entry).nonempty(),
  archives: z.array(entry)
});

export type Manifest = z.infer<typeof manifestSchema>;

export function parseManifest(value: unknown): Manifest {
  return manifestSchema.parse(value);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/manifest.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-ops/src/offline/manifest.ts \
        packages/spec-graph-ops/test/manifest.test.ts
git commit -m "feat(spec-graph-ops): add offline archive manifest schema (zod)"
```

---

### Task 10: Exporter

**Files:**
- Create: `packages/spec-graph-ops/src/offline/exporter.ts`
- Create: `packages/spec-graph-ops/test/exporter.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/exporter.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "tar";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { exportProject } from "../src/offline/exporter.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { compactProject } from "../src/compaction/compactor.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("exportProject", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("writes a .tar.gz archive containing manifest, graph, events, snapshots, and archives", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["a"] });
    for (let i = 0; i < 150; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    // Compact so an archive is present.
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await compactProject({ pool: db.pool, projectId, tailLength: 50, storage });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    try {
      const outPath = join(outDir, "export.tar.gz");
      const result = await exportProject({
        pool: db.pool,
        projectId,
        outPath,
        storage
      });

      expect(result.bytes).toBeGreaterThan(0);
      expect(statSync(outPath).size).toBe(result.bytes);

      // Extract and inspect.
      const extractDir = mkdtempSync(join(tmpdir(), "atlas-export-extract-"));
      await extract({ file: outPath, cwd: extractDir });

      const manifest = JSON.parse(readFileSync(join(extractDir, "manifest.json"), "utf8"));
      expect(manifest.projectId).toBe(projectId);
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.tocoEntries.map((e: { name: string }) => e.name).sort()).toEqual([
        "events.jsonl",
        "snapshots.jsonl",
        "spec_graph.json"
      ]);
      expect(manifest.archives.length).toBe(1);

      const graph = JSON.parse(readFileSync(join(extractDir, "spec_graph.json"), "utf8"));
      expect(graph.graphData).toEqual({ nodes: ["a"] });

      const eventsJsonl = readFileSync(join(extractDir, "events.jsonl"), "utf8");
      expect(eventsJsonl.trim().split("\n")).toHaveLength(50); // tail only

      const snapshotsJsonl = readFileSync(join(extractDir, "snapshots.jsonl"), "utf8");
      expect(snapshotsJsonl.trim().split("\n").length).toBeGreaterThanOrEqual(1);

      rmSync(extractDir, { recursive: true, force: true });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/exporter.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the exporter**

`packages/spec-graph-ops/src/offline/exporter.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTar } from "tar";
import type { Pool } from "pg";
import {
  offlineExportArchiveBytes,
  offlineExportRuns,
  withSpan
} from "../observability.js";
import type { ColdStorage } from "../compaction/cold-storage.js";
import { logger } from "../logger.js";
import { MANIFEST_SCHEMA_VERSION, type Manifest } from "./manifest.js";

export interface ExportProjectInput {
  pool: Pool;
  projectId: string;
  outPath: string;
  storage: ColdStorage;
}

export interface ExportProjectResult {
  outPath: string;
  bytes: number;
}

export async function exportProject(input: ExportProjectInput): Promise<ExportProjectResult> {
  const { pool, projectId, outPath, storage } = input;
  return withSpan("atlas.offline.export", { "atlas.project_id": projectId }, async () => {
    try {
      const result = await runExport(pool, projectId, outPath, storage);
      offlineExportRuns.inc({ result: "ok" });
      offlineExportArchiveBytes.observe(result.bytes);
      return result;
    } catch (error) {
      offlineExportRuns.inc({ result: "error" });
      logger.error("offline.export failed", { projectId, error: (error as Error).message });
      throw error;
    }
  });
}

async function runExport(
  pool: Pool,
  projectId: string,
  outPath: string,
  storage: ColdStorage
): Promise<ExportProjectResult> {
  const client = await pool.connect();
  const stage = mkdtempSync(join(tmpdir(), "atlas-export-stage-"));
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);

    const { rows: graphRows } = await client.query(
      `SELECT id, project_id AS "projectId", schema_version AS "schemaVersion",
              graph_data AS "graphData", current_event_seq AS "currentEventSeq",
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM spec_graphs
        WHERE project_id = $1`,
      [projectId]
    );
    if (graphRows.length === 0) {
      throw new Error(`exportProject: no spec_graphs row for project ${projectId}`);
    }

    const { rows: eventRows } = await client.query(
      `SELECT id, project_id, event_type, payload, actor, created_at
         FROM spec_events
        WHERE project_id = $1
        ORDER BY id ASC`,
      [projectId]
    );
    const { rows: snapshotRows } = await client.query(
      `SELECT id, project_id, up_to_event_id, graph_data, reason, created_at
         FROM spec_snapshots
        WHERE project_id = $1
        ORDER BY created_at ASC`,
      [projectId]
    );

    await client.query("COMMIT");

    // Stage files
    const graphBytes = writeStage(stage, "spec_graph.json", JSON.stringify(graphRows[0], replaceBigints));
    const eventsBytes = writeStage(stage, "events.jsonl", eventRows.map((r) => JSON.stringify(r, replaceBigints)).join("\n") + "\n");
    const snapshotsBytes = writeStage(stage, "snapshots.jsonl", snapshotRows.map((r) => JSON.stringify(r, replaceBigints)).join("\n") + "\n");

    // Copy cold-storage archives referenced by snapshots.
    const archiveDir = join(stage, "archives");
    mkdirSync(archiveDir, { recursive: true });
    const archiveEntries: Manifest["archives"] = [];
    for (const snap of snapshotRows) {
      // A compaction snapshot with up_to_event_id K implies an archive whose
      // toEventId == K. We need fromEventId too: derive by listing archives
      // in the project directory. A robust implementation would store the
      // archive key alongside the snapshot row; for v1 we accept the
      // convention and read the directory.
      const upTo = BigInt(snap.up_to_event_id);
      const candidates = await discoverArchivesForProject(storage, projectId, upTo);
      for (const key of candidates) {
        const jsonl = await storage.getArchive(key);
        const name = `archives/${key.split("/").slice(1).join("/")}`;
        const bytes = writeStageRaw(stage, name, Buffer.from(jsonl, "utf8"));
        archiveEntries.push({
          name,
          sha256: sha256Hex(readStage(stage, name)),
          bytes
        });
      }
    }

    const tocoEntries = [
      { name: "spec_graph.json", sha256: sha256Hex(readStage(stage, "spec_graph.json")), bytes: graphBytes },
      { name: "events.jsonl", sha256: sha256Hex(readStage(stage, "events.jsonl")), bytes: eventsBytes },
      { name: "snapshots.jsonl", sha256: sha256Hex(readStage(stage, "snapshots.jsonl")), bytes: snapshotsBytes }
    ] as const;

    const manifest: Manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      projectId,
      tocoEntries: [...tocoEntries],
      archives: archiveEntries
    };
    writeStage(stage, "manifest.json", JSON.stringify(manifest, null, 2));

    // Tar the stage.
    const entries = ["manifest.json", "spec_graph.json", "events.jsonl", "snapshots.jsonl", "archives"];
    await createTar({ gzip: true, cwd: stage, file: outPath }, entries);

    const bytes = statSync(outPath).size;
    return { outPath, bytes };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    rmSync(stage, { recursive: true, force: true });
  }
}

function writeStage(stage: string, name: string, contents: string): number {
  const buf = Buffer.from(contents, "utf8");
  writeFileSync(join(stage, name), buf);
  return buf.byteLength;
}

function writeStageRaw(stage: string, name: string, buf: Buffer): number {
  const full = join(stage, name);
  mkdirSync(join(stage, name, ".."), { recursive: true });
  writeFileSync(full, buf);
  return buf.byteLength;
}

function readStage(stage: string, name: string): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(join(stage, name));
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function replaceBigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function discoverArchivesForProject(
  storage: ColdStorage,
  projectId: string,
  upToEventId: bigint
): Promise<string[]> {
  // The fs adapter does not expose listing; cold-storage v1 relies on
  // snapshot rows + a convention. To avoid adding a list API here, we derive
  // the single archive key that a compaction run *just* produced by scanning
  // the local fs adapter's directory. S3 deployments persist archive keys
  // in a future schema addition; for v1 the exporter is intended for local
  // use where fs is the default.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const baseDir = process.env.ATLAS_COLD_STORAGE_DIR ?? "./atlas-cold-storage";
  const projectDir = path.join(baseDir, projectId);
  if (!fs.existsSync(projectDir)) return [];
  return fs.readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl.gz"))
    .filter((f) => {
      const to = BigInt(f.split("-")[1]!.replace(".jsonl.gz", ""));
      return to <= upToEventId;
    })
    .map((f) => `${projectId}/${f}`);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/exporter.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-ops/src/offline/exporter.ts \
        packages/spec-graph-ops/test/exporter.test.ts
git commit -m "feat(spec-graph-ops): add offline exporter emitting tar.gz with manifest + sha256 TOC"
```

---

### Task 11: Importer

**Files:**
- Create: `packages/spec-graph-ops/src/offline/importer.ts`
- Create: `packages/spec-graph-ops/test/importer.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/importer.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { exportProject } from "../src/offline/exporter.js";
import { importArchive } from "../src/offline/importer.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("importArchive", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("imports a previously exported archive into a clean database", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["a", "b"] });
    for (let i = 0; i < 25; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "export.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    // Wipe and import.
    await truncateAll(db);
    const summary = await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    expect(summary.projectId).toBe(projectId);
    expect(summary.eventsInserted).toBe(25);

    const round = await graphs.findByProjectId(projectId);
    expect(round?.graphData).toEqual({ nodes: ["a", "b"] });

    rmSync(outDir, { recursive: true, force: true });
  });

  it("refuses to import when the target project already exists (without --force)", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["x"] });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "export.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    // Archive targets a DB where the project already exists.
    await expect(
      importArchive({
        pool: db.pool,
        archivePath: outPath,
        databaseUrl: process.env.DATABASE_URL_TEST!
      })
    ).rejects.toThrow(/already exists/i);

    rmSync(outDir, { recursive: true, force: true });
  });

  it("with force=true, overwrites the existing project", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["old"] });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "export.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    // Modify graph, then export.
    await db.pool.query(
      "UPDATE spec_graphs SET graph_data = $1 WHERE project_id = $2",
      [JSON.stringify({ nodes: ["new"] }), projectId]
    );
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    // Restore the "old" state.
    await db.pool.query(
      "UPDATE spec_graphs SET graph_data = $1 WHERE project_id = $2",
      [JSON.stringify({ nodes: ["old"] }), projectId]
    );

    await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!,
      force: true
    });
    const after = await graphs.findByProjectId(projectId);
    expect(after?.graphData).toEqual({ nodes: ["new"] });

    rmSync(outDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/importer.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the importer**

`packages/spec-graph-ops/src/offline/importer.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { x as extractTar } from "tar";
import type { Pool } from "pg";
import { parseManifest } from "./manifest.js";
import { logger } from "../logger.js";
import {
  offlineImportRuns,
  withSpan
} from "../observability.js";

export interface ImportArchiveInput {
  pool: Pool;
  archivePath: string;
  databaseUrl: string;
  force?: boolean;
}

export interface ImportArchiveSummary {
  projectId: string;
  eventsInserted: number;
  snapshotsInserted: number;
  archivesRestored: number;
}

export async function importArchive(input: ImportArchiveInput): Promise<ImportArchiveSummary> {
  return withSpan("atlas.offline.import", { "atlas.archive_path": input.archivePath }, async () => {
    try {
      const result = await runImport(input);
      offlineImportRuns.inc({ result: "ok" });
      return result;
    } catch (error) {
      offlineImportRuns.inc({ result: "error" });
      logger.error("offline.import failed", { error: (error as Error).message });
      throw error;
    }
  });
}

async function runImport(input: ImportArchiveInput): Promise<ImportArchiveSummary> {
  const { pool, archivePath, force } = input;
  if (!statSync(archivePath).isFile()) {
    throw new Error(`importArchive: not a file: ${archivePath}`);
  }
  const stage = mkdtempSync(join(tmpdir(), "atlas-import-stage-"));
  try {
    await extractTar({ file: archivePath, cwd: stage });
    const manifest = parseManifest(JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8")));

    // Verify sha256 of every TOC entry
    for (const entry of [...manifest.tocoEntries, ...manifest.archives]) {
      const buf = readFileSync(join(stage, entry.name));
      const sum = createHash("sha256").update(buf).digest("hex");
      if (sum !== entry.sha256) {
        throw new Error(`importArchive: sha256 mismatch for ${entry.name}`);
      }
      if (buf.byteLength !== entry.bytes) {
        throw new Error(`importArchive: byte length mismatch for ${entry.name}`);
      }
    }

    const projectId = manifest.projectId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.project_id', $1, true)", [projectId]);

      const { rowCount: exists } = await client.query(
        "SELECT 1 FROM spec_graphs WHERE project_id = $1",
        [projectId]
      );
      if (exists && exists > 0) {
        if (!force) {
          throw new Error(`importArchive: project ${projectId} already exists; pass force=true to overwrite`);
        }
        await client.query("DELETE FROM spec_events WHERE project_id = $1", [projectId]);
        await client.query("DELETE FROM spec_snapshots WHERE project_id = $1", [projectId]);
        await client.query("DELETE FROM spec_graphs WHERE project_id = $1", [projectId]);
      }

      // spec_graph.json
      const graph = JSON.parse(readFileSync(join(stage, "spec_graph.json"), "utf8"));
      await client.query(
        `INSERT INTO spec_graphs (id, project_id, schema_version, graph_data, current_event_seq, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          graph.id,
          graph.projectId,
          graph.schemaVersion,
          JSON.stringify(graph.graphData),
          graph.currentEventSeq.toString(),
          graph.createdAt,
          graph.updatedAt
        ]
      );

      // events.jsonl
      const eventsText = readFileSync(join(stage, "events.jsonl"), "utf8");
      const eventLines = eventsText.split("\n").filter(Boolean);
      let eventsInserted = 0;
      for (const line of eventLines) {
        const row = JSON.parse(line);
        await client.query(
          `INSERT INTO spec_events (id, project_id, event_type, payload, actor, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [row.id, row.project_id, row.event_type, JSON.stringify(row.payload), row.actor, row.created_at]
        );
        eventsInserted++;
      }

      // snapshots.jsonl
      const snapText = readFileSync(join(stage, "snapshots.jsonl"), "utf8");
      const snapLines = snapText.split("\n").filter(Boolean);
      let snapshotsInserted = 0;
      for (const line of snapLines) {
        const row = JSON.parse(line);
        await client.query(
          `INSERT INTO spec_snapshots (id, project_id, up_to_event_id, graph_data, reason, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [row.id, row.project_id, row.up_to_event_id, JSON.stringify(row.graph_data), row.reason, row.created_at]
        );
        snapshotsInserted++;
      }

      // archives → restore to cold-storage root
      const archivesRoot = process.env.ATLAS_COLD_STORAGE_DIR ?? "./atlas-cold-storage";
      let archivesRestored = 0;
      const archiveStage = join(stage, "archives");
      if (readdirSyncSafe(archiveStage).length > 0) {
        const { mkdirSync, copyFileSync } = await import("node:fs");
        mkdirSync(join(archivesRoot, projectId), { recursive: true });
        for (const f of readdirSyncSafe(archiveStage)) {
          copyFileSync(join(archiveStage, f), join(archivesRoot, projectId, f));
          archivesRestored++;
        }
      }

      // Reset the events id sequence so future appends stay monotonic.
      await client.query(
        "SELECT setval(pg_get_serial_sequence('spec_events', 'id'), COALESCE((SELECT MAX(id) FROM spec_events), 0) + 1, false)"
      );

      await client.query("COMMIT");
      return { projectId, eventsInserted, snapshotsInserted, archivesRestored };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/importer.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-ops/src/offline/importer.ts \
        packages/spec-graph-ops/test/importer.test.ts
git commit -m "feat(spec-graph-ops): add offline importer with sha256 verification and force flag"
```

---

### Task 12: Round-trip test

**Files:**
- Create: `packages/spec-graph-ops/test/roundtrip.test.ts`

- [ ] **Step 1: Write the test**

`packages/spec-graph-ops/test/roundtrip.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { exportProject } from "../src/offline/exporter.js";
import { importArchive } from "../src/offline/importer.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("roundtrip: export DB A → import DB B → row counts match", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("export → wipe → import yields identical counts and graph", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["r1", "r2"] });
    for (let i = 0; i < 40; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "rt.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    // Capture pre-state counts.
    const before = await countsFor(db, projectId);

    await truncateAll(db);
    await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!
    });

    const after = await countsFor(db, projectId);
    expect(after).toEqual(before);

    const roundGraph = await graphs.findByProjectId(projectId);
    expect(roundGraph?.graphData).toEqual({ nodes: ["r1", "r2"] });

    rmSync(outDir, { recursive: true, force: true });
  });
});

async function countsFor(db: Database, projectId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ["spec_graphs", "spec_events", "spec_snapshots"] as const) {
    const { rows } = await db.pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ${table} WHERE project_id = $1`,
      [projectId]
    );
    counts[table] = Number(rows[0]!.c);
  }
  return counts;
}
```

- [ ] **Step 2: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/roundtrip.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-ops/test/roundtrip.test.ts
git commit -m "test(spec-graph-ops): add export/import round-trip covering counts + graph equality"
```

---

### Task 13: Offline CLI (`export` and `import`)

**Files:**
- Create: `packages/spec-graph-ops/src/cli/offline.cli.ts`
- Create: `packages/spec-graph-ops/test/offline.cli.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-ops/test/offline.cli.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { main } from "../src/cli/offline.cli.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("atlas-offline CLI", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("export produces a tar.gz at --out", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    await events.append(projectId, { eventType: "e", payload: {} });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
    const out = join(outDir, "p.tar.gz");
    try {
      await main(["node", "atlas-offline", "export", "--project-id", projectId, "--out", out]);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("import restores an exported project into a clean DB", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["imp"] });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
    const out = join(outDir, "p.tar.gz");
    try {
      await main(["node", "atlas-offline", "export", "--project-id", projectId, "--out", out]);
      await truncateAll(db);
      await main([
        "node", "atlas-offline", "import",
        "--archive", out,
        "--database-url", process.env.DATABASE_URL_TEST!
      ]);
      const found = await graphs.findByProjectId(projectId);
      expect(found?.graphData).toEqual({ nodes: ["imp"] });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/offline.cli.test.ts
```

Expected: FAIL (missing module).

- [ ] **Step 3: Implement the CLI**

`packages/spec-graph-ops/src/cli/offline.cli.ts`:
```ts
import { Command } from "commander";
import { createDatabase } from "@atlas/spec-graph-data";
import { exportProject } from "../offline/exporter.js";
import { importArchive } from "../offline/importer.js";
import { coldStorageFromEnv } from "../compaction/cold-storage.js";
import { logger } from "../logger.js";

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("atlas-offline").description("Export/import Atlas projects for offline/local use");

  program
    .command("export")
    .description("Export a project to a .tar.gz archive")
    .requiredOption("--project-id <uuid>", "project to export")
    .requiredOption("--out <path.tar.gz>", "output archive path")
    .action(async (opts: { projectId: string; out: string }) => {
      const db = createDatabase(process.env.DATABASE_URL!);
      try {
        const result = await exportProject({
          pool: db.pool,
          projectId: opts.projectId,
          outPath: opts.out,
          storage: coldStorageFromEnv()
        });
        logger.info("offline.export.ok", { ...result });
      } finally {
        await db.pool.end();
      }
    });

  program
    .command("import")
    .description("Import a .tar.gz archive into a Postgres database")
    .requiredOption("--archive <path.tar.gz>", "input archive path")
    .requiredOption("--database-url <url>", "target Postgres URL")
    .option("--force", "overwrite an existing project", false)
    .action(async (opts: { archive: string; databaseUrl: string; force: boolean }) => {
      const db = createDatabase(opts.databaseUrl);
      try {
        const summary = await importArchive({
          pool: db.pool,
          archivePath: opts.archive,
          databaseUrl: opts.databaseUrl,
          force: opts.force
        });
        logger.info("offline.import.ok", { ...summary });
      } finally {
        await db.pool.end();
      }
    });

  await program.parseAsync(argv);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/offline.cli.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Smoke-test the built CLI**

```bash
pnpm -F @atlas/spec-graph-ops build
node packages/spec-graph-ops/bin/atlas-offline.js --help
```

Expected: prints commander help with `export` and `import` subcommands.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-ops/src/cli/offline.cli.ts \
        packages/spec-graph-ops/test/offline.cli.test.ts
git commit -m "feat(spec-graph-ops): add atlas-offline CLI with export and import subcommands"
```

---

### Task 14: End-to-end integration test

**Files:**
- Create: `packages/spec-graph-ops/test/integration.test.ts`

- [ ] **Step 1: Write the test**

`packages/spec-graph-ops/test/integration.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { compactProject } from "../src/compaction/compactor.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { exportProject } from "../src/offline/exporter.js";
import { importArchive } from "../src/offline/importer.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("integration: seed → compact → export → wipe → import → verify", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("full lifecycle recovers original state after wipe", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["i1", "i2"], edges: [["i1", "i2"]] });
    for (let i = 0; i < 200; i++) {
      await events.append(projectId, { eventType: "e", payload: { i }, actor: "integration" });
    }

    // Compact down to a tail of 50.
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const compactResult = await compactProject({ pool: db.pool, projectId, tailLength: 50, storage });
    expect(compactResult.status).toBe("ok");

    // Capture pre-state metrics
    const before = await snapshotState(db, projectId);
    expect(before.events).toBe(50);
    expect(before.snapshots).toBeGreaterThanOrEqual(1);

    // Export
    const outDir = mkdtempSync(join(tmpdir(), "atlas-int-"));
    const outPath = join(outDir, "int.tar.gz");
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    // Wipe and import
    await truncateAll(db);
    rmSync(workspace.dir, { recursive: true, force: true });
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;

    await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!
    });

    const after = await snapshotState(db, projectId);
    expect(after).toEqual(before);

    const graph = await graphs.findByProjectId(projectId);
    expect(graph?.graphData).toEqual({ nodes: ["i1", "i2"], edges: [["i1", "i2"]] });

    rmSync(outDir, { recursive: true, force: true });
  });
});

async function snapshotState(db: Database, projectId: string): Promise<{ events: number; snapshots: number; graphs: number }> {
  const [e, s, g] = await Promise.all([
    db.pool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM spec_events WHERE project_id = $1", [projectId]),
    db.pool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM spec_snapshots WHERE project_id = $1", [projectId]),
    db.pool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM spec_graphs WHERE project_id = $1", [projectId])
  ]);
  return {
    events: Number(e.rows[0]!.c),
    snapshots: Number(s.rows[0]!.c),
    graphs: Number(g.rows[0]!.c)
  };
}
```

- [ ] **Step 2: Run and confirm pass**

```bash
pnpm -F @atlas/spec-graph-ops test -- test/integration.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 3: Run the full suite**

```bash
pnpm -F @atlas/spec-graph-ops test
```

Expected: all tests green (approximately 20+ tests, with 1 conditionally-skipped S3 test).

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-ops/test/integration.test.ts
git commit -m "test(spec-graph-ops): add full compact→export→wipe→import integration test"
```

---

### Task 15: Package README

**Files:**
- Create: `packages/spec-graph-ops/README.md`
- Modify: `packages/spec-graph-ops/src/index.ts` (publish the typed public API)

- [ ] **Step 1: Write the public-API index**

`packages/spec-graph-ops/src/index.ts`:
```ts
export { compactProject } from "./compaction/compactor.js";
export type { CompactProjectInput, CompactProjectResult } from "./compaction/compactor.js";

export { createColdStorage, coldStorageFromEnv } from "./compaction/cold-storage.js";
export type { ColdStorage, ColdStorageConfig, PutArchiveInput, PutArchiveResult } from "./compaction/cold-storage.js";

export { withAdvisoryLock, projectLockKey } from "./compaction/advisory-lock.js";

export { exportProject } from "./offline/exporter.js";
export type { ExportProjectInput, ExportProjectResult } from "./offline/exporter.js";

export { importArchive } from "./offline/importer.js";
export type { ImportArchiveInput, ImportArchiveSummary } from "./offline/importer.js";

export { parseManifest, MANIFEST_SCHEMA_VERSION } from "./offline/manifest.js";
export type { Manifest } from "./offline/manifest.js";

export { opsRegistry } from "./observability.js";
```

Run:
```bash
pnpm -F @atlas/spec-graph-ops build
pnpm -F @atlas/spec-graph-ops typecheck
```

Expected: both exit 0.

- [ ] **Step 2: Write the README**

`packages/spec-graph-ops/README.md`:
````markdown
# @atlas/spec-graph-ops

Operational tools for the Atlas Living Spec Graph mirror: compaction and offline/local mode.

This package builds on `@atlas/spec-graph-data` (Plan A.1). It never changes the DB schema — it only reads and writes rows through the existing tables (`spec_graphs`, `spec_events`, `spec_snapshots`) plus cold-storage files.

## Concepts

- **Snapshot + tail compaction.** Keep the last N events per project (default 1000, env `ATLAS_EVENT_TAIL_LENGTH`). Roll older events into a `spec_snapshots` row with `reason='compaction'` and archive them as `.jsonl.gz` files in cold storage, then delete them from `spec_events`.
- **Cold storage.** Local filesystem by default (`ATLAS_COLD_STORAGE_DIR`, default `./atlas-cold-storage`). Set `ATLAS_COLD_STORAGE_S3_URL=s3://bucket/prefix` to use S3 instead — the AWS SDK is an optional peer dependency and is loaded lazily.
- **Offline/local mode.** Package a project as a portable `.tar.gz` archive (manifest + graph + events + snapshots + referenced cold-storage pieces) for transfer between machines or air-gapped installations.

## CLIs

### `atlas-compactor`

```bash
# One-shot
atlas-compactor run --project-id <uuid>
atlas-compactor run --all

# Long-lived daemon (default interval 1h)
atlas-compactor daemon --interval-ms 3600000
```

Environment:

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *(required)* | Postgres URL |
| `ATLAS_EVENT_TAIL_LENGTH` | `1000` | Tail length per project |
| `ATLAS_COLD_STORAGE_DIR` | `./atlas-cold-storage` | Filesystem root for archives |
| `ATLAS_COLD_STORAGE_S3_URL` | *(unset)* | When set, archive to S3 instead |

### `atlas-offline`

```bash
# Export a project
atlas-offline export --project-id <uuid> --out ./project.tar.gz

# Import into any Postgres
atlas-offline import \
  --archive ./project.tar.gz \
  --database-url postgresql://atlas:atlas@localhost:5432/atlas_dev
# add --force to overwrite an existing project
```

## Offline/local recipe (PRD §11.6)

The PRD requires that the whole stack run on the user's laptop via Docker Compose. Procedure:

```bash
# From the repo root (uses the docker-compose.yml from Plan A.1)
docker compose up -d postgres
pnpm -F @atlas/spec-graph-data db:migrate

# Import a project archive shipped to you
atlas-offline import \
  --archive ~/Downloads/project.tar.gz \
  --database-url postgresql://atlas:atlas@localhost:5432/atlas_dev

# The sync daemon (A.2) now works against this local Postgres unchanged.
# Compact periodically to keep the event log bounded:
DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas_dev \
  atlas-compactor daemon
```

## Archive format

```
manifest.json          # schema version + exportedAt + projectId + TOC with sha256
spec_graph.json        # the spec_graphs row for the project
events.jsonl           # tail events (one JSON object per line)
snapshots.jsonl        # all snapshot rows
archives/              # verbatim cold-storage .jsonl.gz files referenced by snapshots
  <from>-<to>.jsonl.gz
```

Every entry's sha256 and byte length are recorded in `manifest.json#tocoEntries` / `#archives`. The importer verifies both.

## Observability

This package registers its metrics on a **separate** Prometheus registry (`opsRegistry` exported from this package). Compose it with `@atlas/spec-graph-data`'s `metricsRegistry` on your scrape endpoint.

| Metric | Type | Labels |
|---|---|---|
| `atlas_compaction_runs_total` | counter | `result` (`ok` / `skipped-no-work` / `error`) |
| `atlas_compaction_events_compacted_total` | counter | — |
| `atlas_compaction_snapshot_bytes` | histogram | — |
| `atlas_compaction_duration_seconds` | histogram | — |
| `atlas_offline_export_runs_total` | counter | `result` |
| `atlas_offline_export_archive_bytes` | histogram | — |
| `atlas_offline_import_runs_total` | counter | `result` |

OpenTelemetry spans: `atlas.compaction`, `atlas.offline.export`, `atlas.offline.import` (each carries `atlas.project_id` or `atlas.archive_path`).

## Programmatic API

```ts
import {
  compactProject,
  exportProject,
  importArchive,
  createColdStorage
} from "@atlas/spec-graph-ops";
import { createDatabase } from "@atlas/spec-graph-data";

const db = createDatabase(process.env.DATABASE_URL!);
const storage = createColdStorage({ kind: "fs", dir: "./atlas-cold-storage" });

await compactProject({ pool: db.pool, projectId, tailLength: 1000, storage });
await exportProject({ pool: db.pool, projectId, outPath: "./p.tar.gz", storage });
await importArchive({ pool: db.pool, archivePath: "./p.tar.gz", databaseUrl: process.env.DATABASE_URL! });
```

## Developing

```bash
# From repo root — Postgres 16 from Plan A.1's compose file
pnpm db:up
pnpm -F @atlas/spec-graph-data db:migrate
pnpm -F @atlas/spec-graph-ops test
pnpm -F @atlas/spec-graph-ops build
```
````

- [ ] **Step 3: Final verification — full suite + typecheck + build**

```bash
pnpm -F @atlas/spec-graph-ops test
pnpm -F @atlas/spec-graph-ops typecheck
pnpm -F @atlas/spec-graph-ops build
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-ops/README.md packages/spec-graph-ops/src/index.ts
git commit -m "docs(spec-graph-ops): add README with CLI reference, archive format, and offline recipe"
```

---

## Completion Checklist

After finishing all 15 tasks, verify:

- [ ] `pnpm -F @atlas/spec-graph-ops test` — all tests green (S3 test skipped unless env set)
- [ ] `pnpm -F @atlas/spec-graph-ops build` — exits 0, `dist/` populated
- [ ] `pnpm -F @atlas/spec-graph-ops typecheck` — exits 0
- [ ] `node packages/spec-graph-ops/bin/atlas-compactor.js --help` prints subcommands
- [ ] `node packages/spec-graph-ops/bin/atlas-offline.js --help` prints subcommands
- [ ] `docker compose down && docker compose up -d postgres && pnpm -F @atlas/spec-graph-data db:migrate && pnpm -F @atlas/spec-graph-ops test` — full cold-start works
- [ ] Prometheus metric names exactly match the PRD-aligned list: `atlas_compaction_runs_total`, `atlas_compaction_events_compacted_total`, `atlas_compaction_snapshot_bytes`, `atlas_compaction_duration_seconds`, `atlas_offline_export_runs_total`, `atlas_offline_export_archive_bytes`, `atlas_offline_import_runs_total`
- [ ] `packages/spec-graph-ops/README.md` documents the CLI surface and the Docker-Compose offline recipe

## Handoff: Unit A closes

Unit A is **complete** once A.4 ships:

- **A.1** — Postgres mirror + typed data access (tables, repos, RLS, observability).
- **A.2** — File ↔ mirror sync daemon (reads/writes via A.1's repos).
- **A.3** — Git merge driver (uses A.1's event log as the merge source of truth).
- **A.4** — Compaction + offline/local mode (this plan; bounds the event log and satisfies PRD §11.6's offline/local requirement).

Unit B (spec-graph schema + validators) and Unit C (agent orchestration) depend only on Unit A's public surface (`@atlas/spec-graph-data` and `@atlas/spec-graph-ops`). Nothing downstream of Unit A should need to touch Postgres directly or the cold-storage format; both are encapsulated behind the typed APIs published here.

Any gap discovered in the compaction or offline pipeline after Unit B or C begins is an extension of this package, not a new one — we keep operational surface concentrated in `@atlas/spec-graph-ops`.
