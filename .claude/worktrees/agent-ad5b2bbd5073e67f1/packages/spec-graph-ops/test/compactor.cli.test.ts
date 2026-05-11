import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecEventRepo, SpecGraphRepo, withProjectContext, type Database } from "@atlas/spec-graph-data";
import { main } from "../src/cli/compactor.cli.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("atlas-compactor CLI", () => {
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
    process.env.ATLAS_EVENT_TAIL_LENGTH = "50";
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("run --project-id <id> compacts a single project", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    for (let i = 0; i < 80; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    await main(["node", "atlas-compactor", "run", "--project-id", projectId]);

    const count = await withProjectContext(db.pool, projectId, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM spec_events WHERE project_id = $1",
        [projectId]
      );
      return Number(rows[0]!.count);
    });
    expect(count).toBe(50);
  });

  it("run --all compacts every project above the tail", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await graphs.create(projectA, {});
    await graphs.create(projectB, {});
    for (let i = 0; i < 80; i++) {
      await events.append(projectA, { eventType: "e", payload: { i } });
      await events.append(projectB, { eventType: "e", payload: { i } });
    }

    await main(["node", "atlas-compactor", "run", "--all"]);

    for (const projectId of [projectA, projectB]) {
      const count = await withProjectContext(db.pool, projectId, async (client) => {
        const { rows } = await client.query<{ c: string }>(
          "SELECT COUNT(*)::text AS c FROM spec_events WHERE project_id = $1",
          [projectId]
        );
        return Number(rows[0]!.c);
      });
      expect(count).toBe(50);
    }
  });
});
