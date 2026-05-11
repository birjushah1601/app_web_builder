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
import { compactProject } from "../src/compaction/compactor.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { exportProject } from "../src/offline/exporter.js";
import { importArchive } from "../src/offline/importer.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("integration: seed → compact → export → wipe → import → verify", () => {
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

  it("full lifecycle recovers original state after wipe", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["i1", "i2"], edges: [["i1", "i2"]] });
    for (let i = 0; i < 200; i++) {
      await events.append(projectId, { eventType: "e", payload: { i }, actor: "integration" });
    }

    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const compactResult = await compactProject({ pool: db.pool, projectId, tailLength: 50, storage });
    expect(compactResult.status).toBe("ok");

    const before = await snapshotState(db, projectId);
    expect(before.events).toBe(50);
    expect(before.snapshots).toBeGreaterThanOrEqual(1);

    const outDir = mkdtempSync(join(tmpdir(), "atlas-int-"));
    const outPath = join(outDir, "int.tar.gz");
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    await truncateAll(db);
    rmSync(workspace.dir, { recursive: true, force: true });
    workspace = makeTempColdStorageDir();
    process.env.ATLAS_COLD_STORAGE_DIR = workspace.dir;

    await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!
    });

    const after = await snapshotState(db, projectId);
    expect(after).toEqual(before);

    const graph = await graphs.findByProjectId(projectId);
    expect(graph?.graphData).toEqual({ nodes: ["i1", "i2"], edges: [["i1", "i2"]] });

    rmSync(outDir, { recursive: true, force: true });
  });
});

async function snapshotState(db: Database, projectId: string): Promise<{ events: number; snapshots: number; graphs: number }> {
  return await withProjectContext(db.pool, projectId, async (client) => {
    const [e, s, g] = await Promise.all([
      client.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM spec_events WHERE project_id = $1", [projectId]),
      client.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM spec_snapshots WHERE project_id = $1", [projectId]),
      client.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM spec_graphs WHERE project_id = $1", [projectId])
    ]);
    return {
      events: Number(e.rows[0]!.c),
      snapshots: Number(s.rows[0]!.c),
      graphs: Number(g.rows[0]!.c)
    };
  });
}
