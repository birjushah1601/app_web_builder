import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "tar";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { exportProject } from "../src/offline/exporter.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { compactProject } from "../src/compaction/compactor.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("exportProject", () => {
  let db: Database;
  let graphs: SpecGraphRepo;
  let events: SpecEventRepo;
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeAll(() => {
    db = createTestDb();
    graphs = new SpecGraphRepo(db.pool);
    events = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("writes a .tar.gz archive containing manifest, graph, events, snapshots, and archives", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["a"] });
    for (let i = 0; i < 150; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await compactProject({ pool: db.pool, projectId, tailLength: 50, storage });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    try {
      const outPath = join(outDir, "export.tar.gz");
      const result = await exportProject({
        pool: db.pool,
        projectId,
        outPath,
        storage
      });

      expect(result.bytes).toBeGreaterThan(0);
      expect(statSync(outPath).size).toBe(result.bytes);

      const extractDir = mkdtempSync(join(tmpdir(), "atlas-export-extract-"));
      await extract({ file: outPath, cwd: extractDir });

      const manifest = JSON.parse(readFileSync(join(extractDir, "manifest.json"), "utf8"));
      expect(manifest.projectId).toBe(projectId);
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.tocoEntries.map((e: { name: string }) => e.name).sort()).toEqual([
        "events.jsonl",
        "snapshots.jsonl",
        "spec_graph.json"
      ]);
      expect(manifest.archives.length).toBe(1);

      const graph = JSON.parse(readFileSync(join(extractDir, "spec_graph.json"), "utf8"));
      expect(graph.graphData).toEqual({ nodes: ["a"] });

      const eventsJsonl = readFileSync(join(extractDir, "events.jsonl"), "utf8");
      expect(eventsJsonl.trim().split("\n")).toHaveLength(50);

      const snapshotsJsonl = readFileSync(join(extractDir, "snapshots.jsonl"), "utf8");
      expect(snapshotsJsonl.trim().split("\n").length).toBeGreaterThanOrEqual(1);

      rmSync(extractDir, { recursive: true, force: true });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
