// test/integration-cost-cap-exceeded.test.ts
// Plan G Task 10 — end-to-end integration test asserting the cost cap aborts
// a workflow mid-run.
//
// Drives a 3-node DAG (backend → frontend → tests) in-process with a fake
// IRitualEngine that records $0.05 of LLM usage per node ritual via the
// injected per-run tracker. With costCapUsd: 0.10, after the 2nd ritual
// completes the cap is exceeded → scheduler aborts → 3rd ritual never starts.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryUsageTracker } from "@atlas/llm-provider";
import "../src/artifact-contracts/backend-rest-api.js";
import "../src/artifact-contracts/tests.js";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// In-memory fakes — mirror engine-cost-cap-abort.test.ts.
// ---------------------------------------------------------------------------

type RunRow = {
  id: string;
  projectId: string;
  userId: string;
  prompt: string;
  status: string;
  dependencyProfile: unknown;
  concurrencyCap?: number | null;
  costCapUsd?: number | null;
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
        costCapUsd: (input as { costCapUsd?: number }).costCapUsd ?? null,
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
// Cost math: claude-sonnet-4-6 input price is $3.00 / 1M tokens.
// To record $0.05 of usage per node ritual: 0.05 * 1M / 3 ≈ 16_667 tokens.
// With costCapUsd: 0.10 and $0.05 per ritual, the cap is crossed after the
// 2nd node ritual completes ($0.10 > $0.10 is false, so we bump to slightly
// over $0.05/ritual to ensure cumulative > 0.10 after 2).
// ---------------------------------------------------------------------------
const TOKENS_FOR_5_CENTS_PLUS = Math.ceil((0.051 * 1_000_000) / 3.0);

describe("Plan G Task 10 — cost cap exceeded mid-run (integration)", () => {
  it("aborts the workflow after 2 of 3 rituals complete when cap = $0.10 and each ritual costs $0.05", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{
      ritualId: string;
      input: Parameters<IRitualEngine["start"]>[0];
    }> = [];
    let counter = 0;
    const plannerRitualIds = new Set<string>();

    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        startCalls.push({ ritualId, input });
        const isPlanner =
          input.priorArtifact === undefined ||
          (typeof input.priorArtifact === "object" &&
            input.priorArtifact !== null &&
            "suggestedKinds" in (input.priorArtifact as object));
        if (isPlanner) {
          plannerRitualIds.add(ritualId);
        } else {
          // Each NODE ritual records ~$0.05 of usage via the injected tracker.
          (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
            "anthropic",
            "claude-sonnet-4-6",
            { inputTokens: TOKENS_FOR_5_CENTS_PLUS, outputTokens: 0 }
          );
        }
        return ritualId;
      },
      async getRitual(ritualId) {
        if (plannerRitualIds.has(ritualId)) {
          return {
            state: "completed",
            roleEvents: [
              {
                eventType: "workflow_planner.dag.emitted",
                payload: {
                  nodes: [],
                  dependencyProfile: { schemaVersion: "1" }
                }
              }
            ]
          };
        }
        return { state: "completed", roleEvents: [] };
      },
      async abort() {}
    };

    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Build a 3-node thing",
      costCapUsd: 0.10
    });

    // Seed 3 nodes in a strict chain so they MUST run in order.
    await nodeRepo.insertMany([
      {
        id: "backend",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "Build API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "frontend",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "Build UI",
        dependsOn: ["backend"],
        consumes: ["backend"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "tests",
        workflowRunId: runId,
        artifactKind: "tests",
        summary: "Run tests",
        dependsOn: ["frontend"],
        consumes: ["frontend"],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // 1. Workflow ended aborted (status flipped from "running" by scheduler
    //    upon cost-cap exceeded).
    const row = await runRepo.findById(runId);
    expect(row?.status).toBe("aborted");

    // 2. Strictly fewer than 3 NODE rituals were dispatched. We exclude the
    //    planner ritual from this count.
    const nodeStartCalls = startCalls.filter(
      (c) => !plannerRitualIds.has(c.ritualId)
    );
    expect(nodeStartCalls.length).toBeLessThan(3);
    expect(nodeStartCalls.length).toBeGreaterThanOrEqual(1);

    // 3. The tests node (last in dependency chain) never started. Identify
    //    it by userTurn === "Run tests" (set as the node summary).
    const testsStart = startCalls.find(
      (c) => c.input.userTurn === "Run tests"
    );
    expect(testsStart).toBeUndefined();
  });

  it("completes normally when costCapUsd is unset (regression guard)", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const startCalls: Array<{
      ritualId: string;
      input: Parameters<IRitualEngine["start"]>[0];
    }> = [];
    let counter = 0;
    const plannerRitualIds = new Set<string>();

    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        startCalls.push({ ritualId, input });
        const isPlanner =
          input.priorArtifact === undefined ||
          (typeof input.priorArtifact === "object" &&
            input.priorArtifact !== null &&
            "suggestedKinds" in (input.priorArtifact as object));
        if (isPlanner) {
          plannerRitualIds.add(ritualId);
        } else {
          // Record a huge cost — would blow ANY cap, but no cap is set so
          // the scheduler must NOT abort.
          (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
            "anthropic",
            "claude-sonnet-4-6",
            { inputTokens: 100_000_000, outputTokens: 0 }
          );
        }
        return ritualId;
      },
      async getRitual(ritualId) {
        if (plannerRitualIds.has(ritualId)) {
          return {
            state: "completed",
            roleEvents: [
              {
                eventType: "workflow_planner.dag.emitted",
                payload: {
                  nodes: [],
                  dependencyProfile: { schemaVersion: "1" }
                }
              }
            ]
          };
        }
        return { state: "completed", roleEvents: [] };
      },
      async abort() {}
    };

    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "No cap"
    });
    await nodeRepo.insertMany([
      {
        id: "n1",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "A",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "n2",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "B",
        dependsOn: ["n1"],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    const row = await runRepo.findById(runId);
    expect(row?.status).not.toBe("aborted");

    // Both node rituals should have dispatched. Planner rituals excluded.
    const nodeStartCalls = startCalls.filter(
      (c) => !plannerRitualIds.has(c.ritualId)
    );
    expect(nodeStartCalls.length).toBe(2);
  });
});
