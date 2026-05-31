// test/integration-iac-deploy-handoff.test.ts
// Plan F Task 11 — end-to-end integration test for backend → iac → deploy
// typed artifact handoff.
//
// Mirrors Plan D's integration-backend-handoff.test.ts and Plan E's
// integration-tests-handoff.test.ts. Verifies that:
//   (a) The iac node's persisted artifact (via nodeRepo.findByRunId) has
//       kind === "iac" and matches the IacArtifact emitted by the fake
//       ritual engine — round-tripping services through Zod.
//   (b) The deploy node's launch saw priorArtifact.upstream.<iacNodeId>
//       with kind === "iac" — proving makeLaunchRitual's upstream merge
//       feeds deploy correctly off the iac upstream.
//
// CRITICAL: the side-effect imports below register backend-rest-api, iac and
// deploy in ArtifactContractRegistry. Without registration awaitRitual falls
// back to the generic shape and strips kind-specific fields.
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/backend-rest-api.js";
import "../src/artifact-contracts/iac.js";
import "../src/artifact-contracts/deploy.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes (mirrors integration-tests-handoff.test.ts)
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

// ---------------------------------------------------------------------------
// Artifact fixtures matching the locked Zod schemas.
// ---------------------------------------------------------------------------

const BACKEND_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "backend-rest-api" as const,
  openApiSpec: { openapi: "3.0.0" },
  routes: [
    {
      method: "get" as const,
      path: "/health",
      opId: "getHealth"
    }
  ],
  envContract: [
    { name: "DATABASE_URL", required: true, description: "Postgres DSN" }
  ],
  sandboxId: "sb-backend-1"
};

const IAC_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "iac" as const,
  compose: {
    file: "docker-compose.yml",
    content: "version: '3.8'\nservices:\n  api:\n    image: api:latest\n"
  },
  k8s: {
    manifests: [
      {
        file: "k8s/api-deployment.yaml",
        kind: "Deployment",
        name: "api",
        content: "apiVersion: apps/v1\nkind: Deployment\n"
      }
    ]
  },
  services: [
    {
      name: "api",
      runtimeNodeId: "backend",
      artifactKind: "backend-rest-api",
      port: 8080,
      envContract: [
        { name: "DATABASE_URL", required: true, description: "Postgres DSN" }
      ]
    }
  ],
  imageRegistry: {
    url: "ghcr.io",
    namespace: "atlas"
  }
};

const DEPLOY_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "deploy" as const,
  target: "k8s" as const,
  argoApplication: {
    file: "argocd/app.yaml",
    content: "apiVersion: argoproj.io/v1alpha1\nkind: Application\n",
    name: "atlas-app",
    repoUrl: "https://github.com/atlas/repo",
    path: "k8s"
  },
  imageBuilds: [
    {
      serviceName: "api",
      dockerfilePath: "services/api/Dockerfile",
      imageTag: "ghcr.io/atlas/api:abc123"
    }
  ],
  smokeTests: [
    {
      url: "https://api.example.com/health",
      method: "get" as const,
      expectStatus: 200,
      expectBodyContains: "ok"
    }
  ]
};

/**
 * Ritual engine that records every start() call and routes the emitted
 * artifact based on the upstream shape of priorArtifact:
 *   - empty upstream → backend node → emit BACKEND_ARTIFACT
 *   - upstream has backend-rest-api only → iac node → emit IAC_ARTIFACT
 *   - upstream has iac → deploy node → emit DEPLOY_ARTIFACT
 */
function makeFakeRitualEngine() {
  const startCalls: Array<{
    ritualId: string;
    input: Parameters<IRitualEngine["start"]>[0];
  }> = [];
  const snapshots = new Map<
    string,
    { state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }
  >();
  let counter = 0;

  const ritualEngine: IRitualEngine = {
    async start(input) {
      const ritualId = `ritual-${++counter}`;
      startCalls.push({ ritualId, input });

      const prior = input.priorArtifact as
        | { upstream?: Record<string, { kind?: string }> }
        | undefined;
      const upstream = prior?.upstream ?? {};
      const upstreamKinds = Object.values(upstream).map((u) => u?.kind);

      let emittedArtifact: unknown;
      let fromRole: string;
      if (upstreamKinds.length === 0) {
        emittedArtifact = BACKEND_ARTIFACT;
        fromRole = "backend-artifact";
      } else if (upstreamKinds.includes("iac")) {
        emittedArtifact = DEPLOY_ARTIFACT;
        fromRole = "deploy-artifact";
      } else {
        // backend upstream only → iac node
        emittedArtifact = IAC_ARTIFACT;
        fromRole = "iac-artifact";
      }

      snapshots.set(ritualId, {
        state: "completed",
        roleEvents: [
          {
            eventType: "ritual.artifact_emitted",
            payload: {
              fromRole,
              artifact: emittedArtifact
            }
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

  return { ritualEngine, startCalls };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Plan F Task 11 — end-to-end backend → iac → deploy typed handoff", () => {
  it("persists IacArtifact on iac node and threads it into deploy ritual's priorArtifact.upstream", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls } = makeFakeRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    // Seed the run + nodes directly, bypassing the planner.
    const runId = "00000000-0000-0000-0000-0000000000cc";
    const projectId = "00000000-0000-0000-0000-000000000001";
    const userId = "user-1";
    const now = new Date();

    await runRepo.insert({
      id: runId,
      projectId,
      userId,
      prompt: "Build a backend, generate IaC, and deploy",
      status: "awaiting_approval",
      dependencyProfile: { schemaVersion: "1" },
      createdAt: now,
      updatedAt: now
    });

    await nodeRepo.insertMany([
      {
        id: "backend",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "Build backend",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "iac",
        workflowRunId: runId,
        artifactKind: "iac",
        summary: "Generate IaC",
        dependsOn: ["backend"],
        consumes: ["backend"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "deploy",
        workflowRunId: runId,
        artifactKind: "deploy",
        summary: "Deploy",
        dependsOn: ["iac"],
        consumes: ["iac"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);

    // Approve plan → scheduler runs backend → iac → deploy in dependency order.
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // (a) iac node's persisted artifact must round-trip kind + services.
    const allNodes = await nodeRepo.findByRunId(runId);
    const iacNode = allNodes.find((n) => n.id === "iac");
    expect(iacNode).toBeDefined();
    const persistedIac = iacNode!.artifact as {
      kind?: string;
      services?: unknown[];
    };
    expect(persistedIac).toBeDefined();
    expect(persistedIac.kind).toBe("iac");
    expect(persistedIac.services).toHaveLength(1);
    expect(persistedIac.services).toEqual(IAC_ARTIFACT.services);

    // (b) deploy ritual launch must have received the IacArtifact under
    //     priorArtifact.upstream.iac with kind preserved through the typed
    //     contract registry path.
    const deployCall = startCalls.find((c) => c.input.userTurn === "Deploy");
    expect(deployCall).toBeDefined();
    const deployPrior = deployCall!.input.priorArtifact as {
      upstream: Record<string, { kind?: string }>;
    };
    expect(deployPrior).toBeDefined();
    expect(deployPrior.upstream).toHaveProperty("iac");
    expect(deployPrior.upstream.iac.kind).toBe("iac");
  });
});
