import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SpecEventRepo,
  SpecGraphRepo,
  withProjectContext,
  type Database
} from "@atlas/spec-graph-data";
import { compactProject } from "../src/compaction/compactor.js";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { createTestDb, makeTempColdStorageDir, truncateAll, uniqueProjectId } from "./helpers.js";

describe("compactProject: snapshot + tail + archive", () => {
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

  it("compacts old events into a snapshot + archive, leaving N in the tail", async () => {
    const projectId = uniqueProjectId();
    await graphs.create(projectId, { marker: "initial" });

    const total = 250;
    const tailLength = 100;
    for (let i = 0; i < total; i++) {
      await events.append(projectId, {
        eventType: "node.created",
        payload: { i },
        actor: "test"
      });
    }

    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const result = await compactProject({
      pool: db.pool,
      projectId,
      tailLength,
      storage
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.eventsCompacted).toBe(total - tailLength);
    expect(result.archiveKey).toMatch(/\.jsonl\.gz$/);

    const tail = await events.listSince(projectId, 0n, total);
    expect(tail).toHaveLength(tailLength);

    const snapshotRow = await withProjectContext(db.pool, projectId, async (client) => {
      const { rows } = await client.query<{ reason: string; up_to_event_id: string }>(
        "SELECT reason, up_to_event_id FROM spec_snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
        [projectId]
      );
      return rows[0];
    });
    expect(snapshotRow?.reason).toBe("compaction");
    expect(BigInt(snapshotRow!.up_to_event_id)).toBe(BigInt(total - tailLength));

    const roundtrip = await storage.getArchive(result.archiveKey);
    const lines = roundtrip.trim().split("\n");
    expect(lines).toHaveLength(total - tailLength);
  });
});
