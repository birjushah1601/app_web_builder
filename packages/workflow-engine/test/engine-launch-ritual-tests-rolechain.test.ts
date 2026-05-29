// test/engine-launch-ritual-tests-rolechain.test.ts
// Plan E Task 5 — verifies that makeLaunchRitual passes
// `roleChain: ["tester"]` to ritualEngine.start when the node's
// artifactKind === "tests". Non-tests nodes do NOT receive roleChain.
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/tests.js"; // register tests kind
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// Minimal in-memory repos (same shape as engine-launch-ritual.test.ts)
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
    async findById(id) { return store.get(id); },
    async updateStatus(id, status) {
      const row = store.get(id);
      if (row) { row.status = status; row.updatedAt = new Date(); }
    },
    async updateDependencyProfile(id, dependencyProfile) {
      const row = store.get(id);
      if (row) { row.dependencyProfile = dependencyProfile; row.updatedAt = new Date(); }
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
        store.set(key(r.workflowRunId, r.id), {
          id: r.id, workflowRunId: r.workflowRunId, artifactKind: r.artifactKind,
          summary: r.summary, dependsOn: r.dependsOn, consumes: r.consumes,
          policy: r.policy, status: r.status, ritualId: r.ritualId ?? null
        });
      }
      return rows.map((r) => ({ id: r.id, status: r.status }));
    },
    async findByRunId(runId) {
      return [...store.values()].filter((r) => r.workflowRunId === runId);
    },
    async findOne(runId, nodeId) { return store.get(key(runId, nodeId)); },
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
 * Planner emits a two-node DAG: a frontend-app node + a tests node
 * that consumes it. We then record every ritualEngine.start call so the
 * test can assert roleChain is passed only on the tests node.
 */
function makeRecordingRitualEngine() {
  const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
  const snapshots = new Map<string, { state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }>();
  let counter = 0;

  const FRONTEND_ARTIFACT = {
    schemaVersion: "1",
    kind: "frontend-app",
    pages: [{ route: "/", file: "app/page.tsx" }],
    designTokens: {},
    references: []
  };

  const DAG_NODES = [
    {
      id: "frontend",
      artifactKind: "frontend-app",
      summary: "Build a frontend",
      dependsOn: [],
      consumes: [],
      policy: { priority: 0, runMode: "active" }
    },
    {
      id: "tests",
      artifactKind: "tests",
      summary: "Generate tests",
      dependsOn: ["frontend"],
      consumes: ["frontend"],
      policy: { priority: 0, runMode: "active" }
    }
  ];

  const ritualEngine: IRitualEngine = {
    async start(input) {
      const ritualId = `ritual-${++counter}`;
      startCalls.push({ ritualId, input });
      if (counter === 1) {
        // planner
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            {
              eventType: "workflow_planner.dag.emitted",
              payload: { nodes: DAG_NODES, dependencyProfile: { schemaVersion: "1" } }
            }
          ]
        });
      } else if (input.userTurn === "Build a frontend") {
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            { eventType: "ritual.artifact_emitted", payload: { fromRole: "developer", artifact: FRONTEND_ARTIFACT } }
          ]
        });
      } else {
        snapshots.set(ritualId, { state: "completed", roleEvents: [] });
      }
      return ritualId;
    },
    async getRitual(ritualId) {
      return snapshots.get(ritualId) ?? { state: "completed", roleEvents: [] };
    },
    async abort() {}
  };

  return { ritualEngine, startCalls };
}

describe("Plan E Task 5 — makeLaunchRitual passes roleChain for tests artifactKind", () => {
  it("sets roleChain=['tester'] for tests nodes and omits it for non-tests nodes", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls } = makeRecordingRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start({
      projectId: "00000000-0000-0000-0000-000000000001",
      userId: "user-1",
      prompt: "build + test"
    });

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const frontendCall = startCalls.find((c) => c.input.userTurn === "Build a frontend");
    const testsCall = startCalls.find((c) => c.input.userTurn === "Generate tests");

    expect(frontendCall).toBeDefined();
    expect(testsCall).toBeDefined();

    // The frontend node — a normal artifactKind — does NOT receive roleChain.
    expect(frontendCall!.input.roleChain).toBeUndefined();

    // The tests node DOES receive roleChain=["tester"].
    expect(testsCall!.input.roleChain).toEqual(["tester"]);

    // priorArtifact still flows for both — roleChain doesn't replace it.
    const testsPrior = testsCall!.input.priorArtifact as { upstream: Record<string, unknown> };
    expect(testsPrior.upstream).toHaveProperty("frontend");
  });
});
