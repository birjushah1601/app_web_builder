import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { Counter, Histogram, Registry } from "prom-client";

const TRACER_NAME = "@atlas/spec-graph-ops";
export const tracer = trace.getTracer(TRACER_NAME);

export const opsRegistry = new Registry();

export const compactionRuns = new Counter({
  name: "atlas_compaction_runs_total",
  help: "Total compaction runs",
  labelNames: ["result"],
  registers: [opsRegistry]
});

export const compactionEventsCompacted = new Counter({
  name: "atlas_compaction_events_compacted_total",
  help: "Total events rolled up into snapshots + archived",
  registers: [opsRegistry]
});

export const compactionSnapshotBytes = new Histogram({
  name: "atlas_compaction_snapshot_bytes",
  help: "Size in bytes of each compaction snapshot payload",
  buckets: [1024, 10_240, 102_400, 1_048_576, 10_485_760, 104_857_600],
  registers: [opsRegistry]
});

export const compactionDuration = new Histogram({
  name: "atlas_compaction_duration_seconds",
  help: "Duration of a single compaction run in seconds",
  buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
  registers: [opsRegistry]
});

export const offlineExportRuns = new Counter({
  name: "atlas_offline_export_runs_total",
  help: "Total offline-export runs",
  labelNames: ["result"],
  registers: [opsRegistry]
});

export const offlineExportArchiveBytes = new Histogram({
  name: "atlas_offline_export_archive_bytes",
  help: "Size in bytes of each offline-export archive",
  buckets: [102_400, 1_048_576, 10_485_760, 104_857_600, 1_073_741_824],
  registers: [opsRegistry]
});

export const offlineImportRuns = new Counter({
  name: "atlas_offline_import_runs_total",
  help: "Total offline-import runs",
  labelNames: ["result"],
  registers: [opsRegistry]
});

export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.UNSET });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
