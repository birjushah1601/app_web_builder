import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { SpecGraphRepo } from "../src/repo/spec-graph.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("SpecGraphRepo.create", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("creates a spec graph and returns the inserted row", async () => {
    const projectId = uniqueProjectId();
    const row = await repo.create(projectId, { nodes: [], edges: [] });
    expect(row.projectId).toBe(projectId);
    expect(row.graphData).toEqual({ nodes: [], edges: [] });
    expect(row.currentEventSeq).toBe(0n);
    expect(row.schemaVersion).toBe(1);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects duplicate project_id", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, {});
    await expect(repo.create(projectId, {})).rejects.toThrow(/duplicate|unique/i);
  });
});

describe("SpecGraphRepo.findByProjectId", () => {
  let db: Database;
  let repo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the row for the given project", async () => {
    const projectId = uniqueProjectId();
    await repo.create(projectId, { marker: "alpha" });
    const row = await repo.findByProjectId(projectId);
    expect(row?.graphData).toEqual({ marker: "alpha" });
  });

  it("returns null when the project has no graph", async () => {
    const row = await repo.findByProjectId(uniqueProjectId());
    expect(row).toBeNull();
  });

  it("does not leak across projects (RLS)", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await repo.create(projectA, { marker: "A" });
    const seenByB = await repo.findByProjectId(projectB);
    expect(seenByB).toBeNull();
  });
});
