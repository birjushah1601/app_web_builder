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
