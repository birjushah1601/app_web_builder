// test/engine-launch-ritual-cross-stack.test.ts
// Plan D.2 Task 3 + Plan D.3 — verifies that makeLaunchRitual, when launching a
// frontend-app node, scans upstream artifacts for backend-rest-api and:
//   1. Zero backends → priorArtifact.generatedFiles undefined.
//   2. One backend → single canonical lib/api-client.ts file (D.2 behavior).
//   3. Two+ backends → one lib/api-client-{backendNodeId}.ts per upstream
//      (Plan D.3 — replaces the previous "throws on 2+" behavior).
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
// Local fakes (mirrors engine-launch-ritual.test.ts)
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

const SPEC = {
  openapi: "3.1.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/health": {
      get: { operationId: "h", responses: { "200": { description: "ok" } } }
    }
  }
};

const BACKEND_ARTIFACT = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: SPEC,
  routes: [{ method: "get", path: "/health" }],
  envContract: [],
  sandboxId: "sb-1"
};

describe("makeLaunchRitual — cross-stack api-client injection (Plan D.2 Task 3)", () => {
  it("injects generatedFiles when a frontend node consumes a single backend-rest-api upstream", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    let counter = 0;
    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        startCalls.push({ ritualId, input });
        return ritualId;
      },
      async getRitual(ritualId) {
        const call = startCalls.find((c) => c.ritualId === ritualId);
        const upstream = (call?.input.priorArtifact as { upstream?: Record<string, unknown> })?.upstream ?? {};
        if (Object.keys(upstream).length === 0) {
          // The backend node — emit the BACKEND_ARTIFACT so the frontend's
          // launchRitual can pick it up via the upstream map.
          return {
            state: "completed",
            roleEvents: [
              {
                eventType: "ritual.artifact_emitted",
                payload: { fromRole: "backend-artifact", artifact: BACKEND_ARTIFACT }
              }
            ]
          };
        }
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
      prompt: "p",
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

    const frontendCall = startCalls.find((c) => c.input.userTurn === "Build the UI");
    expect(frontendCall).toBeDefined();
    const generatedFiles = (frontendCall!.input.priorArtifact as {
      generatedFiles?: Array<{ path: string; contents: string }>;
    }).generatedFiles;
    expect(generatedFiles).toBeDefined();
    expect(generatedFiles).toHaveLength(1);
    expect(generatedFiles![0]?.path).toBe("lib/api-client.ts");
    expect(generatedFiles![0]?.contents).toMatch(/export\s+interface\s+paths/);
  });

  it("does NOT inject generatedFiles when no backend-rest-api upstream exists", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    let counter = 0;
    const ritualEngine: IRitualEngine = {
      async start(input) {
        const r = `r-${++counter}`;
        startCalls.push({ ritualId: r, input });
        return r;
      },
      async getRitual() {
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
      prompt: "p",
      status: "awaiting_approval",
      dependencyProfile: { schemaVersion: "1" },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await nodeRepo.insertMany([
      {
        id: "frontend",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "Build the UI",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const call = startCalls.find((c) => c.input.userTurn === "Build the UI");
    expect(call).toBeDefined();
    const prior = call!.input.priorArtifact as { generatedFiles?: unknown };
    expect(prior.generatedFiles).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Plan D.3 — multi-backend cross-stack. Replaces D.2's "throws on 2+" test
  // with success cases for 2 and 3 backend upstreams.
  // ---------------------------------------------------------------------------

  it("injects ONE file per backend when 2 backend-rest-api upstreams exist (Plan D.3)", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    let counter = 0;
    const ritualEngine: IRitualEngine = {
      async start(input) {
        const r = `r-${++counter}`;
        startCalls.push({ ritualId: r, input });
        return r;
      },
      async getRitual(ritualId) {
        const call = startCalls.find((c) => c.ritualId === ritualId);
        const upstream = (call?.input.priorArtifact as { upstream?: Record<string, unknown> })?.upstream ?? {};
        // Backend nodes have no upstream → emit a BackendArtifact.
        if (Object.keys(upstream).length === 0) {
          return {
            state: "completed",
            roleEvents: [
              {
                eventType: "ritual.artifact_emitted",
                payload: { fromRole: "backend-artifact", artifact: BACKEND_ARTIFACT }
              }
            ]
          };
        }
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
      prompt: "p",
      status: "awaiting_approval",
      dependencyProfile: { schemaVersion: "1" },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await nodeRepo.insertMany([
      {
        id: "backend-a",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "API A",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "backend-b",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "API B",
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
        dependsOn: ["backend-a", "backend-b"],
        consumes: ["backend-a", "backend-b"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // The frontend node should have launched successfully — no failure status.
    const nodes = await nodeRepo.findByRunId(runId);
    const frontend = nodes.find((n) => n.id === "frontend");
    expect(frontend?.status).not.toBe("failed");

    const frontendCall = startCalls.find((c) => c.input.userTurn === "Build the UI");
    expect(frontendCall).toBeDefined();
    const generatedFiles = (frontendCall!.input.priorArtifact as {
      generatedFiles?: Array<{ path: string; contents: string }>;
    }).generatedFiles;
    expect(generatedFiles).toBeDefined();
    expect(generatedFiles).toHaveLength(2);
    const paths = generatedFiles!.map((f) => f.path).sort();
    expect(paths).toEqual([
      "lib/api-client-backend-a.ts",
      "lib/api-client-backend-b.ts"
    ]);
    for (const f of generatedFiles!) {
      expect(f.contents).toMatch(/export\s+interface\s+paths/);
    }
  });

  it("injects ONE file per backend when 3 backend-rest-api upstreams exist (Plan D.3)", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    let counter = 0;
    const ritualEngine: IRitualEngine = {
      async start(input) {
        const r = `r-${++counter}`;
        startCalls.push({ ritualId: r, input });
        return r;
      },
      async getRitual(ritualId) {
        const call = startCalls.find((c) => c.ritualId === ritualId);
        const upstream = (call?.input.priorArtifact as { upstream?: Record<string, unknown> })?.upstream ?? {};
        if (Object.keys(upstream).length === 0) {
          return {
            state: "completed",
            roleEvents: [
              {
                eventType: "ritual.artifact_emitted",
                payload: { fromRole: "backend-artifact", artifact: BACKEND_ARTIFACT }
              }
            ]
          };
        }
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
      prompt: "p",
      status: "awaiting_approval",
      dependencyProfile: { schemaVersion: "1" },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await nodeRepo.insertMany([
      {
        id: "backend-a",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "API A",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "backend-b",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "API B",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "backend-c",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "API C",
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
        dependsOn: ["backend-a", "backend-b", "backend-c"],
        consumes: ["backend-a", "backend-b", "backend-c"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const nodes = await nodeRepo.findByRunId(runId);
    const frontend = nodes.find((n) => n.id === "frontend");
    expect(frontend?.status).not.toBe("failed");

    const frontendCall = startCalls.find((c) => c.input.userTurn === "Build the UI");
    expect(frontendCall).toBeDefined();
    const generatedFiles = (frontendCall!.input.priorArtifact as {
      generatedFiles?: Array<{ path: string; contents: string }>;
    }).generatedFiles;
    expect(generatedFiles).toHaveLength(3);
    const paths = generatedFiles!.map((f) => f.path).sort();
    expect(paths).toEqual([
      "lib/api-client-backend-a.ts",
      "lib/api-client-backend-b.ts",
      "lib/api-client-backend-c.ts"
    ]);
  });
});
