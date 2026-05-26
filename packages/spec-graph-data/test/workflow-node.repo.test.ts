import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { WorkflowRunRepo } from "../src/repo/workflow-run.repo.js";
import { WorkflowNodeRepo } from "../src/repo/workflow-node.repo.js";
import { truncateAllTables, seedProject } from "./helpers.js";
import type { NewWorkflowNodeRow } from "../src/schema/workflow-nodes.js";

function makeRun(projectId: string) {
  return {
    projectId,
    userId: "user_test",
    prompt: "Build me a SaaS",
    status: "planning",
    dependencyProfile: { schemaVersion: "1", auth: { provider: "none" } }
  } as const;
}

function makeNode(runId: string, nodeId: string, overrides?: Partial<NewWorkflowNodeRow>): NewWorkflowNodeRow {
  return {
    id: nodeId,
    workflowRunId: runId,
    artifactKind: "spec-graph",
    summary: "Generate spec graph",
    dependsOn: [],
    consumes: [],
    policy: { approval: "auto" },
    status: "pending",
    ...overrides
  };
}

describe("WorkflowNodeRepo.insertMany", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowNodeRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowNodeRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("inserts multiple nodes and returns them all", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    const rows = await repo.insertMany([
      makeNode(run.id, "node-1"),
      makeNode(run.id, "node-2")
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["node-1", "node-2"]);
  });

  it("returns empty array when passed no rows", async () => {
    const rows = await repo.insertMany([]);
    expect(rows).toEqual([]);
  });
});

describe("WorkflowNodeRepo.findByRunId", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowNodeRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowNodeRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns all nodes for a run", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-a"), makeNode(run.id, "n-b")]);
    const found = await repo.findByRunId(run.id);
    expect(found).toHaveLength(2);
  });

  it("does not return nodes from another run", async () => {
    const projectId = await seedProject(db);
    const runA = await runRepo.insert(makeRun(projectId));
    const runB = await runRepo.insert(makeRun(projectId));
    await repo.insertMany([makeNode(runA.id, "n-1")]);
    await repo.insertMany([makeNode(runB.id, "n-2")]);
    const found = await repo.findByRunId(runA.id);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("n-1");
  });

  it("returns empty array when run has no nodes", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    const found = await repo.findByRunId(run.id);
    expect(found).toEqual([]);
  });
});

describe("WorkflowNodeRepo.findOne", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowNodeRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowNodeRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("returns the specific node", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-x"), makeNode(run.id, "n-y")]);
    const found = await repo.findOne(run.id, "n-x");
    expect(found).toBeDefined();
    expect(found!.id).toBe("n-x");
  });

  it("returns undefined for unknown node id", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    const found = await repo.findOne(run.id, "no-such-node");
    expect(found).toBeUndefined();
  });
});

describe("WorkflowNodeRepo.updateStatus", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowNodeRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowNodeRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("updates the status field", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-1")]);
    await repo.updateStatus(run.id, "n-1", "running");
    const updated = await repo.findOne(run.id, "n-1");
    expect(updated!.status).toBe("running");
  });

  it("sets optional fields when opts provided", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-1")]);
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const completedAt = new Date("2026-01-01T01:00:00Z");
    await repo.updateStatus(run.id, "n-1", "done", {
      ritualId: "ritual-abc",
      startedAt,
      completedAt,
      failure: null
    });
    const updated = await repo.findOne(run.id, "n-1");
    expect(updated!.status).toBe("done");
    expect(updated!.ritualId).toBe("ritual-abc");
    expect(updated!.startedAt).toBeInstanceOf(Date);
    expect(updated!.completedAt).toBeInstanceOf(Date);
  });

  it("sets failure when provided", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-1")]);
    const failure = { code: "TIMEOUT", message: "Timed out" };
    await repo.updateStatus(run.id, "n-1", "failed", { failure });
    const updated = await repo.findOne(run.id, "n-1");
    expect(updated!.status).toBe("failed");
    expect(updated!.failure).toEqual(failure);
  });

  it("does not affect sibling nodes", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-1"), makeNode(run.id, "n-2")]);
    await repo.updateStatus(run.id, "n-1", "running");
    const n2 = await repo.findOne(run.id, "n-2");
    expect(n2!.status).toBe("pending");
  });
});

describe("WorkflowNodeRepo.setArtifact", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowNodeRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowNodeRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("writes artifact and schemaVersion to the node", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-1")]);
    const artifact = { schemaVersion: "1", kind: "spec-graph", payload: { nodes: [] } };
    await repo.setArtifact(run.id, "n-1", artifact, "1");
    const updated = await repo.findOne(run.id, "n-1");
    expect(updated!.artifact).toEqual(artifact);
    expect(updated!.artifactSchemaVersion).toBe("1");
  });
});

describe("WorkflowNodeRepo.updatePolicy", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowNodeRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowNodeRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("updates the policy JSONB field", async () => {
    const run = await runRepo.insert(makeRun(await seedProject(db)));
    await repo.insertMany([makeNode(run.id, "n-1")]);
    const newPolicy = { approval: "required", reviewer: "human" };
    await repo.updatePolicy(run.id, "n-1", newPolicy);
    const updated = await repo.findOne(run.id, "n-1");
    expect(updated!.policy).toEqual(newPolicy);
  });
});
