# @atlas/run-dashboard

Headless library that powers the persona-tiered Atlas Run dashboard in `apps/atlas-web`. One data source (Grafana / Prometheus / Tempo), three views (Ama traffic-lights / Diego endpoint table / Priya trace explorer).

## API

- `HealthSummary`, `EndpointStat`, `TraceLink` — Zod-validated shapes consumed by the atlas-web components.
- `GrafanaClient` interface + `InMemoryGrafanaClient` — for tests, preload known responses. Production wraps the Grafana HTTP data-source API (follow-up).
- `computeHealthSummary(client, input)` — returns `{ light: "green"|"amber"|"red"|"unknown" }` from PromQL queries `atlas_availability_ratio` + `atlas_open_burn_alerts`.
- `computeEndpointStats({ requests, errors, p50, p95, p99 })` — merges per-endpoint Prometheus series into `EndpointStat[]` sorted by requestCount desc.

## Canonical PromQL

Services emitting metrics via `@atlas/observability` must publish:

- `atlas_availability_ratio` — instant gauge, 0–1
- `atlas_open_burn_alerts` — instant gauge, count
- `atlas_endpoint_requests_total{endpoint="…"}`
- `atlas_endpoint_errors_total{endpoint="…"}`
- `atlas_endpoint_latency_p50_ms{endpoint="…"}`, `_p95_ms`, `_p99_ms`

## Persona copy rules

- **Ama:** traffic-light + one-sentence support. No numbers.
- **Diego:** per-endpoint table with p50/p95/p99 + rows above 1% error rate highlighted.
- **Priya:** full trace table with deep links to Grafana trace explorer. Errored traces highlighted.

All three views read from the same underlying queries — the `@atlas/run-dashboard` computers normalize the data, the atlas-web components choose what to show.
