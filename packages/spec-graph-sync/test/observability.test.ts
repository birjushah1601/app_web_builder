import { SpanKind } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { metricsRegistry } from "@atlas/spec-graph-data";
import {
  syncFeedbackLoopsAvoided,
  syncInvalidLinesTotal,
  syncPropagationDuration,
  syncReconciliationNeeded,
  syncWatchEvents,
  traceApi,
  withSyncSpan
} from "../src/observability.js";

describe("sync observability", () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)]
    });
    // Use the trace API instance re-exported from observability.ts so the
    // provider registered here is the same one our tracer is bound to.
    // Vite can otherwise load @opentelemetry/api twice (ESM + CJS), producing
    // two TraceAPI singletons with separate ProxyTracerProviders.
    traceApi.setGlobalTracerProvider(provider);
  });

  beforeEach(() => {
    exporter.reset();
    metricsRegistry.resetMetrics();
  });

  afterAll(() => {
    exporter.reset();
  });

  it("registers sync metrics on the shared @atlas/spec-graph-data registry", async () => {
    syncWatchEvents.inc({ direction: "file-to-mirror", kind: "file-changed" });
    syncFeedbackLoopsAvoided.inc();
    syncInvalidLinesTotal.inc();
    syncReconciliationNeeded.inc();
    syncPropagationDuration.observe({ direction: "file-to-mirror" }, 0.123);

    const out = await metricsRegistry.metrics();
    expect(out).toMatch(
      /atlas_sync_watch_events_total\{direction="file-to-mirror",kind="file-changed"\} 1/
    );
    expect(out).toMatch(/atlas_sync_feedback_loops_avoided_total 1/);
    expect(out).toMatch(/atlas_sync_invalid_lines_total 1/);
    expect(out).toMatch(/atlas_sync_reconciliation_needed_total 1/);
    expect(out).toMatch(
      /atlas_sync_propagation_duration_seconds_count\{direction="file-to-mirror"\} 1/
    );
  });

  it("withSyncSpan emits a span with the expected name and attributes", async () => {
    await withSyncSpan(
      "SyncDaemon.propagateFileToMirror",
      { "atlas.project_id": "abc" },
      async () => {
        // work
      }
    );
    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === "SyncDaemon.propagateFileToMirror");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.INTERNAL);
    expect(span!.attributes["atlas.project_id"]).toBe("abc");
  });

  it("withSyncSpan records errors and sets error status", async () => {
    await expect(
      withSyncSpan("SyncDaemon.propagateFileToMirror", { "atlas.project_id": "abc" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "SyncDaemon.propagateFileToMirror");
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(2); // ERROR
  });
});
