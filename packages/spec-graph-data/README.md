# @atlas/spec-graph-data

Postgres mirror for the Atlas Living Spec Graph.

This package owns the data substrate: table schemas, migrations, repositories, tenant isolation, and observability. It does **not** parse or validate the graph payload — that is `@atlas/spec-graph-schema` (Unit B).

## Tables

- `spec_graphs` — one row per project; current materialized graph.
- `spec_events` — append-only event log (one row per mutation).
- `spec_snapshots` — point-in-time snapshots for recovery and compaction.

All three tables have Row-Level Security enabled. Access must go through `withProjectContext` (which sets a session-local `app.project_id` inside a transaction) or the repos (which do this for you). The `atlas` role is provisioned as NOSUPERUSER NOBYPASSRLS by `docker/postgres-init.sql` — this is required because RLS is bypassed by SUPERUSER and BYPASSRLS regardless of FORCE ROW LEVEL SECURITY.

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
DATABASE_URL=postgresql://atlas:atlas@localhost:5433/atlas_dev
DATABASE_URL_TEST=postgresql://atlas:atlas@localhost:5433/atlas_test
```

Note: host port is **5433**, not 5432. See `docker-compose.yml` for the port-mapping rationale.

## Developing

```bash
# From repo root
pnpm db:up                                       # bring up Postgres 16 (runs init script on first boot)
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
