import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SpecEventRepo,
  SpecGraphRepo,
  withProjectContext,
  type Database
} from "@atlas/spec-graph-data";
import { exportProject } from "../src/offline/exporter.js";
import { importArchive } from "../src/offline/importer.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("importArchive", () => {
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

  it("imports a previously exported archive into a clean database", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["a", "b"] });
    for (let i = 0; i < 25; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "export.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    await truncateAll(db);
    const summary = await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!
    });
    expect(summary.projectId).toBe(projectId);
    expect(summary.eventsInserted).toBe(25);

    const round = await graphs.findByProjectId(projectId);
    expect(round?.graphData).toEqual({ nodes: ["a", "b"] });

    rmSync(outDir, { recursive: true, force: true });
  });

  it("refuses to import when the target project already exists (without --force)", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["x"] });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "export.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    await expect(
      importArchive({
        pool: db.pool,
        archivePath: outPath,
        databaseUrl: process.env.DATABASE_URL_TEST!
      })
    ).rejects.toThrow(/already exists/i);

    rmSync(outDir, { recursive: true, force: true });
  });

  it("with force=true, overwrites the existing project", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["old"] });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "export.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });

    // Modify graph (RLS-correct), then export.
    await withProjectContext(db.pool, projectId, async (client) => {
      await client.query(
        "UPDATE spec_graphs SET graph_data = $1 WHERE project_id = $2",
        [JSON.stringify({ nodes: ["new"] }), projectId]
      );
    });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    // Restore the "old" state.
    await withProjectContext(db.pool, projectId, async (client) => {
      await client.query(
        "UPDATE spec_graphs SET graph_data = $1 WHERE project_id = $2",
        [JSON.stringify({ nodes: ["old"] }), projectId]
      );
    });

    await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!,
      force: true
    });
    const after = await graphs.findByProjectId(projectId);
    expect(after?.graphData).toEqual({ nodes: ["new"] });

    rmSync(outDir, { recursive: true, force: true });
  });
});
