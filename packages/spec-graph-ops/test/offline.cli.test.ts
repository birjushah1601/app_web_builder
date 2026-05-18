import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SpecEventRepo,
  SpecGraphRepo,
  type Database
} from "@atlas/spec-graph-data";
import { main } from "../src/cli/offline.cli.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("atlas-offline CLI", () => {
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
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST!;
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("export produces a tar.gz at --out", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    await events.append(projectId, { eventType: "e", payload: {} });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
    const out = join(outDir, "p.tar.gz");
    try {
      await main(["node", "atlas-offline", "export", "--project-id", projectId, "--out", out]);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("import restores an exported project into a clean DB", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { nodes: ["imp"] });

    const outDir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
    const out = join(outDir, "p.tar.gz");
    try {
      await main(["node", "atlas-offline", "export", "--project-id", projectId, "--out", out]);
      await truncateAll(db);
      await main([
        "node", "atlas-offline", "import",
        "--archive", out,
        "--database-url", process.env.DATABASE_URL_TEST!
      ]);
      const found = await graphs.findByProjectId(projectId);
      expect(found?.graphData).toEqual({ nodes: ["imp"] });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
