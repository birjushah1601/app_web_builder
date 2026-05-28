// test/engine-launch-ritual.test.ts
// Plan D Task 8.5 — verifies that makeLaunchRitual:
//   1. Calls ritualEngine.start (not a stub)
//   2. Passes node.summary as userTurn
//   3. Builds priorArtifact.upstream from node.consumes by looking up each
//      upstream node's persisted artifact
//   4. Passes the run's dependencyProfile through
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/backend-rest-api.js"; // register backend-rest-api kind
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// Local fakes mirroring engine.test.ts patterns
// ---------------------------------------------------------------------------

type RunRow = {
  id: string;
  projectId: string;
  userId: string;
  prompt: string;
  status: string;
  dependencyProfile: unknown;
  concurrencyCap?: number | null;
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
 * A ritual engine that:
 *  - emits a two-node DAG (a → b, b consumes a) from the planner ritual
 *  - emits a backend-rest-api artifact for node "a"
 *  - records every start() call so the test can assert on node-ritual launch
 */
function makeRecordingRitualEngine() {
  const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
  const snapshots = new Map<string, { state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }>();
  let counter = 0;

  const NODE_A_ARTIFACT = {
    schemaVersion: "1",
    kind: "backend-rest-api",
    openApiSpec: { openapi: "3.1.0", paths: {} },
    routes: [],
    envContract: [],
    sandboxId: "sb-a"
  };

  const DAG_NODES = [
    {
      id: "a",
      artifactKind: "backend-rest-api",
      summary: "Build API A",
      dependsOn: [],
      consumes: [],
      policy: { priority: 0, runMode: "active" }
    },
    {
      id: "b",
      artifactKind: "backend-rest-api",
      summary: "Build API B that consumes A",
      dependsOn: ["a"],
      consumes: ["a"],
      policy: { priority: 0, runMode: "active" }
    }
  ];

  const ritualEngine: IRitualEngine = {
    async start(input) {
      const ritualId = `ritual-${++counter}`;
      startCalls.push({ ritualId, input });

      // First call = planner. Subsequent calls = node rituals.
      if (counter === 1) {
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            {
              eventType: "workflow_planner.dag.emitted",
              payload: {
                nodes: DAG_NODES,
                dependencyProfile: { schemaVersion: "1" }
              }
            }
          ]
        });
      } else if (input.userTurn === "Build API A") {
        // Node A: emit its artifact so node B's launch can pick it up.
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            {
              eventType: "ritual.artifact_emitted",
              payload: { fromRole: "backend-artifact", artifact: NODE_A_ARTIFACT }
            }
          ]
        });
      } else {
        // Node B (or anything else): empty completed snapshot → generic fallback.
        snapshots.set(ritualId, { state: "completed", roleEvents: [] });
      }
      return ritualId;
    },
    async getRitual(ritualId) {
      return snapshots.get(ritualId) ?? { state: "completed", roleEvents: [] };
    },
    async abort() {}
  };

  return { ritualEngine, startCalls, NODE_A_ARTIFACT };
}

describe("Plan D Task 8.5 — makeLaunchRitual (real)", () => {
  it("calls ritualEngine.start for each node ritual with priorArtifact.upstream populated from node.consumes", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls, NODE_A_ARTIFACT } = makeRecordingRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start({
      projectId: "00000000-0000-0000-0000-000000000001",
      userId: "user-1",
      prompt: "Build a backend with two APIs"
    });

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // First call = planner; subsequent calls = node rituals.
    expect(startCalls.length).toBeGreaterThanOrEqual(3);

    const nodeACall = startCalls.find((c) => c.input.userTurn === "Build API A");
    const nodeBCall = startCalls.find((c) => c.input.userTurn === "Build API B that consumes A");

    // Node A has no consumes → upstream should be {}
    expect(nodeACall).toBeDefined();
    const nodeAPrior = nodeACall!.input.priorArtifact as { upstream: Record<string, unknown>; dependencyProfile: unknown };
    expect(nodeAPrior).toBeDefined();
    expect(nodeAPrior.upstream).toEqual({});
    expect(nodeAPrior.dependencyProfile).toEqual({ schemaVersion: "1" });

    // Node B consumes A → upstream.a should equal A's persisted artifact
    expect(nodeBCall).toBeDefined();
    const nodeBPrior = nodeBCall!.input.priorArtifact as { upstream: Record<string, unknown>; dependencyProfile: unknown };
    expect(nodeBPrior).toBeDefined();
    expect(nodeBPrior.upstream).toHaveProperty("a");
    expect(nodeBPrior.upstream.a).toEqual(NODE_A_ARTIFACT);
    expect(nodeBPrior.dependencyProfile).toEqual({ schemaVersion: "1" });

    // The ritualId persisted onto node B should be the real one returned by ritualEngine.start,
    // not a stub-ritual-* fake.
    const persistedB = await nodeRepo.findOne(runId, "b");
    expect(persistedB?.ritualId).toBe(nodeBCall!.ritualId);
    expect(persistedB?.ritualId).not.toMatch(/^stub-ritual-/);
  });

  it("passes editClass='structural', projectId, and userId from the run", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls } = makeRecordingRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const projectId = "00000000-0000-0000-0000-000000000001";
    const userId = "user-7";
    const runId = await engine.start({ projectId, userId, prompt: "go" });
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // Inspect node-ritual launch calls (everything past the first/planner call).
    const nodeRitualCalls = startCalls.slice(1);
    expect(nodeRitualCalls.length).toBeGreaterThan(0);
    for (const call of nodeRitualCalls) {
      expect(call.input.editClass).toBe("structural");
      expect(call.input.projectId).toBe(projectId);
      expect(call.input.userId).toBe(userId);
    }
  });
});
