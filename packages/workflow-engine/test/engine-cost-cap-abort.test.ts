// test/engine-cost-cap-abort.test.ts
// Plan G Task 5 — verifies the WorkflowScheduler aborts the workflow when
// the per-run LLMUsageTracker.totalUsd() exceeds run.costCapUsd after a
// ritual completes.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { InMemoryUsageTracker } from "@atlas/llm-provider";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine
} from "../src/engine.js";

// ---------------------------------------------------------------------------
// Local fakes — mirror engine-cost-cap.test.ts, extended so node rows insert
// well and findByRunId returns enough info for the scheduler.
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

// claude-sonnet-4-6 input price is $3.00 / 1M tokens.
// To record ~$0.06 of usage per ritual (so two rituals cross a $0.10 cap):
const TOKENS_PER_6_CENTS = Math.ceil((0.06 * 1_000_000) / 3.0);

describe("Plan G — cost cap abort", () => {
  it("aborts the workflow when totalUsd exceeds costCapUsd after a ritual completes", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const abortCalls: string[] = [];
    let counter = 0;
    // Map from ritualId to its returned snapshot. Planner ritual returns an
    // empty DAG (so engine.start() inserts no nodes — we seed nodes directly
    // afterwards). Node rituals return a generic completed snapshot.
    const plannerRitualIds = new Set<string>();

    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        const isPlanner = input.priorArtifact === undefined ||
          (typeof input.priorArtifact === "object" &&
            input.priorArtifact !== null &&
            "suggestedKinds" in (input.priorArtifact as object));
        if (isPlanner) {
          plannerRitualIds.add(ritualId);
        } else {
          // Each NODE ritual records 6 cents of usage.
          (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
            "anthropic",
            "claude-sonnet-4-6",
            { inputTokens: TOKENS_PER_6_CENTS, outputTokens: 0 }
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
      async abort(ritualId) {
        abortCalls.push(ritualId);
      }
    };

    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });
    const runId = await engine.start({
      projectId: randomUUID(),
      userId: "user-1",
      prompt: "Build a 3-node thing",
      costCapUsd: 0.10 // cap exceeded after 2nd ritual ($0.12 > $0.10)
    });

    // Seed 3 nodes directly so we can deterministically test multi-node abort.
    await nodeRepo.insertMany([
      {
        id: "n1",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "Build API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "n2",
        workflowRunId: runId,
        artifactKind: "frontend-app",
        summary: "Build UI",
        dependsOn: ["n1"],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      },
      {
        id: "n3",
        workflowRunId: runId,
        artifactKind: "tests",
        summary: "Test",
        dependsOn: ["n2"],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // Run should be aborted (status was flipped from "running" by the
    // scheduler upon cost-cap exceeded).
    const row = await runRepo.findById(runId);
    expect(row?.status).toBe("aborted");

    // The 3rd ritual (tests) should never have started.
    const allNodes = await nodeRepo.findByRunId(runId);
    expect(allNodes.length).toBe(3);
    const completedNodes = allNodes.filter((n) => n.status === "done");
    expect(completedNodes.length).toBeLessThan(3);
  });

  it("does NOT abort when costCapUsd is unset (no cap)", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    let counter = 0;
    const plannerRitualIds = new Set<string>();

    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        const isPlanner = input.priorArtifact === undefined ||
          (typeof input.priorArtifact === "object" &&
            input.priorArtifact !== null &&
            "suggestedKinds" in (input.priorArtifact as object));
        if (isPlanner) {
          plannerRitualIds.add(ritualId);
        } else {
          // Record a huge amount of usage — would trip any reasonable cap.
          (input.usageTracker as InMemoryUsageTracker | undefined)?.record(
            "anthropic",
            "claude-sonnet-4-6",
            { inputTokens: 10_000_000, outputTokens: 0 }
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
      prompt: "no cap"
    });
    await nodeRepo.insertMany([
      {
        id: "n1",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "Build API",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);
    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);
    const row = await runRepo.findById(runId);
    expect(row?.status).not.toBe("aborted");
  });

  it("removes the per-run usageTracker on terminal status (memory leak guard)", async () => {
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    let counter = 0;
    const plannerRitualIds = new Set<string>();

    const ritualEngine: IRitualEngine = {
      async start(input) {
        const ritualId = `r-${++counter}`;
        const isPlanner = input.priorArtifact === undefined ||
          (typeof input.priorArtifact === "object" &&
            input.priorArtifact !== null &&
            "suggestedKinds" in (input.priorArtifact as object));
        if (isPlanner) plannerRitualIds.add(ritualId);
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
      prompt: "cleanup test"
    });
    await nodeRepo.insertMany([
      {
        id: "n1",
        workflowRunId: runId,
        artifactKind: "backend-rest-api",
        summary: "x",
        dependsOn: [],
        consumes: [],
        policy: { priority: 0, runMode: "active" },
        status: "pending"
      }
    ]);
    // Tracker exists pre-completion
    expect(engine._getUsageTracker(runId)).toBeDefined();

    await engine.approvePlan(runId);
    await engine._waitForScheduler(runId);

    // Workflow completed normally → tracker should be cleaned up.
    expect(engine._getUsageTracker(runId)).toBeUndefined();
  });
});
