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
