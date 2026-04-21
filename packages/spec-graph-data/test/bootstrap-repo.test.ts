import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { BootstrapRepo } from "../src/repo/bootstrap-repo.js";
import { SpecGraphRepo } from "../src/repo/spec-graph.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

describe("BootstrapRepo", () => {
  let db: Database;
  let repo: BootstrapRepo;
  let specGraphRepo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new BootstrapRepo(db.pool);
    specGraphRepo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("hasPassed false initially, true after markPassed", async () => {
    const projectId = uniqueProjectId();
    // Insert a parent spec_graph row for FK (use SpecGraphRepo to respect RLS)
    await specGraphRepo.create(projectId, {});
    expect(await repo.hasPassed(projectId)).toBe(false);
    await repo.markPassed(projectId, { ts: "2026-04-20T00:00:00Z", ritualId: "r-1" });
    expect(await repo.hasPassed(projectId)).toBe(true);
    const r = await repo.getRecord(projectId);
    expect(r?.ritualId).toBe("r-1");
  });
});
