import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Database, createDatabase } from "../src/client.js";
import { WorkflowRunRepo } from "../src/repo/workflow-run.repo.js";
import { WorkflowUsageRepo } from "../src/repo/workflow-usage.repo.js";
import { truncateAllTables, uniqueProjectId } from "./helpers.js";
import type { NewWorkflowUsageRow } from "../src/schema/workflow-usage.js";

function makeRun(projectId: string) {
  return {
    projectId,
    userId: "user_test",
    prompt: "Build me a SaaS",
    status: "running",
    dependencyProfile: { schemaVersion: "1", auth: { provider: "none" } }
  } as const;
}

function makeUsage(
  runId: string,
  nodeId: string,
  overrides?: Partial<NewWorkflowUsageRow>
): NewWorkflowUsageRow {
  return {
    workflowRunId: runId,
    nodeId,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 100,
    outputTokens: 50,
    costUsd: "0.0015",
    ...overrides
  };
}

describe("WorkflowUsageRepo.append", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowUsageRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowUsageRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("inserts a usage event and returns it", async () => {
    const run = await runRepo.insert(makeRun(uniqueProjectId()));
    const row = await repo.append(makeUsage(run.id, "n-1"));
    expect(row.workflowRunId).toBe(run.id);
    expect(row.nodeId).toBe("n-1");
    expect(row.provider).toBe("anthropic");
    expect(row.inputTokens).toBe(100);
    expect(row.outputTokens).toBe(50);
    expect(row.recordedAt).toBeInstanceOf(Date);
  });
});

describe("WorkflowUsageRepo.sumForRun", () => {
  let db: Database;
  let runRepo: WorkflowRunRepo;
  let repo: WorkflowUsageRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    runRepo = new WorkflowRunRepo(db.pool);
    repo = new WorkflowUsageRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  afterAll(async () => {
    await db.pool.end();
  });

  it("sums tokens and cost across multiple events", async () => {
    const run = await runRepo.insert(makeRun(uniqueProjectId()));
    await repo.append(makeUsage(run.id, "n-1", { inputTokens: 100, outputTokens: 50, costUsd: "0.0010" }));
    await repo.append(makeUsage(run.id, "n-1", { inputTokens: 200, outputTokens: 75, costUsd: "0.0020" }));
    await repo.append(makeUsage(run.id, "n-2", { inputTokens: 50, outputTokens: 25, costUsd: "0.0005" }));

    const sum = await repo.sumForRun(run.id);
    expect(sum.inputTokens).toBe(350);
    expect(sum.outputTokens).toBe(150);
    expect(sum.costUsd).toBeCloseTo(0.0035, 6);
  });

  it("returns zeros when no events exist for the run", async () => {
    const run = await runRepo.insert(makeRun(uniqueProjectId()));
    const sum = await repo.sumForRun(run.id);
    expect(sum.inputTokens).toBe(0);
    expect(sum.outputTokens).toBe(0);
    expect(sum.costUsd).toBe(0);
  });

  it("does not include events from another run", async () => {
    const projectId = uniqueProjectId();
    const runA = await runRepo.insert(makeRun(projectId));
    const runB = await runRepo.insert(makeRun(projectId));
    await repo.append(makeUsage(runA.id, "n-1", { inputTokens: 1000, outputTokens: 500, costUsd: "0.1000" }));
    await repo.append(makeUsage(runB.id, "n-1", { inputTokens: 9999, outputTokens: 9999, costUsd: "9.9999" }));

    const sum = await repo.sumForRun(runA.id);
    expect(sum.inputTokens).toBe(1000);
    expect(sum.outputTokens).toBe(500);
    expect(sum.costUsd).toBeCloseTo(0.1, 4);
  });

  it("returns numbers (not strings) for all fields", async () => {
    const run = await runRepo.insert(makeRun(uniqueProjectId()));
    await repo.append(makeUsage(run.id, "n-1"));
    const sum = await repo.sumForRun(run.id);
    expect(typeof sum.inputTokens).toBe("number");
    expect(typeof sum.outputTokens).toBe("number");
    expect(typeof sum.costUsd).toBe("number");
  });
});
