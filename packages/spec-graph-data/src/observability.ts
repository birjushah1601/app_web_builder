import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Counter, Histogram, Registry } from "prom-client";

const TRACER_NAME = "@atlas/spec-graph-data";
export const tracer = trace.getTracer(TRACER_NAME);
// Re-export the same @opentelemetry/api trace singleton this module is bound to.
// Tests (and downstream consumers) must use this exact instance to register a
// global tracer provider — Vite can otherwise load `@opentelemetry/api` via
// both the ESM (`module`) and CJS (`main`) entry points, producing two
// TraceAPI singletons whose ProxyTracerProviders are separate.
export const traceApi = trace;

export const registry = new Registry();

export const repoOpCounter = new Counter({
  name: "atlas_spec_graph_repo_ops_total",
  help: "Total spec-graph repo operations",
  labelNames: ["operation", "status"],
  registers: [registry]
});

export const repoOpDuration = new Histogram({
  name: "atlas_spec_graph_repo_op_duration_seconds",
  help: "Duration of spec-graph repo operations in seconds",
  labelNames: ["operation"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry]
});

export async function withSpan<T>(
  operationName: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const start = process.hrtime.bigint();
  return tracer.startActiveSpan(operationName, async (span) => {
    for (const [key, value] of Object.entries(attrs)) {
      span.setAttribute(key, value);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.UNSET });
      repoOpCounter.inc({ operation: operationName, status: "ok" });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      repoOpCounter.inc({ operation: operationName, status: "error" });
      throw error;
    } finally {
      const durationNs = process.hrtime.bigint() - start;
      repoOpDuration.observe({ operation: operationName }, Number(durationNs) / 1e9);
      span.end();
    }
  });
}
