import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../../src/client.js";
import { PreferencesRepo } from "../../src/repo/preferences-repo.js";
import { SpecGraphRepo } from "../../src/repo/spec-graph.repo.js";
import { truncateAllTables } from "../helpers.js";

describe("PreferencesRepo", () => {
  let db: Database;
  let repo: PreferencesRepo;
  let graphRepo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new PreferencesRepo(db.pool);
    graphRepo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("getOverride returns null when absent, persists after upsert", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    await graphRepo.create(projectId, {});
    expect(await repo.getOverride("user_a", projectId)).toBeNull();
    await repo.upsertOverride("user_a", projectId, "diego");
    expect(await repo.getOverride("user_a", projectId)).toBe("diego");
  });

  it("upsertOverride updates an existing row", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    await graphRepo.create(projectId, {});
    await repo.upsertOverride("user_b", projectId, "ama");
    await repo.upsertOverride("user_b", projectId, "priya");
    expect(await repo.getOverride("user_b", projectId)).toBe("priya");
  });
});
