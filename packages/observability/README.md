# @atlas/observability

Shared observability primitives for every Atlas service. Per ADR-001 §4, Atlas runs its own monitoring stack (OpenTelemetry + Prometheus + Grafana + Loki) — never Sentry / Datadog / New Relic.

## What this package gives you

- `initOtelSdk(opts)` — start the OpenTelemetry SDK for tracing. Call once per process, at startup, before any Atlas code runs. Pass `exporterMode: "noop"` in tests, `"otlp-proto"` in production.
- `initPromRegistry(opts)` — singleton Prometheus registry with the service-name + version labels preset. Idempotent.
- `getPromRegistry()` — returns the singleton; throws if `initPromRegistry` was never called.
- `createAtlasLogger(opts)` — pino logger that auto-stamps `trace_id` + `span_id` from the active OpenTelemetry span context. Use this everywhere instead of `console.log`.
- `ATLAS_ATTRS` — the canonical span-attribute keys every role, gate, orchestrator, and ritual must use (`atlas.project_id`, `atlas.role_id`, `atlas.ritual_id`, `atlas.gate_layer`, etc.).
- `buildAtlasResourceAttributes(...)` — builds the OpenTelemetry `Resource` attribute map from service name + version + deploy target.

## Bootstrap pattern

```ts
import { initOtelSdk, initPromRegistry, createAtlasLogger } from "@atlas/observability";

await initOtelSdk({
  serviceName: "atlas-conductor",
  serviceVersion: "0.0.0",
  deployTarget: (process.env.ATLAS_DEPLOY_TARGET as "production" | "preview") ?? "production",
  exporterMode: process.env.NODE_ENV === "test" ? "noop" : "otlp-proto"
});
initPromRegistry({ serviceName: "atlas-conductor", serviceVersion: "0.0.0" });
const logger = createAtlasLogger({ serviceName: "atlas-conductor" });

logger.info({ msg: "conductor started" });
```

## Why no `initMetricsExporter`?

The Prometheus scrape pattern works differently from OTel traces: the collector scrapes the `/metrics` endpoint on each service, so there's no exporter to bootstrap. Services just need to expose `getPromRegistry().metrics()` at `/metrics`. Knative handles the scrape config in `deploy/atlas-helm/`.

## ADR reference

Per ADR-001 §4: platform telemetry goes through OTel + Prometheus + Grafana + Loki; user-app exceptions go through GlitchTip via `SENTRY_DSN` injection in `@atlas/deploy-orchestrator`.
