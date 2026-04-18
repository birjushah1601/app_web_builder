import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecSnapshotRepo } from "../src/repo/spec-snapshot.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("SpecSnapshotRepo.create", () => {
  let db: Database;
  let repo: SpecSnapshotRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecSnapshotRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("creates a snapshot and returns the inserted row", async () => {
    const projectId = uniqueProjectId();
    const row = await repo.create(projectId, {
      upToEventId: 42n,
      graphData: { nodes: [{ id: "n1" }] },
      reason: "manual"
    });
    expect(row.projectId).toBe(projectId);
    expect(row.upToEventId).toBe(42n);
    expect(row.reason).toBe("manual");
    expect(row.graphData).toEqual({ nodes: [{ id: "n1" }] });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
