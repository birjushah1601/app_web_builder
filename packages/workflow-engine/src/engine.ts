// src/engine.ts
import { randomUUID } from "node:crypto";
import type {
  WorkflowNode,
  WorkflowRunSnapshot,
  DependencyProfile,
  NodePolicy
} from "./types.js";

// ---------------------------------------------------------------------------
// Minimal EventBroker interface — only what the engine needs for emitting
// workflow status events. Keeps the engine free of atlas-web imports.
// ---------------------------------------------------------------------------

export interface IEventBrokerForEngine {
  publish(event: {
    projectId: string;
    ritualId: string;
    type: string;
    payload: Record<string, unknown>;
    ts: number;
  }): Promise<unknown>;
}
import {
  WorkflowNodeSchema,
  DependencyProfileSchema
} from "./types.js";
import { WorkflowScheduler } from "./scheduler.js";
import {
  WorkflowNotFoundError,
  WorkflowAlreadyApprovedError,
  NodeNotFoundError,
  InvalidNodePolicyEditError
} from "./errors.js";

// ---------------------------------------------------------------------------
// Minimal repo interfaces — the engine depends on these abstractions so that
// tests can inject in-memory fakes without importing real DB adapters.
// ---------------------------------------------------------------------------

export interface IWorkflowRunRepo {
  insert(input: {
    id: string;
    projectId: string;
    userId: string;
    prompt: string;
    status: string;
    dependencyProfile: unknown;
    concurrencyCap?: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<{ id: string; status: string; createdAt: Date | string; updatedAt: Date | string }>;
  findById(id: string): Promise<{ id: string; projectId: string; userId: string; prompt: string; status: string; dependencyProfile: unknown; concurrencyCap?: number | null; createdAt: Date | string; updatedAt: Date | string } | undefined>;
  updateStatus(id: string, status: string): Promise<void>;
  updateDependencyProfile(id: string, dependencyProfile: unknown): Promise<void>;
}

export interface IWorkflowNodeRepo {
  insertMany(rows: Array<{
    id: string;
    workflowRunId: string;
    artifactKind: string;
    summary: string;
    dependsOn: string[];
    consumes: string[];
    policy: unknown;
    status: string;
    ritualId?: string;
  }>): Promise<Array<{ id: string; status: string }>>;
  findByRunId(runId: string): Promise<Array<{
    id: string;
    workflowRunId: string;
    artifactKind: string;
    summary: string;
    dependsOn: unknown;
    consumes: unknown;
    policy: unknown;
    status: string;
    ritualId?: string | null;
    artifact?: unknown;
    failure?: unknown;
  }>>;
  findOne(runId: string, nodeId: string): Promise<{
    id: string;
    status: string;
    ritualId?: string | null;
  } | undefined>;
  updateStatus(runId: string, nodeId: string, status: string, opts?: {
    ritualId?: string;
    failure?: unknown;
    startedAt?: Date;
    completedAt?: Date;
  }): Promise<void>;
  setArtifact(runId: string, nodeId: string, artifact: unknown, schemaVersion: string): Promise<void>;
  updatePolicy(runId: string, nodeId: string, policy: unknown): Promise<void>;
}

export interface IWorkflowCheckpointRepo {
  append?(input: {
    workflowRunId: string;
    nodeId: string;
    kind: string;
    payload: unknown;
    ritualEventId?: string;
  }): Promise<void>;
}

/**
 * Minimal interface for a CheckpointRecorder — only what the engine needs.
 * The full CheckpointRecorder class from checkpoints.ts satisfies this.
 */
export interface ICheckpointRecorder {
  registerRitualForNode(ritualId: string, workflowRunId: string, nodeId: string): void;
  onEvent(event: { type: string; ritualId: string; payload?: unknown; ritualEventId?: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Minimal RitualEngine interface (subset used by WorkflowEngine).
// ---------------------------------------------------------------------------

export interface IRitualEngine {
  start(input: {
    userTurn: string;
    editClass: "structural" | "additive" | "cosmetic";
    projectId: string;
    userId: string;
    priorArtifact?: unknown;
  }): Promise<string>;
  getRitual(ritualId: string): Promise<{
    state: string;
    roleEvents: Array<{ eventType: string; payload: unknown }>;
  } | undefined>;
  abort(ritualId: string, reason: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface StartWorkflowInput {
  projectId: string;
  userId: string;
  prompt: string;
  artifactKindHint?: string;
  concurrencyCap?: number;
}

export interface PlanEdit {
  nodeId: string;
  policy?: Partial<NodePolicy>;
}

export interface WorkflowEngineOptions {
  ritualEngine: IRitualEngine;
  runRepo: IWorkflowRunRepo;
  nodeRepo: IWorkflowNodeRepo;
  checkpointRepo?: IWorkflowCheckpointRepo;
  /** F3: optional CheckpointRecorder wired to the project's broker */
  checkpointRecorder?: ICheckpointRecorder;
  /** Plan C: optional broker for emitting workflow.run/node.status_changed SSE
   *  events. When absent (tests that don't need SSE), status updates still
   *  persist to the repo — only broker publishing is skipped. */
  broker?: IEventBrokerForEngine;
}

// ---------------------------------------------------------------------------
// WorkflowEngine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  private readonly opts: WorkflowEngineOptions;

  /**
   * F4: tracks in-flight scheduler promises so tests can await completion
   * without blocking the HTTP response in production.
   * Key = workflowRunId.
   */
  private readonly runningSchedulers = new Map<string, Promise<void>>();

  constructor(opts: WorkflowEngineOptions) {
    this.opts = opts;
  }

  /**
   * Test-only helper (underscore prefix = internal API).
   * Returns the in-flight scheduler promise for a given run, or
   * resolves immediately if no scheduler is currently running.
   */
  _waitForScheduler(workflowRunId: string): Promise<void> {
    return this.runningSchedulers.get(workflowRunId) ?? Promise.resolve();
  }

  // ---------------------------------------------------------------------------
  // Plan C: SSE emit helpers
  // Fire-and-forget — a broker publish failure must never crash the engine.
  // ---------------------------------------------------------------------------

  private emitRunStatus(
    projectId: string,
    workflowRunId: string,
    status: string
  ): void {
    const { broker } = this.opts;
    if (!broker) return;
    void broker.publish({
      projectId,
      ritualId: workflowRunId,
      type: "workflow.run.status_changed",
      payload: { workflowRunId, status },
      ts: Date.now()
    }).catch((err) => {
      console.error("[workflow-engine] broker emit (run status) failed:", err);
    });
  }

  private emitNodeStatus(
    projectId: string,
    workflowRunId: string,
    nodeId: string,
    status: string,
    extras?: { ritualId?: string; artifact?: unknown; failure?: unknown }
  ): void {
    const { broker } = this.opts;
    if (!broker) return;
    void broker.publish({
      projectId,
      ritualId: workflowRunId,
      type: "workflow.node.status_changed",
      payload: {
        workflowRunId,
        nodeId,
        status,
        ...(extras?.ritualId !== undefined && { ritualId: extras.ritualId }),
        ...(extras?.artifact !== undefined && { artifact: extras.artifact }),
        ...(extras?.failure !== undefined && { failure: extras.failure })
      },
      ts: Date.now()
    }).catch((err) => {
      console.error("[workflow-engine] broker emit (node status) failed:", err);
    });
  }

  /**
   * Starts a new workflow run:
   * 1. Inserts a workflow_runs row (status=planning).
   * 2. Launches a workflow-planner ritual.
   * 3. Reads the emitted DAG from the ritual's roleEvents.
   * 4. Inserts the workflow_nodes rows.
   * 5. Flips status to awaiting_approval.
   * Returns the workflowRunId.
   */
  async start(input: StartWorkflowInput): Promise<string> {
    const { ritualEngine, runRepo, nodeRepo } = this.opts;
    const runId = randomUUID();
    const now = new Date();

    // 1. Insert workflow run
    await runRepo.insert({
      id: runId,
      projectId: input.projectId,
      userId: input.userId,
      prompt: input.prompt,
      status: "planning",
      dependencyProfile: { schemaVersion: "1" },
      ...(input.concurrencyCap !== undefined && { concurrencyCap: input.concurrencyCap }),
      createdAt: now,
      updatedAt: now
    });

    // 2. Launch workflow-planner ritual
    const plannerRitualId = await ritualEngine.start({
      userTurn: input.prompt,
      editClass: "structural",
      projectId: input.projectId,
      userId: input.userId,
      priorArtifact: input.artifactKindHint
        ? { suggestedKinds: [input.artifactKindHint] }
        : undefined
    });

    // 3. Read emitted DAG from ritual snapshot
    const { nodes, dependencyProfile } = await this.awaitPlannerDag(plannerRitualId);

    // 4. Insert nodes (set status=pending; planner emits nodes without status)
    const nodeRows = nodes.map((n) => ({
      id: n.id,
      workflowRunId: runId,
      artifactKind: n.artifactKind,
      summary: n.summary,
      dependsOn: n.dependsOn,
      consumes: n.consumes,
      policy: n.policy,
      status: "pending" as const
    }));
    if (nodeRows.length > 0) {
      await nodeRepo.insertMany(nodeRows);
    }

    // 5a. Persist the planner's dependencyProfile (F2)
    await runRepo.updateDependencyProfile(runId, dependencyProfile);

    // 5b. Flip status to awaiting_approval
    await runRepo.updateStatus(runId, "awaiting_approval");
    this.emitRunStatus(input.projectId, runId, "awaiting_approval");

    return runId;
  }

  /**
   * Approves a workflow plan and immediately runs the scheduler.
   * For Plan A, the scheduler is awaited (synchronous test-friendly).
   */
  async approvePlan(workflowRunId: string, _edits?: PlanEdit[]): Promise<void> {
    const { runRepo, nodeRepo } = this.opts;

    const runRow = await runRepo.findById(workflowRunId);
    if (!runRow) throw new WorkflowNotFoundError(workflowRunId);
    if (runRow.status !== "awaiting_approval") {
      throw new WorkflowAlreadyApprovedError(workflowRunId, runRow.status);
    }

    // Apply any plan edits before running
    if (_edits && _edits.length > 0) {
      for (const edit of _edits) {
        const nodeRow = await nodeRepo.findOne(workflowRunId, edit.nodeId);
        if (!nodeRow) throw new NodeNotFoundError(workflowRunId, edit.nodeId);
        if (edit.policy) {
          const existing = nodeRow as { policy?: unknown };
          const merged = { ...(existing.policy as object ?? {}), ...edit.policy };
          await nodeRepo.updatePolicy(workflowRunId, edit.nodeId, merged);
        }
      }
    }

    // Flip to running
    await runRepo.updateStatus(workflowRunId, "running");
    this.emitRunStatus(runRow.projectId, workflowRunId, "running");

    // Build snapshot
    const snapshot = await this.buildSnapshot(workflowRunId);
    if (!snapshot) throw new WorkflowNotFoundError(workflowRunId);

    // Run scheduler (awaited for Plan A; Plan C makes this fire-and-forget)
    const scheduler = new WorkflowScheduler(snapshot, {
      launchRitual: this.makeLaunchRitual(workflowRunId),
      awaitRitual: this.makeAwaitRitual(),
      persistNodeState: async (nodeId, update) => {
        if (update.status) {
          await nodeRepo.updateStatus(workflowRunId, nodeId, update.status, {
            ...(update.ritualId && { ritualId: update.ritualId }),
            ...(update.failure && { failure: update.failure })
          });
          this.emitNodeStatus(runRow.projectId, workflowRunId, nodeId, update.status, {
            ritualId: update.ritualId,
            artifact: update.artifact,
            failure: update.failure
          });
        }
        if (update.artifact !== undefined) {
          await nodeRepo.setArtifact(workflowRunId, nodeId, update.artifact, "1");
        }
      },
      persistWorkflowStatus: async (status) => {
        await runRepo.updateStatus(workflowRunId, status);
        this.emitRunStatus(runRow.projectId, workflowRunId, status);
      }
    });

    // F4: fire-and-forget so approvePlan() returns immediately in production.
    // The scheduler persists its own terminal status via persistWorkflowStatus.
    // Tests should await engine._waitForScheduler(workflowRunId) to assert final state.
    const schedulerPromise = scheduler.execute().catch((err) => {
      console.error("[workflow-engine] scheduler failed:", err);
    });
    this.runningSchedulers.set(workflowRunId, schedulerPromise);
    void schedulerPromise.finally(() => {
      this.runningSchedulers.delete(workflowRunId);
    });
  }

  /**
   * Resets a failed node to pending and re-runs the scheduler.
   */
  async retryNode(workflowRunId: string, nodeId: string): Promise<void> {
    const { runRepo, nodeRepo } = this.opts;

    const runRow = await runRepo.findById(workflowRunId);
    if (!runRow) throw new WorkflowNotFoundError(workflowRunId);

    const nodeRow = await nodeRepo.findOne(workflowRunId, nodeId);
    if (!nodeRow) throw new NodeNotFoundError(workflowRunId, nodeId);

    if (nodeRow.status !== "failed") {
      throw new InvalidNodePolicyEditError(nodeId, `only failed nodes can be retried; current status="${nodeRow.status}"`);
    }

    // Reset node to pending
    await nodeRepo.updateStatus(workflowRunId, nodeId, "pending");
    this.emitNodeStatus(runRow.projectId, workflowRunId, nodeId, "pending");

    // F5: Reset transitively-blocked descendants.
    // BFS from the retried node following dependsOn edges in reverse,
    // collecting any node whose status is currently "blocked".
    const allNodes = await nodeRepo.findByRunId(workflowRunId);
    const unblockSet = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of allNodes) {
        if (unblockSet.has(n.id)) continue;
        if (n.status !== "blocked") continue;
        const deps = Array.isArray(n.dependsOn) ? (n.dependsOn as string[]) : [];
        if (deps.some((d) => unblockSet.has(d))) {
          unblockSet.add(n.id);
          changed = true;
        }
      }
    }
    // Reset all blocked descendants (not the retried node itself — already done)
    for (const bid of unblockSet) {
      if (bid !== nodeId) {
        await nodeRepo.updateStatus(workflowRunId, bid, "pending");
        this.emitNodeStatus(runRow.projectId, workflowRunId, bid, "pending");
      }
    }

    // Ensure workflow is running
    await runRepo.updateStatus(workflowRunId, "running");
    this.emitRunStatus(runRow.projectId, workflowRunId, "running");

    // Re-build snapshot and run scheduler
    const snapshot = await this.buildSnapshot(workflowRunId);
    if (!snapshot) throw new WorkflowNotFoundError(workflowRunId);

    const scheduler = new WorkflowScheduler(snapshot, {
      launchRitual: this.makeLaunchRitual(workflowRunId),
      awaitRitual: this.makeAwaitRitual(),
      persistNodeState: async (nId, update) => {
        if (update.status) {
          await nodeRepo.updateStatus(workflowRunId, nId, update.status, {
            ...(update.ritualId && { ritualId: update.ritualId }),
            ...(update.failure && { failure: update.failure })
          });
          this.emitNodeStatus(runRow.projectId, workflowRunId, nId, update.status, {
            ritualId: update.ritualId,
            artifact: update.artifact,
            failure: update.failure
          });
        }
        if (update.artifact !== undefined) {
          await nodeRepo.setArtifact(workflowRunId, nId, update.artifact, "1");
        }
      },
      persistWorkflowStatus: async (status) => {
        await runRepo.updateStatus(workflowRunId, status);
        this.emitRunStatus(runRow.projectId, workflowRunId, status);
      }
    });

    // F4: fire-and-forget for retryNode too
    const retrySchedulerPromise = scheduler.execute().catch((err) => {
      console.error("[workflow-engine] retry scheduler failed:", err);
    });
    this.runningSchedulers.set(workflowRunId, retrySchedulerPromise);
    void retrySchedulerPromise.finally(() => {
      this.runningSchedulers.delete(workflowRunId);
    });
  }

  /**
   * Aborts a workflow run and any actively running node rituals.
   */
  async abort(workflowRunId: string, reason: string): Promise<void> {
    const { runRepo, nodeRepo, ritualEngine } = this.opts;

    const runRow = await runRepo.findById(workflowRunId);
    if (!runRow) throw new WorkflowNotFoundError(workflowRunId);

    // Abort any running node rituals
    const nodeRows = await nodeRepo.findByRunId(workflowRunId);
    await Promise.allSettled(
      nodeRows
        .filter((n) => n.status === "running" && n.ritualId)
        .map((n) => ritualEngine.abort(n.ritualId!, reason))
    );

    await runRepo.updateStatus(workflowRunId, "aborted");
    this.emitRunStatus(runRow.projectId, workflowRunId, "aborted");
  }

  /**
   * Updates the execution policy for a specific node.
   */
  async setNodePolicy(
    workflowRunId: string,
    nodeId: string,
    policy: Partial<NodePolicy>
  ): Promise<void> {
    const { runRepo, nodeRepo } = this.opts;

    const runRow = await runRepo.findById(workflowRunId);
    if (!runRow) throw new WorkflowNotFoundError(workflowRunId);

    const nodeRow = await nodeRepo.findOne(workflowRunId, nodeId);
    if (!nodeRow) throw new NodeNotFoundError(workflowRunId, nodeId);

    await nodeRepo.updatePolicy(workflowRunId, nodeId, policy);
  }

  /**
   * Returns a reconstructed WorkflowRunSnapshot from persisted rows.
   */
  async getRun(workflowRunId: string): Promise<WorkflowRunSnapshot | undefined> {
    return this.buildSnapshot(workflowRunId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Reads the DAG from the planner ritual's roleEvents.
   * For Plan A: synchronous — stub planner runs synchronously inside start().
   */
  private async awaitPlannerDag(
    ritualId: string
  ): Promise<{ nodes: WorkflowNode[]; dependencyProfile: DependencyProfile }> {
    const snapshot = await this.opts.ritualEngine.getRitual(ritualId);
    if (!snapshot) {
      throw new Error(`Planner ritual ${ritualId} not found after dispatch`);
    }
    const event = snapshot.roleEvents?.find(
      (e) => e.eventType === "workflow_planner.dag.emitted"
    );
    if (!event) {
      throw new Error(
        `Planner ritual ${ritualId} did not emit workflow_planner.dag.emitted`
      );
    }

    const payload = event.payload as { nodes?: unknown; dependencyProfile?: unknown };

    // Parse nodes (without status — planner doesn't emit status; we set pending)
    const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const nodes: WorkflowNode[] = rawNodes.map((raw: unknown) => {
      const withStatus = { ...(raw as object), status: "pending" };
      return WorkflowNodeSchema.parse(withStatus);
    });

    // Parse dependencyProfile
    const dependencyProfile = DependencyProfileSchema.parse(
      payload.dependencyProfile ?? { schemaVersion: "1" }
    );

    return { nodes, dependencyProfile };
  }

  /**
   * Plan A: stub launchRitual — returns a fake ritualId immediately.
   * Plan B: wire to ritualEngine.start() with real roles.
   * F3: calls checkpointRecorder.registerRitualForNode when a recorder is present.
   */
  private makeLaunchRitual(workflowRunId: string) {
    const recorder = this.opts.checkpointRecorder;
    return async (node: WorkflowNode, _run: WorkflowRunSnapshot): Promise<string> => {
      // Stub: return a deterministic fake ritualId for the node
      const ritualId = `stub-ritual-${node.id}`;
      // F3: register the mapping so the recorder can route broker events to checkpoints
      if (recorder) {
        recorder.registerRitualForNode(ritualId, workflowRunId, node.id);
      }
      return ritualId;
    };
  }

  /**
   * Plan A: stub awaitRitual — resolves immediately with a done result.
   * Plan B: poll ritualEngine.getRitual() until terminal state.
   */
  private makeAwaitRitual() {
    return async (
      ritualId: string
    ): Promise<
      | { kind: "done"; artifact: unknown; artifactKind: string }
      | { kind: "failed"; error: string }
    > => {
      // Extract nodeId from the stub ritual ID format: "stub-ritual-<nodeId>"
      const nodeId = ritualId.replace("stub-ritual-", "");
      return {
        kind: "done",
        artifact: { schemaVersion: "1", kind: "generic", payload: { nodeId } },
        artifactKind: "generic"
      };
    };
  }

  /**
   * Reconstructs a WorkflowRunSnapshot from the run + node repos.
   */
  private async buildSnapshot(
    workflowRunId: string
  ): Promise<WorkflowRunSnapshot | undefined> {
    const { runRepo, nodeRepo } = this.opts;

    const runRow = await runRepo.findById(workflowRunId);
    if (!runRow) return undefined;

    const nodeRows = await nodeRepo.findByRunId(workflowRunId);

    const nodes: WorkflowNode[] = nodeRows.map((row) => ({
      id: row.id,
      artifactKind: row.artifactKind,
      summary: row.summary,
      dependsOn: Array.isArray(row.dependsOn) ? (row.dependsOn as string[]) : [],
      consumes: Array.isArray(row.consumes) ? (row.consumes as string[]) : [],
      policy: row.policy as WorkflowNode["policy"],
      status: row.status as WorkflowNode["status"],
      ...(row.ritualId && { ritualId: row.ritualId }),
      ...(row.artifact !== undefined && row.artifact !== null && { artifact: row.artifact }),
      ...(row.failure !== undefined && row.failure !== null && {
        failure: row.failure as WorkflowNode["failure"]
      })
    }));

    const createdAt =
      runRow.createdAt instanceof Date
        ? runRow.createdAt.toISOString()
        : String(runRow.createdAt);
    const updatedAt =
      runRow.updatedAt instanceof Date
        ? runRow.updatedAt.toISOString()
        : String(runRow.updatedAt);

    return {
      id: runRow.id,
      projectId: runRow.projectId,
      userId: runRow.userId,
      prompt: runRow.prompt,
      status: runRow.status as WorkflowRunSnapshot["status"],
      nodes,
      edges: [],
      dependencyProfile: (runRow.dependencyProfile as DependencyProfile) ?? {
        schemaVersion: "1"
      },
      ...(runRow.concurrencyCap != null && { concurrencyCap: runRow.concurrencyCap }),
      createdAt,
      updatedAt
    };
  }
}
