// test/engine-cost-cap.test.ts
// Plan G Task 3 — verifies costCapUsd plumbing through:
//   - StartWorkflowInput
//   - runRepo.insert
//   - buildSnapshot / getRun
//   - WorkflowRunSchema validation
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
// Local fakes mirroring engine-launch-ritual.test.ts patterns, extended with
// costCapUsd on the stored run row + insert input.
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

function makeRunRepo(): IWorkflowRunRepo & { _store: Map<string, RunRow> } {
  const store = new Map<string, RunRow>();
  return {
    _store: store,
    async insert(input) {
      const row: RunRow = {
        id: input.id,
        projectId: input.projectId,
        userId: input.userId,
        prompt: input.prompt,
        status: input.status,
        dependencyProfile: input.dependencyProfile,
        concurrencyCap: input.concurrencyCap,
        costCapUsd:
          (input as { costCapUsd?: number }).costCapUsd ?? null,
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
}

function makeNodeRepo(): IWorkflowNodeRepo & { _store: Map<string, NodeRow> } {
  const store = new Map<string, NodeRow>();
  const key = (runId: string, nodeId: string) => `${runId}:${nodeId}`;
  return {
    _store: store,
    async insertMany(rows) {
      for (const r of rows) {
        const nodeRow: NodeRow = {
          id: r.id,
          workflowRunId: r.workflowRunId,
          artifactKind: r.artifactKind,
          summary: r.summary,
          dependsOn: r.dependsOn,
          consumes: r.consumes,
          policy: r.policy,
          status: r.status,
          ritualId: r.ritualId ?? null
        };
        store.set(key(r.workflowRunId, r.id), nodeRow);
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
    }
  };
}

/**
 * Stub ritual engine — every start() returns a unique ritualId; getRitual()
 * returns a completed snapshot with an empty DAG so engine.start() succeeds
 * without producing any node rows.
 */
function makeStubRitualEngine(): IRitualEngine {
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

describe("Plan G — costCapUsd plumbing", () => {
  it("persists costCapUsd to the run row when set on StartWorkflowInput", async () => {
    const runRepo = makeRunRepo();
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo,
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Build it",
      costCapUsd: 5.0
    });
    const row = await runRepo.findById(runId);
    expect(row).toBeDefined();
    // The fake repo stores it as a number; the real one stores string.
    expect((row as { costCapUsd?: unknown }).costCapUsd).toBe(5.0);
  });

  it("snapshot.costCapUsd reflects the persisted value", async () => {
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Build it",
      costCapUsd: 5.0
    });
    const snap = await engine.getRun(runId);
    expect(snap?.costCapUsd).toBe(5.0);
  });

  it("snapshot.costCapUsd is undefined when no cap was set", async () => {
    const engine = new WorkflowEngine({
      ritualEngine: makeStubRitualEngine(),
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "no cap"
    });
    const snap = await engine.getRun(runId);
    expect(snap?.costCapUsd).toBeUndefined();
  });

  it("WorkflowRunSchema rejects a non-positive costCapUsd", async () => {
    const { WorkflowRunSchema } = await import("../src/types.js");
    const r = WorkflowRunSchema.safeParse({
      id: randomUUID(),
      projectId: randomUUID(),
      userId: "u",
      prompt: "p",
      status: "running",
      nodes: [],
      edges: [],
      dependencyProfile: { schemaVersion: "1" },
      costCapUsd: -1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    expect(r.success).toBe(false);
  });
});

describe("Plan G — per-run usage tracker plumbing", () => {
  it("passes a usageTracker to ritualEngine.start for each node ritual", async () => {
    const startCalls: Array<{ ritualId: string; input: any }> = [];
    let counter = 0;
    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        startCalls.push({ ritualId, input });
        return ritualId;
      },
      async getRitual() {
        return {
          state: "completed",
          roleEvents: [
            {
              eventType: "workflow_planner.dag.emitted",
              payload: {
                nodes: [
                  {
                    id: "n1",
                    artifactKind: "backend-rest-api",
                    summary: "build the API",
                    dependsOn: [],
                    consumes: [],
                    policy: { priority: 0, runMode: "active" }
                  }
                ],
                dependencyProfile: { schemaVersion: "1" }
              }
            }
          ]
        };
      },
      async abort() {}
    };
    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Build the API",
      costCapUsd: 5.00
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // At least one ritualEngine.start was called — the node ritual.
    // Its input.usageTracker should be a defined object with a record() method.
    const nodeStart = startCalls.find(
      (c) => c.input.userTurn !== undefined && c.input.userTurn !== ""
    );
    expect(nodeStart).toBeDefined();
    const tracker = nodeStart!.input.usageTracker;
    expect(tracker).toBeDefined();
    expect(typeof tracker.record).toBe("function");
    expect(typeof tracker.totalUsd).toBe("function");
  });

  it("uses the SAME tracker across all node rituals of one workflow run", async () => {
    const startCalls: Array<{ ritualId: string; input: any }> = [];
    let counter = 0;
    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        startCalls.push({ ritualId, input });
        // Simulate a role recording $0.01 of usage per ritual.
        (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
          "anthropic",
          "claude-sonnet-4-6",
          { inputTokens: 3333, outputTokens: 0 } // 3333 * $3 / 1M ≈ $0.01
        );
        return ritualId;
      },
      async getRitual() {
        return {
          state: "completed",
          roleEvents: [
            {
              eventType: "workflow_planner.dag.emitted",
              payload: {
                nodes: [
                  {
                    id: "n1",
                    artifactKind: "backend-rest-api",
                    summary: "build it 1",
                    dependsOn: [],
                    consumes: [],
                    policy: { priority: 0, runMode: "active" }
                  },
                  {
                    id: "n2",
                    artifactKind: "backend-rest-api",
                    summary: "build it 2",
                    dependsOn: [],
                    consumes: [],
                    policy: { priority: 0, runMode: "active" }
                  }
                ],
                dependencyProfile: { schemaVersion: "1" }
              }
            }
          ]
        };
      },
      async abort() {}
    };
    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Build it"
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // The tracker is the SAME instance across calls (so subsequent calls
    // see accumulated cost).
    const nodeStarts = startCalls.filter(
      (c) => c.input.userTurn !== "" && c.input.userTurn !== undefined
    );
    if (nodeStarts.length > 1) {
      const firstTracker = nodeStarts[0]!.input.usageTracker;
      for (const call of nodeStarts.slice(1)) {
        expect(call.input.usageTracker).toBe(firstTracker);
      }
    }
    // Total accumulated cost > 0 after recording usage.
    if (nodeStarts.length > 0) {
      const tracker = nodeStarts[0]!.input.usageTracker as InMemoryUsageTracker;
      expect(tracker.totalUsd()).toBeGreaterThan(0);
    }
  });
});

describe("Plan G — snapshot.totalCostUsd", () => {
  it("returns tracker.totalUsd() on the snapshot", async () => {
    const ritualEngine: IRitualEngine = {
      async start(input) {
        // Record some usage via the injected tracker
        (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
          "anthropic", "claude-sonnet-4-6",
          { inputTokens: 500_000, outputTokens: 100_000 }
        );
        // 500K * $3 / 1M + 100K * $15 / 1M = $1.50 + $1.50 = $3.00
        return "r-1";
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
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Test"
    });

    // Before approvePlan() triggers terminal status + tracker cleanup,
    // the snapshot should surface the tracker's accumulated cost (set
    // by the planner ritual's start() above).
    const snap = await engine.getRun(runId);
    expect(snap?.totalCostUsd).toBeCloseTo(3.00, 4);
  });

  it("totalCostUsd is 0 when no usage has been recorded", async () => {
    const ritualEngine: IRitualEngine = {
      async start() { return "r-1"; },
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
    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    const snap = await engine.getRun(runId);
    // Tracker exists but no usage recorded yet → totalUsd() === 0
    expect(snap?.totalCostUsd).toBe(0);
  });

  it("totalCostUsd is undefined after the tracker is cleaned up (terminal status)", async () => {
    const ritualEngine: IRitualEngine = {
      async start(input) {
        (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
          "anthropic", "claude-sonnet-4-6",
          { inputTokens: 500_000, outputTokens: 100_000 }
        );
        return "r-1";
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
    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo: makeRunRepo(),
      nodeRepo: makeNodeRepo()
    });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "p"
    });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);
    // After terminal status, onSchedulerExit cleared the tracker.
    // v1 acceptable behavior (chosen here): snapshot.totalCostUsd is
    // undefined after cleanup. A future iteration may freeze the final
    // cost onto the run row via a new schema column.
    const snap = await engine.getRun(runId);
    expect(snap?.totalCostUsd).toBeUndefined();
  });
});
