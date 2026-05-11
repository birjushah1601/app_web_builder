# Spec Graph Custom Git Merge Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a custom Git merge driver for `.atlas/*` files that replaces Git's default 3-way text merge with domain-aware logic. This is Plan A.3 of Unit A in Phase A — the fix for Council MUST-2 (Git text-merge corrupts the event log and graph snapshot on concurrent multi-branch edits).

**Architecture:** One new pnpm-workspace package (`packages/spec-graph-merge-driver`). The package builds to a small Node CLI (`atlas-merge-driver`) with three subcommands: `merge` (invoked by Git with the positional args `%O %A %B %P`), `install` (registers the driver in a repo's `.gitattributes` + `git config`), and `uninstall`. Two filename patterns are handled by dedicated mergers — `.atlas/events.jsonl` via line-union with de-duplication, and `.atlas/spec.graph.json` via Postgres-mirror-first semantics with a structural JSON fallback when the mirror is unreachable. The package is a workspace consumer of `@atlas/spec-graph-data` (Plan A.1) and reuses its `SpecGraphRepo` for mirror reads.

**How Git invokes the driver.** When `.gitattributes` sets `merge=atlas-spec-graph` on a path and the user's `git config` has `merge.atlas-spec-graph.driver` set to a command template, Git calls that command during a merge with four positional arguments:
- `%O` — path to a tmp file containing the merge-base (ancestor) version of the file.
- `%A` — path to the "ours" version. **The driver MUST overwrite this file with the merged result.**
- `%B` — path to the "theirs" version.
- `%P` — the pathname being merged (e.g. `.atlas/events.jsonl`).

The driver communicates outcomes via exit code: `0` = merge succeeded cleanly, non-zero = conflict (Git will then leave conflict markers). The driver also respects the Git convention that stdout is reserved for driver output (we never write to stdout) — all logs go to stderr.

**Tech Stack:** TypeScript 5.5+ · Node 22 LTS · pnpm workspaces · `commander` 12.x (CLI argv) · `execa` 9.x (spawning git + the installed driver in tests) · `simple-git` 3.x (richer repo harness for integration tests) · Vitest 2.x · `@opentelemetry/api` · `prom-client` · `@atlas/spec-graph-data` (workspace:*).

**Prerequisites the implementing engineer needs installed before starting:**
- Node 22 LTS (`node --version` ≥ v22.0.0)
- pnpm 9+ (`pnpm --version` ≥ 9.0.0)
- Git 2.40+ on PATH (`git --version`) — required for the custom merge driver config keys to behave as documented
- Docker Desktop with Postgres 16 up via `pnpm db:up` (from Plan A.1) — integration tests that exercise the mirror-reachable path talk to real Postgres
- Plan A.1 merged — `@atlas/spec-graph-data` must be available in the workspace

---

## File Structure

Files this plan creates. Paths are relative to the repo root `f:/claude/ai_builder/`.

```
packages/
  spec-graph-merge-driver/
    package.json                                      # package manifest
    tsconfig.json                                     # extends base
    vitest.config.ts                                  # test runner config
    README.md                                         # install + troubleshooting
    bin/
      atlas-merge-driver.js                           # thin shim → dist/cli.js
    src/
      index.ts                                        # public exports
      cli.ts                                          # commander setup: merge/install/uninstall
      logger.ts                                       # structured stderr JSON logger
      observability.ts                                # extends A.1's registry
      merge/
        dispatcher.ts                                 # pattern match → merger
        events-jsonl.ts                               # line-union de-dup merger
        spec-graph-json.ts                            # mirror-first, structural-fallback merger
      install/
        install.ts                                    # .gitattributes + git config writer
        uninstall.ts                                  # reverses install
    test/
      setup.ts                                        # Postgres bootstrap + tmp-repo fixture
      helpers.ts                                      # git-harness utilities
      logger.test.ts
      observability.test.ts
      events-jsonl.test.ts
      spec-graph-json-fallback.test.ts
      spec-graph-json-mirror.test.ts
      dispatcher.test.ts
      cli-merge.test.ts
      install.test.ts
      uninstall.test.ts
      integration-events.test.ts                      # real git merge with driver installed
      integration-graph-mirror.test.ts
      integration-graph-fallback.test.ts
      integration-unknown-pattern.test.ts
```

**Why this shape.** Three concerns stay visually separate: `merge/` holds pure merge algorithms (unit-testable without touching Git), `install/` holds repo-side configuration (tested in tmp repos via execa), and `cli.ts` / `bin/atlas-merge-driver.js` wire them together. The shim is a separate file because Git calls it by absolute path — keeping it as one line makes a stable entry point that survives bundler changes.

**What Plan A.3 does NOT build.** The sync daemon (Plan A.2). The compaction + snapshot scheduler (Plan A.4). A GUI for resolving the rare residual conflicts — a clean exit code + stderr log is the v1 contract; richer UX is Phase B. The driver does not modify Postgres; it only reads the authoritative graph via `SpecGraphRepo.findByProjectId`.

---

## Design Notes

### `.atlas/events.jsonl` — line-union with de-dup

The event log is append-only JSONL. Each line is a JSON object with at least `id` (monotonic string/number assigned by the sync daemon) and `createdAt` (ISO-8601 timestamp). Default Git text-merge can duplicate events, drop events, or emit conflict markers that break the JSONL invariant.

The merger:
1. Parses all three files (`base`, `ours`, `theirs`) line by line, skipping blank lines.
2. Builds a `Map<id, event>` keyed by `id` — each id seen only once.
3. Ignores lines missing `id` but logs them at WARN (they are preserved verbatim at the end of the merged file, in insertion order, to avoid silent data loss).
4. Sorts the kept events by `(id, createdAt)` — id lexicographic ascending, then `createdAt` ascending as tiebreak.
5. Emits one JSON object per line, terminated by `\n`.

This is commutative and associative — the same set of events always produces the same merged file regardless of which branch is "ours".

### `.atlas/spec.graph.json` — mirror-first, structural fallback

The graph file is a JSON document with `{ schemaVersion, nodes: [...], edges: [...], metadata: {...} }`. It is a *derived* artifact — the authoritative state lives in Postgres. On merge we prefer to discard both branch versions and regenerate from the mirror.

The merger:
1. Reads `ATLAS_DATABASE_URL` from the environment.
2. If set, opens a connection with a **2 second hard timeout** (connection + query combined) and calls `SpecGraphRepo.findByProjectId(projectId)`. The `projectId` is read from the merge-base file's top-level `metadata.projectId` field; if missing, falls back to the "ours" file's value, then "theirs". If all three are missing, the mirror path is skipped.
3. If the mirror returns a row, the merger serializes that row's `graphData` with stable key ordering and writes it to `%A`. Done.
4. If `ATLAS_DATABASE_URL` is unset, the connection times out, the query errors, or no `projectId` is discoverable, the merger falls back to **structural 3-way JSON merge**:
   - `nodes` and `edges` arrays are unioned by stable `id` field. Duplicates collapse.
   - Scalar fields (`schemaVersion`, `metadata.*`): if "ours" and "theirs" agree, use that value. If they disagree, **"theirs" wins**, and the merged file is prefixed with a single-line JSON comment-like marker: `{"__atlas_merge_note__": "fallback merger: scalar conflicts resolved as theirs-wins; review required"}` as the first key of the root object. Consumers that don't know about this key will ignore it; the sync daemon (A.2) surfaces it in the UI.

Both paths exit 0. The only non-zero exit is a genuine I/O error (e.g. `%A` is not writable).

### Installation semantics

`atlas-merge-driver install` performs four idempotent steps, in order, against the repo containing `.git/` at the current working directory:

1. Ensures `.gitattributes` (at the repo root) contains the two lines:
   ```
   .atlas/events.jsonl     merge=atlas-spec-graph
   .atlas/spec.graph.json  merge=atlas-spec-graph
   ```
   Existing lines with the same left-hand pattern are left alone if they already include `merge=atlas-spec-graph`; otherwise the tool appends.
2. `git config merge.atlas-spec-graph.name "Atlas Spec Graph merge driver"`
3. `git config merge.atlas-spec-graph.driver "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"`
4. `git config merge.atlas-spec-graph.recursive "binary"` — instructs Git to treat merge-of-a-merge-result as a binary (no further text-merge attempts).

Rerunning the install is safe: the `.gitattributes` appender is idempotent, and `git config` keys are unconditionally set to their target values.

`atlas-merge-driver uninstall` reverses the above: strips the two lines from `.gitattributes` (leaving the file if other content remains; removing it if empty), and runs `git config --unset-all` for each of the three keys.

---

## Task List (15 tasks)

Each task is TDD-shaped: write the failing test, run it red, write minimal code, run it green, commit. Every task commits. Commits use Conventional Commits prefixes.

---

### Task 1: Package scaffold

**Files:**
- Create: `packages/spec-graph-merge-driver/package.json`
- Create: `packages/spec-graph-merge-driver/tsconfig.json`
- Create: `packages/spec-graph-merge-driver/vitest.config.ts`
- Create: `packages/spec-graph-merge-driver/src/index.ts`
- Create: `packages/spec-graph-merge-driver/bin/atlas-merge-driver.js`

- [ ] **Step 1: Write `packages/spec-graph-merge-driver/package.json`**

```json
{
  "name": "@atlas/spec-graph-merge-driver",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "atlas-merge-driver": "./bin/atlas-merge-driver.js"
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
    "commander": "12.1.0",
    "execa": "9.5.2",
    "prom-client": "15.1.3"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "simple-git": "3.27.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Write `packages/spec-graph-merge-driver/tsconfig.json`**

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

- [ ] **Step 3: Write `packages/spec-graph-merge-driver/vitest.config.ts`**

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

**Why single-fork.** Integration tests create and mutate real Git repos in tmp dirs and hit a shared Postgres DB. A single worker prevents cross-test interference and lets us clean tmp roots per test without races.

- [ ] **Step 4: Write the CLI shim**

`packages/spec-graph-merge-driver/bin/atlas-merge-driver.js`:
```js
#!/usr/bin/env node
import { main } from "../dist/cli.js";

main(process.argv).catch((err) => {
  process.stderr.write(
    JSON.stringify({ level: "fatal", msg: "atlas-merge-driver crashed", err: String(err?.stack ?? err) }) + "\n"
  );
  process.exit(3);
});
```

- [ ] **Step 5: Write a minimal `src/index.ts`**

```ts
export const PACKAGE_NAME = "@atlas/spec-graph-merge-driver";
```

- [ ] **Step 6: Install deps and verify build**

Run:
```bash
pnpm install
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver typecheck
```

Expected: both exit 0; `packages/spec-graph-merge-driver/dist/index.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/spec-graph-merge-driver pnpm-lock.yaml
git commit -m "feat(spec-graph-merge-driver): scaffold package with commander + execa deps"
```

---

### Task 2: Structured stderr logger

**Files:**
- Create: `packages/spec-graph-merge-driver/src/logger.ts`
- Create: `packages/spec-graph-merge-driver/test/logger.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/logger.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  let writes: string[] = [];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("writes structured JSON with level, msg, ts, and extras", () => {
    const log = createLogger({ level: "info" });
    log.info("hello", { path: ".atlas/events.jsonl" });
    expect(writes).toHaveLength(1);
    const entry = JSON.parse(writes[0]!.trim());
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.path).toBe(".atlas/events.jsonl");
    expect(typeof entry.ts).toBe("string");
    expect(() => new Date(entry.ts).toISOString()).not.toThrow();
  });

  it("filters below the configured level", () => {
    const log = createLogger({ level: "warn" });
    log.debug("chatter");
    log.info("still chatter");
    log.warn("real");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).msg).toBe("real");
  });

  it("never writes to stdout (Git protocol)", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = createLogger({ level: "debug" });
    log.error("something broke", { err: "boom" });
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it("reads level from ATLAS_LOG_LEVEL when no option is passed", () => {
    process.env.ATLAS_LOG_LEVEL = "error";
    const log = createLogger();
    log.warn("should be suppressed");
    log.error("should appear");
    delete process.env.ATLAS_LOG_LEVEL;
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).level).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/logger.test.ts
```

Expected: FAIL (cannot find `../src/logger.js`).

- [ ] **Step 3: Implement the logger**

`packages/spec-graph-merge-driver/src/logger.ts`:
```ts
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

export interface Logger {
  debug: (msg: string, extras?: Record<string, unknown>) => void;
  info: (msg: string, extras?: Record<string, unknown>) => void;
  warn: (msg: string, extras?: Record<string, unknown>) => void;
  error: (msg: string, extras?: Record<string, unknown>) => void;
  fatal: (msg: string, extras?: Record<string, unknown>) => void;
}

function resolveLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const envLevel = (process.env.ATLAS_LOG_LEVEL ?? "").toLowerCase();
  if (envLevel in ORDER) return envLevel as LogLevel;
  return "info";
}

export function createLogger(opts: { level?: LogLevel } = {}): Logger {
  const threshold = ORDER[resolveLevel(opts.level)];

  const emit = (level: LogLevel, msg: string, extras?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const entry = { ts: new Date().toISOString(), level, msg, ...extras };
    process.stderr.write(JSON.stringify(entry) + "\n");
  };

  return {
    debug: (m, e) => emit("debug", m, e),
    info: (m, e) => emit("info", m, e),
    warn: (m, e) => emit("warn", m, e),
    error: (m, e) => emit("error", m, e),
    fatal: (m, e) => emit("fatal", m, e)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/logger.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-merge-driver/src/logger.ts packages/spec-graph-merge-driver/test/logger.test.ts
git commit -m "feat(spec-graph-merge-driver): add structured stderr JSON logger with level filter"
```

---

### Task 3: Observability module (extends A.1's registry)

**Files:**
- Create: `packages/spec-graph-merge-driver/src/observability.ts`
- Create: `packages/spec-graph-merge-driver/test/setup.ts`
- Create: `packages/spec-graph-merge-driver/test/observability.test.ts`

- [ ] **Step 1: Write the test setup stub (will grow in later tasks)**

`packages/spec-graph-merge-driver/test/setup.ts`:
```ts
// Global setup hooks for vitest. Later tasks extend this with a Postgres bootstrap
// and a tmp-repo factory. For Task 3 we only need an exported `setup` that is a no-op.

export async function setup(): Promise<void> {
  // no-op for now
}
```

- [ ] **Step 2: Write the failing test**

`packages/spec-graph-merge-driver/test/observability.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeInvocations,
  mergeDuration,
  mirrorUnreachable,
  registry,
  withMergeSpan
} from "../src/observability.js";

describe("observability: merge-driver metrics", () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  it("exposes the three metric series with the agreed names", async () => {
    const text = await registry.metrics();
    expect(text).toContain("atlas_merge_driver_invocations_total");
    expect(text).toContain("atlas_merge_driver_duration_seconds");
    expect(text).toContain("atlas_merge_driver_mirror_unreachable_total");
  });

  it("increments invocations_total with {pattern,path,result}", async () => {
    mergeInvocations.inc({ pattern: "events.jsonl", path: ".atlas/events.jsonl", result: "ok" });
    const text = await registry.metrics();
    expect(text).toMatch(
      /atlas_merge_driver_invocations_total\{pattern="events\.jsonl",path="\.atlas\/events\.jsonl",result="ok"\} 1/
    );
  });

  it("observes a duration on the histogram", async () => {
    mergeDuration.observe({ pattern: "events.jsonl" }, 0.017);
    const text = await registry.metrics();
    expect(text).toMatch(/atlas_merge_driver_duration_seconds_count\{pattern="events\.jsonl"\} 1/);
  });

  it("increments mirror_unreachable_total as a zero-label counter", async () => {
    mirrorUnreachable.inc();
    const text = await registry.metrics();
    expect(text).toMatch(/atlas_merge_driver_mirror_unreachable_total 1/);
  });

  it("withMergeSpan emits ok result on success", async () => {
    await withMergeSpan(
      { pattern: "events.jsonl", path: ".atlas/events.jsonl" },
      async () => "done"
    );
    const text = await registry.metrics();
    expect(text).toMatch(/result="ok"/);
  });

  it("withMergeSpan emits conflict result when fn throws an Error tagged 'conflict'", async () => {
    const err = Object.assign(new Error("3-way failed"), { atlasResult: "conflict" as const });
    await expect(
      withMergeSpan({ pattern: "spec.graph.json", path: ".atlas/spec.graph.json" }, async () => {
        throw err;
      })
    ).rejects.toThrow("3-way failed");
    const text = await registry.metrics();
    expect(text).toMatch(/result="conflict"/);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/observability.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the observability module**

`packages/spec-graph-merge-driver/src/observability.ts`:
```ts
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { metricsRegistry } from "@atlas/spec-graph-data";
import { Counter, Histogram } from "prom-client";

const TRACER_NAME = "@atlas/spec-graph-merge-driver";
export const tracer = trace.getTracer(TRACER_NAME);

// Reuse the A.1 registry so scrapers collect both packages' metrics from one endpoint.
export const registry = metricsRegistry;

export const mergeInvocations = new Counter({
  name: "atlas_merge_driver_invocations_total",
  help: "Total atlas merge-driver invocations",
  labelNames: ["pattern", "path", "result"],
  registers: [registry]
});

export const mergeDuration = new Histogram({
  name: "atlas_merge_driver_duration_seconds",
  help: "Duration of atlas merge-driver invocations in seconds",
  labelNames: ["pattern"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry]
});

export const mirrorUnreachable = new Counter({
  name: "atlas_merge_driver_mirror_unreachable_total",
  help: "Times the Postgres mirror was unreachable during a spec.graph.json merge",
  registers: [registry]
});

export type MergeResult = "ok" | "conflict" | "fallback";

export interface WithMergeSpanAttrs {
  pattern: string;
  path: string;
}

export async function withMergeSpan<T>(
  attrs: WithMergeSpanAttrs,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const start = process.hrtime.bigint();
  return tracer.startActiveSpan("atlas.merge-driver.invoke", async (span) => {
    span.setAttribute("atlas.merge.pattern", attrs.pattern);
    span.setAttribute("atlas.merge.path", attrs.path);
    let result: MergeResult = "ok";
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.UNSET });
      return out;
    } catch (error) {
      const tagged = (error as { atlasResult?: MergeResult })?.atlasResult;
      result = tagged ?? "conflict";
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      const durationNs = process.hrtime.bigint() - start;
      mergeDuration.observe({ pattern: attrs.pattern }, Number(durationNs) / 1e9);
      mergeInvocations.inc({ pattern: attrs.pattern, path: attrs.path, result });
      span.end();
    }
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/observability.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-merge-driver/src/observability.ts \
        packages/spec-graph-merge-driver/test/setup.ts \
        packages/spec-graph-merge-driver/test/observability.test.ts
git commit -m "feat(spec-graph-merge-driver): add Prometheus/OTel observability extending spec-graph-data"
```

---

### Task 4: `events-jsonl` merger — pure function

**Files:**
- Create: `packages/spec-graph-merge-driver/src/merge/events-jsonl.ts`
- Create: `packages/spec-graph-merge-driver/test/events-jsonl.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/events-jsonl.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mergeEventsJsonl } from "../src/merge/events-jsonl.js";

const line = (obj: unknown) => JSON.stringify(obj);
const j = (...objs: unknown[]) => objs.map(line).join("\n") + "\n";

describe("mergeEventsJsonl", () => {
  it("returns the base content when ours and theirs both equal base", () => {
    const base = j({ id: "1", createdAt: "2026-01-01T00:00:00Z", type: "a" });
    const merged = mergeEventsJsonl(base, base, base);
    expect(merged).toBe(base);
  });

  it("unions new events from both sides with no base overlap", () => {
    const base = j({ id: "1", createdAt: "2026-01-01T00:00:00Z", type: "a" });
    const ours = base + j({ id: "2", createdAt: "2026-01-02T00:00:00Z", type: "b" });
    const theirs = base + j({ id: "3", createdAt: "2026-01-03T00:00:00Z", type: "c" });
    const merged = mergeEventsJsonl(base, ours, theirs);
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("deduplicates events with the same id", () => {
    const event = { id: "42", createdAt: "2026-03-01T00:00:00Z", type: "x" };
    const base = "";
    const ours = j(event);
    const theirs = j(event);
    const merged = mergeEventsJsonl(base, ours, theirs);
    expect(merged.trim().split("\n")).toHaveLength(1);
  });

  it("sorts by (id asc, createdAt asc) regardless of input order", () => {
    const base = "";
    const ours = j(
      { id: "b", createdAt: "2026-01-02T00:00:00Z" },
      { id: "a", createdAt: "2026-01-03T00:00:00Z" }
    );
    const theirs = j({ id: "c", createdAt: "2026-01-01T00:00:00Z" });
    const merged = mergeEventsJsonl(base, ours, theirs);
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("handles empty base", () => {
    const ours = j({ id: "1", createdAt: "2026-01-01T00:00:00Z" });
    const theirs = j({ id: "2", createdAt: "2026-01-02T00:00:00Z" });
    const merged = mergeEventsJsonl("", ours, theirs);
    expect(merged.trim().split("\n")).toHaveLength(2);
  });

  it("preserves lines missing an id at the end, in insertion order", () => {
    const base = "";
    const ours = j({ id: "1", createdAt: "2026-01-01T00:00:00Z" }) + `{"malformed":true}\n`;
    const theirs = j({ id: "2", createdAt: "2026-01-02T00:00:00Z" });
    const merged = mergeEventsJsonl(base, ours, theirs);
    const lines = merged.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!)).toEqual({ malformed: true });
  });

  it("is commutative: swap(ours, theirs) ⇒ same output", () => {
    const base = j({ id: "1", createdAt: "2026-01-01T00:00:00Z" });
    const ours = base + j({ id: "2", createdAt: "2026-01-02T00:00:00Z" });
    const theirs = base + j({ id: "3", createdAt: "2026-01-03T00:00:00Z" });
    expect(mergeEventsJsonl(base, ours, theirs)).toBe(mergeEventsJsonl(base, theirs, ours));
  });

  it("collapses blank lines and trailing whitespace", () => {
    const input = `{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n\n\n`;
    const merged = mergeEventsJsonl("", input, "");
    expect(merged).toBe(`{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n`);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/events-jsonl.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the merger**

`packages/spec-graph-merge-driver/src/merge/events-jsonl.ts`:
```ts
interface ParsedEvent {
  id: string;
  createdAt: string;
  raw: string;
  original: unknown;
}

function parseLines(content: string): { keyed: ParsedEvent[]; orphans: string[] } {
  const keyed: ParsedEvent[] = [];
  const orphans: string[] = [];
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      orphans.push(trimmed);
      continue;
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "id" in (parsed as Record<string, unknown>) &&
      typeof (parsed as { id: unknown }).id !== "undefined"
    ) {
      const rec = parsed as { id: string | number; createdAt?: string };
      keyed.push({
        id: String(rec.id),
        createdAt: typeof rec.createdAt === "string" ? rec.createdAt : "",
        raw: trimmed,
        original: parsed
      });
    } else {
      orphans.push(trimmed);
    }
  }
  return { keyed, orphans };
}

export function mergeEventsJsonl(base: string, ours: string, theirs: string): string {
  const byId = new Map<string, ParsedEvent>();
  const orphanOrder: string[] = [];
  const seenOrphans = new Set<string>();

  for (const source of [base, ours, theirs]) {
    const { keyed, orphans } = parseLines(source);
    for (const ev of keyed) {
      if (!byId.has(ev.id)) byId.set(ev.id, ev);
    }
    for (const line of orphans) {
      if (!seenOrphans.has(line)) {
        seenOrphans.add(line);
        orphanOrder.push(line);
      }
    }
  }

  const sorted = [...byId.values()].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });

  const lines = [...sorted.map((e) => e.raw), ...orphanOrder];
  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/events-jsonl.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-merge-driver/src/merge/events-jsonl.ts \
        packages/spec-graph-merge-driver/test/events-jsonl.test.ts
git commit -m "feat(spec-graph-merge-driver): add line-union events.jsonl merger with dedup"
```

---

### Task 5: `spec-graph-json` structural-fallback merger (no mirror)

**Files:**
- Create: `packages/spec-graph-merge-driver/src/merge/spec-graph-json.ts`
- Create: `packages/spec-graph-merge-driver/test/spec-graph-json-fallback.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/spec-graph-json-fallback.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { mergeSpecGraphJsonFallback } from "../src/merge/spec-graph-json.js";

const graph = (nodes: unknown[] = [], edges: unknown[] = [], extras: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, nodes, edges, metadata: {}, ...extras });

describe("mergeSpecGraphJsonFallback", () => {
  it("returns base content when ours and theirs equal base", () => {
    const b = graph([{ id: "n1" }]);
    const merged = mergeSpecGraphJsonFallback(b, b, b);
    const parsed = JSON.parse(merged);
    expect(parsed.nodes).toEqual([{ id: "n1" }]);
    expect(parsed.__atlas_merge_note__).toBeUndefined();
  });

  it("unions nodes by id with no overlap", () => {
    const base = graph([]);
    const ours = graph([{ id: "n1", label: "A" }]);
    const theirs = graph([{ id: "n2", label: "B" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.nodes).toHaveLength(2);
    expect(merged.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("deduplicates nodes by id when both sides add the same id (theirs wins on fields)", () => {
    const base = graph([]);
    const ours = graph([{ id: "n1", label: "ours" }]);
    const theirs = graph([{ id: "n1", label: "theirs" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0].label).toBe("theirs");
  });

  it("unions edges by id", () => {
    const base = graph([], [{ id: "e1", from: "n1", to: "n2" }]);
    const ours = graph([], [{ id: "e1", from: "n1", to: "n2" }, { id: "e2", from: "n2", to: "n3" }]);
    const theirs = graph([], [{ id: "e1", from: "n1", to: "n2" }, { id: "e3", from: "n3", to: "n4" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.edges.map((e: { id: string }) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("uses theirs-wins for scalar conflicts and prepends the conflict marker", () => {
    const base = graph([], [], { schemaVersion: 1 });
    const ours = graph([], [], { schemaVersion: 2 });
    const theirs = graph([], [], { schemaVersion: 3 });
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.schemaVersion).toBe(3);
    expect(merged.__atlas_merge_note__).toMatch(/theirs-wins/);
  });

  it("does not add the marker when no scalar conflict occurred", () => {
    const base = graph([{ id: "n1" }]);
    const ours = graph([{ id: "n1" }, { id: "n2" }]);
    const theirs = graph([{ id: "n1" }, { id: "n3" }]);
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.__atlas_merge_note__).toBeUndefined();
  });

  it("merges nested metadata as theirs-wins object merge", () => {
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId: "p" } });
    const ours = JSON.stringify({
      schemaVersion: 1,
      nodes: [],
      edges: [],
      metadata: { projectId: "p", name: "ours" }
    });
    const theirs = JSON.stringify({
      schemaVersion: 1,
      nodes: [],
      edges: [],
      metadata: { projectId: "p", name: "theirs", extra: true }
    });
    const merged = JSON.parse(mergeSpecGraphJsonFallback(base, ours, theirs));
    expect(merged.metadata.name).toBe("theirs");
    expect(merged.metadata.extra).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/spec-graph-json-fallback.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the fallback merger**

`packages/spec-graph-merge-driver/src/merge/spec-graph-json.ts`:
```ts
interface GraphDoc {
  schemaVersion?: number;
  nodes?: Array<{ id: string } & Record<string, unknown>>;
  edges?: Array<{ id: string } & Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

function parse(content: string): GraphDoc {
  if (content.trim() === "") return { schemaVersion: 1, nodes: [], edges: [], metadata: {} };
  return JSON.parse(content) as GraphDoc;
}

function unionById(
  ours: Array<{ id: string } & Record<string, unknown>> = [],
  theirs: Array<{ id: string } & Record<string, unknown>> = []
): Array<{ id: string } & Record<string, unknown>> {
  const map = new Map<string, { id: string } & Record<string, unknown>>();
  for (const item of ours) map.set(item.id, { ...item });
  for (const item of theirs) map.set(item.id, { ...(map.get(item.id) ?? {}), ...item });
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function mergeScalars(
  base: unknown,
  ours: unknown,
  theirs: unknown
): { value: unknown; conflict: boolean } {
  if (JSON.stringify(ours) === JSON.stringify(theirs)) {
    return { value: ours, conflict: false };
  }
  if (JSON.stringify(base) === JSON.stringify(ours)) {
    return { value: theirs, conflict: false };
  }
  if (JSON.stringify(base) === JSON.stringify(theirs)) {
    return { value: ours, conflict: false };
  }
  return { value: theirs, conflict: true };
}

function mergeMetadata(
  base: Record<string, unknown> = {},
  ours: Record<string, unknown> = {},
  theirs: Record<string, unknown> = {}
): { value: Record<string, unknown>; conflict: boolean } {
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  const out: Record<string, unknown> = {};
  let conflict = false;
  for (const key of keys) {
    const { value, conflict: c } = mergeScalars(base[key], ours[key], theirs[key]);
    if (typeof value !== "undefined") out[key] = value;
    conflict ||= c;
  }
  return { value: out, conflict };
}

export function mergeSpecGraphJsonFallback(base: string, ours: string, theirs: string): string {
  const b = parse(base);
  const o = parse(ours);
  const t = parse(theirs);

  const nodes = unionById(o.nodes, t.nodes);
  const edges = unionById(o.edges, t.edges);

  const scalarResult = mergeScalars(b.schemaVersion, o.schemaVersion, t.schemaVersion);
  const metadata = mergeMetadata(b.metadata, o.metadata, t.metadata);

  const hasConflict = scalarResult.conflict || metadata.conflict;

  const merged: Record<string, unknown> = hasConflict
    ? {
        __atlas_merge_note__:
          "fallback merger: scalar conflicts resolved as theirs-wins; review required",
        schemaVersion: scalarResult.value,
        nodes,
        edges,
        metadata: metadata.value
      }
    : {
        schemaVersion: scalarResult.value,
        nodes,
        edges,
        metadata: metadata.value
      };

  return JSON.stringify(merged, null, 2) + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/spec-graph-json-fallback.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-merge-driver/src/merge/spec-graph-json.ts \
        packages/spec-graph-merge-driver/test/spec-graph-json-fallback.test.ts
git commit -m "feat(spec-graph-merge-driver): add structural fallback merger for spec.graph.json"
```

---

### Task 6: `spec-graph-json` mirror-first merger

**Files:**
- Modify: `packages/spec-graph-merge-driver/src/merge/spec-graph-json.ts`
- Modify: `packages/spec-graph-merge-driver/test/setup.ts`
- Create: `packages/spec-graph-merge-driver/test/spec-graph-json-mirror.test.ts`

- [ ] **Step 1: Extend the test setup to bootstrap Postgres like Plan A.1**

Modify `packages/spec-graph-merge-driver/test/setup.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "pg";

const TEST_URL = "postgresql://atlas:atlas@localhost:5432/atlas_test";
process.env.DATABASE_URL_TEST = TEST_URL;
// The driver reads ATLAS_DATABASE_URL at runtime; tests opt into it explicitly.

export async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_URL });
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO atlas");

    const migrationDir = resolve(__dirname, "..", "..", "spec-graph-data", "drizzle");
    const files = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
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

**Why reuse A.1's migration files.** The driver is a read-only consumer of the spec-graph schema. Rebuilding the schema in this package would drift. We walk A.1's committed `drizzle/` in lexical order, identical to its own setup.

- [ ] **Step 2: Write the failing test**

`packages/spec-graph-merge-driver/test/spec-graph-json-mirror.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { mergeSpecGraphJsonMirrorFirst } from "../src/merge/spec-graph-json.js";

describe("mergeSpecGraphJsonMirrorFirst", () => {
  let db: Database;
  let graphs: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphs = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query("TRUNCATE spec_graphs, spec_events, spec_snapshots RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the mirror state verbatim when ATLAS_DATABASE_URL points at a reachable DB", async () => {
    const projectId = randomUUID();
    const mirrorState = { schemaVersion: 1, nodes: [{ id: "from-mirror" }], edges: [], metadata: { projectId } };
    await graphs.create(projectId, mirrorState);

    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "ours" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "theirs" }], edges: [], metadata: { projectId } });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    const parsed = JSON.parse(merged);
    expect(parsed.nodes).toEqual([{ id: "from-mirror" }]);
  });

  it("falls back to structural merger when databaseUrl is undefined", async () => {
    const projectId = randomUUID();
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "ours" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "theirs" }], edges: [], metadata: { projectId } });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, { databaseUrl: undefined });
    const parsed = JSON.parse(merged);
    const ids = parsed.nodes.map((n: { id: string }) => n.id).sort();
    expect(ids).toEqual(["ours", "theirs"]);
  });

  it("falls back when the mirror has no row for the projectId", async () => {
    const projectId = randomUUID(); // not inserted
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "o" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "t" }], edges: [], metadata: { projectId } });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["o", "t"]);
  });

  it("falls back when databaseUrl points at an unreachable host (timeout under 2s)", async () => {
    const projectId = randomUUID();
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "o" }], edges: [], metadata: { projectId } });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "t" }], edges: [], metadata: { projectId } });

    const start = Date.now();
    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: "postgresql://atlas:atlas@127.0.0.1:9/atlas_dev" // port 9 refuses
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4_000);
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["o", "t"]);
  });

  it("falls back when no projectId can be discovered in any of the three files", async () => {
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: {} });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "o" }], edges: [], metadata: {} });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "t" }], edges: [], metadata: {} });

    const merged = await mergeSpecGraphJsonMirrorFirst(base, ours, theirs, {
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["o", "t"]);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run:
```bash
pnpm db:up
pnpm -F @atlas/spec-graph-merge-driver test -- test/spec-graph-json-mirror.test.ts
```

Expected: FAIL (`mergeSpecGraphJsonMirrorFirst is not exported`).

- [ ] **Step 4: Extend `src/merge/spec-graph-json.ts`**

Append to `packages/spec-graph-merge-driver/src/merge/spec-graph-json.ts`:
```ts
import { SpecGraphRepo, createDatabase } from "@atlas/spec-graph-data";
import { mirrorUnreachable } from "../observability.js";
import { createLogger } from "../logger.js";

const MIRROR_TIMEOUT_MS = 2_000;

function extractProjectId(...contents: string[]): string | undefined {
  for (const content of contents) {
    if (content.trim() === "") continue;
    try {
      const parsed = JSON.parse(content) as GraphDoc;
      const pid = parsed?.metadata?.["projectId"];
      if (typeof pid === "string" && pid.length > 0) return pid;
    } catch {
      // ignore; next candidate
    }
  }
  return undefined;
}

async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface MirrorFirstOptions {
  databaseUrl: string | undefined;
}

export async function mergeSpecGraphJsonMirrorFirst(
  base: string,
  ours: string,
  theirs: string,
  opts: MirrorFirstOptions
): Promise<string> {
  const log = createLogger();
  const { databaseUrl } = opts;
  if (!databaseUrl) {
    log.info("mirror-first: ATLAS_DATABASE_URL unset; using fallback merger");
    mirrorUnreachable.inc();
    return mergeSpecGraphJsonFallback(base, ours, theirs);
  }

  const projectId = extractProjectId(base, ours, theirs);
  if (!projectId) {
    log.warn("mirror-first: no projectId in metadata of any file; using fallback merger");
    return mergeSpecGraphJsonFallback(base, ours, theirs);
  }

  let db: ReturnType<typeof createDatabase> | null = null;
  try {
    db = createDatabase(databaseUrl, { connectionTimeoutMillis: MIRROR_TIMEOUT_MS });
    const repo = new SpecGraphRepo(db.pool);
    const row = await withDeadline(repo.findByProjectId(projectId), MIRROR_TIMEOUT_MS, "mirror lookup");
    if (!row) {
      log.warn("mirror-first: no row in mirror for projectId; using fallback merger", { projectId });
      return mergeSpecGraphJsonFallback(base, ours, theirs);
    }
    return JSON.stringify(row.graphData, null, 2) + "\n";
  } catch (error) {
    log.warn("mirror-first: mirror unreachable; using fallback merger", {
      err: (error as Error).message
    });
    mirrorUnreachable.inc();
    return mergeSpecGraphJsonFallback(base, ours, theirs);
  } finally {
    await db?.pool.end().catch(() => {
      /* swallow */
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/spec-graph-json-mirror.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-merge-driver/src/merge/spec-graph-json.ts \
        packages/spec-graph-merge-driver/test/setup.ts \
        packages/spec-graph-merge-driver/test/spec-graph-json-mirror.test.ts
git commit -m "feat(spec-graph-merge-driver): add mirror-first spec.graph.json merger with 2s fallback"
```

---

### Task 7: Dispatcher — pattern match filename to merger

**Files:**
- Create: `packages/spec-graph-merge-driver/src/merge/dispatcher.ts`
- Create: `packages/spec-graph-merge-driver/test/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/dispatcher.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dispatchMerge, UnknownPatternError } from "../src/merge/dispatcher.js";

describe("dispatchMerge", () => {
  it("routes `.atlas/events.jsonl` to the events merger", async () => {
    const merged = await dispatchMerge({
      pathname: ".atlas/events.jsonl",
      base: "",
      ours: '{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n',
      theirs: '{"id":"2","createdAt":"2026-01-02T00:00:00Z"}\n',
      databaseUrl: undefined
    });
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("routes `.atlas/spec.graph.json` to the spec-graph merger", async () => {
    const base = JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: {} });
    const ours = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "n1" }], edges: [], metadata: {} });
    const theirs = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "n2" }], edges: [], metadata: {} });
    const merged = await dispatchMerge({
      pathname: ".atlas/spec.graph.json",
      base,
      ours,
      theirs,
      databaseUrl: undefined // force fallback
    });
    expect(JSON.parse(merged).nodes.map((n: { id: string }) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("tolerates forward vs backslash separators on Windows-style paths", async () => {
    const merged = await dispatchMerge({
      pathname: ".atlas\\events.jsonl",
      base: "",
      ours: '{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n',
      theirs: "",
      databaseUrl: undefined
    });
    expect(merged.trim().split("\n")).toHaveLength(1);
  });

  it("throws UnknownPatternError for unhandled paths", async () => {
    await expect(
      dispatchMerge({
        pathname: "src/index.ts",
        base: "",
        ours: "",
        theirs: "",
        databaseUrl: undefined
      })
    ).rejects.toBeInstanceOf(UnknownPatternError);
  });

  it("UnknownPatternError carries the offending pathname", async () => {
    try {
      await dispatchMerge({ pathname: "foo.bar", base: "", ours: "", theirs: "", databaseUrl: undefined });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as UnknownPatternError).pathname).toBe("foo.bar");
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/dispatcher.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the dispatcher**

`packages/spec-graph-merge-driver/src/merge/dispatcher.ts`:
```ts
import { mergeEventsJsonl } from "./events-jsonl.js";
import { mergeSpecGraphJsonMirrorFirst } from "./spec-graph-json.js";

export class UnknownPatternError extends Error {
  readonly pathname: string;
  constructor(pathname: string) {
    super(`atlas-merge-driver: no merger registered for path "${pathname}"`);
    this.name = "UnknownPatternError";
    this.pathname = pathname;
  }
}

function normalize(pathname: string): string {
  return pathname.replace(/\\/g, "/");
}

export interface DispatchInput {
  pathname: string;
  base: string;
  ours: string;
  theirs: string;
  databaseUrl: string | undefined;
}

export async function dispatchMerge(input: DispatchInput): Promise<string> {
  const norm = normalize(input.pathname);
  if (norm.endsWith(".atlas/events.jsonl")) {
    return mergeEventsJsonl(input.base, input.ours, input.theirs);
  }
  if (norm.endsWith(".atlas/spec.graph.json")) {
    return mergeSpecGraphJsonMirrorFirst(input.base, input.ours, input.theirs, {
      databaseUrl: input.databaseUrl
    });
  }
  throw new UnknownPatternError(input.pathname);
}

export function patternFor(pathname: string): "events.jsonl" | "spec.graph.json" | "unknown" {
  const norm = normalize(pathname);
  if (norm.endsWith(".atlas/events.jsonl")) return "events.jsonl";
  if (norm.endsWith(".atlas/spec.graph.json")) return "spec.graph.json";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/dispatcher.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-merge-driver/src/merge/dispatcher.ts \
        packages/spec-graph-merge-driver/test/dispatcher.test.ts
git commit -m "feat(spec-graph-merge-driver): add pattern dispatcher with UnknownPatternError"
```

---

### Task 8: CLI `merge` subcommand

**Files:**
- Create: `packages/spec-graph-merge-driver/src/cli.ts`
- Create: `packages/spec-graph-merge-driver/test/cli-merge.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/cli-merge.test.ts`:
```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("CLI: merge subcommand", () => {
  let dir: string;
  let origExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atlas-cli-merge-"));
    exitCode = undefined;
    origExit = process.exit;
    // Replace process.exit to record without aborting the test
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`__atlas_exit_${code ?? 0}__`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it("exits 0 and writes the merged result to %A for events.jsonl", async () => {
    const base = join(dir, "base");
    const ours = join(dir, "ours");
    const theirs = join(dir, "theirs");
    writeFileSync(base, "");
    writeFileSync(ours, '{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n');
    writeFileSync(theirs, '{"id":"2","createdAt":"2026-01-02T00:00:00Z"}\n');

    await expect(
      main(["node", "atlas-merge-driver", "merge", base, ours, theirs, ".atlas/events.jsonl"])
    ).rejects.toThrow("__atlas_exit_0__");
    expect(exitCode).toBe(0);

    const result = readFileSync(ours, "utf8");
    const ids = result.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("exits 2 for an unknown pathname", async () => {
    const base = join(dir, "base");
    const ours = join(dir, "ours");
    const theirs = join(dir, "theirs");
    writeFileSync(base, "");
    writeFileSync(ours, "foo");
    writeFileSync(theirs, "bar");

    await expect(
      main(["node", "atlas-merge-driver", "merge", base, ours, theirs, "src/index.ts"])
    ).rejects.toThrow("__atlas_exit_2__");
    expect(exitCode).toBe(2);
  });

  it("exits 1 on an I/O error (unwritable %A)", async () => {
    // Use a path that definitely cannot be written: a directory.
    await expect(
      main(["node", "atlas-merge-driver", "merge", dir, dir, dir, ".atlas/events.jsonl"])
    ).rejects.toThrow(/__atlas_exit_[12]__/);
    expect(exitCode === 1 || exitCode === 2).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/cli-merge.test.ts
```

Expected: FAIL (cannot find `../src/cli.js`).

- [ ] **Step 3: Implement the CLI**

`packages/spec-graph-merge-driver/src/cli.ts`:
```ts
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { UnknownPatternError, dispatchMerge, patternFor } from "./merge/dispatcher.js";
import { installDriver } from "./install/install.js";
import { uninstallDriver } from "./install/uninstall.js";
import { createLogger } from "./logger.js";
import { withMergeSpan } from "./observability.js";

export async function runMerge(
  basePath: string,
  oursPath: string,
  theirsPath: string,
  pathname: string
): Promise<number> {
  const log = createLogger();
  const pattern = patternFor(pathname);
  try {
    return await withMergeSpan({ pattern, path: pathname }, async () => {
      const [base, ours, theirs] = await Promise.all([
        readFile(basePath, "utf8").catch(() => ""),
        readFile(oursPath, "utf8"),
        readFile(theirsPath, "utf8")
      ]);
      const merged = await dispatchMerge({
        pathname,
        base,
        ours,
        theirs,
        databaseUrl: process.env.ATLAS_DATABASE_URL
      });
      await writeFile(oursPath, merged, "utf8");
      log.info("merge-driver: merged cleanly", { pathname, pattern });
      return 0;
    });
  } catch (err) {
    if (err instanceof UnknownPatternError) {
      log.error("merge-driver: unknown pattern, refusing to merge", { pathname });
      return 2;
    }
    log.error("merge-driver: I/O error during merge", {
      pathname,
      err: (err as Error).message
    });
    return 1;
  }
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("atlas-merge-driver").description("Atlas Spec Graph Git merge driver");

  program
    .command("merge <base> <ours> <theirs> <pathname>")
    .description("Invoked by Git: merges base/ours/theirs for the given pathname, writing result to ours.")
    .action(async (base: string, ours: string, theirs: string, pathname: string) => {
      const code = await runMerge(base, ours, theirs, pathname);
      process.exit(code);
    });

  program
    .command("install")
    .description("Register the driver in the current repo (.gitattributes + git config).")
    .action(async () => {
      await installDriver(process.cwd());
      process.exit(0);
    });

  program
    .command("uninstall")
    .description("Reverse a previous install in the current repo.")
    .action(async () => {
      await uninstallDriver(process.cwd());
      process.exit(0);
    });

  await program.parseAsync(argv);
}
```

Also update `src/index.ts` to re-export the entrypoints and the dispatcher:
```ts
export { main, runMerge } from "./cli.js";
export { dispatchMerge, patternFor, UnknownPatternError } from "./merge/dispatcher.js";
export { mergeEventsJsonl } from "./merge/events-jsonl.js";
export {
  mergeSpecGraphJsonFallback,
  mergeSpecGraphJsonMirrorFirst
} from "./merge/spec-graph-json.js";
export { installDriver } from "./install/install.js";
export { uninstallDriver } from "./install/uninstall.js";
export { createLogger } from "./logger.js";
export {
  mergeInvocations,
  mergeDuration,
  mirrorUnreachable,
  registry,
  withMergeSpan
} from "./observability.js";
```

- [ ] **Step 4: Stub the install/uninstall modules so the build passes**

`packages/spec-graph-merge-driver/src/install/install.ts`:
```ts
export async function installDriver(_repoRoot: string): Promise<void> {
  throw new Error("not yet implemented");
}
```

`packages/spec-graph-merge-driver/src/install/uninstall.ts`:
```ts
export async function uninstallDriver(_repoRoot: string): Promise<void> {
  throw new Error("not yet implemented");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/cli-merge.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-merge-driver/src/cli.ts \
        packages/spec-graph-merge-driver/src/index.ts \
        packages/spec-graph-merge-driver/src/install \
        packages/spec-graph-merge-driver/test/cli-merge.test.ts
git commit -m "feat(spec-graph-merge-driver): add CLI merge subcommand with %O %A %B %P wiring"
```

---

### Task 9: `install` command — writes `.gitattributes` + git config

**Files:**
- Modify: `packages/spec-graph-merge-driver/src/install/install.ts`
- Create: `packages/spec-graph-merge-driver/test/helpers.ts`
- Create: `packages/spec-graph-merge-driver/test/install.test.ts`

- [ ] **Step 1: Write test helpers for tmp repos**

`packages/spec-graph-merge-driver/test/helpers.ts`:
```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

export async function createTmpRepo(prefix = "atlas-repo-"): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  await execa("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@atlas.local"], { cwd: dir });
  await execa("git", ["config", "user.name", "Atlas Test"], { cwd: dir });
  return dir;
}

export async function gitConfigGet(repo: string, key: string): Promise<string | undefined> {
  const { stdout, exitCode } = await execa("git", ["config", "--get", key], {
    cwd: repo,
    reject: false
  });
  return exitCode === 0 ? stdout : undefined;
}

export function readFileOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
```

- [ ] **Step 2: Write the failing test**

`packages/spec-graph-merge-driver/test/install.test.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDriver } from "../src/install/install.js";
import { createTmpRepo, gitConfigGet, readFileOrEmpty } from "./helpers.js";

describe("installDriver", () => {
  it("creates .gitattributes with both patterns when none exists", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    const content = readFileSync(join(repo, ".gitattributes"), "utf8");
    expect(content).toMatch(/\.atlas\/events\.jsonl\s+merge=atlas-spec-graph/);
    expect(content).toMatch(/\.atlas\/spec\.graph\.json\s+merge=atlas-spec-graph/);
  });

  it("appends the two lines when .gitattributes already exists with unrelated content", async () => {
    const repo = await createTmpRepo();
    writeFileSync(join(repo, ".gitattributes"), "*.md text\n");
    await installDriver(repo);
    const content = readFileSync(join(repo, ".gitattributes"), "utf8");
    expect(content).toMatch(/^\*\.md text$/m);
    expect(content).toMatch(/\.atlas\/events\.jsonl\s+merge=atlas-spec-graph/);
  });

  it("is idempotent: running twice does not duplicate lines", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await installDriver(repo);
    const content = readFileOrEmpty(join(repo, ".gitattributes"));
    const eventsLines = content.split("\n").filter((l) => l.includes(".atlas/events.jsonl"));
    const graphLines = content.split("\n").filter((l) => l.includes(".atlas/spec.graph.json"));
    expect(eventsLines).toHaveLength(1);
    expect(graphLines).toHaveLength(1);
  });

  it("sets the three required git config keys", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.name")).toBe("Atlas Spec Graph merge driver");
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.driver")).toBe(
      "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"
    );
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.recursive")).toBe("binary");
  });

  it("overwrites pre-existing divergent git config values", async () => {
    const repo = await createTmpRepo();
    const { execa } = await import("execa");
    await execa("git", ["config", "merge.atlas-spec-graph.driver", "old-command"], { cwd: repo });
    await installDriver(repo);
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.driver")).toBe(
      "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"
    );
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/install.test.ts
```

Expected: FAIL (`installDriver` throws "not yet implemented").

- [ ] **Step 4: Implement `installDriver`**

Replace `packages/spec-graph-merge-driver/src/install/install.ts`:
```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { createLogger } from "../logger.js";

export const ATTR_MARKER = "merge=atlas-spec-graph";
export const ATTR_LINES: Array<[pattern: string, line: string]> = [
  [".atlas/events.jsonl", ".atlas/events.jsonl     merge=atlas-spec-graph"],
  [".atlas/spec.graph.json", ".atlas/spec.graph.json  merge=atlas-spec-graph"]
];

export const GIT_CONFIG: Array<[key: string, value: string]> = [
  ["merge.atlas-spec-graph.name", "Atlas Spec Graph merge driver"],
  ["merge.atlas-spec-graph.driver", "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"],
  ["merge.atlas-spec-graph.recursive", "binary"]
];

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function patternAlreadyMapped(content: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+.*merge=atlas-spec-graph`,
    "m"
  );
  return regex.test(content);
}

export async function installDriver(repoRoot: string): Promise<void> {
  const log = createLogger();
  const attrPath = join(repoRoot, ".gitattributes");
  let content = await readOrEmpty(attrPath);

  for (const [pattern, line] of ATTR_LINES) {
    if (!patternAlreadyMapped(content, pattern)) {
      if (content.length > 0 && !content.endsWith("\n")) content += "\n";
      content += line + "\n";
    }
  }
  await writeFile(attrPath, content, "utf8");

  for (const [key, value] of GIT_CONFIG) {
    await execa("git", ["config", key, value], { cwd: repoRoot });
  }
  log.info("installDriver: registered atlas-spec-graph merge driver", { repoRoot });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/install.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/spec-graph-merge-driver/src/install/install.ts \
        packages/spec-graph-merge-driver/test/helpers.ts \
        packages/spec-graph-merge-driver/test/install.test.ts
git commit -m "feat(spec-graph-merge-driver): add idempotent install command"
```

---

### Task 10: `uninstall` command

**Files:**
- Modify: `packages/spec-graph-merge-driver/src/install/uninstall.ts`
- Create: `packages/spec-graph-merge-driver/test/uninstall.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/uninstall.test.ts`:
```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDriver } from "../src/install/install.js";
import { uninstallDriver } from "../src/install/uninstall.js";
import { createTmpRepo, gitConfigGet } from "./helpers.js";

describe("uninstallDriver", () => {
  it("removes both atlas lines from .gitattributes, preserving other content", async () => {
    const repo = await createTmpRepo();
    writeFileSync(join(repo, ".gitattributes"), "*.md text\n");
    await installDriver(repo);
    await uninstallDriver(repo);
    const content = readFileSync(join(repo, ".gitattributes"), "utf8");
    expect(content).toMatch(/^\*\.md text$/m);
    expect(content).not.toMatch(/\.atlas\/events\.jsonl/);
    expect(content).not.toMatch(/\.atlas\/spec\.graph\.json/);
  });

  it("deletes .gitattributes entirely if it becomes empty", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await uninstallDriver(repo);
    expect(existsSync(join(repo, ".gitattributes"))).toBe(false);
  });

  it("unsets all three git config keys", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await uninstallDriver(repo);
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.name")).toBeUndefined();
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.driver")).toBeUndefined();
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.recursive")).toBeUndefined();
  });

  it("is idempotent: running twice does not error", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await uninstallDriver(repo);
    await expect(uninstallDriver(repo)).resolves.toBeUndefined();
  });

  it("leaves a repo that never had the driver installed unchanged", async () => {
    const repo = await createTmpRepo();
    await expect(uninstallDriver(repo)).resolves.toBeUndefined();
    expect(existsSync(join(repo, ".gitattributes"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/uninstall.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `uninstallDriver`**

Replace `packages/spec-graph-merge-driver/src/install/uninstall.ts`:
```ts
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { ATTR_LINES, GIT_CONFIG } from "./install.js";
import { createLogger } from "../logger.js";

export async function uninstallDriver(repoRoot: string): Promise<void> {
  const log = createLogger();
  const attrPath = join(repoRoot, ".gitattributes");

  let content = "";
  try {
    content = await readFile(attrPath, "utf8");
  } catch {
    content = "";
  }

  if (content.length > 0) {
    const removed = content
      .split("\n")
      .filter((line) => {
        for (const [pattern] of ATTR_LINES) {
          if (line.startsWith(pattern) && line.includes("merge=atlas-spec-graph")) return false;
        }
        return true;
      })
      .join("\n");
    const cleaned = removed.replace(/\n+$/g, "");
    if (cleaned.trim() === "") {
      await unlink(attrPath).catch(() => {
        /* swallow */
      });
    } else {
      await writeFile(attrPath, cleaned + "\n", "utf8");
    }
  }

  for (const [key] of GIT_CONFIG) {
    await execa("git", ["config", "--unset-all", key], { cwd: repoRoot, reject: false });
  }
  log.info("uninstallDriver: removed atlas-spec-graph merge driver", { repoRoot });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/uninstall.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-merge-driver/src/install/uninstall.ts \
        packages/spec-graph-merge-driver/test/uninstall.test.ts
git commit -m "feat(spec-graph-merge-driver): add idempotent uninstall command"
```

---

### Task 11: Integration test — real git merge of `events.jsonl`

**Files:**
- Create: `packages/spec-graph-merge-driver/test/integration-events.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/integration-events.test.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { createTmpRepo } from "./helpers.js";

// Path to the driver shim in this workspace. The integration tests invoke it
// directly rather than going through `npx` to keep tests hermetic.
const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

async function registerLocalDriver(repo: string): Promise<void> {
  // .gitattributes
  mkdirSync(join(repo, ".atlas"), { recursive: true });
  writeFileSync(
    join(repo, ".gitattributes"),
    ".atlas/events.jsonl     merge=atlas-spec-graph\n" +
      ".atlas/spec.graph.json  merge=atlas-spec-graph\n"
  );
  // git config pointing at the workspace shim (no npx)
  await execa("git", ["config", "merge.atlas-spec-graph.name", "Atlas Spec Graph merge driver"], { cwd: repo });
  await execa(
    "git",
    ["config", "merge.atlas-spec-graph.driver", `node "${DRIVER_BIN}" merge %O %A %B %P`],
    { cwd: repo }
  );
  await execa("git", ["config", "merge.atlas-spec-graph.recursive", "binary"], { cwd: repo });
}

describe("integration: real git merge of .atlas/events.jsonl", () => {
  it("merges divergent branches without conflict markers or data loss", async () => {
    const repo = await createTmpRepo("atlas-int-events-");
    await registerLocalDriver(repo);

    // Initial commit with one base event
    const eventsPath = join(repo, ".atlas", "events.jsonl");
    writeFileSync(eventsPath, '{"id":"1","createdAt":"2026-01-01T00:00:00Z","type":"seed"}\n');
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-m", "seed"], { cwd: repo });

    // Branch A: append id=2
    await execa("git", ["checkout", "-b", "branchA"], { cwd: repo });
    writeFileSync(
      eventsPath,
      readFileSync(eventsPath, "utf8") +
        '{"id":"2","createdAt":"2026-01-02T00:00:00Z","type":"A"}\n'
    );
    await execa("git", ["commit", "-am", "branchA event"], { cwd: repo });

    // Back on main, append id=3
    await execa("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(
      eventsPath,
      readFileSync(eventsPath, "utf8") +
        '{"id":"3","createdAt":"2026-01-03T00:00:00Z","type":"main"}\n'
    );
    await execa("git", ["commit", "-am", "main event"], { cwd: repo });

    // Merge
    const result = await execa("git", ["merge", "--no-edit", "branchA"], { cwd: repo, reject: false });
    expect(result.exitCode).toBe(0);

    const merged = readFileSync(eventsPath, "utf8");
    expect(merged).not.toMatch(/<<<<<<</);
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2", "3"]);
  });
});
```

- [ ] **Step 2: Run to confirm failure (or pass — depends on whether dist is built)**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/integration-events.test.ts
```

Expected: FAIL on first run if the shim cannot find `dist/cli.js`. Confirm the build step was executed.

- [ ] **Step 3: Verify the driver works end-to-end**

If Task 8's CLI is correct and Task 4's merger is correct, this test should pass after `build`. If it fails, inspect `git log --oneline` in the tmp repo (via a temporary `console.log`) and the `.atlas/events.jsonl` contents post-merge to isolate whether Git invoked the driver, whether the driver wrote to `%A`, and whether the sort is correct.

- [ ] **Step 4: Re-run to confirm pass**

```bash
pnpm -F @atlas/spec-graph-merge-driver test -- test/integration-events.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/spec-graph-merge-driver/test/integration-events.test.ts
git commit -m "test(spec-graph-merge-driver): add real-git integration test for events.jsonl merge"
```

---

### Task 12: Integration test — `spec.graph.json` with reachable mirror

**Files:**
- Create: `packages/spec-graph-merge-driver/test/integration-graph-mirror.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/spec-graph-merge-driver/test/integration-graph-mirror.test.ts`:
```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SpecGraphRepo, createDatabase, type Database } from "@atlas/spec-graph-data";
import { createTmpRepo } from "./helpers.js";

const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

async function registerLocalDriver(repo: string, databaseUrl: string): Promise<void> {
  mkdirSync(join(repo, ".atlas"), { recursive: true });
  writeFileSync(
    join(repo, ".gitattributes"),
    ".atlas/events.jsonl     merge=atlas-spec-graph\n" +
      ".atlas/spec.graph.json  merge=atlas-spec-graph\n"
  );
  await execa(
    "git",
    [
      "config",
      "merge.atlas-spec-graph.driver",
      // Pass ATLAS_DATABASE_URL through; Git will inherit parent env for the driver.
      `node "${DRIVER_BIN}" merge %O %A %B %P`
    ],
    { cwd: repo, env: { ATLAS_DATABASE_URL: databaseUrl } }
  );
  await execa("git", ["config", "merge.atlas-spec-graph.recursive", "binary"], { cwd: repo });
}

describe("integration: spec.graph.json merge with reachable mirror", () => {
  let db: Database;
  let graphs: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphs = new SpecGraphRepo(db.pool);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("discards both branch versions and regenerates from the mirror", async () => {
    const projectId = randomUUID();
    const repo = await createTmpRepo("atlas-int-graph-mirror-");
    await registerLocalDriver(repo, process.env.DATABASE_URL_TEST!);

    const graphPath = join(repo, ".atlas", "spec.graph.json");
    const basePayload = { schemaVersion: 1, nodes: [], edges: [], metadata: { projectId } };
    writeFileSync(graphPath, JSON.stringify(basePayload));
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-m", "seed"], { cwd: repo });

    // Seed the mirror with authoritative state
    await graphs.create(projectId, {
      schemaVersion: 1,
      nodes: [{ id: "authoritative" }],
      edges: [],
      metadata: { projectId }
    });

    await execa("git", ["checkout", "-b", "branchA"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "branchA" }], edges: [], metadata: { projectId } })
    );
    await execa("git", ["commit", "-am", "branchA"], { cwd: repo });

    await execa("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "main" }], edges: [], metadata: { projectId } })
    );
    await execa("git", ["commit", "-am", "main"], { cwd: repo });

    // Git must inherit ATLAS_DATABASE_URL
    const res = await execa("git", ["merge", "--no-edit", "branchA"], {
      cwd: repo,
      env: { ...process.env, ATLAS_DATABASE_URL: process.env.DATABASE_URL_TEST! },
      reject: false
    });
    expect(res.exitCode).toBe(0);

    const merged = JSON.parse(readFileSync(graphPath, "utf8"));
    expect(merged.nodes).toEqual([{ id: "authoritative" }]);
  });
});
```

- [ ] **Step 2: Run to confirm pass (or diagnose)**

Run:
```bash
pnpm db:up
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/integration-graph-mirror.test.ts
```

Expected: PASS (1 test). If it falls back to the structural merger instead, inspect the driver's stderr log (capture `execa`'s `stderr` in the test) — likely causes: `ATLAS_DATABASE_URL` not inherited, or `projectId` not parsed from the metadata.

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-merge-driver/test/integration-graph-mirror.test.ts
git commit -m "test(spec-graph-merge-driver): add integration test for mirror-reachable graph merge"
```

---

### Task 13: Integration test — `spec.graph.json` with mirror unset (fallback path)

**Files:**
- Create: `packages/spec-graph-merge-driver/test/integration-graph-fallback.test.ts`

- [ ] **Step 1: Write the test**

`packages/spec-graph-merge-driver/test/integration-graph-fallback.test.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { createTmpRepo } from "./helpers.js";

const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

describe("integration: spec.graph.json merge without ATLAS_DATABASE_URL (fallback)", () => {
  it("runs the structural fallback merger and unions nodes by id", async () => {
    const repo = await createTmpRepo("atlas-int-graph-fb-");
    mkdirSync(join(repo, ".atlas"), { recursive: true });
    writeFileSync(
      join(repo, ".gitattributes"),
      ".atlas/events.jsonl     merge=atlas-spec-graph\n.atlas/spec.graph.json  merge=atlas-spec-graph\n"
    );
    await execa(
      "git",
      ["config", "merge.atlas-spec-graph.driver", `node "${DRIVER_BIN}" merge %O %A %B %P`],
      { cwd: repo }
    );

    const graphPath = join(repo, ".atlas", "spec.graph.json");
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: {} })
    );
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-m", "seed"], { cwd: repo });

    await execa("git", ["checkout", "-b", "branchA"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "A" }], edges: [], metadata: {} })
    );
    await execa("git", ["commit", "-am", "A"], { cwd: repo });

    await execa("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "B" }], edges: [], metadata: {} })
    );
    await execa("git", ["commit", "-am", "B"], { cwd: repo });

    const env = { ...process.env };
    delete env.ATLAS_DATABASE_URL;
    const res = await execa("git", ["merge", "--no-edit", "branchA"], { cwd: repo, env, reject: false });
    expect(res.exitCode).toBe(0);

    const merged = JSON.parse(readFileSync(graphPath, "utf8"));
    expect(merged.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Run**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/integration-graph-fallback.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-merge-driver/test/integration-graph-fallback.test.ts
git commit -m "test(spec-graph-merge-driver): add integration test for offline fallback graph merge"
```

---

### Task 14: Integration test — unknown file pattern exits 2

**Files:**
- Create: `packages/spec-graph-merge-driver/test/integration-unknown-pattern.test.ts`

- [ ] **Step 1: Write the test**

`packages/spec-graph-merge-driver/test/integration-unknown-pattern.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

describe("integration: unknown pattern exits 2 with stderr error", () => {
  it("exits with code 2 and writes a JSON error line to stderr for unregistered paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-unknown-"));
    const base = join(dir, "base");
    const ours = join(dir, "ours");
    const theirs = join(dir, "theirs");
    writeFileSync(base, "");
    writeFileSync(ours, "foo");
    writeFileSync(theirs, "bar");

    const res = await execa(
      "node",
      [DRIVER_BIN, "merge", base, ours, theirs, "src/unknown.ts"],
      { reject: false }
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/unknown pattern/i);
    // Logger output is one JSON object per line
    const lines = res.stderr.trim().split("\n");
    const lastEntry = JSON.parse(lines[lines.length - 1]!);
    expect(lastEntry.level).toBe("error");
    expect(lastEntry.pathname).toBe("src/unknown.ts");
  });
});
```

- [ ] **Step 2: Run**

Run:
```bash
pnpm -F @atlas/spec-graph-merge-driver build
pnpm -F @atlas/spec-graph-merge-driver test -- test/integration-unknown-pattern.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add packages/spec-graph-merge-driver/test/integration-unknown-pattern.test.ts
git commit -m "test(spec-graph-merge-driver): assert unknown pattern exits 2 with structured stderr"
```

---

### Task 15: Package README

**Files:**
- Create: `packages/spec-graph-merge-driver/README.md`

- [ ] **Step 1: Write the README**

`packages/spec-graph-merge-driver/README.md`:
````markdown
# @atlas/spec-graph-merge-driver

Custom Git merge driver for Atlas `.atlas/*` files. Replaces Git's default 3-way text merge for:

- `.atlas/events.jsonl` — line-union with de-duplication by `id`.
- `.atlas/spec.graph.json` — mirror-first: discards both branch versions and regenerates from the Postgres mirror when reachable; structural 3-way JSON merge as fallback.

## Install (once per clone)

```bash
npx -y @atlas/spec-graph-merge-driver install
```

This command is idempotent. It does three things in your current repository:

1. Adds two lines to `.gitattributes`:
   ```
   .atlas/events.jsonl     merge=atlas-spec-graph
   .atlas/spec.graph.json  merge=atlas-spec-graph
   ```
2. Sets `merge.atlas-spec-graph.name`, `merge.atlas-spec-graph.driver`, and `merge.atlas-spec-graph.recursive` in the local `git config`.
3. Logs a structured JSON line to stderr confirming success.

**Commit `.gitattributes`** so every collaborator's Git picks up the rule. Each collaborator still has to run `install` once — Git configuration is per-clone.

## Uninstall

```bash
npx -y @atlas/spec-graph-merge-driver uninstall
```

Removes the two lines from `.gitattributes` (deleting the file if it becomes empty) and unsets the three git config keys.

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `ATLAS_DATABASE_URL` | Postgres connection string for the mirror. If unset, `spec.graph.json` merges use the structural fallback. | *(unset)* |
| `ATLAS_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` \| `fatal` — controls the stderr log threshold. | `info` |

## How Git invokes the driver

When `.gitattributes` and `git config` are in place, every `git merge` that touches one of the two patterns calls:

```
npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P
```

Git passes four file paths (`%O` = base, `%A` = ours, `%B` = theirs, `%P` = pathname). The driver overwrites `%A` with the merged result. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Clean merge. Git uses `%A` as-is. |
| 1 | I/O error (e.g. `%A` unwritable). Git treats this as a conflict. |
| 2 | Unknown path pattern. Git treats this as a conflict. |
| 3 | Driver crashed. Git treats this as a conflict. |

## Observability

Every merge invocation increments or observes:

- `atlas_merge_driver_invocations_total{pattern, path, result}` — counter, `result` ∈ `ok` / `conflict` / `fallback`.
- `atlas_merge_driver_duration_seconds{pattern}` — histogram.
- `atlas_merge_driver_mirror_unreachable_total` — counter.

Metrics register on the shared `@atlas/spec-graph-data` registry. OpenTelemetry spans under the `atlas.merge-driver.invoke` name are emitted per invocation.

## Troubleshooting

**"The driver isn't being called."**
Confirm `.gitattributes` is committed and `git check-attr merge .atlas/events.jsonl` prints `merge: atlas-spec-graph`. If it prints `unspecified`, the pattern didn't match — check for CRLF line endings or a missing final newline.

**"The driver is called but `git merge` still shows conflicts."**
Driver exited non-zero. Inspect stderr; the driver logs a JSON line per error with `level`, `msg`, `pathname`, and `err`.

**"The mirror-first path never runs."**
Either `ATLAS_DATABASE_URL` is unset in the environment `git merge` inherited, or the connection times out (the threshold is 2 seconds). Verify with `env | grep ATLAS_DATABASE_URL` before merging.

**"`npx` is too slow."**
Install once globally: `npm i -g @atlas/spec-graph-merge-driver` and change the driver command to `atlas-merge-driver merge %O %A %B %P` via `git config merge.atlas-spec-graph.driver`.
````

- [ ] **Step 2: Commit**

```bash
git add packages/spec-graph-merge-driver/README.md
git commit -m "docs(spec-graph-merge-driver): add install/uninstall README with troubleshooting"
```

---

## Completion Checklist

After finishing all 15 tasks, verify:

- [ ] `pnpm -F @atlas/spec-graph-merge-driver test` — all tests green (≈ 40+ tests total across the suite)
- [ ] `pnpm -F @atlas/spec-graph-merge-driver build` — exits 0, `dist/` populated, `bin/atlas-merge-driver.js` resolves `../dist/cli.js`
- [ ] `pnpm -F @atlas/spec-graph-merge-driver typecheck` — exits 0
- [ ] `docker compose down && docker compose up -d && pnpm -F @atlas/spec-graph-data db:migrate && pnpm -F @atlas/spec-graph-merge-driver test` — full cold-start works
- [ ] Manual smoke test: `cd $(mktemp -d) && git init && node <repo>/packages/spec-graph-merge-driver/bin/atlas-merge-driver.js install` — prints a success log, creates `.gitattributes`, populates `git config --list | grep atlas`
- [ ] `packages/spec-graph-merge-driver/README.md` documents install, uninstall, env vars, and troubleshooting
- [ ] All commits use Conventional Commits prefixes (`feat`, `test`, `docs`, `chore`)
- [ ] No test writes to `process.stdout` from the driver itself (Git protocol)

## Handoff to Plan A.4

Plan A.4 (compaction + offline mode) depends on:

- `installDriver` / `uninstallDriver` — A.4's `atlas init` bootstrap calls `installDriver` as part of first-time repo setup.
- The `mergeEventsJsonl` pure function — A.4's compaction rewrites `events.jsonl` after snapshotting and reuses the same sort/dedup invariants to stay compatible with the driver.
- The `mirrorUnreachable` counter + structured logger — A.4's offline-mode manager scrapes this to decide when to warn the user that the mirror has been unreachable for too long.
- The `atlas.merge-driver.invoke` span — A.4's reconciliation tool correlates local merge outcomes against mirror state via trace context.

Nothing in A.4 should modify the merge algorithms themselves; if A.4 discovers an algorithmic gap, that is a change to this package, not a workaround in the compaction layer.
