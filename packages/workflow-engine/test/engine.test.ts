// test/engine.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkflowEngine } from "../src/engine.js";
import type {
  IWorkflowRunRepo,
  IWorkflowNodeRepo,
  IRitualEngine,
  StartWorkflowInput
} from "../src/engine.js";
import {
  WorkflowNotFoundError,
  WorkflowAlreadyApprovedError,
  NodeNotFoundError,
  InvalidNodePolicyEditError
} from "../src/errors.js";

// ---------------------------------------------------------------------------
// In-memory fake implementations
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
  const store = new Map<string, NodeRow>(); // keyed by "runId:nodeId"
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

/**
 * Builds a stub RitualEngine that uses the StubWorkflowPlannerRole event
 * format: on start() it immediately stores a snapshot with roleEvents,
 * returning a ritualId. getRitual() returns that snapshot.
 */
function makeRitualEngine(): IRitualEngine & {
  startCalled: string[];
  abortCalled: string[];
} {
  const snapshots = new Map<string, {
    state: string;
    roleEvents: Array<{ eventType: string; payload: unknown }>;
  }>();
  const startCalled: string[] = [];
  const abortCalled: string[] = [];
  let counter = 0;

  return {
    startCalled,
    abortCalled,
    async start(input) {
      const ritualId = `ritual-${++counter}`;
      startCalled.push(ritualId);

      // Determine the artifactKind from priorArtifact (matches StubWorkflowPlannerRole)
      const prior = input.priorArtifact as { suggestedKinds?: string[] } | undefined;
      const kind = prior?.suggestedKinds?.[0] ?? "frontend-app";

      snapshots.set(ritualId, {
        state: "completed",
        roleEvents: [
          {
            eventType: "workflow_planner.dag.emitted",
            payload: {
              nodes: [
                {
                  id: "n1",
                  artifactKind: kind,
                  summary: `Build the ${kind}`,
                  dependsOn: [],
                  consumes: [],
                  policy: { priority: 0, runMode: "active" }
                }
              ],
              dependencyProfile: { schemaVersion: "1" }
            }
          }
        ]
      });
      return ritualId;
    },
    async getRitual(ritualId) {
      return snapshots.get(ritualId);
    },
    async abort(ritualId) {
      abortCalled.push(ritualId);
    }
  };
}

/**
 * Multi-node ritual engine — emits a custom set of nodes from the planner.
 */
function makeMultiNodeRitualEngine(nodes: Array<{
  id: string;
  artifactKind: string;
  summary: string;
  dependsOn: string[];
  consumes: string[];
  policy: { priority: number; runMode: string };
}>): IRitualEngine {
  const snapshots = new Map<string, { state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }>();
  let counter = 0;
  return {
    async start(_input) {
      const ritualId = `ritual-${++counter}`;
      snapshots.set(ritualId, {
        state: "completed",
        roleEvents: [
          {
            eventType: "workflow_planner.dag.emitted",
            payload: { nodes, dependencyProfile: { schemaVersion: "1" } }
          }
        ]
      });
      return ritualId;
    },
    async getRitual(ritualId) { return snapshots.get(ritualId); },
    async abort() {}
  };
}

function makeEngine(
  overrides: {
    runRepo?: IWorkflowRunRepo;
    nodeRepo?: IWorkflowNodeRepo;
    ritualEngine?: IRitualEngine;
  } = {}
) {
  const runRepo = overrides.runRepo ?? makeRunRepo();
  const nodeRepo = overrides.nodeRepo ?? makeNodeRepo();
  const ritualEngine = overrides.ritualEngine ?? makeRitualEngine();
  const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });
  return { engine, runRepo, nodeRepo, ritualEngine };
}

const defaultInput: StartWorkflowInput = {
  projectId: "00000000-0000-0000-0000-000000000001",
  userId: "user-1",
  prompt: "Build a todo app"
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowEngine", () => {
  describe("start()", () => {
    it("returns a UUID workflowRunId", async () => {
      const { engine } = makeEngine();
      const id = await engine.start(defaultInput);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("inserts a run row with status=planning then flips to awaiting_approval", async () => {
      const runRepo = makeRunRepo();
      const statusChanges: string[] = [];
      const origInsert = runRepo.insert.bind(runRepo);
      runRepo.insert = async (input) => {
        statusChanges.push(input.status);
        return origInsert(input);
      };
      const origUpdate = runRepo.updateStatus.bind(runRepo);
      runRepo.updateStatus = async (id, status) => {
        statusChanges.push(status);
        return origUpdate(id, status);
      };
      const { engine } = makeEngine({ runRepo });
      await engine.start(defaultInput);
      expect(statusChanges[0]).toBe("planning");
      expect(statusChanges[statusChanges.length - 1]).toBe("awaiting_approval");
    });

    it("inserts workflow nodes after planner emits DAG", async () => {
      const nodeRepo = makeNodeRepo();
      const { engine } = makeEngine({ nodeRepo });
      const runId = await engine.start(defaultInput);
      const nodes = await nodeRepo.findByRunId(runId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.id).toBe("n1");
      expect(nodes[0]!.artifactKind).toBe("frontend-app");
      expect(nodes[0]!.status).toBe("pending");
    });

    it("launches the planner ritual", async () => {
      const ritualEngine = makeRitualEngine();
      const { engine } = makeEngine({ ritualEngine });
      await engine.start(defaultInput);
      expect(ritualEngine.startCalled).toHaveLength(1);
    });

    it("respects artifactKindHint in priorArtifact to planner", async () => {
      const nodeRepo = makeNodeRepo();
      const { engine } = makeEngine({ nodeRepo });
      const runId = await engine.start({ ...defaultInput, artifactKindHint: "backend-rest-api" });
      const nodes = await nodeRepo.findByRunId(runId);
      expect(nodes[0]!.artifactKind).toBe("backend-rest-api");
    });

    it("final run status is awaiting_approval", async () => {
      const runRepo = makeRunRepo();
      const { engine } = makeEngine({ runRepo });
      const runId = await engine.start(defaultInput);
      const row = await runRepo.findById(runId);
      expect(row!.status).toBe("awaiting_approval");
    });
  });

  describe("approvePlan()", () => {
    async function startAndGetId(engine: WorkflowEngine): Promise<string> {
      return engine.start(defaultInput);
    }

    it("flips status to running then to completed after scheduler finishes", async () => {
      const runRepo = makeRunRepo();
      const { engine } = makeEngine({ runRepo });
      const runId = await startAndGetId(engine);
      await engine.approvePlan(runId);
      await engine._waitForScheduler(runId);
      const row = await runRepo.findById(runId);
      expect(row!.status).toBe("completed");
    });

    it("marks all nodes as done after approve", async () => {
      const nodeRepo = makeNodeRepo();
      const { engine } = makeEngine({ nodeRepo });
      const runId = await engine.start(defaultInput);
      await engine.approvePlan(runId);
      await engine._waitForScheduler(runId);
      const nodes = await nodeRepo.findByRunId(runId);
      expect(nodes.every((n) => n.status === "done")).toBe(true);
    });

    it("throws WorkflowNotFoundError for unknown run", async () => {
      const { engine } = makeEngine();
      await expect(engine.approvePlan("nonexistent-id")).rejects.toThrow(
        WorkflowNotFoundError
      );
    });

    it("throws WorkflowAlreadyApprovedError if status is not awaiting_approval", async () => {
      const { engine } = makeEngine();
      const runId = await engine.start(defaultInput);
      await engine.approvePlan(runId); // flips to completed
      await engine._waitForScheduler(runId);
      await expect(engine.approvePlan(runId)).rejects.toThrow(
        WorkflowAlreadyApprovedError
      );
    });

    it("applies policy + summary edits before running", async () => {
      const nodeRepo = makeNodeRepo();
      const { engine } = makeEngine({ nodeRepo });
      const runId = await engine.start(defaultInput);

      await engine.approvePlan(runId, [
        { nodeId: "n1", policy: { priority: 7 }, summary: "Renamed summary" }
      ]);
      await engine._waitForScheduler(runId);

      const nodes = await nodeRepo.findByRunId(runId);
      const n1 = nodes.find((n) => n.id === "n1")!;
      expect(n1.summary).toBe("Renamed summary");
      const policy = n1.policy as { priority: number };
      expect(policy.priority).toBe(7);
    });
  });

  describe("retryNode()", () => {
    it("resets a failed node to pending and re-runs scheduler to completion", async () => {
      const runRepo = makeRunRepo();
      const nodeRepo = makeNodeRepo();
      const { engine } = makeEngine({ runRepo, nodeRepo });

      const runId = await engine.start(defaultInput);
      // Manually mark node as failed to simulate a failure
      await nodeRepo.updateStatus(runId, "n1", "failed", {
        failure: { error: "test err", attempts: 1 }
      });
      await runRepo.updateStatus(runId, "escalated");

      await engine.retryNode(runId, "n1");
      await engine._waitForScheduler(runId);

      const nodes = await nodeRepo.findByRunId(runId);
      expect(nodes[0]!.status).toBe("done");
      const runRow = await runRepo.findById(runId);
      expect(runRow!.status).toBe("completed");
    });

    it("throws WorkflowNotFoundError for unknown run", async () => {
      const { engine } = makeEngine();
      await expect(engine.retryNode("bad-run", "n1")).rejects.toThrow(
        WorkflowNotFoundError
      );
    });

    it("throws NodeNotFoundError for unknown node", async () => {
      const { engine } = makeEngine();
      const runId = await engine.start(defaultInput);
      await expect(engine.retryNode(runId, "not-a-node")).rejects.toThrow(
        NodeNotFoundError
      );
    });

    it("throws InvalidNodePolicyEditError when node is not in failed state", async () => {
      const { engine } = makeEngine();
      const runId = await engine.start(defaultInput);
      // n1 is pending after start(), not failed
      await expect(engine.retryNode(runId, "n1")).rejects.toThrow(
        InvalidNodePolicyEditError
      );
    });
  });

  describe("abort()", () => {
    it("sets workflow status to aborted", async () => {
      const runRepo = makeRunRepo();
      const { engine } = makeEngine({ runRepo });
      const runId = await engine.start(defaultInput);
      await engine.abort(runId, "user cancelled");
      const row = await runRepo.findById(runId);
      expect(row!.status).toBe("aborted");
    });

    it("calls ritualEngine.abort for any running node rituals", async () => {
      const runRepo = makeRunRepo();
      const nodeRepo = makeNodeRepo();
      const ritualEngine = makeRitualEngine();
      const { engine } = makeEngine({ runRepo, nodeRepo, ritualEngine });

      const runId = await engine.start(defaultInput);
      // Mark n1 as running with a ritualId
      await nodeRepo.updateStatus(runId, "n1", "running", { ritualId: "ritual-xyz" });

      await engine.abort(runId, "cancelled");

      expect(ritualEngine.abortCalled).toContain("ritual-xyz");
    });

    it("throws WorkflowNotFoundError for unknown run", async () => {
      const { engine } = makeEngine();
      await expect(engine.abort("bad-run", "reason")).rejects.toThrow(
        WorkflowNotFoundError
      );
    });
  });

  describe("setNodePolicy()", () => {
    it("calls nodeRepo.updatePolicy with the new policy", async () => {
      const nodeRepo = makeNodeRepo();
      const updatePolicyCalls: Array<{ nodeId: string; policy: unknown }> = [];
      const origUpdate = nodeRepo.updatePolicy.bind(nodeRepo);
      nodeRepo.updatePolicy = async (runId, nodeId, policy) => {
        updatePolicyCalls.push({ nodeId, policy });
        return origUpdate(runId, nodeId, policy);
      };

      const { engine } = makeEngine({ nodeRepo });
      const runId = await engine.start(defaultInput);

      await engine.setNodePolicy(runId, "n1", { priority: 5, runMode: "background" });

      expect(updatePolicyCalls).toHaveLength(1);
      expect(updatePolicyCalls[0]!.nodeId).toBe("n1");
      const policy = updatePolicyCalls[0]!.policy as { priority: number; runMode: string };
      expect(policy.priority).toBe(5);
    });

    it("throws WorkflowNotFoundError for unknown run", async () => {
      const { engine } = makeEngine();
      await expect(
        engine.setNodePolicy("bad-run", "n1", { priority: 1, runMode: "active" })
      ).rejects.toThrow(WorkflowNotFoundError);
    });

    it("throws NodeNotFoundError for unknown node", async () => {
      const { engine } = makeEngine();
      const runId = await engine.start(defaultInput);
      await expect(
        engine.setNodePolicy(runId, "no-such-node", { priority: 1, runMode: "active" })
      ).rejects.toThrow(NodeNotFoundError);
    });
  });

  describe("getRun()", () => {
    it("returns undefined for unknown run", async () => {
      const { engine } = makeEngine();
      const result = await engine.getRun("not-found");
      expect(result).toBeUndefined();
    });

    it("returns a snapshot with correct fields after start()", async () => {
      const { engine } = makeEngine();
      const runId = await engine.start(defaultInput);
      const snapshot = await engine.getRun(runId);
      expect(snapshot).toBeDefined();
      expect(snapshot!.id).toBe(runId);
      expect(snapshot!.projectId).toBe(defaultInput.projectId);
      expect(snapshot!.userId).toBe(defaultInput.userId);
      expect(snapshot!.prompt).toBe(defaultInput.prompt);
      expect(snapshot!.status).toBe("awaiting_approval");
      expect(snapshot!.nodes).toHaveLength(1);
      expect(snapshot!.nodes[0]!.id).toBe("n1");
    });

    it("returns completed snapshot after approvePlan()", async () => {
      const { engine } = makeEngine();
      const runId = await engine.start(defaultInput);
      await engine.approvePlan(runId);
      await engine._waitForScheduler(runId);
      const snapshot = await engine.getRun(runId);
      expect(snapshot!.status).toBe("completed");
      expect(snapshot!.nodes[0]!.status).toBe("done");
    });
  });
});

// ---------------------------------------------------------------------------
// F2: dependencyProfile is persisted after start()
// ---------------------------------------------------------------------------

describe("F2 — dependencyProfile persistence", () => {
  it("getRun() returns the planner-emitted dependencyProfile after start()", async () => {
    const runRepo = makeRunRepo();
    const { engine } = makeEngine({ runRepo });
    const runId = await engine.start(defaultInput);
    const run = await runRepo.findById(runId);
    // The fake planner emits { schemaVersion: "1" }; it should now be persisted
    expect(run!.dependencyProfile).toBeDefined();
    const profile = run!.dependencyProfile as { schemaVersion: string };
    expect(profile.schemaVersion).toBe("1");
  });

  it("updateDependencyProfile is called on the runRepo during start()", async () => {
    const runRepo = makeRunRepo();
    const updateCalls: unknown[] = [];
    const orig = runRepo.updateDependencyProfile.bind(runRepo);
    runRepo.updateDependencyProfile = async (id, profile) => {
      updateCalls.push({ id, profile });
      return orig(id, profile);
    };
    const { engine } = makeEngine({ runRepo });
    await engine.start(defaultInput);
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0] as { profile: { schemaVersion: string } };
    expect(call.profile.schemaVersion).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// F4: approvePlan is fire-and-forget; _waitForScheduler resolves after done
// ---------------------------------------------------------------------------

describe("F4 — fire-and-forget scheduler", () => {
  it("approvePlan() returns before scheduler finishes; _waitForScheduler awaits completion", async () => {
    const runRepo = makeRunRepo();
    const { engine } = makeEngine({ runRepo });
    const runId = await engine.start(defaultInput);

    // approvePlan returns immediately (fire-and-forget)
    await engine.approvePlan(runId);
    // At this point the scheduler may or may not be done; that's fine.
    // _waitForScheduler must eventually resolve with completed status.
    await engine._waitForScheduler(runId);

    const row = await runRepo.findById(runId);
    expect(row!.status).toBe("completed");
  });

  it("_waitForScheduler resolves immediately when no scheduler is running", async () => {
    const { engine } = makeEngine();
    // No scheduler started for this run
    await expect(engine._waitForScheduler("nonexistent")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F5: retryNode resets transitively-blocked descendants
// ---------------------------------------------------------------------------

describe("F5 — retryNode resets blocked descendants", () => {
  it("diamond DAG: retrying b resets b and d to pending; c (done) untouched", async () => {
    // a → root; b → a; c → a; d → (b, c)
    const nodes = [
      { id: "a", artifactKind: "frontend-app", summary: "A", dependsOn: [], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "b", artifactKind: "frontend-app", summary: "B", dependsOn: ["a"], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "c", artifactKind: "frontend-app", summary: "C", dependsOn: ["a"], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "d", artifactKind: "frontend-app", summary: "D", dependsOn: ["b", "c"], consumes: [], policy: { priority: 0, runMode: "active" } }
    ];
    const ritualEngine = makeMultiNodeRitualEngine(nodes);
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start(defaultInput);

    // Simulate: a=done, c=done, b=failed, d=blocked
    await nodeRepo.updateStatus(runId, "a", "done");
    await nodeRepo.updateStatus(runId, "c", "done");
    await nodeRepo.updateStatus(runId, "b", "failed", { failure: { error: "boom", attempts: 1 } });
    await nodeRepo.updateStatus(runId, "d", "blocked");
    await runRepo.updateStatus(runId, "escalated");

    await engine.retryNode(runId, "b");
    await engine._waitForScheduler(runId);

    const bNode = await nodeRepo.findOne(runId, "b");
    const dNode = await nodeRepo.findOne(runId, "d");
    const cNode = await nodeRepo.findOne(runId, "c");

    // b and d should be done (re-ran); c stays done
    expect(bNode!.status).toBe("done");
    expect(dNode!.status).toBe("done");
    expect(cNode!.status).toBe("done"); // unchanged
  });

  it("chain a→b→c→d: retrying b resets b, c, d to pending then to done", async () => {
    const nodes = [
      { id: "a", artifactKind: "frontend-app", summary: "A", dependsOn: [], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "b", artifactKind: "frontend-app", summary: "B", dependsOn: ["a"], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "c", artifactKind: "frontend-app", summary: "C", dependsOn: ["b"], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "d", artifactKind: "frontend-app", summary: "D", dependsOn: ["c"], consumes: [], policy: { priority: 0, runMode: "active" } }
    ];
    const ritualEngine = makeMultiNodeRitualEngine(nodes);
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start(defaultInput);

    // a=done, b=failed, c+d=blocked
    await nodeRepo.updateStatus(runId, "a", "done");
    await nodeRepo.updateStatus(runId, "b", "failed", { failure: { error: "err", attempts: 1 } });
    await nodeRepo.updateStatus(runId, "c", "blocked");
    await nodeRepo.updateStatus(runId, "d", "blocked");
    await runRepo.updateStatus(runId, "escalated");

    await engine.retryNode(runId, "b");
    await engine._waitForScheduler(runId);

    const statuses = await Promise.all(["b", "c", "d"].map((id) => nodeRepo.findOne(runId, id)));
    expect(statuses.every((n) => n!.status === "done")).toBe(true);
  });

  it("sibling-not-dependent: retrying a only resets a+c; b and d untouched", async () => {
    // a (root), b (root, independent), c → a, d → b
    const nodes = [
      { id: "a", artifactKind: "frontend-app", summary: "A", dependsOn: [], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "b", artifactKind: "frontend-app", summary: "B", dependsOn: [], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "c", artifactKind: "frontend-app", summary: "C", dependsOn: ["a"], consumes: [], policy: { priority: 0, runMode: "active" } },
      { id: "d", artifactKind: "frontend-app", summary: "D", dependsOn: ["b"], consumes: [], policy: { priority: 0, runMode: "active" } }
    ];
    const ritualEngine = makeMultiNodeRitualEngine(nodes);
    const runRepo = makeRunRepo();
    const nodeRepo = makeNodeRepo();
    const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo });

    const runId = await engine.start(defaultInput);

    // a=failed, c=blocked, b=done, d=done
    await nodeRepo.updateStatus(runId, "a", "failed", { failure: { error: "err", attempts: 1 } });
    await nodeRepo.updateStatus(runId, "c", "blocked");
    await nodeRepo.updateStatus(runId, "b", "done");
    await nodeRepo.updateStatus(runId, "d", "done");
    await runRepo.updateStatus(runId, "escalated");

    await engine.retryNode(runId, "a");
    await engine._waitForScheduler(runId);

    const aNode = await nodeRepo.findOne(runId, "a");
    const cNode = await nodeRepo.findOne(runId, "c");
    const bNode = await nodeRepo.findOne(runId, "b");
    const dNode = await nodeRepo.findOne(runId, "d");

    expect(aNode!.status).toBe("done");
    expect(cNode!.status).toBe("done");
    // b and d stay done (untouched)
    expect(bNode!.status).toBe("done");
    expect(dNode!.status).toBe("done");
  });

  // ---------------------------------------------------------------------------
  // Plan C: broker emit tests
  // ---------------------------------------------------------------------------

  describe("broker emit — workflow.run/node.status_changed", () => {
    function makeStubBroker() {
      const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
      return {
        published,
        async publish(event: { projectId: string; ritualId: string; type: string; payload: Record<string, unknown>; ts: number }) {
          published.push({ type: event.type, payload: event.payload });
          return event;
        }
      };
    }

    it("emits workflow.run.status_changed(awaiting_approval) when start() completes", async () => {
      const broker = makeStubBroker();
      const runRepo = makeRunRepo();
      const nodeRepo = makeNodeRepo();
      const ritualEngine = makeRitualEngine();
      const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo, broker });

      const runId = await engine.start(defaultInput);
      // Allow any fire-and-forget promises to flush
      await new Promise((r) => setTimeout(r, 0));

      const runEvents = broker.published.filter((e) => e.type === "workflow.run.status_changed");
      expect(runEvents.length).toBeGreaterThanOrEqual(1);
      const approval = runEvents.find((e) => e.payload.status === "awaiting_approval");
      expect(approval).toBeDefined();
      expect(approval!.payload.workflowRunId).toBe(runId);
    });

    it("emits workflow.run.status_changed(running) and workflow.node.status_changed(done) after approvePlan()", async () => {
      const broker = makeStubBroker();
      const runRepo = makeRunRepo();
      const nodeRepo = makeNodeRepo();
      const ritualEngine = makeRitualEngine();
      const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo, broker });

      const runId = await engine.start(defaultInput);
      broker.published.length = 0; // reset to isolate approve-phase events

      await engine.approvePlan(runId);
      await engine._waitForScheduler(runId);
      await new Promise((r) => setTimeout(r, 0));

      const runEvents = broker.published.filter((e) => e.type === "workflow.run.status_changed");
      const nodeEvents = broker.published.filter((e) => e.type === "workflow.node.status_changed");

      expect(runEvents.some((e) => e.payload.status === "running")).toBe(true);
      expect(nodeEvents.length).toBeGreaterThanOrEqual(1);
      expect(nodeEvents.every((e) => e.payload.workflowRunId === runId)).toBe(true);
    });

    it("emits workflow.run.status_changed(aborted) when abort() is called", async () => {
      const broker = makeStubBroker();
      const runRepo = makeRunRepo();
      const nodeRepo = makeNodeRepo();
      const ritualEngine = makeRitualEngine();
      const engine = new WorkflowEngine({ ritualEngine, runRepo, nodeRepo, broker });

      const runId = await engine.start(defaultInput);
      broker.published.length = 0;

      await engine.abort(runId, "test-abort");
      await new Promise((r) => setTimeout(r, 0));

      const abortEvent = broker.published.find(
        (e) => e.type === "workflow.run.status_changed" && e.payload.status === "aborted"
      );
      expect(abortEvent).toBeDefined();
      expect(abortEvent!.payload.workflowRunId).toBe(runId);
    });
  });
});
