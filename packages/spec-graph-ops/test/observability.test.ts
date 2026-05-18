import { describe, expect, it } from "vitest";
import {
  compactionRuns,
  compactionEventsCompacted,
  compactionSnapshotBytes,
  compactionDuration,
  offlineExportRuns,
  offlineExportArchiveBytes,
  offlineImportRuns,
  opsRegistry
} from "../src/observability.js";

describe("observability: compaction + offline metrics", () => {
  it("exposes all required counters and histograms with exact names", async () => {
    compactionRuns.inc({ result: "ok" });
    compactionEventsCompacted.inc(42);
    compactionSnapshotBytes.observe(1024);
    compactionDuration.observe(0.5);
    offlineExportRuns.inc({ result: "ok" });
    offlineExportArchiveBytes.observe(2048);
    offlineImportRuns.inc({ result: "ok" });

    const out = await opsRegistry.metrics();
    expect(out).toMatch(/atlas_compaction_runs_total\{result="ok"\} 1/);
    expect(out).toMatch(/atlas_compaction_events_compacted_total 42/);
    expect(out).toMatch(/atlas_compaction_snapshot_bytes_count 1/);
    expect(out).toMatch(/atlas_compaction_duration_seconds_count 1/);
    expect(out).toMatch(/atlas_offline_export_runs_total\{result="ok"\} 1/);
    expect(out).toMatch(/atlas_offline_export_archive_bytes_count 1/);
    expect(out).toMatch(/atlas_offline_import_runs_total\{result="ok"\} 1/);
  });
});
