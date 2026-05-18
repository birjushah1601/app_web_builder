import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../../src/client.js";
import { SandboxSpendRepo } from "../../src/repo/sandbox-spend-repo.js";
import { SpecGraphRepo } from "../../src/repo/spec-graph.repo.js";
import { truncateAllTables } from "../helpers.js";

describe("SandboxSpendRepo", () => {
  let db: Database;
  let repo: SandboxSpendRepo;
  let graphRepo: SpecGraphRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new SandboxSpendRepo(db.pool);
    graphRepo = new SpecGraphRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("getAccumulatedSpend returns 0 for a project with no rows", async () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await graphRepo.create(projectId, {});
    expect(await repo.getAccumulatedSpend(projectId)).toBe(0);
    expect(await repo.getRollingAverageSpend(projectId)).toBe(0);
  });

  it("record() then getAccumulatedSpend sums current month", async () => {
    const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await graphRepo.create(projectId, {});
    await repo.record({ projectId, sandboxId: "sb_1", usdAmount: 1.25 });
    await repo.record({ projectId, sandboxId: "sb_2", usdAmount: 3.5 });
    const total = await repo.getAccumulatedSpend(projectId);
    expect(total).toBeCloseTo(4.75, 2);
  });

  it("getAccumulatedSpend excludes rows from previous months", async () => {
    const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await graphRepo.create(projectId, {});
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    lastMonth.setUTCDate(5);
    await repo.record({ projectId, sandboxId: "old", usdAmount: 10, occurredAt: lastMonth });
    await repo.record({ projectId, sandboxId: "new", usdAmount: 2 });
    const total = await repo.getAccumulatedSpend(projectId);
    expect(total).toBeCloseTo(2, 2);
  });

  it("getRollingAverageSpend sums last 30 days only", async () => {
    const projectId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await graphRepo.create(projectId, {});
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 45);
    await repo.record({ projectId, sandboxId: "ancient", usdAmount: 100, occurredAt: old });
    await repo.record({ projectId, sandboxId: "recent", usdAmount: 7.25 });
    const total = await repo.getRollingAverageSpend(projectId);
    expect(total).toBeCloseTo(7.25, 2);
  });

  it("record() is isolated per project", async () => {
    const projectA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const projectB = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await graphRepo.create(projectA, {});
    await graphRepo.create(projectB, {});
    await repo.record({ projectId: projectA, sandboxId: "a1", usdAmount: 5 });
    await repo.record({ projectId: projectB, sandboxId: "b1", usdAmount: 9 });
    expect(await repo.getAccumulatedSpend(projectA)).toBeCloseTo(5, 2);
    expect(await repo.getAccumulatedSpend(projectB)).toBeCloseTo(9, 2);
  });
});
