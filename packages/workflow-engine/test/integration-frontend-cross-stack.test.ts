// test/integration-frontend-cross-stack.test.ts
// Plan D.2 Task 5 — end-to-end integration test for the backend → frontend
// cross-stack api-client handoff.
//
// Drives a 2-node DAG (backend → frontend) in-process and asserts:
//   (1) Cross-stack api-client present: the frontend node's recorded start()
//       call captured priorArtifact.generatedFiles with one entry whose
//       path === "lib/api-client.ts" and whose contents contains
//       `export interface paths` AND the route `/health`. This proves
//       openapi-typescript actually ran on the backend's emitted openApiSpec.
//   (2) Existing upstream merge still works: the same call captured
//       priorArtifact.upstream.backend.kind === "backend-rest-api"
//       (sanity check — Plan D Task 8.5's behavior is preserved).
//
// CRITICAL: the side-effect import below registers the backend-rest-api kind
// in ArtifactContractRegistry. Without it, awaitRitual falls back to the
// generic shape and strips the openApiSpec field, so the api-client generation
// would have nothing to work with.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import "../src/artifact-contracts/backend-rest-api.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes (pasted from engine-launch-ritual-cross-stack.test.ts)
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
// Fixtures — minimal OpenAPI 3.1 doc with one /health route.
// ---------------------------------------------------------------------------

const SPEC = {
  openapi: "3.1.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/health": {
      get: {
        operationId: "get_health",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" } },
                  required: ["status"]
                }
              }
            }
          }
        }
      }
    }
  }
};

const BACKEND_ARTIFACT = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: SPEC,
  routes: [{ method: "get", path: "/health", opId: "get_health" }],
  envContract: [],
  sandboxId: "sb-1"
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Plan D.2 Task 5 — end-to-end backend → frontend cross-stack api-client handoff", () => {
  it("threads a generated lib/api-client.ts into the frontend ritual's priorArtifact while preserving the upstream backend artifact", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{
      ritualId: string;
      input: Parameters<IRitualEngine["start"]>[0];
    }> = [];
    let counter = 0;

    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        startCalls.push({ ritualId, input });
        return ritualId;
      },
      async getRitual(ritualId) {
        const call = startCalls.find((c) => c.ritualId === ritualId);
        const upstream = (call?.input.priorArtifact as
          | { upstream?: Record<string, unknown> }
          | undefined)?.upstream ?? {};
        if (Object.keys(upstream).length === 0) {
          // Backend ritual — emit the real BackendArtifact so the
          // frontend's launchRitual can extract the openApiSpec.
          return {
            state: "completed",
            roleEvents: [
              {
                eventType: "ritual.artifact_emitted",
                payload: {
                  fromRole: "backend-artifact",
                  artifact: BACKEND_ARTIFACT
                }
              }
            ]
          };
        }
        // Frontend ritual — no further artifact to emit.
        return { state: "completed", roleEvents: [] };
      },
      async abort() {}
    };

    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });
    const runId = randomUUID();

    await runRepo.insert({
      id: runId,
      projectId: "p-1",
      userId: "u-1",
      prompt: "Build a backend and a frontend that consumes it",
      status: "awaiting_approval",
      dependencyProfile: { schemaVersion: "1" },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await nodeRepo.insertMany([
      {
        id: "backend",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "Build the API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "frontend",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "Build the UI",
        dependsOn: ["backend"],
        consumes: ["backend"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const frontendCall = startCalls.find(
      (c) => c.input.userTurn === "Build the UI"
    );
    expect(frontendCall).toBeDefined();
    const prior = frontendCall!.input.priorArtifact as {
      upstream: { backend: { kind: string } };
      generatedFiles?: Array<{ path: string; contents: string }>;
    };

    // Prong 1: api-client generated and threaded
    expect(prior.generatedFiles).toBeDefined();
    expect(prior.generatedFiles).toHaveLength(1);
    expect(prior.generatedFiles![0]?.path).toBe("lib/api-client.ts");
    expect(prior.generatedFiles![0]?.contents).toMatch(/export\s+interface\s+paths/);
    expect(prior.generatedFiles![0]?.contents).toContain("/health");

    // Prong 2: upstream merge still works
    expect(prior.upstream.backend.kind).toBe("backend-rest-api");
  });
});
