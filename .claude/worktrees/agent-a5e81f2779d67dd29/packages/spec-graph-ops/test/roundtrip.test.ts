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

describe("roundtrip: export DB A → import DB B → row counts match", () => {
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

  it("export → wipe → import yields identical counts and graph", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["r1", "r2"] });
    for (let i = 0; i < 40; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const outDir = mkdtempSync(join(tmpdir(), "atlas-export-"));
    const outPath = join(outDir, "rt.tar.gz");
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    await exportProject({ pool: db.pool, projectId, outPath, storage });

    const before = await countsFor(db, projectId);

    await truncateAll(db);
    await importArchive({
      pool: db.pool,
      archivePath: outPath,
      databaseUrl: process.env.DATABASE_URL_TEST!
    });

    const after = await countsFor(db, projectId);
    expect(after).toEqual(before);

    const roundGraph = await graphs.findByProjectId(projectId);
    expect(roundGraph?.graphData).toEqual({ nodes: ["r1", "r2"] });

    rmSync(outDir, { recursive: true, force: true });
  });
});

async function countsFor(db: Database, projectId: string): Promise<Record<string, number>> {
  return await withProjectContext(db.pool, projectId, async (client) => {
    const counts: Record<string, number> = {};
    for (const table of ["spec_graphs", "spec_events", "spec_snapshots"] as const) {
      const { rows } = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${table} WHERE project_id = $1`,
        [projectId]
      );
      counts[table] = Number(rows[0]!.c);
    }
    return counts;
  });
}
