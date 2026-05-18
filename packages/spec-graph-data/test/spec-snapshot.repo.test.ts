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

describe("SpecSnapshotRepo.findLatest", () => {
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

  it("returns the most recent snapshot for the project", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, { upToEventId: 1n, graphData: { v: 1 }, reason: "manual" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await repo.create(projectId, { upToEventId: 5n, graphData: { v: 2 }, reason: "compaction" });
    const latest = await repo.findLatest(projectId);
    expect(latest?.id).toBe(second.id);
    expect(latest?.upToEventId).toBe(5n);
  });

  it("returns null when the project has no snapshots", async () => {
    expect(await repo.findLatest(uniqueProjectId())).toBeNull();
  });
});
