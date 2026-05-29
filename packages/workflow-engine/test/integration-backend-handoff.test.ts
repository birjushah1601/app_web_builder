// test/integration-backend-handoff.test.ts
// Plan D Task 9 — end-to-end integration test for typed BackendArtifact handoff.
//
// Verifies that when a backend node emits a BackendArtifact via
// ritual.artifact_emitted, the engine persists it on the backend node AND
// passes it through priorArtifact.upstream to a downstream consumer node's
// ritual launch — round-tripping every backend-rest-api-specific field
// (kind, routes) without generic-fallback stripping.
//
// CRITICAL: the side-effect import below registers the backend-rest-api kind
// in ArtifactContractRegistry. Without it, awaitRitual falls back to the
// generic shape and strips backend fields, breaking the assertion.
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/backend-rest-api.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes (mirrors engine.test.ts / engine-launch-ritual.test.ts)
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
// The BackendArtifact the backend node will emit.
// ---------------------------------------------------------------------------

const BACKEND_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "backend-rest-api" as const,
  openApiSpec: { openapi: "3.1.0", paths: {} },
  routes: [
    {
      method: "get" as const,
      path: "/api/things",
      opId: "listThings"
    }
  ],
  envContract: [],
  sandboxId: "sb-backend-1"
};

/**
 * Ritual engine that:
 *   - Records every start() call (so the test can inspect what the consumer
 *     ritual was launched with).
 *   - When called with priorArtifact.upstream === {} (the backend node case),
 *     returns a completed snapshot containing ritual.artifact_emitted with a
 *     real BackendArtifact.
 *   - Otherwise (the consumer case) returns completed with no events.
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
        | { upstream?: Record<string, unknown> }
        | undefined;
      const upstreamKeys = prior?.upstream ? Object.keys(prior.upstream) : [];

      if (upstreamKeys.length === 0) {
        // Backend node — emit its artifact.
        snapshots.set(ritualId, {
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
        });
      } else {
        // Consumer (frontend) node — completed with no artifact events.
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

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Plan D Task 9 — end-to-end typed BackendArtifact handoff", () => {
  it("persists BackendArtifact on backend node and threads it into frontend ritual's priorArtifact.upstream", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls } = makeFakeRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    // Seed the run + nodes directly, bypassing the planner.
    const runId = "00000000-0000-0000-0000-0000000000aa";
    const projectId = "00000000-0000-0000-0000-000000000001";
    const userId = "user-1";
    const now = new Date();

    await runRepo.insert({
      id: runId,
      projectId,
      userId,
      prompt: "Build a backend + frontend",
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
        summary: "Build the backend API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "frontend",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "Build the frontend app that consumes backend",
        dependsOn: ["backend"],
        consumes: ["backend"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);

    // Approve plan → scheduler runs both nodes in dependency order.
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // (a) Backend node's persisted artifact must preserve kind + routes.
    const allNodes = await nodeRepo.findByRunId(runId);
    const backendNode = allNodes.find((n) => n.id === "backend");
    expect(backendNode).toBeDefined();
    const persistedArtifact = backendNode!.artifact as {
      kind?: string;
      routes?: unknown;
    };
    expect(persistedArtifact).toBeDefined();
    expect(persistedArtifact.kind).toBe("backend-rest-api");
    expect(persistedArtifact.routes).toEqual(BACKEND_ARTIFACT.routes);

    // (b) The frontend ritual launch must have received the BackendArtifact
    //     under priorArtifact.upstream.backend — kind + routes intact.
    const frontendCall = startCalls.find(
      (c) => c.input.userTurn === "Build the frontend app that consumes backend"
    );
    expect(frontendCall).toBeDefined();
    const frontendPrior = frontendCall!.input.priorArtifact as {
      upstream: Record<string, { kind?: string; routes?: unknown }>;
    };
    expect(frontendPrior).toBeDefined();
    expect(frontendPrior.upstream).toHaveProperty("backend");
    expect(frontendPrior.upstream.backend.kind).toBe("backend-rest-api");
    expect(frontendPrior.upstream.backend.routes).toEqual(BACKEND_ARTIFACT.routes);
  });
});
