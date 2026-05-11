import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SpecEventRepo, SpecGraphRepo, withProjectContext, type Database } from "@atlas/spec-graph-data";
import { compactProject } from "../src/compaction/compactor.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("compactProject idempotency", () => {
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
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("running compaction twice does not duplicate work", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    for (let i = 0; i < 150; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }

    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const first = await compactProject({ pool: db.pool, projectId, tailLength: 100, storage });
    expect(first.status).toBe("ok");

    const second = await compactProject({ pool: db.pool, projectId, tailLength: 100, storage });
    expect(second.status).toBe("skipped-no-work");

    // Exactly one compaction snapshot exists — wrap in withProjectContext for RLS
    const count = await withProjectContext(db.pool, projectId, async (client) => {
      const { rows } = await client.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM spec_snapshots WHERE project_id = $1 AND reason = 'compaction'",
        [projectId]
      );
      return Number(rows[0]!.count);
    });
    expect(count).toBe(1);
  });

  it("no-ops when the project has fewer events than the tail", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, {});
    for (let i = 0; i < 10; i++) {
      await events.append(projectId, { eventType: "e", payload: { i } });
    }
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const result = await compactProject({ pool: db.pool, projectId, tailLength: 100, storage });
    expect(result.status).toBe("skipped-no-work");
  });
});
