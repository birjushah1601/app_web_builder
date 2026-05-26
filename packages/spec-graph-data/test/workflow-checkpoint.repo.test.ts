import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { WorkflowRunRepo } from "../src/repo/workflow-run.repo.js";
import { WorkflowCheckpointRepo } from "../src/repo/workflow-checkpoint.repo.js";
import { truncateAllTables, seedProject } from "./helpers.js";
import type { NewWorkflowCheckpointRow } from "../src/schema/workflow-node-checkpoints.js";

function makeRun(projectId: string) {
  return {
    projectId,
    userId: "user_test",
    prompt: "Build me a SaaS",
    status: "running",
    dependencyProfile: { schemaVersion: "1", auth: { provider: "none" } }
  } as const;
}

function makeCheckpoint(
  runId: string,
  nodeId: string,
  overrides?: Partial<NewWorkflowCheckpointRow>
): NewWorkflowCheckpointRow {
  return {
    workflowRunId: runId,
    nodeId,
    kind: "progress",
    payload: { step: 1 },
    ...overrides
  };
}

describe("WorkflowCheckpointRepo.append", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowCheckpointRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowCheckpointRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("inserts a checkpoint and returns it with a uuid id", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    const cp = await repo.append(makeCheckpoint(run.id, "n-1"));
    expect(cp.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(cp.workflowRunId).toBe(run.id);
    expect(cp.nodeId).toBe("n-1");
    expect(cp.kind).toBe("progress");
    expect(cp.createdAt).toBeInstanceOf(Date);
  });
});

describe("WorkflowCheckpointRepo.listForNode", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowCheckpointRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowCheckpointRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns checkpoints for a specific node in chronological order", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.append(makeCheckpoint(run.id, "n-1", { kind: "started", payload: { step: 1 } }));
    await repo.append(makeCheckpoint(run.id, "n-1", { kind: "progress", payload: { step: 2 } }));
    await repo.append(makeCheckpoint(run.id, "n-1", { kind: "done", payload: { step: 3 } }));

    const list = await repo.listForNode(run.id, "n-1");
    expect(list).toHaveLength(3);
    expect(list.map((c) => c.kind)).toEqual(["started", "progress", "done"]);
  });

  it("does not include checkpoints from other nodes", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.append(makeCheckpoint(run.id, "n-1"));
    await repo.append(makeCheckpoint(run.id, "n-2"));

    const list = await repo.listForNode(run.id, "n-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.nodeId).toBe("n-1");
  });

  it("returns empty array when node has no checkpoints", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    const list = await repo.listForNode(run.id, "n-none");
    expect(list).toEqual([]);
  });
});

describe("WorkflowCheckpointRepo.listForRun", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowCheckpointRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowCheckpointRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns all checkpoints across all nodes for a run", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.append(makeCheckpoint(run.id, "n-1", { kind: "started", payload: {} }));
    await repo.append(makeCheckpoint(run.id, "n-2", { kind: "started", payload: {} }));
    await repo.append(makeCheckpoint(run.id, "n-1", { kind: "done", payload: {} }));

    const list = await repo.listForRun(run.id);
    expect(list).toHaveLength(3);
  });

  it("does not return checkpoints from another run", async () => {
    const projectId = await seedProject(db);
    const runA = await runRepo.insert(makeRun(projectId));
    const runB = await runRepo.insert(makeRun(projectId));
    await repo.append(makeCheckpoint(runA.id, "n-1"));
    await repo.append(makeCheckpoint(runB.id, "n-1"));

    const list = await repo.listForRun(runA.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.workflowRunId).toBe(runA.id);
  });

  it("returns empty array when run has no checkpoints", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    const list = await repo.listForRun(run.id);
    expect(list).toEqual([]);
  });
});
