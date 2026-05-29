// test/integration-tests-handoff.test.ts
// Plan E Task 8 — end-to-end integration test for typed TestsArtifact handoff.
//
// Mirrors Plan D's integration-backend-handoff.test.ts. Verifies that:
//   (a) The tests node's persisted artifact (via nodeRepo.findByRunId) has
//       kind === "tests" and matches the TestsArtifact emitted by the fake
//       ritual engine — round-tripping framework/specs through Zod.
//   (b) The tests node's launch saw priorArtifact.upstream.<frontendNodeId>
//       with kind === "frontend-app" — proving makeLaunchRitual's upstream
//       merge from Plan D works for tests consumers too.
//
// CRITICAL: the side-effect import below registers the tests kind in
// ArtifactContractRegistry. Without it, awaitRitual falls back to the
// generic shape and strips tests-specific fields. The frontend-app kind is
// NOT registered (intentionally) — its emitted artifact hits the
// generic-kind-fallback path in awaitRitualImpl and is coerced via
// GenericArtifactSchema, which preserves the kind field. The tests node's
// launch then sees that generic-validated FrontendArtifact in
// priorArtifact.upstream.frontend with its kind still === "frontend-app".
import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/backend-rest-api.js";
import "../src/artifact-contracts/tests.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes (mirrors integration-backend-handoff.test.ts)
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
// Artifacts the fake ritual engine will emit.
//   - FRONTEND_ARTIFACT: shaped to pass GenericArtifactSchema validation
//     (schemaVersion + kind + payload) since "frontend-app" is not registered.
//   - TESTS_ARTIFACT: shaped to pass TestsArtifactSchema validation.
// ---------------------------------------------------------------------------

const FRONTEND_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "frontend-app" as const,
  payload: {
    sandboxId: "sb-frontend-1",
    routes: ["/", "/about"]
  }
};

const TESTS_ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "tests" as const,
  framework: "vitest" as const,
  specs: [
    {
      file: "src/foo.test.ts",
      targets: ["foo"],
      passed: 3,
      failed: 0,
      skipped: 0,
      durationMs: 42
    }
  ],
  coverage: { lines: 87.5, branches: 75 }
};

/**
 * Ritual engine that:
 *  - Records every start() call so the test can inspect the consumer launch.
 *  - Looks at priorArtifact.upstream:
 *      - empty → frontend node ritual → emit FRONTEND_ARTIFACT
 *      - non-empty → tests node ritual → emit TESTS_ARTIFACT
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
        // Frontend node — emit its (generic-validated) FrontendArtifact.
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            {
              eventType: "ritual.artifact_emitted",
              payload: {
                fromRole: "frontend-artifact",
                artifact: FRONTEND_ARTIFACT
              }
            }
          ]
        });
      } else {
        // Tests node — emit a real TestsArtifact.
        snapshots.set(ritualId, {
          state: "completed",
          roleEvents: [
            {
              eventType: "ritual.artifact_emitted",
              payload: {
                fromRole: "tests-artifact",
                artifact: TESTS_ARTIFACT
              }
            }
          ]
        });
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

describe("Plan E Task 8 — end-to-end typed TestsArtifact handoff", () => {
  it("persists TestsArtifact on tests node and threads frontend artifact into tests ritual's priorArtifact.upstream", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const { ritualEngine, startCalls } = makeFakeRitualEngine();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    // Seed the run + nodes directly, bypassing the planner.
    const runId = "00000000-0000-0000-0000-0000000000bb";
    const projectId = "00000000-0000-0000-0000-000000000001";
    const userId = "user-1";
    const now = new Date();

    await runRepo.insert({
      id: runId,
      projectId,
      userId,
      prompt: "Build a frontend and run the unit tests",
      status: "awaiting_approval",
      dependencyProfile: { schemaVersion: "1" },
      createdAt: now,
      updatedAt: now
    });

    await nodeRepo.insertMany([
      {
        id: "frontend",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "Build the frontend app",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "tests",
        workflowRunId: runId,
        artifactKind: "tests",
        summary: "Run the unit tests",
        dependsOn: ["frontend"],
        consumes: ["frontend"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);

    // Approve plan → scheduler runs frontend then tests in dependency order.
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // (a) Tests node's persisted artifact must round-trip kind + framework + specs.
    const allNodes = await nodeRepo.findByRunId(runId);
    const testsNode = allNodes.find((n) => n.id === "tests");
    expect(testsNode).toBeDefined();
    const persistedArtifact = testsNode!.artifact as {
      kind?: string;
      framework?: string;
      specs?: unknown;
    };
    expect(persistedArtifact).toBeDefined();
    expect(persistedArtifact.kind).toBe("tests");
    expect(persistedArtifact.framework).toBe("vitest");
    expect(persistedArtifact.specs).toEqual(TESTS_ARTIFACT.specs);

    // (b) Tests ritual launch must have received the FrontendArtifact under
    //     priorArtifact.upstream.frontend with kind preserved through the
    //     generic-kind-fallback path.
    const testsCall = startCalls.find(
      (c) => c.input.userTurn === "Run the unit tests"
    );
    expect(testsCall).toBeDefined();
    const testsPrior = testsCall!.input.priorArtifact as {
      upstream: Record<string, { kind?: string }>;
    };
    expect(testsPrior).toBeDefined();
    expect(testsPrior.upstream).toHaveProperty("frontend");
    expect(testsPrior.upstream.frontend.kind).toBe("frontend-app");
  });
});
