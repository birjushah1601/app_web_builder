// test/integration-deploy-runtime.test.ts
// Plan F.2 Task 7 — end-to-end integration test for the deploy runtime hook.
//
// Headline test for Plan F.2: proves the full chain works in-process when
//   (a) a deploy-kind node consumes an iac upstream,
//   (b) the fake ritual engine emits a valid IacArtifact for the iac node
//       and a valid DeployArtifact for the deploy node, and
//   (c) deployRunner is wired AND deployApex is set.
//
// Asserted:
//   1. deployRunner is called exactly once with workflowRunId, projectId,
//      nodeId, iacArtifact, deployArtifact, branchId, subdomain, apex.
//   2. The deploy node ends `done` with `deployResult` populated from the
//      runner's return value.
//   3. Regression guard: when deployApex is unset, deployRunner is NEVER
//      invoked (Plan F's pre-runtime behavior preserved).
//
// CRITICAL: the side-effect imports below register iac and deploy in
// ArtifactContractRegistry. Without registration awaitRitual falls back to
// the generic shape and strips kind-specific fields.
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
// In-memory fakes (mirrors engine-deploy-runtime.test.ts — the nodeRepo here
// MUST implement setDeployResult; Task 4 added that method to the contract).
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
  compose: {
    file: "docker-compose.yml",
    content: "version: '3'\nservices: {}\n"
  },
  k8s: {
    manifests: [
      {
        file: "k8s/api.yaml",
        kind: "Service",
        name: "api",
        content:
          "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\nspec: {}\n"
      }
    ]
  },
  services: [],
  imageRegistry: { url: "reg.local", namespace: "proj-1" }
};

const DEPLOY_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "deploy" as const,
  target: "k8s" as const,
  argoApplication: {
    file: "argo/app.yaml",
    name: "proj-1-main",
    repoUrl: "git@example.com:manifests.git",
    path: "k8s/",
    content:
      "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: proj-1-main\nspec: {}\n"
  },
  imageBuilds: [],
  smokeTests: []
};

const HEALTHY_DEPLOY_RESULT = {
  deployId: "d-1",
  publicUrl: "https://proj-1.atlas.dev",
  argoApplicationName: "proj-1-main",
  branchSchemaName: "branch_main",
  appliedManifests: [{ namespace: "atlas-projects", kind: "Service", name: "api" }],
  phase: "healthy" as const,
  startedAt: "2026-06-02T00:00:00.000Z"
};

// ---------------------------------------------------------------------------
// Ritual engine that emits IacArtifact for the iac node and DeployArtifact
// for the deploy node. Routes by inspecting priorArtifact.upstream — empty
// → iac, presence of iac upstream → deploy.
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
      let fromRole: string;
      if (upstreamKinds.includes("iac")) {
        emittedArtifact = DEPLOY_ARTIFACT;
        fromRole = "deploy-artifact";
      } else {
        emittedArtifact = IAC_ARTIFACT;
        fromRole = "iac-artifact";
      }

      snapshots.set(ritualId, {
        state: "completed",
        roleEvents: [
          {
            eventType: "ritual.artifact_emitted",
            payload: { fromRole, artifact: emittedArtifact }
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
// Seed helper: 2-node DAG (iac → deploy) already past planning, in
// awaiting_approval status.
// ---------------------------------------------------------------------------

const RUN_ID = "00000000-0000-0000-0000-0000000000d7";
const PROJECT_ID = "00000000-0000-0000-0000-00000000007a";

async function seedRunWithIacAndDeployNodes(
  runRepo: ReturnType<typeof makeRunRepo>,
  nodeRepo: ReturnType<typeof makeNodeRepo>
): Promise<void> {
  const now = new Date();
  await runRepo.insert({
    id: RUN_ID,
    projectId: PROJECT_ID,
    userId: "user-1",
    prompt: "Deploy proj-1",
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

describe("Plan F.2 Task 7 — deploy runtime hook (end-to-end integration)", () => {
  it("end-to-end: iac upstream → deploy ritual → deployRunner → node done with deployResult", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine } = makeFakeRitualEngine();

    const deployRunner = vi.fn(async (_input: DeployRunnerInput) => HEALTHY_DEPLOY_RESULT);

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

    // --- Prong 1: deployRunner called exactly once with the right inputs.
    expect(deployRunner).toHaveBeenCalledTimes(1);
    const call = deployRunner.mock.calls[0]![0]!;
    expect(call.workflowRunId).toBe(RUN_ID);
    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.nodeId).toBe("deploy");
    expect(call.iacArtifact.kind).toBe("iac");
    expect(call.deployArtifact.kind).toBe("deploy");
    expect(call.apex).toBe("atlas.dev");
    // branchId + subdomain are derived from runId — assert non-empty.
    expect(call.branchId).toBeTruthy();
    expect(call.subdomain).toBeTruthy();

    // --- Prong 2: deploy node ends `done` with deployResult populated.
    const snapshot = await engine.getRun(RUN_ID);
    const deployNode = snapshot!.nodes.find((n) => n.id === "deploy")!;
    expect(deployNode.status).toBe("done");
    expect(deployNode.deployResult).toEqual(HEALTHY_DEPLOY_RESULT);

    // Bonus: iac node also ended done (proves the chain ran top-to-bottom).
    const iacNode = snapshot!.nodes.find((n) => n.id === "iac")!;
    expect(iacNode.status).toBe("done");
  });

  it("does NOT call deployRunner when deployApex is unset (regression guard)", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine } = makeFakeRitualEngine();
    const deployRunner = vi.fn(async () => HEALTHY_DEPLOY_RESULT);

    const engine = new WorkflowEngine({
      ritualEngine,
      runRepo,
      nodeRepo,
      deployRunner
      // deployApex intentionally unset
    });

    await seedRunWithIacAndDeployNodes(runRepo, nodeRepo);
    await engine.approvePlan(RUN_ID);
    await engine._waitForScheduler(RUN_ID);

    expect(deployRunner).not.toHaveBeenCalled();

    // Node still ends `done` (the hook is a no-op, not a failure path).
    const snapshot = await engine.getRun(RUN_ID);
    const deployNode = snapshot!.nodes.find((n) => n.id === "deploy")!;
    expect(deployNode.status).toBe("done");
    expect(deployNode.deployResult).toBeUndefined();
  });
});
