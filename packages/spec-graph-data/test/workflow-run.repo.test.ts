import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { WorkflowRunRepo } from "../src/repo/workflow-run.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";

const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000099";

function makeInput(projectId: string, overrides?: Record<string, unknown>) {
  return {
    projectId,
    userId: "user_test",
    prompt: "Build me a SaaS",
    status: "planning",
    dependencyProfile: { schemaVersion: "1", auth: { provider: "none" } },
    ...overrides
  } as const;
}

describe("WorkflowRunRepo.insert", () => {
  let db: Database;
  let repo: WorkflowRunRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new WorkflowRunRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the inserted row with a uuid id", async () => {
    const projectId = uniqueProjectId();
    const row = await repo.insert(makeInput(projectId));
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(row.projectId).toBe(projectId);
    expect(row.status).toBe("planning");
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });
});

describe("WorkflowRunRepo.findById", () => {
  let db: Database;
  let repo: WorkflowRunRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new WorkflowRunRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the row when it exists", async () => {
    const projectId = uniqueProjectId();
    const inserted = await repo.insert(makeInput(projectId));
    const found = await repo.findById(inserted.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    expect(found!.prompt).toBe("Build me a SaaS");
  });

  it("returns undefined when the id does not exist", async () => {
    const result = await repo.findById("00000000-0000-0000-0000-000000000000");
    expect(result).toBeUndefined();
  });
});

describe("WorkflowRunRepo.listOpenForProject", () => {
  let db: Database;
  let repo: WorkflowRunRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new WorkflowRunRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns running and awaiting_approval runs, not others", async () => {
    const projectId = uniqueProjectId();
    await repo.insert(makeInput(projectId, { status: "planning" }));
    await repo.insert(makeInput(projectId, { status: "running" }));
    await repo.insert(makeInput(projectId, { status: "awaiting_approval" }));
    await repo.insert(makeInput(projectId, { status: "done" }));

    const open = await repo.listOpenForProject(projectId);
    expect(open).toHaveLength(2);
    expect(open.map((r) => r.status).sort()).toEqual(["awaiting_approval", "running"].sort());
  });

  it("does not return runs for other projects", async () => {
    const projectA = uniqueProjectId();
    const projectB = uniqueProjectId();
    await repo.insert(makeInput(projectA, { status: "running" }));
    await repo.insert(makeInput(projectB, { status: "running" }));

    const open = await repo.listOpenForProject(projectA);
    expect(open).toHaveLength(1);
    expect(open[0]!.projectId).toBe(projectA);
  });

  it("returns empty array when no open runs", async () => {
    const projectId = uniqueProjectId();
    await repo.insert(makeInput(projectId, { status: "done" }));
    const open = await repo.listOpenForProject(projectId);
    expect(open).toEqual([]);
  });
});

describe("WorkflowRunRepo.updateStatus", () => {
  let db: Database;
  let repo: WorkflowRunRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    repo = new WorkflowRunRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("updates the status of the row", async () => {
    const projectId = uniqueProjectId();
    const inserted = await repo.insert(makeInput(projectId, { status: "planning" }));

    await repo.updateStatus(inserted.id, "running");
    const updated = await repo.findById(inserted.id);
    expect(updated!.status).toBe("running");
    expect(updated!.updatedAt).toBeInstanceOf(Date);
  });

  it("does not affect other rows", async () => {
    const projectId = uniqueProjectId();
    const a = await repo.insert(makeInput(projectId, { status: "planning" }));
    const b = await repo.insert(makeInput(projectId, { status: "planning" }));

    await repo.updateStatus(a.id, "running");
    const bAfter = await repo.findById(b.id);
    expect(bAfter!.status).toBe("planning");
  });
});
