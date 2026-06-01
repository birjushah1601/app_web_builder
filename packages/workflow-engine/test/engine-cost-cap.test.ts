// test/engine-cost-cap.test.ts
// Plan G Task 3 — verifies costCapUsd plumbing through:
//   - StartWorkflowInput
//   - runRepo.insert
//   - buildSnapshot / getRun
//   - WorkflowRunSchema validation
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
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
