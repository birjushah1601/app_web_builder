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

`run --all` requires a one-time admin migration installing the `list_all_project_ids()` SECURITY DEFINER function (the test suite installs it automatically; production deployments need to apply it as a superuser). See `test/setup.ts` for the SQL.

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
