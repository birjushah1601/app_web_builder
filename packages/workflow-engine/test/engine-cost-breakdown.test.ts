// test/engine-cost-breakdown.test.ts
// Plan G.3 — per-role cost breakdown surfaced on the run snapshot.
// Verifies that:
//   1. onSchedulerExit calls runRepo.updateCostBreakdown(runId, tracker.breakdown())
//      BEFORE deleting the tracker from the map.
//   2. After terminal status, buildSnapshot prefers the persisted column
//      when the live tracker is gone.
//   3. The live tracker takes precedence during execution.
//   4. Repos that don't implement updateCostBreakdown are no-ops (legacy
//      compatibility — snapshot.costBreakdown reverts to undefined post-cleanup).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryUsageTracker } from "@atlas/llm-provider";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

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
  costBreakdown?: unknown;
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

function makeRunRepo(opts?: { withBreakdownFreeze?: boolean }):
  IWorkflowRunRepo & {
    _store: Map<string, RunRow>;
    _breakdownCalls: Array<[string, unknown]>;
  } {
  const store = new Map<string, RunRow>();
  const breakdownCalls: Array<[string, unknown]> = [];
  const repo: IWorkflowRunRepo & {
    _store: Map<string, RunRow>;
    _breakdownCalls: Array<[string, unknown]>;
  } = {
    _store: store,
    _breakdownCalls: breakdownCalls,
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
        costBreakdown: null,
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
    },
    // Always wire updateTotalCostUsd so the G.2 path runs cleanly.
    async updateTotalCostUsd(id, totalCostUsd) {
      const row = store.get(id);
      if (row) {
        row.totalCostUsd = totalCostUsd;
        row.updatedAt = new Date();
      }
    }
  };
  if (opts?.withBreakdownFreeze !== false) {
    repo.updateCostBreakdown = async (id, breakdown) => {
      breakdownCalls.push([id, breakdown]);
      const row = store.get(id);
      if (row) {
        row.costBreakdown = breakdown;
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
 * Stub ritual engine. Records two distinct roles' usage on the planner ritual
 * so breakdown() has multiple buckets to surface.
 */
function makeStubRitualEngine(): IRitualEngine {
  let counter = 0;
  return {
    async start(input) {
      const tracker = input.usageTracker as InMemoryUsageTracker | undefined;
      // architect: 1M input sonnet = $3.00
      tracker?.record(
        "anthropic",
        "claude-sonnet-4-6",
        { inputTokens: 1_000_000, outputTokens: 0 },
        { roleId: "architect" }
      );
      // developer: 1M output sonnet = $15.00
      tracker?.record(
        "anthropic",
        "claude-sonnet-4-6",
        { inputTokens: 0, outputTokens: 1_000_000 },
        { roleId: "developer" }
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

describe("Plan G.3 — per-role cost breakdown on run row", () => {
  it("persists tracker.breakdown() via updateCostBreakdown in onSchedulerExit", async () => {
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

    expect(runRepo._breakdownCalls.length).toBe(1);
    expect(runRepo._breakdownCalls[0]![0]).toBe(runId);
    const breakdown = runRepo._breakdownCalls[0]![1] as Array<{
      roleId: string;
      totalUsd: number;
      callCount: number;
    }>;
    expect(breakdown.map((e) => e.roleId)).toEqual(["developer", "architect"]);
    expect(breakdown[0]!.totalUsd).toBeCloseTo(15.0, 4);
    expect(breakdown[0]!.callCount).toBe(1);
    expect(breakdown[1]!.totalUsd).toBeCloseTo(3.0, 4);
    expect(breakdown[1]!.callCount).toBe(1);
  });

  it("snapshot.costBreakdown reads persisted column when tracker is gone", async () => {
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

    const snap = await engine.getRun(runId);
    expect(snap?.costBreakdown).toBeDefined();
    expect(snap!.costBreakdown!.map((e) => e.roleId)).toEqual([
      "developer",
      "architect"
    ]);
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
    // Simulate a stale frozen value somehow lives on the row.
    (runRepo._store.get(runId) as { costBreakdown?: unknown }).costBreakdown = [
      { roleId: "stale", totalUsd: 999, callCount: 999 }
    ];

    const snap = await engine.getRun(runId);
    // Live tracker = architect + developer; the stale row is ignored.
    expect(snap?.costBreakdown).toBeDefined();
    expect(snap!.costBreakdown!.map((e) => e.roleId)).toEqual([
      "developer",
      "architect"
    ]);
  });

  it("legacy repo without updateCostBreakdown → snapshot has no breakdown", async () => {
    const runRepo = makeRunRepo({ withBreakdownFreeze: false });
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

    expect(runRepo._breakdownCalls.length).toBe(0);
    const snap = await engine.getRun(runId);
    expect(snap?.costBreakdown).toBeUndefined();
  });

  it("snapshot omits costBreakdown when the row holds null + no tracker", async () => {
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
    // Drop the tracker to simulate post-cleanup, then null out the row so
    // it looks like a legacy row that never ran the freeze path.
    // Directly access the private map via the test-only helper:
    // (engine._waitForScheduler doesn't run because we never approved).
    // Easier: just await scheduler then clobber the row's costBreakdown.
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    (runRepo._store.get(runId) as { costBreakdown?: unknown }).costBreakdown = null;
    const snap = await engine.getRun(runId);
    expect(snap?.costBreakdown).toBeUndefined();
  });
});
