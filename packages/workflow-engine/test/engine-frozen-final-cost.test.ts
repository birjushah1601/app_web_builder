// test/engine-frozen-final-cost.test.ts
// Plan G.2 — frozen final cost on the run row.
// Verifies that:
//   1. onSchedulerExit calls runRepo.updateTotalCostUsd(runId, tracker.totalUsd())
//      BEFORE deleting the tracker from the map.
//   2. After terminal status, buildSnapshot prefers the persisted value when
//      the live tracker is gone.
//   3. Repos that don't implement updateTotalCostUsd are no-ops (legacy
//      compatibility — snapshot.totalCostUsd reverts to undefined post-cleanup,
//      same as today's behavior).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryUsageTracker } from "@atlas/llm-provider";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes. The run repo distinguishes "with updateTotalCostUsd" from
// "legacy without" so we can drive both behaviors.
// ---------------------------------------------------------------------------

type RunRow = {
  id: string;
  projectId: string;
  userId: string;
  prompt: string;
  status: string;
  dependencyProfile: unknown;
  concurrencyCap?: number | null;
  costCapUsd?: number | null;
  totalCostUsd?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type NodeRow = {
  id: string;
  workflowRunId: string;
  artifactKind: string;
  summary: string;
  dependsOn: string[];
  consumes: string[];
  policy: unknown;
  status: string;
  ritualId?: string | null;
  artifact?: unknown;
  failure?: unknown;
};

function makeRunRepo(opts?: { withFreeze?: boolean }):
  IWorkflowRunRepo & { _store: Map<string, RunRow>; _freezeCalls: Array<[string, number]> } {
  const store = new Map<string, RunRow>();
  const freezeCalls: Array<[string, number]> = [];
  const repo: IWorkflowRunRepo & {
    _store: Map<string, RunRow>;
    _freezeCalls: Array<[string, number]>;
  } = {
    _store: store,
    _freezeCalls: freezeCalls,
    async insert(input) {
      const row: RunRow = {
        id: input.id,
        projectId: input.projectId,
        userId: input.userId,
        prompt: input.prompt,
        status: input.status,
        dependencyProfile: input.dependencyProfile,
        concurrencyCap: input.concurrencyCap,
        costCapUsd: (input as { costCapUsd?: number }).costCapUsd ?? null,
        totalCostUsd: null,
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
      if (row) {
        row.status = status;
        row.updatedAt = new Date();
      }
    },
    async updateDependencyProfile(id, dependencyProfile) {
      const row = store.get(id);
      if (row) {
        row.dependencyProfile = dependencyProfile;
        row.updatedAt = new Date();
      }
    }
  };
  if (opts?.withFreeze !== false) {
    repo.updateTotalCostUsd = async (id, totalCostUsd) => {
      freezeCalls.push([id, totalCostUsd]);
      const row = store.get(id);
      if (row) {
        row.totalCostUsd = totalCostUsd;
        row.updatedAt = new Date();
      }
    };
    repo.updateCostCap = async (id, costCapUsd) => {
      const row = store.get(id);
      if (row) {
        row.costCapUsd = costCapUsd ?? null;
        row.updatedAt = new Date();
      }
    };
  }
  return repo;
}

function makeNodeRepo(): IWorkflowNodeRepo {
  const store = new Map<string, NodeRow>();
  const key = (runId: string, nodeId: string) => `${runId}:${nodeId}`;
  return {
    async insertMany(rows) {
      for (const r of rows) {
        store.set(key(r.workflowRunId, r.id), {
          id: r.id,
          workflowRunId: r.workflowRunId,
          artifactKind: r.artifactKind,
          summary: r.summary,
          dependsOn: r.dependsOn,
          consumes: r.consumes,
          policy: r.policy,
          status: r.status,
          ritualId: r.ritualId ?? null
        });
      }
      return rows.map((r) => ({ id: r.id, status: r.status }));
    },
    async findByRunId(runId) {
      return [...store.values()].filter((r) => r.workflowRunId === runId);
    },
    async findOne(runId, nodeId) {
      return store.get(key(runId, nodeId));
    },
    async updateStatus(runId, nodeId, status, opts) {
      const row = store.get(key(runId, nodeId));
      if (row) {
        row.status = status;
        if (opts?.ritualId !== undefined) row.ritualId = opts.ritualId;
        if (opts?.failure !== undefined) row.failure = opts.failure;
      }
    },
    async setArtifact(runId, nodeId, artifact) {
      const row = store.get(key(runId, nodeId));
      if (row) row.artifact = artifact;
    },
    async updatePolicy(runId, nodeId, policy) {
      const row = store.get(key(runId, nodeId));
      if (row) row.policy = policy;
    },
    async updateSummary(runId, nodeId, summary) {
      const row = store.get(key(runId, nodeId));
      if (row) row.summary = summary;
    },
    async setDeployResult() {
      /* no-op */
    }
  };
}

/**
 * Stub ritual engine. Each start() records $3.00 of usage (500K input + 100K
 * output of claude-sonnet-4-6 = $1.50 + $1.50 = $3.00). getRitual() returns
 * an empty-DAG planner snapshot so node count = 0; the test exercises only
 * the scheduler-exit path (the planner ritual records, then approval runs
 * the scheduler with zero nodes → onSchedulerExit fires immediately).
 */
function makeStubRitualEngine(): IRitualEngine {
  let counter = 0;
  return {
    async start(input) {
      (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
        "anthropic",
        "claude-sonnet-4-6",
        { inputTokens: 500_000, outputTokens: 100_000 }
      );
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

describe("Plan G.2 — frozen final cost on run row", () => {
  it("persists tracker.totalUsd() via updateTotalCostUsd in onSchedulerExit", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });

    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // Planner recorded $3.00; tracker.totalUsd() = 3.00 at exit.
    expect(runRepo._freezeCalls.length).toBe(1);
    expect(runRepo._freezeCalls[0]![0]).toBe(runId);
    expect(runRepo._freezeCalls[0]![1]).toBeCloseTo(3.0, 4);
  });

  it("snapshot.totalCostUsd reads persisted column when tracker is gone", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // Tracker has been cleaned up; the snapshot must surface the frozen
    // persisted value instead of degrading to undefined.
    const snap = await engine.getRun(runId);
    expect(snap?.totalCostUsd).toBeCloseTo(3.0, 4);
  });

  it("falls back to undefined when repo lacks updateTotalCostUsd (legacy)", async () => {
    const runRepo = makeRunRepo({ withFreeze: false });
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    expect(runRepo._freezeCalls.length).toBe(0);
    const snap = await engine.getRun(runId);
    expect(snap?.totalCostUsd).toBeUndefined();
  });

  it("normalizes a string totalCostUsd from the row (drizzle numeric returns string)", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // Simulate what drizzle does — overwrite stored number with the string
    // representation Postgres returns from numeric.
    const row = (runRepo._store.get(runId) as { totalCostUsd?: unknown });
    row.totalCostUsd = "3.0000" as unknown as number;

    const snap = await engine.getRun(runId);
    expect(snap?.totalCostUsd).toBeCloseTo(3.0, 4);
  });

  it("live tracker takes precedence over persisted value during execution", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    // Don't approvePlan — tracker is still alive after start().
    // Simulate that a stale frozen value somehow lives on the row.
    (runRepo._store.get(runId) as { totalCostUsd?: unknown }).totalCostUsd =
      999 as unknown as number;
    const snap = await engine.getRun(runId);
    // Live tracker = $3.00 (planner recorded); the 999 fallback is ignored.
    expect(snap?.totalCostUsd).toBeCloseTo(3.0, 4);
  });
});
