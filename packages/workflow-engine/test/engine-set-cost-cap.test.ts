// test/engine-set-cost-cap.test.ts
// Plan G.2 — WorkflowEngine.setCostCap(workflowRunId, costCapUsd?).
// Approval-time cap edit used by approveWorkflowPlan Server Action.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";
import { WorkflowNotFoundError } from "../src/errors.js";

type RunRow = {
  id: string;
  projectId: string;
  userId: string;
  prompt: string;
  status: string;
  dependencyProfile: unknown;
  costCapUsd?: number | null;
  totalCostUsd?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeRunRepo(): IWorkflowRunRepo & {
  _store: Map<string, RunRow>;
  _updateCostCapCalls: Array<[string, number | undefined]>;
} {
  const store = new Map<string, RunRow>();
  const updateCostCapCalls: Array<[string, number | undefined]> = [];
  return {
    _store: store,
    _updateCostCapCalls: updateCostCapCalls,
    async insert(input) {
      const row: RunRow = {
        id: input.id,
        projectId: input.projectId,
        userId: input.userId,
        prompt: input.prompt,
        status: input.status,
        dependencyProfile: input.dependencyProfile,
        costCapUsd: (input as { costCapUsd?: number }).costCapUsd ?? null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt
      };
      store.set(row.id, row);
      return row;
    },
    async findById(id) {
      return store.get(id);
    },
    async updateStatus(id, status) {
      const row = store.get(id);
      if (row) row.status = status;
    },
    async updateDependencyProfile(id, dp) {
      const row = store.get(id);
      if (row) row.dependencyProfile = dp;
    },
    async updateCostCap(id, costCapUsd) {
      updateCostCapCalls.push([id, costCapUsd]);
      const row = store.get(id);
      if (row) row.costCapUsd = costCapUsd ?? null;
    }
  };
}

function makeNodeRepo(): IWorkflowNodeRepo {
  return {
    async insertMany() {
      return [];
    },
    async findByRunId() {
      return [];
    },
    async findOne() {
      return undefined;
    },
    async updateStatus() {},
    async setArtifact() {},
    async updatePolicy() {},
    async updateSummary() {},
    async setDeployResult() {}
  };
}

function makeRitualEngine(): IRitualEngine {
  let counter = 0;
  return {
    async start() {
      return `r-${++counter}`;
    },
    async getRitual() {
      return {
        state: "completed",
        roleEvents: [
          {
            eventType: "workflow_planner.dag.emitted",
            payload: {
              nodes: [],
              dependencyProfile: { schemaVersion: "1" }
            }
          }
        ]
      };
    },
    async abort() {}
  };
}

describe("Plan G.2 — WorkflowEngine.setCostCap", () => {
  it("persists a positive cap via runRepo.updateCostCap", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });

    await engine.setCostCap(runId, 7.5);
    expect(runRepo._updateCostCapCalls).toEqual([[runId, 7.5]]);
    const row = await runRepo.findById(runId);
    expect(row?.costCapUsd).toBe(7.5);
  });

  it("clears the cap when given undefined", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p",
      costCapUsd: 3
    });

    await engine.setCostCap(runId, undefined);
    expect(runRepo._updateCostCapCalls).toEqual([[runId, undefined]]);
    const row = await runRepo.findById(runId);
    expect(row?.costCapUsd).toBeNull();
  });

  it("throws WorkflowNotFoundError for an unknown run", async () => {
    const engine = new WorkflowEngine({
      ritualEngine: makeRitualEngine(),
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    await expect(engine.setCostCap("no-such-run", 1)).rejects.toBeInstanceOf(
      WorkflowNotFoundError
    );
  });

  it("rejects non-positive caps", async () => {
    const engine = new WorkflowEngine({
      ritualEngine: makeRitualEngine(),
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    await expect(engine.setCostCap(runId, 0)).rejects.toThrow(/positive/);
    await expect(engine.setCostCap(runId, -1)).rejects.toThrow(/positive/);
    await expect(engine.setCostCap(runId, NaN)).rejects.toThrow(/positive/);
  });
});
