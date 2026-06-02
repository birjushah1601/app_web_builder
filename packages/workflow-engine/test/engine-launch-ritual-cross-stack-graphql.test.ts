// test/engine-launch-ritual-cross-stack-graphql.test.ts
// Plan D.4 Task 4 — verifies that makeLaunchRitual, when launching a
// frontend-app node, ALSO scans upstream artifacts for backend-graphql and
// generates a typed graphql client per upstream. Coexists with the REST
// behavior from Plan D.2/D.3 — a single frontend node can consume any mix.
//
// Cases under test:
//   1. Frontend + 1 GraphQL backend → 1 lib/graphql-client-<gqlId>.ts file.
//   2. Frontend + 1 REST + 1 GraphQL backend → 2 files
//      (lib/api-client.ts + lib/graphql-client-<gqlId>.ts).
//   3. Backward compat: 1 REST-only backend still produces lib/api-client.ts
//      unchanged (no GraphQL files injected).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import "../src/artifact-contracts/backend-rest-api.js";
import "../src/artifact-contracts/backend-graphql.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// Local fakes (mirrors engine-launch-ritual-cross-stack.test.ts)
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
    },
    async setDeployResult() {
      // no-op for cross-stack tests
    }
  };
}

// ---------------------------------------------------------------------------
// Fixture artifacts
// ---------------------------------------------------------------------------

const REST_SPEC = {
  openapi: "3.1.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/health": {
      get: { operationId: "h", responses: { "200": { description: "ok" } } }
    }
  }
};

const REST_ARTIFACT = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: REST_SPEC,
  routes: [{ method: "get", path: "/health" }],
  envContract: [],
  sandboxId: "sb-rest"
};

const GRAPHQL_SDL = /* GraphQL */ `
  type Query {
    health: String!
    user(id: ID!): User
  }

  type User {
    id: ID!
    name: String!
  }
`;

const GRAPHQL_ARTIFACT = {
  schemaVersion: "1",
  kind: "backend-graphql",
  graphqlSchema: GRAPHQL_SDL,
  envContract: [],
  sandboxId: "sb-gql"
};

// ---------------------------------------------------------------------------
// Helpers: build a ritual-engine fake that emits per-kind artifacts.
// ---------------------------------------------------------------------------

function makeRitualEngine(
  startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }>,
  artifactByCallShape: (
    input: Parameters<IRitualEngine["start"]>[0]
  ) => unknown | undefined
): IRitualEngine {
  let counter = 0;
  return {
    async start(input) {
      const ritualId = `r-${++counter}`;
      startCalls.push({ ritualId, input });
      return ritualId;
    },
    async getRitual(ritualId) {
      const call = startCalls.find((c) => c.ritualId === ritualId);
      if (!call) return { state: "completed", roleEvents: [] };
      const artifact = artifactByCallShape(call.input);
      if (!artifact) return { state: "completed", roleEvents: [] };
      return {
        state: "completed",
        roleEvents: [
          {
            eventType: "ritual.artifact_emitted",
            payload: { fromRole: "test", artifact }
          }
        ]
      };
    },
    async abort() {}
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeLaunchRitual — cross-stack GraphQL client injection (Plan D.4 Task 4)", () => {
  it("injects ONE graphql-client when a frontend consumes ONE backend-graphql upstream", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    const ritualEngine = makeRitualEngine(startCalls, (input) => {
      // The single backend node has no upstream → emit a GraphQL artifact.
      const upstream = (input.priorArtifact as { upstream?: Record<string, unknown> })?.upstream ?? {};
      if (Object.keys(upstream).length === 0) return GRAPHQL_ARTIFACT;
      return undefined;
    });

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
        id: "gql-backend",
        workflowRunId: runId,
        artifactKind: "backend-graphql",
        summary: "Build the GraphQL API",
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
        dependsOn: ["gql-backend"],
        consumes: ["gql-backend"],
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
    expect(generatedFiles![0]?.path).toBe("lib/graphql-client-gql-backend.ts");
    expect(generatedFiles![0]?.contents).toMatch(/export\s+type/);
  });

  it("injects BOTH a REST client and a GraphQL client when a frontend consumes one of each", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    const ritualEngine = makeRitualEngine(startCalls, (input) => {
      const upstream = (input.priorArtifact as { upstream?: Record<string, unknown> })?.upstream ?? {};
      if (Object.keys(upstream).length > 0) return undefined;
      // Backend rituals — pick by summary to differentiate
      if (input.userTurn === "Build the REST API") return REST_ARTIFACT;
      if (input.userTurn === "Build the GraphQL API") return GRAPHQL_ARTIFACT;
      return undefined;
    });

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
        id: "rest-backend",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "Build the REST API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "gql-backend",
        workflowRunId: runId,
        artifactKind: "backend-graphql",
        summary: "Build the GraphQL API",
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
        dependsOn: ["rest-backend", "gql-backend"],
        consumes: ["rest-backend", "gql-backend"],
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
    expect(generatedFiles).toBeDefined();
    expect(generatedFiles).toHaveLength(2);
    const paths = generatedFiles!.map((f) => f.path).sort();
    expect(paths).toEqual([
      "lib/api-client.ts",
      "lib/graphql-client-gql-backend.ts"
    ]);
    const restFile = generatedFiles!.find((f) => f.path === "lib/api-client.ts");
    const gqlFile = generatedFiles!.find(
      (f) => f.path === "lib/graphql-client-gql-backend.ts"
    );
    expect(restFile?.contents).toMatch(/export\s+interface\s+paths/);
    expect(gqlFile?.contents).toMatch(/export\s+type/);
  });

  it("backward-compat: single REST backend still produces ONLY lib/api-client.ts", async () => {
    // This is a sanity check that the new cross-stack scan is purely
    // additive: a workflow with no GraphQL upstreams emits the EXACT same
    // generatedFiles array as before Plan D.4. Mirrors the D.2/D.3 fixture.
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{ ritualId: string; input: Parameters<IRitualEngine["start"]>[0] }> = [];
    const ritualEngine = makeRitualEngine(startCalls, (input) => {
      const upstream = (input.priorArtifact as { upstream?: Record<string, unknown> })?.upstream ?? {};
      if (Object.keys(upstream).length === 0) return REST_ARTIFACT;
      return undefined;
    });

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
});
