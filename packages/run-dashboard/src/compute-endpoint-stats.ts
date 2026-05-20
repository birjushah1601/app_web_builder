import { EndpointStatSchema, type EndpointStat } from "./types.js";

export function parsePromEndpointSeries(
  series: Array<{ metric: Record<string, string>; value: number }>,
  _kind: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const point of series) {
    const ep = point.metric.endpoint;
    if (!ep) continue;
    out[ep] = point.value;
  }
  return out;
}

export interface ComputeEndpointStatsInput {
  requests: Record<string, number>;
  errors: Record<string, number>;
  p50: Record<string, number>;
  p95: Record<string, number>;
  p99: Record<string, number>;
}

export function computeEndpointStats(input: ComputeEndpointStatsInput): EndpointStat[] {
  const allEndpoints = new Set<string>([
    ...Object.keys(input.requests),
    ...Object.keys(input.errors),
    ...Object.keys(input.p50),
    ...Object.keys(input.p95),
    ...Object.keys(input.p99)
  ]);
  const stats: EndpointStat[] = [];
  for (const ep of allEndpoints) {
    stats.push(
      EndpointStatSchema.parse({
        endpointId: ep,
        requestCount: input.requests[ep] ?? 0,
        errorCount: input.errors[ep] ?? 0,
        p50Ms: input.p50[ep] ?? 0,
        p95Ms: input.p95[ep] ?? 0,
        p99Ms: input.p99[ep] ?? 0
      })
    );
  }
  stats.sort((a, b) => b.requestCount - a.requestCount);
  return stats;
}
