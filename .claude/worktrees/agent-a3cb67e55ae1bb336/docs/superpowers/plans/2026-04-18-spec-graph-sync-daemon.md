# Spec Graph Sync Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the file ↔ mirror sync daemon that keeps `.atlas/spec.graph.json` and `.atlas/events.jsonl` in lockstep with the Postgres mirror from Plan A.1. This is Plan A.2 of Unit A in Phase A — the glue that turns the mirror from "a database that exists" into "the live coordination substrate PRD §11.5 promises", while preserving the Git-tracked files as the export/audit surface.

**Architecture:** One new pnpm workspace package (`packages/spec-graph-sync`, published as `@atlas/spec-graph-sync`) hosts a long-running daemon process. The daemon uses `chokidar@4.x` to watch the two files inside a user-specified project directory, debounces rapid edits over a 100ms window, and pushes changes into the Postgres mirror via `SpecEventRepo.append` / `SpecGraphRepo.updateGraphData` from `@atlas/spec-graph-data`. It also writes in the reverse direction — on startup, on-demand, or when drift is detected — regenerating `spec.graph.json` atomically (write-temp-then-rename) and appending missing events to `events.jsonl`. A monotonic `writeToken` set prevents feedback loops: every file write is tagged by content hash, and incoming events whose hash matches a recently-written token are ignored. Mirror is authoritative; conflicts surface as `reconciliation-needed` log entries (reconciliation logic itself is out of scope for A.2). A CLI binary (`atlas-sync`) runs one daemon per `projectId`. Observability extends `@atlas/spec-graph-data`'s Prometheus registry with sync-specific counters/histograms and emits OpenTelemetry spans around every propagation cycle.

**Tech Stack:** TypeScript 5.5+ · Node 22 LTS · pnpm workspaces · `@atlas/spec-graph-data` (workspace dep) · `chokidar` 4.0 · `@opentelemetry/api` 1.9 · `prom-client` 15.1 (transitively via `@atlas/spec-graph-data`) · Vitest 2.x · `execa` 9.x (for CLI subprocess tests).

**Prerequisites the implementing engineer needs installed before starting:**
- Plan A.1 complete and merged on `main`. Verify by: `pnpm -F @atlas/spec-graph-data test` passes locally and the package exports `createDatabase`, `SpecGraphRepo`, `SpecEventRepo`, `SpecSnapshotRepo`, `metricsRegistry`.
- Node 22 LTS (`node --version` ≥ v22.0.0)
- pnpm 9+ (`pnpm --version` ≥ 9.0.0)
- Docker Desktop running, `docker compose up -d postgres` from A.1 healthy
- `atlas_test` database present (A.1 Task 1 Step 7)
- `.env` has `DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5432/atlas_test`

---

## File Structure

Files this plan creates. Paths are relative to the repo root `f:/claude/ai_builder/`.

```
packages/spec-graph-sync/
  package.json                               # package manifest
  tsconfig.json                              # extends tsconfig.base.json
  vitest.config.ts                           # test runner config
  README.md                                  # CLI + ops guide
  bin/
    atlas-sync.js                            # thin CLI shim -> dist/cli.js
  src/
    index.ts                                 # public exports
    daemon.ts                                # SyncDaemon class (start/stop/state)
    watcher.ts                               # chokidar wrapper + debouncer
    file-to-mirror.ts                        # parse file changes -> repo calls
    mirror-to-file.ts                        # read mirror -> write files atomically
    write-token.ts                           # feedback-loop guard (hash set + TTL)
    observability.ts                         # extends metrics registry + spans
    cli.ts                                   # CLI entry (parse args, wire daemon)
  test/
    setup.ts                                 # Postgres bootstrap (reuses A.1 pattern)
    helpers.ts                               # tmp dir fixtures, file writers
    write-token.test.ts
    watcher.test.ts
    file-to-mirror.test.ts
    mirror-to-file.test.ts
    observability.test.ts
    daemon.integration.test.ts
    cli.test.ts
```

**Why this shape.** One package, one job: bidirectional sync. The file-to-mirror and mirror-to-file flows live in separate modules so they can be tested independently — the daemon in `daemon.ts` is just the orchestrator. The `write-token` module is a named boundary so the feedback-loop guard is testable without mounting a real watcher or database. CLI entry is last so the daemon class stands on its own for embedding (e.g., from a desktop host process).

**What Plan A.2 does NOT build.** The Git merge driver (Plan A.3). Compaction + offline mode (Plan A.4). Graph-shape validation (Unit B). Actual reconciliation of true conflicts — A.2 only **logs** `reconciliation-needed` when mirror state and file state disagree in a way that cannot be resolved by "mirror wins after recording file edit as event".

---

## Task List (14 tasks)

Each task is TDD-shaped: write the failing test, run it red, write minimal code, run it green, commit. Every task commits. Commits use Conventional Commits prefixes.

---

### Task 1: `packages/spec-graph-sync` package scaffold

**Files:**
- Create: `packages/spec-graph-sync/package.json`
- Create: `packages/spec-graph-sync/tsconfig.json`
- Create: `packages/spec-graph-sync/vitest.config.ts`
- Create: `packages/spec-graph-sync/src/index.ts`

- [ ] **Step 1: Write `packages/spec-graph-sync/package.json`**

```json
{
  "name": "@atlas/spec-graph-sync",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "atlas-sync": "./bin/atlas-sync.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
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
    "chokidar": "4.0.1",
    "prom-client": "15.1.3"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "execa": "9.5.1",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Write `packages/spec-graph-sync/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist"]
}
```

- [ ] **Step 3: Write `packages/spec-graph-sync/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    globalSetup: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    fileParallel: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
```

**Why single-fork + no file parallelism.** Each test mounts a real chokidar watcher against a real tmp directory and hits the shared test Postgres. Parallel suites would race on the file system and the database.

- [ ] **Step 4: Write minimal public entry**

`packages/spec-graph-sync/src/index.ts`:
```ts
export const PACKAGE_NAME = "@atlas/spec-graph-sync";
```

- [ ] **Step 5: Install and verify**

Run:
```bash
pnpm install
pnpm -F @atlas/spec-graph-sync build
pnpm -F @atlas/spec-graph-sync typecheck
```

Expected: both exit 0; `packages/spec-graph-sync/dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-sync pnpm-lock.yaml
git commit -m "feat(spec-graph-sync): scaffold package with chokidar + workspace dep on spec-graph-data"
```

---

### Task 2: Write-token feedback-loop guard

**Files:**
- Create: `packages/spec-graph-sync/src/write-token.ts`
- Create: `packages/spec-graph-sync/test/write-token.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-sync/test/write-token.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WriteTokenRegistry } from "../src/write-token.js";

describe("WriteTokenRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers a token and reports it as recent", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    registry.register("file-a", "hash-123");
    expect(registry.wasWrittenByUs("file-a", "hash-123")).toBe(true);
  });

  it("returns false for an unknown file/hash pair", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    expect(registry.wasWrittenByUs("file-a", "hash-xyz")).toBe(false);
  });

  it("distinguishes tokens by file path", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    registry.register("file-a", "hash-123");
    expect(registry.wasWrittenByUs("file-b", "hash-123")).toBe(false);
  });

  it("expires tokens after the TTL window", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 1_000 });
    registry.register("file-a", "hash-123");
    vi.advanceTimersByTime(1_100);
    registry.gc();
    expect(registry.wasWrittenByUs("file-a", "hash-123")).toBe(false);
  });

  it("gc() is idempotent and safe on empty registries", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 1_000 });
    expect(() => registry.gc()).not.toThrow();
    expect(() => registry.gc()).not.toThrow();
  });

  it("holds multiple tokens for the same file (rapid successive writes)", () => {
    const registry = new WriteTokenRegistry({ ttlMs: 5_000 });
    registry.register("file-a", "hash-1");
    registry.register("file-a", "hash-2");
    expect(registry.wasWrittenByUs("file-a", "hash-1")).toBe(true);
    expect(registry.wasWrittenByUs("file-a", "hash-2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @atlas/spec-graph-sync test -- test/write-token.test.ts
```

Expected: FAIL. Error mentions `../src/write-token.js` not found.

- [ ] **Step 3: Implement `WriteTokenRegistry`**

`packages/spec-graph-sync/src/write-token.ts`:
```ts
export interface WriteTokenOptions {
  ttlMs: number;
}

interface Token {
  filePath: string;
  contentHash: string;
  expiresAt: number;
}

/**
 * Tracks content hashes the daemon has just written to disk so that the
 * resulting filesystem event can be ignored (prevents feedback loops).
 *
 * Keyed by (filePath, contentHash). Entries expire after `ttlMs`.
 */
export class WriteTokenRegistry {
  private readonly tokens: Map<string, Token[]> = new Map();

  constructor(private readonly opts: WriteTokenOptions) {}

  register(filePath: string, contentHash: string): void {
    const expiresAt = Date.now() + this.opts.ttlMs;
    const existing = this.tokens.get(filePath) ?? [];
    existing.push({ filePath, contentHash, expiresAt });
    this.tokens.set(filePath, existing);
  }

  wasWrittenByUs(filePath: string, contentHash: string): boolean {
    const entries = this.tokens.get(filePath);
    if (!entries) {
      return false;
    }
    const now = Date.now();
    return entries.some((t) => t.contentHash === contentHash && t.expiresAt > now);
  }

  gc(): void {
    const now = Date.now();
    for (const [filePath, entries] of this.tokens) {
      const live = entries.filter((t) => t.expiresAt > now);
      if (live.length === 0) {
        this.tokens.delete(filePath);
      } else if (live.length !== entries.length) {
        this.tokens.set(filePath, live);
      }
    }
  }

  size(): number {
    let total = 0;
    for (const entries of this.tokens.values()) {
      total += entries.length;
    }
    return total;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-sync test -- test/write-token.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/write-token.ts packages/spec-graph-sync/test/write-token.test.ts
git commit -m "feat(spec-graph-sync): add WriteTokenRegistry feedback-loop guard"
```

---

### Task 3: Chokidar watcher wrapper with debouncer

**Files:**
- Create: `packages/spec-graph-sync/src/watcher.ts`
- Create: `packages/spec-graph-sync/test/helpers.ts`
- Create: `packages/spec-graph-sync/test/setup.ts`
- Create: `packages/spec-graph-sync/test/watcher.test.ts`

- [ ] **Step 1: Write test setup + helpers**

`packages/spec-graph-sync/test/setup.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const TEST_URL = "postgresql://atlas:atlas@localhost:5432/atlas_test";
process.env.DATABASE_URL_TEST = TEST_URL;

export async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_URL });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO atlas");

    // Replay all @atlas/spec-graph-data migrations against the test DB
    const thisDir = fileURLToPath(new URL(".", import.meta.url));
    const migrationDir = join(thisDir, "..", "..", "spec-graph-data", "drizzle");
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

`packages/spec-graph-sync/test/helpers.ts`:
```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "@atlas/spec-graph-data";
import { SpecGraphRepo } from "@atlas/spec-graph-data";

export interface ProjectFixture {
  projectId: string;
  projectDir: string;
  atlasDir: string;
  graphPath: string;
  eventsPath: string;
  cleanup: () => void;
}

export function createProjectFixture(): ProjectFixture {
  const projectDir = mkdtempSync(join(tmpdir(), "atlas-sync-"));
  const atlasDir = join(projectDir, ".atlas");
  mkdirSync(atlasDir, { recursive: true });
  const graphPath = join(atlasDir, "spec.graph.json");
  const eventsPath = join(atlasDir, "events.jsonl");
  writeFileSync(graphPath, JSON.stringify({ nodes: [], edges: [] }, null, 2));
  writeFileSync(eventsPath, "");
  return {
    projectId: randomUUID(),
    projectDir,
    atlasDir,
    graphPath,
    eventsPath,
    cleanup: () => rmSync(projectDir, { recursive: true, force: true })
  };
}

export function writeGraphFile(path: string, graph: unknown): void {
  writeFileSync(path, JSON.stringify(graph, null, 2));
}

export function appendEventLine(path: string, event: unknown): void {
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export async function truncateAll(db: Database): Promise<void> {
  await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
}

export async function seedGraph(db: Database, projectId: string, graphData: unknown = {}): Promise<void> {
  const repo = new SpecGraphRepo(db.pool);
  await repo.create(projectId, graphData);
}

export function waitFor(predicate: () => boolean, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 2_000;
  const intervalMs = opts.intervalMs ?? 20;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
```

- [ ] **Step 2: Write the failing watcher test**

`packages/spec-graph-sync/test/watcher.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileWatcher, type WatchEvent } from "../src/watcher.js";
import { appendEventLine, createProjectFixture, waitFor, writeGraphFile, type ProjectFixture } from "./helpers.js";

describe("FileWatcher", () => {
  let fx: ProjectFixture;

  beforeEach(() => {
    fx = createProjectFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it("emits 'graph-changed' when spec.graph.json is written", async () => {
    const events: WatchEvent[] = [];
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 50
    });
    watcher.on("event", (e) => events.push(e));
    await watcher.start();
    try {
      writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
      await waitFor(() => events.some((e) => e.kind === "graph-changed"));
    } finally {
      await watcher.stop();
    }
    expect(events.filter((e) => e.kind === "graph-changed")).toHaveLength(1);
  });

  it("emits 'events-appended' when events.jsonl grows", async () => {
    const events: WatchEvent[] = [];
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 50
    });
    watcher.on("event", (e) => events.push(e));
    await watcher.start();
    try {
      appendEventLine(fx.eventsPath, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
      await waitFor(() => events.some((e) => e.kind === "events-appended"));
    } finally {
      await watcher.stop();
    }
    expect(events.filter((e) => e.kind === "events-appended")).toHaveLength(1);
  });

  it("debounces rapid writes into a single event", async () => {
    const events: WatchEvent[] = [];
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 100
    });
    watcher.on("event", (e) => events.push(e));
    await watcher.start();
    try {
      for (let i = 0; i < 5; i++) {
        writeGraphFile(fx.graphPath, { nodes: [{ id: `n${i}` }], edges: [] });
      }
      // Wait longer than debounce window
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      await watcher.stop();
    }
    expect(events.filter((e) => e.kind === "graph-changed").length).toBeLessThanOrEqual(2);
  });

  it("stop() is idempotent and does not throw on double-call", async () => {
    const watcher = new FileWatcher({
      graphPath: fx.graphPath,
      eventsPath: fx.eventsPath,
      debounceMs: 50
    });
    await watcher.start();
    await watcher.stop();
    await expect(watcher.stop()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/watcher.test.ts
```

Expected: FAIL (module `../src/watcher.js` not found).

- [ ] **Step 4: Implement `FileWatcher`**

`packages/spec-graph-sync/src/watcher.ts`:
```ts
import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";

export type WatchEventKind = "graph-changed" | "events-appended" | "graph-removed" | "events-removed";

export interface WatchEvent {
  kind: WatchEventKind;
  path: string;
  at: number;
}

export interface FileWatcherOptions {
  graphPath: string;
  eventsPath: string;
  debounceMs: number;
}

type Listener = (event: WatchEvent) => void;

/**
 * Thin chokidar wrapper that emits typed `WatchEvent`s for the two tracked
 * files with a per-file debounce window. The debounce collapses bursts of
 * writes (editor atomic-save patterns, rapid programmatic appends) into
 * single emitted events.
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private readonly debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private stopped = false;

  constructor(private readonly opts: FileWatcherOptions) {
    super();
  }

  async start(): Promise<void> {
    const watcher = chokidar.watch([this.opts.graphPath, this.opts.eventsPath], {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 30,
        pollInterval: 10
      }
    });
    this.watcher = watcher;

    const schedule = (kind: WatchEventKind, path: string) => {
      const key = `${kind}:${path}`;
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.debounceTimers.delete(key);
        if (this.stopped) return;
        this.emit("event", { kind, path, at: Date.now() } satisfies WatchEvent);
      }, this.opts.debounceMs);
      this.debounceTimers.set(key, timer);
    };

    watcher.on("add", (path) => {
      if (path === this.opts.graphPath) schedule("graph-changed", path);
      else if (path === this.opts.eventsPath) schedule("events-appended", path);
    });
    watcher.on("change", (path) => {
      if (path === this.opts.graphPath) schedule("graph-changed", path);
      else if (path === this.opts.eventsPath) schedule("events-appended", path);
    });
    watcher.on("unlink", (path) => {
      if (path === this.opts.graphPath) schedule("graph-removed", path);
      else if (path === this.opts.eventsPath) schedule("events-removed", path);
    });

    await new Promise<void>((resolve, reject) => {
      watcher.once("ready", () => resolve());
      watcher.once("error", reject);
    });
  }

  override on(event: "event", listener: Listener): this;
  override on(event: string, listener: (...args: unknown[]) => void): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
```

**Why `awaitWriteFinish`.** On Windows, editor saves arrive as partial writes. Chokidar's `awaitWriteFinish` ensures we don't read a half-written file; the `stabilityThreshold: 30` means "wait 30ms of inactivity before treating the file as complete".

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/watcher.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-sync/src/watcher.ts packages/spec-graph-sync/test/setup.ts packages/spec-graph-sync/test/helpers.ts packages/spec-graph-sync/test/watcher.test.ts
git commit -m "feat(spec-graph-sync): add debounced FileWatcher wrapping chokidar"
```

---

### Task 4: File-to-mirror — ingest new `events.jsonl` lines

**Files:**
- Create: `packages/spec-graph-sync/src/file-to-mirror.ts`
- Create: `packages/spec-graph-sync/test/file-to-mirror.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-sync/test/file-to-mirror.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendEventLine, createProjectFixture, seedGraph, truncateAll, type ProjectFixture } from "./helpers.js";
import { SpecEventRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { ingestNewEventLines, type FileToMirrorState } from "../src/file-to-mirror.js";

describe("ingestNewEventLines", () => {
  let db: Database;
  let fx: ProjectFixture;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId);
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("appends each new JSONL line as a spec_event row", async () => {
    appendEventLine(fx.eventsPath, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    appendEventLine(fx.eventsPath, { eventType: "edge.created", payload: { from: "n1", to: "n2" }, actor: "architect" });

    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const result = await ingestNewEventLines({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      state,
      eventRepo
    });

    expect(result.appended).toBe(2);
    expect(result.invalid).toBe(0);
    expect(state.eventsFileOffset).toBeGreaterThan(0);

    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["node.created", "edge.created"]);
  });

  it("only reads new bytes after the stored offset (no duplicates on re-ingest)", async () => {
    appendEventLine(fx.eventsPath, { eventType: "a", payload: {}, actor: null });
    const state: FileToMirrorState = { eventsFileOffset: 0 };
    await ingestNewEventLines({ projectId: fx.projectId, eventsPath: fx.eventsPath, state, eventRepo });
    appendEventLine(fx.eventsPath, { eventType: "b", payload: {}, actor: null });
    const result = await ingestNewEventLines({ projectId: fx.projectId, eventsPath: fx.eventsPath, state, eventRepo });

    expect(result.appended).toBe(1);
    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["a", "b"]);
  });

  it("skips malformed JSON lines and counts them as invalid", async () => {
    appendEventLine(fx.eventsPath, { eventType: "valid", payload: {}, actor: null });
    // Append a raw broken line (not via helper)
    const { appendFileSync } = await import("node:fs");
    appendFileSync(fx.eventsPath, "this-is-not-json\n");
    appendEventLine(fx.eventsPath, { eventType: "also-valid", payload: {}, actor: null });

    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const result = await ingestNewEventLines({ projectId: fx.projectId, eventsPath: fx.eventsPath, state, eventRepo });

    expect(result.appended).toBe(2);
    expect(result.invalid).toBe(1);
  });

  it("rejects events missing required fields (eventType/payload)", async () => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(fx.eventsPath, `${JSON.stringify({ actor: "x" })}\n`);
    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const result = await ingestNewEventLines({ projectId: fx.projectId, eventsPath: fx.eventsPath, state, eventRepo });
    expect(result.appended).toBe(0);
    expect(result.invalid).toBe(1);
  });

  it("tolerates a trailing partial line (no newline) by leaving it for next read", async () => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(fx.eventsPath, `${JSON.stringify({ eventType: "a", payload: {}, actor: null })}\n`);
    appendFileSync(fx.eventsPath, JSON.stringify({ eventType: "b", payload: {}, actor: null })); // no trailing \n
    const state: FileToMirrorState = { eventsFileOffset: 0 };
    const r1 = await ingestNewEventLines({ projectId: fx.projectId, eventsPath: fx.eventsPath, state, eventRepo });
    expect(r1.appended).toBe(1);
    appendFileSync(fx.eventsPath, "\n");
    const r2 = await ingestNewEventLines({ projectId: fx.projectId, eventsPath: fx.eventsPath, state, eventRepo });
    expect(r2.appended).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/file-to-mirror.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ingestNewEventLines`**

`packages/spec-graph-sync/src/file-to-mirror.ts`:
```ts
import { open } from "node:fs/promises";
import type { SpecEventRepo } from "@atlas/spec-graph-data";

export interface FileToMirrorState {
  /** Byte offset into events.jsonl up to which we've already ingested. */
  eventsFileOffset: number;
}

export interface IngestEventLinesArgs {
  projectId: string;
  eventsPath: string;
  state: FileToMirrorState;
  eventRepo: SpecEventRepo;
}

export interface IngestEventLinesResult {
  appended: number;
  invalid: number;
}

interface ParsedEvent {
  eventType: string;
  payload: unknown;
  actor: string | null;
}

function parseLine(line: string): ParsedEvent | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const eventType = raw["eventType"];
    const payload = raw["payload"];
    if (typeof eventType !== "string" || payload === undefined) return null;
    const actor = raw["actor"];
    return {
      eventType,
      payload,
      actor: typeof actor === "string" ? actor : null
    };
  } catch {
    return null;
  }
}

/**
 * Reads new bytes appended to events.jsonl since the last recorded offset,
 * parses each complete line as a spec event, and appends each one to the
 * mirror via `SpecEventRepo.append`. Malformed or incomplete lines are
 * skipped and counted. The offset advances only past *complete* lines —
 * a trailing partial line (no newline) is left for the next invocation.
 */
export async function ingestNewEventLines(args: IngestEventLinesArgs): Promise<IngestEventLinesResult> {
  const { projectId, eventsPath, state, eventRepo } = args;
  const fh = await open(eventsPath, "r");
  try {
    const stats = await fh.stat();
    if (stats.size <= state.eventsFileOffset) {
      return { appended: 0, invalid: 0 };
    }
    const bytesToRead = stats.size - state.eventsFileOffset;
    const buffer = Buffer.alloc(bytesToRead);
    await fh.read(buffer, 0, bytesToRead, state.eventsFileOffset);
    const text = buffer.toString("utf8");

    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      // Entire read is a partial line. Do not advance offset.
      return { appended: 0, invalid: 0 };
    }
    const completeSection = text.slice(0, lastNewline);
    const completeBytes = Buffer.byteLength(completeSection, "utf8") + 1; // +1 for the \n

    const lines = completeSection.split("\n");
    let appended = 0;
    let invalid = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      const parsed = parseLine(line);
      if (!parsed) {
        invalid += 1;
        continue;
      }
      await eventRepo.append(projectId, parsed);
      appended += 1;
    }

    state.eventsFileOffset += completeBytes;
    return { appended, invalid };
  } finally {
    await fh.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/file-to-mirror.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/file-to-mirror.ts packages/spec-graph-sync/test/file-to-mirror.test.ts
git commit -m "feat(spec-graph-sync): add ingestNewEventLines with offset tracking and malformed-line handling"
```

---

### Task 5: File-to-mirror — sync `spec.graph.json` into mirror + emit diff event

**Files:**
- Modify: `packages/spec-graph-sync/src/file-to-mirror.ts`
- Modify: `packages/spec-graph-sync/test/file-to-mirror.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/file-to-mirror.test.ts`:
```ts
import { writeGraphFile } from "./helpers.js";
import { SpecGraphRepo } from "@atlas/spec-graph-data";
import { syncGraphFileToMirror } from "../src/file-to-mirror.js";

describe("syncGraphFileToMirror", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId, { nodes: [], edges: [] });
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("reads the file, appends a 'graph.file_edited' event, and updates the mirror graph", async () => {
    const newGraph = { nodes: [{ id: "n1" }], edges: [] };
    writeGraphFile(fx.graphPath, newGraph);

    const result = await syncGraphFileToMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      eventRepo
    });

    expect(result.updated).toBe(true);
    const mirror = await graphRepo.findByProjectId(fx.projectId);
    expect(mirror?.graphData).toEqual(newGraph);
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events.map((e) => e.eventType)).toEqual(["graph.file_edited"]);
  });

  it("is a no-op when the file content already equals mirror state", async () => {
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] }); // same as seed
    const result = await syncGraphFileToMirror({
      projectId: fx.projectId,
      graphPath: fx.graphPath,
      graphRepo,
      eventRepo
    });
    expect(result.updated).toBe(false);
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events).toHaveLength(0);
  });

  it("stamps the new event id as current_event_seq on the mirror row", async () => {
    writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
    await syncGraphFileToMirror({ projectId: fx.projectId, graphPath: fx.graphPath, graphRepo, eventRepo });
    const mirror = await graphRepo.findByProjectId(fx.projectId);
    const latest = await eventRepo.getLatest(fx.projectId);
    expect(mirror?.currentEventSeq).toBe(latest?.id);
  });

  it("throws a reconciliation-needed error if the project has no mirror row", async () => {
    const ghost = createProjectFixture();
    try {
      writeGraphFile(ghost.graphPath, { nodes: [], edges: [] });
      await expect(
        syncGraphFileToMirror({ projectId: ghost.projectId, graphPath: ghost.graphPath, graphRepo, eventRepo })
      ).rejects.toThrow(/reconciliation-needed/i);
    } finally {
      ghost.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/file-to-mirror.test.ts
```

Expected: FAIL (`syncGraphFileToMirror` not exported).

- [ ] **Step 3: Implement `syncGraphFileToMirror`**

Append to `packages/spec-graph-sync/src/file-to-mirror.ts`:
```ts
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { SpecGraphRepo } from "@atlas/spec-graph-data";

export interface SyncGraphFileArgs {
  projectId: string;
  graphPath: string;
  graphRepo: SpecGraphRepo;
  eventRepo: SpecEventRepo;
}

export interface SyncGraphFileResult {
  updated: boolean;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function syncGraphFileToMirror(args: SyncGraphFileArgs): Promise<SyncGraphFileResult> {
  const { projectId, graphPath, graphRepo, eventRepo } = args;
  const raw = await readFile(graphPath, "utf8");
  const fileGraph = JSON.parse(raw) as unknown;
  const fileHash = sha256(JSON.stringify(fileGraph));

  const mirror = await graphRepo.findByProjectId(projectId);
  if (!mirror) {
    throw new Error(
      `reconciliation-needed: project ${projectId} has a spec.graph.json on disk but no mirror row. ` +
        `Create the project via SpecGraphRepo.create before starting the sync daemon.`
    );
  }

  const mirrorHash = sha256(JSON.stringify(mirror.graphData));
  if (mirrorHash === fileHash) {
    return { updated: false };
  }

  const event = await eventRepo.append(projectId, {
    eventType: "graph.file_edited",
    payload: { fileHash, mirrorHashBefore: mirrorHash },
    actor: "sync-daemon"
  });
  await graphRepo.updateGraphData(projectId, fileGraph, event.id);
  return { updated: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/file-to-mirror.test.ts
```

Expected: PASS (9 tests total in file).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/file-to-mirror.ts packages/spec-graph-sync/test/file-to-mirror.test.ts
git commit -m "feat(spec-graph-sync): add syncGraphFileToMirror with hash-based diff detection"
```

---

### Task 6: Mirror-to-file — atomic write of `spec.graph.json`

**Files:**
- Create: `packages/spec-graph-sync/src/mirror-to-file.ts`
- Create: `packages/spec-graph-sync/test/mirror-to-file.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-sync/test/mirror-to-file.test.ts`:
```ts
import { readFileSync, existsSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { writeGraphFromMirror } from "../src/mirror-to-file.js";
import { createProjectFixture, seedGraph, truncateAll, type ProjectFixture } from "./helpers.js";
import { WriteTokenRegistry } from "../src/write-token.js";

describe("writeGraphFromMirror", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("writes the mirror's graph_data to spec.graph.json", async () => {
    const data = { nodes: [{ id: "n1" }], edges: [] };
    await seedGraph(db, fx.projectId, data);
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await writeGraphFromMirror({ projectId: fx.projectId, graphPath: fx.graphPath, graphRepo, tokens });
    const onDisk = JSON.parse(readFileSync(fx.graphPath, "utf8")) as unknown;
    expect(onDisk).toEqual(data);
  });

  it("registers a write token for the hash of what it wrote", async () => {
    const data = { nodes: [{ id: "n2" }], edges: [] };
    await seedGraph(db, fx.projectId, data);
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await writeGraphFromMirror({ projectId: fx.projectId, graphPath: fx.graphPath, graphRepo, tokens });

    const written = readFileSync(fx.graphPath, "utf8");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(written).digest("hex");
    expect(tokens.wasWrittenByUs(fx.graphPath, hash)).toBe(true);
  });

  it("uses write-temp-then-rename so a crash mid-write leaves the original intact", async () => {
    await seedGraph(db, fx.projectId, { nodes: [], edges: [] });
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await writeGraphFromMirror({ projectId: fx.projectId, graphPath: fx.graphPath, graphRepo, tokens });
    // The temp file should not linger after a successful rename
    expect(existsSync(`${fx.graphPath}.tmp`)).toBe(false);
  });

  it("throws when the mirror has no row for the project", async () => {
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await expect(
      writeGraphFromMirror({ projectId: fx.projectId, graphPath: fx.graphPath, graphRepo, tokens })
    ).rejects.toThrow(/no mirror row/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/mirror-to-file.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `writeGraphFromMirror`**

`packages/spec-graph-sync/src/mirror-to-file.ts`:
```ts
import { createHash } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import type { SpecGraphRepo } from "@atlas/spec-graph-data";
import type { WriteTokenRegistry } from "./write-token.js";

export interface WriteGraphArgs {
  projectId: string;
  graphPath: string;
  graphRepo: SpecGraphRepo;
  tokens: WriteTokenRegistry;
}

/**
 * Reads the authoritative mirror state for `projectId` and writes it to
 * `graphPath` atomically: write a `.tmp` sibling, fsync it, rename over
 * the target. Registers the output's SHA-256 hash in the write-token
 * registry so the resulting filesystem event will be filtered out.
 */
export async function writeGraphFromMirror(args: WriteGraphArgs): Promise<void> {
  const { projectId, graphPath, graphRepo, tokens } = args;
  const row = await graphRepo.findByProjectId(projectId);
  if (!row) {
    throw new Error(`writeGraphFromMirror: no mirror row for project ${projectId}`);
  }
  const serialized = `${JSON.stringify(row.graphData, null, 2)}\n`;
  const tmpPath = `${graphPath}.tmp`;
  const fh = await open(tmpPath, "w");
  try {
    await fh.writeFile(serialized, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmpPath, graphPath);
  } catch (err) {
    // Best-effort cleanup so a failed rename doesn't leave a stray .tmp
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  const hash = createHash("sha256").update(serialized).digest("hex");
  tokens.register(graphPath, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/mirror-to-file.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/mirror-to-file.ts packages/spec-graph-sync/test/mirror-to-file.test.ts
git commit -m "feat(spec-graph-sync): add atomic writeGraphFromMirror with write-token tagging"
```

---

### Task 7: Mirror-to-file — append missing events to `events.jsonl` on reconnect

**Files:**
- Modify: `packages/spec-graph-sync/src/mirror-to-file.ts`
- Modify: `packages/spec-graph-sync/test/mirror-to-file.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/mirror-to-file.test.ts`:
```ts
import { SpecEventRepo } from "@atlas/spec-graph-data";
import { appendEventLine } from "./helpers.js";
import { reconcileEventsJsonl } from "../src/mirror-to-file.js";
import { appendFileSync } from "node:fs";

describe("reconcileEventsJsonl", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId);
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("appends mirror events that are not yet represented in events.jsonl", async () => {
    await eventRepo.append(fx.projectId, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    await eventRepo.append(fx.projectId, { eventType: "edge.created", payload: { from: "n1", to: "n2" }, actor: "architect" });

    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    const result = await reconcileEventsJsonl({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      eventRepo,
      tokens
    });

    expect(result.appended).toBe(2);
    const content = readFileSync(fx.eventsPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).eventType).toBe("node.created");
  });

  it("does not re-append events already present on disk (by id)", async () => {
    const first = await eventRepo.append(fx.projectId, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    appendFileSync(fx.eventsPath, `${JSON.stringify({ id: first.id.toString(), eventType: "node.created", payload: { id: "n1" }, actor: "architect" })}\n`);
    await eventRepo.append(fx.projectId, { eventType: "edge.created", payload: {}, actor: "architect" });

    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    const result = await reconcileEventsJsonl({
      projectId: fx.projectId,
      eventsPath: fx.eventsPath,
      eventRepo,
      tokens
    });

    expect(result.appended).toBe(1);
    const lines = readFileSync(fx.eventsPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("registers write tokens so the resulting file event is ignored", async () => {
    await eventRepo.append(fx.projectId, { eventType: "x", payload: {}, actor: null });
    const tokens = new WriteTokenRegistry({ ttlMs: 5_000 });
    await reconcileEventsJsonl({ projectId: fx.projectId, eventsPath: fx.eventsPath, eventRepo, tokens });
    const content = readFileSync(fx.eventsPath, "utf8");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(content).digest("hex");
    expect(tokens.wasWrittenByUs(fx.eventsPath, hash)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/mirror-to-file.test.ts
```

Expected: FAIL (`reconcileEventsJsonl` not exported).

- [ ] **Step 3: Implement `reconcileEventsJsonl`**

Append to `packages/spec-graph-sync/src/mirror-to-file.ts`:
```ts
import { appendFile, readFile, stat } from "node:fs/promises";
import type { SpecEventRepo } from "@atlas/spec-graph-data";

export interface ReconcileEventsArgs {
  projectId: string;
  eventsPath: string;
  eventRepo: SpecEventRepo;
  tokens: WriteTokenRegistry;
}

export interface ReconcileEventsResult {
  appended: number;
  highestIdOnDisk: bigint;
}

function parseIdsFromJsonl(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const id = obj["id"];
      if (typeof id === "string" || typeof id === "number") {
        ids.add(String(id));
      }
    } catch {
      // skip malformed
    }
  }
  return ids;
}

/**
 * Reads events.jsonl, extracts the set of event ids already recorded on disk,
 * queries the mirror for all events, and appends any missing ones. Run at
 * daemon startup to heal any gaps (e.g. the mirror has events from another
 * process that this checkout never saw).
 */
export async function reconcileEventsJsonl(args: ReconcileEventsArgs): Promise<ReconcileEventsResult> {
  const { projectId, eventsPath, eventRepo, tokens } = args;
  let existingIds: Set<string> = new Set();
  try {
    const existing = await readFile(eventsPath, "utf8");
    existingIds = parseIdsFromJsonl(existing);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const mirrorEvents = await eventRepo.listSince(projectId, 0n, { limit: 100_000 });
  const missing = mirrorEvents.filter((e) => !existingIds.has(e.id.toString()));

  let appendedText = "";
  for (const ev of missing) {
    appendedText += `${JSON.stringify({
      id: ev.id.toString(),
      eventType: ev.eventType,
      payload: ev.payload,
      actor: ev.actor,
      createdAt: ev.createdAt.toISOString()
    })}\n`;
  }
  if (appendedText.length > 0) {
    await appendFile(eventsPath, appendedText, "utf8");
    const fullContent = await readFile(eventsPath, "utf8");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(fullContent).digest("hex");
    tokens.register(eventsPath, hash);
  }

  const sizeHint = (await stat(eventsPath)).size;
  return {
    appended: missing.length,
    highestIdOnDisk: mirrorEvents.length === 0 ? 0n : mirrorEvents[mirrorEvents.length - 1]!.id
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/mirror-to-file.test.ts
```

Expected: PASS (7 tests total in file).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/mirror-to-file.ts packages/spec-graph-sync/test/mirror-to-file.test.ts
git commit -m "feat(spec-graph-sync): add reconcileEventsJsonl for startup event backfill"
```

---

### Task 8: Observability — extend metrics registry + spans

**Files:**
- Create: `packages/spec-graph-sync/src/observability.ts`
- Create: `packages/spec-graph-sync/test/observability.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-sync/test/observability.test.ts`:
```ts
import { SpanKind } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { metricsRegistry } from "@atlas/spec-graph-data";
import {
  syncFeedbackLoopsAvoided,
  syncInvalidLinesTotal,
  syncPropagationDuration,
  syncReconciliationNeeded,
  syncWatchEvents,
  withSyncSpan
} from "../src/observability.js";

describe("sync observability", () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
  });

  beforeEach(() => {
    exporter.reset();
    metricsRegistry.resetMetrics();
  });

  afterAll(() => {
    exporter.reset();
  });

  it("registers sync metrics on the shared @atlas/spec-graph-data registry", async () => {
    syncWatchEvents.inc({ direction: "file-to-mirror", kind: "file-changed" });
    syncFeedbackLoopsAvoided.inc();
    syncInvalidLinesTotal.inc();
    syncReconciliationNeeded.inc();
    syncPropagationDuration.observe({ direction: "file-to-mirror" }, 0.123);

    const out = await metricsRegistry.metrics();
    expect(out).toMatch(/atlas_sync_watch_events_total\{direction="file-to-mirror",kind="file-changed"\} 1/);
    expect(out).toMatch(/atlas_sync_feedback_loops_avoided_total 1/);
    expect(out).toMatch(/atlas_sync_invalid_lines_total 1/);
    expect(out).toMatch(/atlas_sync_reconciliation_needed_total 1/);
    expect(out).toMatch(/atlas_sync_propagation_duration_seconds_count\{direction="file-to-mirror"\} 1/);
  });

  it("withSyncSpan emits a span with the expected name and attributes", async () => {
    await withSyncSpan("SyncDaemon.propagateFileToMirror", { "atlas.project_id": "abc" }, async () => {
      // work
    });
    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === "SyncDaemon.propagateFileToMirror");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.INTERNAL);
    expect(span!.attributes["atlas.project_id"]).toBe("abc");
  });

  it("withSyncSpan records errors and sets error status", async () => {
    await expect(
      withSyncSpan("SyncDaemon.propagateFileToMirror", { "atlas.project_id": "abc" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const span = exporter.getFinishedSpans().find((s) => s.name === "SyncDaemon.propagateFileToMirror");
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(2); // ERROR
  });
});
```

Add the required dev dep:
```bash
pnpm -F @atlas/spec-graph-sync add -D @opentelemetry/sdk-trace-base@1.28.0
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/observability.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement sync observability**

`packages/spec-graph-sync/src/observability.ts`:
```ts
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Counter, Histogram } from "prom-client";
import { metricsRegistry } from "@atlas/spec-graph-data";

const TRACER_NAME = "@atlas/spec-graph-sync";
export const syncTracer = trace.getTracer(TRACER_NAME);

export const syncWatchEvents = new Counter({
  name: "atlas_sync_watch_events_total",
  help: "File/mirror sync watch events by direction and kind",
  labelNames: ["direction", "kind"] as const,
  registers: [metricsRegistry]
});

export const syncPropagationDuration = new Histogram({
  name: "atlas_sync_propagation_duration_seconds",
  help: "Duration of a single propagation cycle in seconds",
  labelNames: ["direction"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry]
});

export const syncFeedbackLoopsAvoided = new Counter({
  name: "atlas_sync_feedback_loops_avoided_total",
  help: "File events ignored because they match a recent write token",
  registers: [metricsRegistry]
});

export const syncInvalidLinesTotal = new Counter({
  name: "atlas_sync_invalid_lines_total",
  help: "Malformed events.jsonl lines skipped during ingest",
  registers: [metricsRegistry]
});

export const syncReconciliationNeeded = new Counter({
  name: "atlas_sync_reconciliation_needed_total",
  help: "Times the daemon logged a reconciliation-needed condition",
  registers: [metricsRegistry]
});

export async function withSyncSpan<T>(
  operationName: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return syncTracer.startActiveSpan(operationName, async (span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.UNSET });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/observability.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/observability.ts packages/spec-graph-sync/test/observability.test.ts packages/spec-graph-sync/package.json pnpm-lock.yaml
git commit -m "feat(spec-graph-sync): extend metrics registry with sync counters and propagation span helper"
```

---

### Task 9: `SyncDaemon` class — orchestration

**Files:**
- Create: `packages/spec-graph-sync/src/daemon.ts`
- Create: `packages/spec-graph-sync/test/daemon.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

`packages/spec-graph-sync/test/daemon.integration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecEventRepo, SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { SyncDaemon } from "../src/daemon.js";
import { appendEventLine, createProjectFixture, seedGraph, truncateAll, waitFor, writeGraphFile, type ProjectFixture } from "./helpers.js";

describe("SyncDaemon — integration", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId, { nodes: [], edges: [] });
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("file -> mirror: appending to events.jsonl shows up in the mirror", async () => {
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start();
    try {
      appendEventLine(fx.eventsPath, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
      await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length > 0, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }
    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toContain("node.created");
  });

  it("file -> mirror: editing spec.graph.json updates mirror + emits graph.file_edited", async () => {
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start();
    try {
      writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
      await waitFor(async () => {
        const g = await graphRepo.findByProjectId(fx.projectId);
        return JSON.stringify(g?.graphData) === JSON.stringify({ nodes: [{ id: "n1" }], edges: [] });
      }, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events.some((e) => e.eventType === "graph.file_edited")).toBe(true);
  });

  it("mirror -> file: on startup, regenerates spec.graph.json from mirror state", async () => {
    await graphRepo.updateGraphData(fx.projectId, { nodes: [{ id: "seed" }], edges: [] }, 0n);
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] }); // stale disk
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start({ regenerateOnStartup: true });
    try {
      await waitFor(() => {
        const onDisk = JSON.parse(readFileSync(fx.graphPath, "utf8")) as { nodes: Array<{ id: string }> };
        return onDisk.nodes?.[0]?.id === "seed";
      }, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }
  });

  it("round-trip: stop -> restart -> no event loss and no duplication", async () => {
    const d1 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d1.start();
    appendEventLine(fx.eventsPath, { eventType: "a", payload: {}, actor: null });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 1, { timeoutMs: 5_000 });
    await d1.stop();

    const d2 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d2.start();
    appendEventLine(fx.eventsPath, { eventType: "b", payload: {}, actor: null });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 2, { timeoutMs: 5_000 });
    await d2.stop();

    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/daemon.integration.test.ts
```

Expected: FAIL (module `../src/daemon.js` not found).

- [ ] **Step 3: Implement `SyncDaemon`**

`packages/spec-graph-sync/src/daemon.ts`:
```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { statSync } from "node:fs";
import type { Pool } from "pg";
import { SpecEventRepo, SpecGraphRepo } from "@atlas/spec-graph-data";
import { FileWatcher, type WatchEvent } from "./watcher.js";
import { WriteTokenRegistry } from "./write-token.js";
import { ingestNewEventLines, syncGraphFileToMirror, type FileToMirrorState } from "./file-to-mirror.js";
import { reconcileEventsJsonl, writeGraphFromMirror } from "./mirror-to-file.js";
import {
  syncFeedbackLoopsAvoided,
  syncInvalidLinesTotal,
  syncPropagationDuration,
  syncReconciliationNeeded,
  syncWatchEvents,
  withSyncSpan
} from "./observability.js";

export interface SyncDaemonOptions {
  projectId: string;
  projectDir: string;
  pool: Pool;
  debounceMs?: number;
  writeTokenTtlMs?: number;
}

export interface StartOptions {
  regenerateOnStartup?: boolean;
}

export class SyncDaemon {
  private readonly graphPath: string;
  private readonly eventsPath: string;
  private readonly tokens: WriteTokenRegistry;
  private readonly graphRepo: SpecGraphRepo;
  private readonly eventRepo: SpecEventRepo;
  private readonly state: FileToMirrorState;
  private watcher: FileWatcher | null = null;
  private started = false;
  private gcInterval: NodeJS.Timeout | null = null;

  constructor(private readonly opts: SyncDaemonOptions) {
    const atlasDir = join(opts.projectDir, ".atlas");
    this.graphPath = join(atlasDir, "spec.graph.json");
    this.eventsPath = join(atlasDir, "events.jsonl");
    this.tokens = new WriteTokenRegistry({ ttlMs: opts.writeTokenTtlMs ?? 5_000 });
    this.graphRepo = new SpecGraphRepo(opts.pool);
    this.eventRepo = new SpecEventRepo(opts.pool);
    this.state = { eventsFileOffset: 0 };
  }

  async start(opts: StartOptions = {}): Promise<void> {
    if (this.started) return;
    // Initialise offset to current file size so startup backfill is not treated as "new"
    try {
      this.state.eventsFileOffset = statSync(this.eventsPath).size;
    } catch {
      this.state.eventsFileOffset = 0;
    }

    // Startup: reconcile events file from mirror, regenerate graph file if asked
    await reconcileEventsJsonl({
      projectId: this.opts.projectId,
      eventsPath: this.eventsPath,
      eventRepo: this.eventRepo,
      tokens: this.tokens
    });
    // Re-stat after reconcile so we don't re-ingest what we just wrote
    try {
      this.state.eventsFileOffset = statSync(this.eventsPath).size;
    } catch {
      /* ignore */
    }
    if (opts.regenerateOnStartup) {
      await writeGraphFromMirror({
        projectId: this.opts.projectId,
        graphPath: this.graphPath,
        graphRepo: this.graphRepo,
        tokens: this.tokens
      });
    }

    this.watcher = new FileWatcher({
      graphPath: this.graphPath,
      eventsPath: this.eventsPath,
      debounceMs: this.opts.debounceMs ?? 100
    });
    this.watcher.on("event", (e) => void this.handle(e));
    await this.watcher.start();
    this.gcInterval = setInterval(() => this.tokens.gc(), 1_000);
    this.started = true;

    // eslint-disable-next-line no-console
    console.log(
      `[atlas-sync] watching project=${this.opts.projectId} dir=${this.opts.projectDir} graph=${this.graphPath} events=${this.eventsPath}`
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.gcInterval) clearInterval(this.gcInterval);
    this.gcInterval = null;
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
  }

  private async handle(event: WatchEvent): Promise<void> {
    syncWatchEvents.inc({ direction: "file-to-mirror", kind: event.kind });

    // Feedback-loop guard: ignore events matching a recent write token
    try {
      const content = await readFile(event.path, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      if (this.tokens.wasWrittenByUs(event.path, hash)) {
        syncFeedbackLoopsAvoided.inc();
        return;
      }
    } catch {
      /* if file read fails we still proceed — downstream handler will see it */
    }

    const timer = syncPropagationDuration.startTimer({ direction: "file-to-mirror" });
    try {
      await withSyncSpan(
        "SyncDaemon.propagateFileToMirror",
        { "atlas.project_id": this.opts.projectId, "atlas.sync.kind": event.kind },
        async () => {
          if (event.kind === "events-appended") {
            const result = await ingestNewEventLines({
              projectId: this.opts.projectId,
              eventsPath: this.eventsPath,
              state: this.state,
              eventRepo: this.eventRepo
            });
            if (result.invalid > 0) syncInvalidLinesTotal.inc(result.invalid);
          } else if (event.kind === "graph-changed") {
            try {
              await syncGraphFileToMirror({
                projectId: this.opts.projectId,
                graphPath: this.graphPath,
                graphRepo: this.graphRepo,
                eventRepo: this.eventRepo
              });
            } catch (err) {
              if ((err as Error).message.startsWith("reconciliation-needed")) {
                syncReconciliationNeeded.inc();
                // eslint-disable-next-line no-console
                console.warn(`[atlas-sync] reconciliation-needed: ${(err as Error).message}`);
                return;
              }
              throw err;
            }
          }
        }
      );
    } finally {
      timer();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/daemon.integration.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-sync/src/daemon.ts packages/spec-graph-sync/test/daemon.integration.test.ts
git commit -m "feat(spec-graph-sync): wire SyncDaemon orchestrating watcher + repos + write-tokens"
```

---

### Task 10: CLI entry point + `atlas-sync` binary

**Files:**
- Create: `packages/spec-graph-sync/src/cli.ts`
- Create: `packages/spec-graph-sync/bin/atlas-sync.js`
- Create: `packages/spec-graph-sync/test/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-sync/test/cli.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { createDatabase, SpecEventRepo, SpecGraphRepo, type Database } from "@atlas/spec-graph-data";
import { appendEventLine, createProjectFixture, seedGraph, truncateAll, waitFor, type ProjectFixture } from "./helpers.js";

const CLI_ENTRY = resolve(__dirname, "..", "bin", "atlas-sync.js");

describe("atlas-sync CLI", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId);
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("exits non-zero when required args are missing", async () => {
    const result = await execa("node", [CLI_ENTRY], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--project-dir/);
  });

  it("starts, propagates an event, and shuts down cleanly on SIGINT", async () => {
    const child = execa(
      "node",
      [
        CLI_ENTRY,
        "--project-dir", fx.projectDir,
        "--project-id", fx.projectId,
        "--database-url", process.env.DATABASE_URL_TEST!,
        "--debounce-ms", "50"
      ],
      { buffer: true }
    );

    // Wait for the "watching" log line
    await waitFor(() => (child.stdout?.read() ? true : false), { timeoutMs: 5_000 }).catch(() => undefined);
    // Cheaper: just sleep 500ms for ready
    await new Promise((r) => setTimeout(r, 500));

    appendEventLine(fx.eventsPath, { eventType: "cli-test", payload: {}, actor: null });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length > 0, { timeoutMs: 5_000 });

    child.kill("SIGINT");
    const result = await child;
    expect(result.exitCode).toBe(0);
  });

  it("rejects an invalid project-id (not a UUID)", async () => {
    const result = await execa(
      "node",
      [
        CLI_ENTRY,
        "--project-dir", fx.projectDir,
        "--project-id", "not-a-uuid",
        "--database-url", process.env.DATABASE_URL_TEST!
      ],
      { reject: false, timeout: 5_000 }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/uuid/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/cli.test.ts
```

Expected: FAIL (`bin/atlas-sync.js` does not exist).

- [ ] **Step 3: Implement CLI entry**

`packages/spec-graph-sync/src/cli.ts`:
```ts
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { SyncDaemon } from "./daemon.js";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface CliArgs {
  projectDir: string;
  projectId: string;
  databaseUrl: string;
  debounceMs: number;
  regenerateOnStartup: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "project-dir": { type: "string" },
      "project-id": { type: "string" },
      "database-url": { type: "string" },
      "debounce-ms": { type: "string", default: "100" },
      "regenerate-on-startup": { type: "boolean", default: false }
    },
    strict: true,
    allowPositionals: false
  });
  const projectDir = values["project-dir"];
  const projectId = values["project-id"];
  const databaseUrl = values["database-url"];
  if (!projectDir) throw new Error("--project-dir is required");
  if (!projectId) throw new Error("--project-id is required");
  if (!databaseUrl) throw new Error("--database-url is required");
  if (!UUID_RE.test(projectId)) throw new Error(`--project-id must be a UUID, got "${projectId}"`);

  return {
    projectDir,
    projectId,
    databaseUrl,
    debounceMs: Number.parseInt(values["debounce-ms"] ?? "100", 10),
    regenerateOnStartup: Boolean(values["regenerate-on-startup"])
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`[atlas-sync] ${(err as Error).message}\n`);
    process.exit(2);
  }

  const pool = new Pool({ connectionString: args.databaseUrl });
  const daemon = new SyncDaemon({
    projectId: args.projectId,
    projectDir: args.projectDir,
    pool,
    debounceMs: args.debounceMs
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`[atlas-sync] received ${signal}, stopping...\n`);
    try {
      await daemon.stop();
      await pool.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[atlas-sync] shutdown error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await daemon.start({ regenerateOnStartup: args.regenerateOnStartup });
  } catch (err) {
    process.stderr.write(`[atlas-sync] startup error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
```

`packages/spec-graph-sync/bin/atlas-sync.js`:
```js
#!/usr/bin/env node
import("../dist/cli.js").then((m) => m.main()).catch((err) => {
  process.stderr.write(`[atlas-sync] fatal: ${err?.message ?? err}\n`);
  process.exit(1);
});
```

On POSIX make the shim executable (no-op on Windows):
```bash
chmod +x packages/spec-graph-sync/bin/atlas-sync.js 2>/dev/null || true
```

- [ ] **Step 4: Build so the shim has something to import**

```bash
pnpm -F @atlas/spec-graph-sync build
```

Expected: exit 0; `packages/spec-graph-sync/dist/cli.js` exists.

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/cli.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-sync/src/cli.ts packages/spec-graph-sync/bin/atlas-sync.js packages/spec-graph-sync/test/cli.test.ts
git commit -m "feat(spec-graph-sync): add atlas-sync CLI with SIGINT/SIGTERM graceful shutdown"
```

---

### Task 11: Full round-trip integration

**Files:**
- Modify: `packages/spec-graph-sync/test/daemon.integration.test.ts`

- [ ] **Step 1: Add the end-to-end round-trip test**

Append to `test/daemon.integration.test.ts`:
```ts
describe("SyncDaemon — full round-trip", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId, { nodes: [], edges: [] });
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("events -> mirror -> graph.json rewrite -> restart preserves state", async () => {
    const d1 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d1.start();

    // Step 1: append an event via the file
    appendEventLine(fx.eventsPath, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 1, { timeoutMs: 5_000 });

    // Step 2: update the graph file
    writeGraphFile(fx.graphPath, { nodes: [{ id: "n1" }], edges: [] });
    await waitFor(async () => {
      const g = await graphRepo.findByProjectId(fx.projectId);
      return (g?.graphData as { nodes?: unknown[] })?.nodes?.length === 1;
    }, { timeoutMs: 5_000 });

    await d1.stop();

    // Step 3: tamper with the graph file while the daemon is down
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] });

    // Step 4: restart with regenerateOnStartup — disk should match mirror again
    const d2 = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await d2.start({ regenerateOnStartup: true });
    try {
      await waitFor(() => {
        const onDisk = JSON.parse(readFileSync(fx.graphPath, "utf8")) as { nodes?: Array<{ id: string }> };
        return onDisk.nodes?.[0]?.id === "n1";
      }, { timeoutMs: 5_000 });
    } finally {
      await d2.stop();
    }

    // Step 5: no duplicate events in the mirror
    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.filter((r) => r.eventType === "node.created")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/daemon.integration.test.ts
```

Expected: PASS (5 tests total in file).

- [ ] **Step 3: Run the full suite to confirm no regressions**

```bash
pnpm -F @atlas/spec-graph-sync test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-sync/test/daemon.integration.test.ts
git commit -m "test(spec-graph-sync): add full round-trip scenario with restart + regenerate-on-startup"
```

---

### Task 12: Feedback-loop regression test

**Files:**
- Modify: `packages/spec-graph-sync/test/daemon.integration.test.ts`

- [ ] **Step 1: Add the feedback-loop test**

Append to `test/daemon.integration.test.ts`:
```ts
describe("SyncDaemon — feedback-loop prevention", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("regenerating spec.graph.json from mirror does not re-trigger file->mirror ingest", async () => {
    await seedGraph(db, fx.projectId, { nodes: [{ id: "seed" }], edges: [] });
    writeGraphFile(fx.graphPath, { nodes: [], edges: [] }); // drift

    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start({ regenerateOnStartup: true });
    try {
      // Give the daemon time to process any feedback events
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      await daemon.stop();
    }

    // The daemon should NOT have appended a 'graph.file_edited' event for its own write
    const events = await eventRepo.listSince(fx.projectId, 0n);
    expect(events.filter((e) => e.eventType === "graph.file_edited")).toHaveLength(0);
  });

  it("reconcileEventsJsonl write does not re-ingest the lines we just backfilled", async () => {
    await seedGraph(db, fx.projectId);
    await eventRepo.append(fx.projectId, { eventType: "node.created", payload: { id: "n1" }, actor: "architect" });

    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start(); // reconciles events.jsonl with the single mirror event
    try {
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      await daemon.stop();
    }

    const rows = await eventRepo.listSince(fx.projectId, 0n);
    // Exactly one event total — no duplicate appended from our own reconcile write
    expect(rows.filter((r) => r.eventType === "node.created")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/daemon.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-sync/test/daemon.integration.test.ts
git commit -m "test(spec-graph-sync): pin feedback-loop prevention with regression tests"
```

---

### Task 13: Invalid-line handling + metric assertion

**Files:**
- Modify: `packages/spec-graph-sync/test/daemon.integration.test.ts`

- [ ] **Step 1: Add the invalid-line test**

Append to `test/daemon.integration.test.ts`:
```ts
import { metricsRegistry } from "@atlas/spec-graph-data";
import { appendFileSync } from "node:fs";

describe("SyncDaemon — invalid line handling", () => {
  let db: Database;
  let fx: ProjectFixture;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId);
    metricsRegistry.resetMetrics();
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("skips a malformed events.jsonl line, increments the counter, continues ingesting valid lines", async () => {
    const daemon = new SyncDaemon({
      projectId: fx.projectId,
      projectDir: fx.projectDir,
      pool: db.pool,
      debounceMs: 50,
      writeTokenTtlMs: 5_000
    });
    await daemon.start();
    try {
      appendFileSync(fx.eventsPath, `${JSON.stringify({ eventType: "valid", payload: {}, actor: null })}\n`);
      appendFileSync(fx.eventsPath, "not-json\n");
      appendFileSync(fx.eventsPath, `${JSON.stringify({ eventType: "also-valid", payload: {}, actor: null })}\n`);

      await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length >= 2, { timeoutMs: 5_000 });
    } finally {
      await daemon.stop();
    }

    const rows = await eventRepo.listSince(fx.projectId, 0n);
    expect(rows.map((r) => r.eventType)).toEqual(["valid", "also-valid"]);

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toMatch(/atlas_sync_invalid_lines_total 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm -F @atlas/spec-graph-sync test -- test/daemon.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full suite**

```bash
pnpm -F @atlas/spec-graph-sync test
```

Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/spec-graph-sync/test/daemon.integration.test.ts
git commit -m "test(spec-graph-sync): cover invalid-line handling + atlas_sync_invalid_lines_total"
```

---

### Task 14: Package README

**Files:**
- Create: `packages/spec-graph-sync/README.md`

- [ ] **Step 1: Write the README**

`packages/spec-graph-sync/README.md`:
````markdown
# @atlas/spec-graph-sync

Bidirectional file ↔ Postgres-mirror sync daemon for the Atlas Living Spec Graph.

This package keeps `.atlas/spec.graph.json` and `.atlas/events.jsonl` in lockstep with the mirror owned by `@atlas/spec-graph-data`. The mirror is authoritative; the files are the export/audit surface (PRD §11.5).

## What it does

- Watches `.atlas/spec.graph.json` and `.atlas/events.jsonl` with chokidar (debounced, 100ms default).
- **File → mirror:** appends each new JSONL line to `spec_events` and replaces `spec_graphs.graph_data` on graph-file changes (emitting a `graph.file_edited` event).
- **Mirror → file:** on startup, backfills any events.jsonl gaps and (optionally) regenerates the graph file from mirror state atomically (`write-tmp → fsync → rename`).
- Prevents feedback loops: daemon writes are tagged by SHA-256 content hash so the resulting filesystem event is ignored.
- Logs `reconciliation-needed` when mirror state and file state genuinely disagree (resolution is Plan A.3's job).

## CLI

Install with `pnpm -F @atlas/spec-graph-sync build` (the `atlas-sync` binary lives at `packages/spec-graph-sync/bin/atlas-sync.js`).

```bash
atlas-sync \
  --project-dir /path/to/my-atlas-project \
  --project-id 00000000-0000-0000-0000-000000000001 \
  --database-url "$DATABASE_URL" \
  --debounce-ms 100 \
  --regenerate-on-startup
```

Required:
- `--project-dir` — path containing the `.atlas/` directory
- `--project-id` — project UUID (must already exist in the mirror via `SpecGraphRepo.create`)
- `--database-url` — Postgres connection string

Optional:
- `--debounce-ms` (default `100`)
- `--regenerate-on-startup` (default `false`) — if set, rewrites `spec.graph.json` from mirror on start

Signal handling: SIGINT and SIGTERM trigger a graceful stop (close watcher, end pool, exit 0).

## Environment

```
DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlas_dev
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5432/atlas_test
```

## Programmatic usage

```ts
import { SyncDaemon } from "@atlas/spec-graph-sync";
import { createDatabase } from "@atlas/spec-graph-data";

const { pool } = createDatabase(process.env.DATABASE_URL!);
const daemon = new SyncDaemon({
  projectId,
  projectDir: "/path/to/project",
  pool,
  debounceMs: 100
});
await daemon.start({ regenerateOnStartup: true });
// ...
await daemon.stop();
```

## Observability

Extends the shared `metricsRegistry` from `@atlas/spec-graph-data`:

- `atlas_sync_watch_events_total{direction, kind}` (counter) — kinds: `file-changed`, `file-added`, `file-removed`; directions: `file-to-mirror`, `mirror-to-file`.
- `atlas_sync_propagation_duration_seconds{direction}` (histogram)
- `atlas_sync_feedback_loops_avoided_total` (counter)
- `atlas_sync_invalid_lines_total` (counter)
- `atlas_sync_reconciliation_needed_total` (counter)

OpenTelemetry spans: every propagation cycle runs inside `SyncDaemon.propagateFileToMirror` with `atlas.project_id` and `atlas.sync.kind` attributes.

## Operations

**One daemon per project.** If two daemons are started for the same `projectId` they will both succeed but double-ingest file events. Guard at the launcher layer (e.g. a lock file under `.atlas/`).

**Crash recovery.** On restart, the daemon:
1. Snapshots the current size of `events.jsonl` as its starting offset (so startup does not re-ingest already-synced lines).
2. Runs `reconcileEventsJsonl` to append any mirror events that are missing on disk.
3. Re-snapshots the offset (so its own backfill writes are not re-ingested).
4. Optionally runs `writeGraphFromMirror` if `--regenerate-on-startup`.

**When `reconciliation-needed` fires.** The daemon observed a graph-file edit but the project has no mirror row, or a write-time constraint cannot be satisfied. A.2 logs the condition and increments the counter — Plan A.3 owns resolution.

## Developing

```bash
pnpm -F @atlas/spec-graph-sync test       # runs vitest (requires Postgres + migrations applied)
pnpm -F @atlas/spec-graph-sync build      # emits dist/
pnpm -F @atlas/spec-graph-sync typecheck
```
````

- [ ] **Step 2: Commit**

```bash
git add packages/spec-graph-sync/README.md
git commit -m "docs(spec-graph-sync): add CLI + ops README"
```

---

## Completion Checklist

After finishing all 14 tasks, verify:

- [ ] `pnpm -F @atlas/spec-graph-sync test` — all tests green (approximately 30+ tests across 7 suites)
- [ ] `pnpm -F @atlas/spec-graph-sync build` — exits 0, `dist/` populated, `dist/cli.js` present
- [ ] `pnpm -F @atlas/spec-graph-sync typecheck` — exits 0
- [ ] `pnpm -F @atlas/spec-graph-data test && pnpm -F @atlas/spec-graph-sync test` — both packages green in sequence (no cross-package regression)
- [ ] Manual smoke: bring up Postgres, create a project via `SpecGraphRepo.create`, run the CLI with `--regenerate-on-startup`, edit `.atlas/events.jsonl`, observe the mirror advancing and no duplicate ingestion
- [ ] `curl`/scrape `metricsRegistry.metrics()` from a host process using the daemon shows `atlas_sync_*` counters alongside `atlas_spec_graph_repo_*`
- [ ] `packages/spec-graph-sync/README.md` documents the CLI and the five metric names

## Handoff to Plan A.3

Plan A.3 (custom Git merge driver for `.atlas/*` under Postgres coordination) depends on:

- `SyncDaemon` — the merge driver invokes the daemon's `writeGraphFromMirror` / `reconcileEventsJsonl` primitives after resolving a three-way merge.
- `atlas_sync_reconciliation_needed_total` — the merge driver's conflict output stream is the eventual consumer of this counter; A.3 wires that loop closed.
- The write-token registry — A.3's merge driver must register its own output writes against the same registry so a running daemon doesn't round-trip the merge output.

Nothing in A.3 should add new daemon primitives; any new needs are extensions of `SyncDaemon` or its helpers, not parallel processes.
