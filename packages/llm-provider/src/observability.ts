import { Counter, Histogram, Registry } from "prom-client";
import { trace, SpanStatusCode, type Tracer } from "@opentelemetry/api";

export interface ProviderMetrics {
  requestsTotal: Counter<string>;
  latencySeconds: Histogram<string>;
}

export function createProviderMetrics(registry: Registry): ProviderMetrics {
  const requestsTotal = new Counter({
    name: "atlas_llm_provider_requests_total",
    help: "Total LLM provider requests",
    labelNames: ["provider", "model", "status"],
    registers: [registry]
  });
  const latencySeconds = new Histogram({
    name: "atlas_llm_provider_latency_seconds",
    help: "LLM provider request latency",
    labelNames: ["provider", "model", "status"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry]
  });
  return { requestsTotal, latencySeconds };
}

export interface InstrumentContext {
  provider: string;
  model: string;
  metrics: ProviderMetrics;
  tracer?: Tracer;
}

export async function instrumentCall<T>(ctx: InstrumentContext, fn: () => Promise<T>): Promise<T> {
  const tracer = ctx.tracer ?? trace.getTracer("@atlas/llm-provider");
  const start = Date.now();
  return tracer.startActiveSpan(`llm.${ctx.provider}.call`, async (span) => {
    span.setAttribute("llm.provider", ctx.provider);
    span.setAttribute("llm.model", ctx.model);
    try {
      const result = await fn();
      const elapsedSec = (Date.now() - start) / 1000;
      ctx.metrics.requestsTotal.labels({ provider: ctx.provider, model: ctx.model, status: "success" }).inc();
      ctx.metrics.latencySeconds.labels({ provider: ctx.provider, model: ctx.model, status: "success" }).observe(elapsedSec);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const elapsedSec = (Date.now() - start) / 1000;
      ctx.metrics.requestsTotal.labels({ provider: ctx.provider, model: ctx.model, status: "error" }).inc();
      ctx.metrics.latencySeconds.labels({ provider: ctx.provider, model: ctx.model, status: "error" }).observe(elapsedSec);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
