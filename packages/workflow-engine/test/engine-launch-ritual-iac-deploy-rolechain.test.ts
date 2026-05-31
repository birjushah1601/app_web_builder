// test/engine-launch-ritual-iac-deploy-rolechain.test.ts
// Plan F Task 7 — verifies that makeLaunchRitual passes
// `roleChain: ["iac"]` for iac artifactKind nodes and
// `roleChain: ["deployer"]` for deploy artifactKind nodes.
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/iac.js";    // register iac kind
import "../src/artifact-contracts/deploy.js"; // register deploy kind
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// Minimal in-memory repos (same shape as engine-launch-ritual-tests-rolechain.test.ts)
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
 * Planner emits a three-node DAG: backend (frontend-app stand-in) →
 * iac → deploy. We record every ritualEngine.start call so the test can
 * assert roleChain values per kind.
 */
function makeRecordingRitualEngine() {
  const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
  const snapshots = new Map<string, { state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }>();
  let counter = 0;

  // The backend node is just a stand-in upstream — its artifactKind is not
  // registered in this test (we only import iac + deploy contracts), so the
  // engine falls back to GenericArtifactSchema, which requires `payload`.
  const BACKEND_ARTIFACT = {
    schemaVersion: "1",
    kind: "backend-rest-api",
    payload: { envContract: [], routes: [] }
  };

  const IAC_ARTIFACT = {
    schemaVersion: "1",
    kind: "iac",
    compose: { file: "docker-compose.yml", content: "version: '3'\nservices: {}" },
    k8s: { manifests: [] },
    services: [],
    imageRegistry: { url: "registry.atlas.local/projects", namespace: "default" }
  };

  const DAG_NODES = [
    {
      id: "backend",
      artifactKind: "backend-rest-api",
      summary: "Build backend",
      dependsOn: [],
      consumes: [],
      policy: { priority: 0, runMode: "active" }
    },
    {
      id: "iac",
      artifactKind: "iac",
      summary: "Generate IaC",
      dependsOn: ["backend"],
      consumes: ["backend"],
      policy: { priority: 0, runMode: "active" }
    },
    {
      id: "deploy",
      artifactKind: "deploy",
      summary: "Wire deployment",
      dependsOn: ["iac"],
      consumes: ["iac"],
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
      } else if (input.userTurn === "Build backend") {
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            { eventType: "ritual.artifact_emitted", payload: { fromRole: "developer", artifact: BACKEND_ARTIFACT } }
          ]
        });
      } else if (input.userTurn === "Generate IaC") {
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            { eventType: "ritual.artifact_emitted", payload: { fromRole: "iac", artifact: IAC_ARTIFACT } }
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

describe("Plan F Task 7 — makeLaunchRitual passes roleChain for iac + deploy artifactKinds", () => {
  it("sets roleChain=['iac'] for iac nodes and roleChain=['deployer'] for deploy nodes", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls } = makeRecordingRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start({
      projectId: "00000000-0000-0000-0000-000000000001",
      userId: "user-1",
      prompt: "build + iac + deploy"
    });

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const backendCall = startCalls.find((c) => c.input.userTurn === "Build backend");
    const iacCall = startCalls.find((c) => c.input.userTurn === "Generate IaC");
    const deployCall = startCalls.find((c) => c.input.userTurn === "Wire deployment");

    expect(backendCall).toBeDefined();
    expect(iacCall).toBeDefined();
    expect(deployCall).toBeDefined();

    // Backend (a normal artifactKind) does NOT receive roleChain.
    expect(backendCall!.input.roleChain).toBeUndefined();

    // iac node receives roleChain=["iac"].
    expect(iacCall!.input.roleChain).toEqual(["iac"]);

    // deploy node receives roleChain=["deployer"].
    expect(deployCall!.input.roleChain).toEqual(["deployer"]);

    // priorArtifact still flows — roleChain doesn't replace it.
    const iacPrior = iacCall!.input.priorArtifact as { upstream: Record<string, unknown> };
    expect(iacPrior.upstream).toHaveProperty("backend");
    const deployPrior = deployCall!.input.priorArtifact as { upstream: Record<string, unknown> };
    expect(deployPrior.upstream).toHaveProperty("iac");
  });
});
