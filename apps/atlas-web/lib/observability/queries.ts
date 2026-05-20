/**
 * Named query constants used by the Run page. Strings live here (not
 * inline in page.tsx) so operators can grep "what are we asking Grafana
 * for" and tests can assert their shape without parsing a TSX file.
 *
 * Each query assumes the operator's metrics + log streams are emitted by
 * @atlas/observability (which auto-stamps trace_id / span_id) — see
 * docs/adr/2026-04-21-oss-stack-pivot.md §4 for the metric-name policy.
 */

/** Instant query: per-window availability ratio. Defaulted by computeHealthSummary. */
export const AVAILABILITY_QUERY = "atlas_availability_ratio";

/** Instant query: count of open SLO burn-rate alerts. */
export const OPEN_ALERTS_QUERY = "atlas_open_burn_alerts";

/** Range query: per-endpoint p95 latency for the last hour.
 *  Returns matrix-shaped data parseable by parsePromEndpointSeries. */
export const ENDPOINT_LATENCY_QUERY =
  "histogram_quantile(0.95, sum by (endpoint, le) (rate(atlas_http_request_duration_seconds_bucket[5m])))";

/** LogQL query (Loki, exposed via the same Grafana proxy): recent
 *  error-level log lines that carry a trace_id label. The Tempo cross-
 *  link uses these trace_ids. */
export const ERROR_TRACES_QUERY = '{level="error"} | json | trace_id != ""';
