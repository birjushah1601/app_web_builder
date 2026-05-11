import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Counter, Histogram } from "prom-client";
import { metricsRegistry } from "@atlas/spec-graph-data";

const TRACER_NAME = "@atlas/spec-graph-sync";
export const syncTracer = trace.getTracer(TRACER_NAME);
// Re-export the same @opentelemetry/api trace singleton this module is bound to.
// Tests (and downstream consumers) must use this exact instance to register a
// global tracer provider — Vite can otherwise load `@opentelemetry/api` via
// both the ESM (`module`) and CJS (`main`) entry points, producing two
// TraceAPI singletons whose ProxyTracerProviders are separate.
export const traceApi = trace;

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
