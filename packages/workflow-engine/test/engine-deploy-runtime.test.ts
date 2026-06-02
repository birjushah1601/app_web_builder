// test/engine-deploy-runtime.test.ts
// Plan F.2 Task 4 — verifies the workflow engine's post-producer deploy hook.
//
// When a deploy-kind node's ritual emits a valid DeployArtifact AND
// WorkflowEngineOptions.deployRunner + deployApex are both set, the engine
// MUST:
//   1. Look up the upstream IacArtifact via priorArtifact.upstream
//   2. Build DeployRunnerInput { workflowRunId, projectId, nodeId,
//      iacArtifact, deployArtifact, branchId, subdomain, apex }
//   3. Call deployRunner AFTER artifact persistence but BEFORE marking done
//   4. On success: persist deployResult via IWorkflowNodeRepo.setDeployResult
//   5. On throw: mark the node failed via the existing failure path
//
// When deployRunner is undefined OR deployApex is unset, the hook is a no-op
// (today's Plan F behavior preserved).
import { describe, it, expect, vi } from "vitest";
import "../src/artifact-contracts/iac.js";
import "../src/artifact-contracts/deploy.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine,
  DeployRunnerInput
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes
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
  deployResult?: unknown;
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
    },
    async setDeployResult(runId, nodeId, deployResult) {
      const row = store.get(key(runId, nodeId));
      if (row) row.deployResult = deployResult;
    }
  };
}

// ---------------------------------------------------------------------------
// Artifact fixtures
// ---------------------------------------------------------------------------

const IAC_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "iac" as const,
  compose: { file: "docker-compose.yml", content: "version: '3'\n" },
  k8s: { manifests: [] },
  services: [],
  imageRegistry: { url: "ghcr.io", namespace: "atlas" }
};

const DEPLOY_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "deploy" as const,
  target: "k8s" as const,
  argoApplication: {
    file: "argocd/app.yaml",
    content: "apiVersion: argoproj.io/v1alpha1\n",
    name: "atlas-app",
    repoUrl: "https://github.com/atlas/repo",
    path: "k8s"
  },
  imageBuilds: [],
  smokeTests: []
};

const VALID_DEPLOY_RESULT = {
  deployId: "d-1",
  publicUrl: "https://proj.atlas.dev",
  argoApplicationName: "proj-main",
  branchSchemaName: "branch_run-1",
  appliedManifests: [{ namespace: "atlas-projects", kind: "Service", name: "api" }],
  phase: "healthy" as const,
  startedAt: "2026-01-01T00:00:00.000Z"
};

// ---------------------------------------------------------------------------
// Ritual engine that emits IacArtifact for iac node, DeployArtifact for
// deploy node. Mirrors integration-iac-deploy-handoff.test.ts.
// ---------------------------------------------------------------------------

function makeFakeRitualEngine() {
  const snapshots = new Map<
    string,
    { state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }
  >();
  let counter = 0;

  const ritualEngine: IRitualEngine = {
    async start(input) {
      const ritualId = `ritual-${++counter}`;
      const prior = input.priorArtifact as
        | { upstream?: Record<string, { kind?: string }> }
        | undefined;
      const upstream = prior?.upstream ?? {};
      const upstreamKinds = Object.values(upstream).map((u) => u?.kind);

      let emittedArtifact: unknown;
      if (upstreamKinds.length === 0) {
        emittedArtifact = IAC_ARTIFACT;
      } else if (upstreamKinds.includes("iac")) {
        emittedArtifact = DEPLOY_ARTIFACT;
      } else {
        emittedArtifact = IAC_ARTIFACT;
      }

      snapshots.set(ritualId, {
        state: "completed",
        roleEvents: [
          {
            eventType: "ritual.artifact_emitted",
            payload: { fromRole: "stub", artifact: emittedArtifact }
          }
        ]
      });
      return ritualId;
    },
    async getRitual(ritualId) {
      return snapshots.get(ritualId) ?? { state: "completed", roleEvents: [] };
    },
    async abort() {}
  };

  return { ritualEngine };
}

// ---------------------------------------------------------------------------
// Seed helper: a 2-node DAG (iac → deploy) already past planning, in
// awaiting_approval status. Mirrors integration-iac-deploy-handoff.test.ts.
// ---------------------------------------------------------------------------

const RUN_ID = "00000000-0000-0000-0000-0000000000c4";
const PROJECT_ID = "00000000-0000-0000-0000-000000000099";

async function seedRunWithIacAndDeployNodes(
  runRepo: ReturnType<typeof makeRunRepo>,
  nodeRepo: ReturnType<typeof makeNodeRepo>
): Promise<void> {
  const now = new Date();
  await runRepo.insert({
    id: RUN_ID,
    projectId: PROJECT_ID,
    userId: "user-1",
    prompt: "iac + deploy",
    status: "awaiting_approval",
    dependencyProfile: { schemaVersion: "1" },
    createdAt: now,
    updatedAt: now
  });
  await nodeRepo.insertMany([
    {
      id: "iac",
      workflowRunId: RUN_ID,
      artifactKind: "iac",
      summary: "Generate IaC",
      dependsOn: [],
      consumes: [],
      policy: { priority: 0, runMode: "active" },
      status: "pending"
    },
    {
      id: "deploy",
      workflowRunId: RUN_ID,
      artifactKind: "deploy",
      summary: "Deploy",
      dependsOn: ["iac"],
      consumes: ["iac"],
      policy: { priority: 0, runMode: "active" },
      status: "pending"
    }
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Plan F.2 Task 4 — engine post-producer deploy hook", () => {
  it("calls deployRunner when a deploy node emits a DeployArtifact + deployApex is configured", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine } = makeFakeRitualEngine();

    const deployRunner = vi.fn(async (_input: DeployRunnerInput) => VALID_DEPLOY_RESULT);

    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo,
      nodeRepo,
      deployRunner,
      deployApex: "atlas.dev"
    });

    await seedRunWithIacAndDeployNodes(runRepo, nodeRepo);
    await engine.approvePlan(RUN_ID);
    await engine._waitForScheduler(RUN_ID);

    // 1. deployRunner was called exactly once with the right input shape
    expect(deployRunner).toHaveBeenCalledTimes(1);
    const callArg = deployRunner.mock.calls[0]![0]!;
    expect(callArg.workflowRunId).toBe(RUN_ID);
    expect(callArg.projectId).toBe(PROJECT_ID);
    expect(callArg.nodeId).toBe("deploy");
    expect(callArg.iacArtifact.kind).toBe("iac");
    expect(callArg.deployArtifact.kind).toBe("deploy");
    expect(callArg.branchId).toBe(RUN_ID);
    expect(callArg.subdomain).toBe(RUN_ID.slice(0, 8));
    expect(callArg.apex).toBe("atlas.dev");

    // 2. node.deployResult is persisted and matches what the runner returned
    const snapshot = await engine.getRun(RUN_ID);
    const deployNode = snapshot!.nodes.find((n) => n.id === "deploy")!;
    expect(deployNode.deployResult).toEqual(VALID_DEPLOY_RESULT);

    // 3. node.status is "done"
    expect(deployNode.status).toBe("done");
  });

  it("does NOT call deployRunner when deployRunner option is not provided", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine } = makeFakeRitualEngine();

    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo,
      nodeRepo,
      // deployRunner intentionally omitted
      deployApex: "atlas.dev"
    });

    await seedRunWithIacAndDeployNodes(runRepo, nodeRepo);
    await engine.approvePlan(RUN_ID);
    await engine._waitForScheduler(RUN_ID);

    const snapshot = await engine.getRun(RUN_ID);
    const deployNode = snapshot!.nodes.find((n) => n.id === "deploy")!;
    expect(deployNode.status).toBe("done");
    expect(deployNode.deployResult).toBeUndefined();
  });

  it("does NOT call deployRunner when deployApex is missing", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine } = makeFakeRitualEngine();
    const deployRunner = vi.fn(async () => VALID_DEPLOY_RESULT);

    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo,
      nodeRepo,
      deployRunner
      // deployApex intentionally omitted
    });

    await seedRunWithIacAndDeployNodes(runRepo, nodeRepo);
    await engine.approvePlan(RUN_ID);
    await engine._waitForScheduler(RUN_ID);

    expect(deployRunner).not.toHaveBeenCalled();
    const snapshot = await engine.getRun(RUN_ID);
    const deployNode = snapshot!.nodes.find((n) => n.id === "deploy")!;
    expect(deployNode.status).toBe("done");
    expect(deployNode.deployResult).toBeUndefined();
  });

  it("marks the deploy node failed when deployRunner throws", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine } = makeFakeRitualEngine();
    const deployRunner = vi.fn(async () => {
      throw new Error("argo reported Degraded; deployment rolled back");
    });

    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo,
      nodeRepo,
      deployRunner,
      deployApex: "atlas.dev"
    });

    await seedRunWithIacAndDeployNodes(runRepo, nodeRepo);
    await engine.approvePlan(RUN_ID);
    await engine._waitForScheduler(RUN_ID);

    expect(deployRunner).toHaveBeenCalledTimes(1);
    const snapshot = await engine.getRun(RUN_ID);
    const deployNode = snapshot!.nodes.find((n) => n.id === "deploy")!;
    expect(deployNode.status).toBe("failed");
    expect(deployNode.failure?.error).toContain("argo reported Degraded");
    expect(deployNode.deployResult).toBeUndefined();
  });
});
