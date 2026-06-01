// src/engine.ts
import { randomUUID } from "node:crypto";
import { InMemoryUsageTracker, type LLMUsageTracker } from "@atlas/llm-provider";
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
import { ArtifactContractRegistry } from "./artifact-contracts/registry.js";
import { GenericArtifactSchema } from "./artifact-contracts/generic.js";
import { generateApiClient } from "./api-client-gen.js";

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
    /** Plan G — optional USD cost cap for the run. Drizzle stores this as
     *  numeric (returned as string); in-memory fakes typically use number.
     *  The repo implementation accepts a number here; the snapshot builder
     *  normalizes either string or number coming back from findById. */
    costCapUsd?: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<{ id: string; status: string; createdAt: Date | string; updatedAt: Date | string }>;
  findById(id: string): Promise<{
    id: string;
    projectId: string;
    userId: string;
    prompt: string;
    status: string;
    dependencyProfile: unknown;
    concurrencyCap?: number | null;
    /** Plan G — drizzle returns numeric columns as string; in-memory fakes
     *  may return number. The snapshot builder accepts either form. */
    costCapUsd?: number | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  } | undefined>;
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
  updateSummary(runId: string, nodeId: string, summary: string): Promise<void>;
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
    /** Plan E Task 5: when set, the ritual-engine dispatches this ordered
     *  list of role IDs through the conductor and SKIPS the default
     *  architect → developer → canvas-pause → build-gate chain. Used by
     *  WorkflowEngine.makeLaunchRitual to route artifact-kind-specific
     *  nodes (e.g. tests) to a single dedicated role.
     *  Empty / undefined preserves today's full-chain behavior. */
    roleChain?: string[];
    /** Plan G Task 4 — per-workflow usage tracker. When set, roles can
     *  record token usage so the workflow engine can later enforce a USD
     *  cost cap. Optional — when unset, no cost tracking happens. Role-level
     *  recording is wired in a follow-up Plan G task; v1 just plumbs the
     *  channel through to the ritual engine. */
    usageTracker?: LLMUsageTracker;
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
  /** Plan G — optional USD cost cap for the run. When set, it is persisted
   *  to the run row and surfaced on the WorkflowRunSnapshot. Enforcement
   *  (abort-on-overrun) is the responsibility of later Plan G tasks. */
  costCapUsd?: number;
}

export interface PlanEdit {
  nodeId: string;
  policy?: Partial<NodePolicy>;
  summary?: string;
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
// Plan E Task 5 + Plan F Task 7 — artifactKind → roleChain mapping.
// When makeLaunchRitual sees a node whose artifactKind has an entry here,
// the ritual-engine dispatches that single role and SKIPS the default
// architect → developer → canvas-pause → build-gate chain. Empty / missing
// entry preserves the full-chain behavior.
// ---------------------------------------------------------------------------

const ROLE_CHAIN_BY_KIND: Record<string, string[] | undefined> = {
  tests: ["tester"],
  iac: ["iac"],
  deploy: ["deployer"]
};

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

  /**
   * Plan G Task 4: per-workflow-run LLMUsageTracker. Created lazily in
   * start(); read by makeLaunchRitual() so every node ritual of the same
   * workflow run shares the same tracker instance (subsequent calls see
   * accumulated cost). Key = workflowRunId.
   */
  private readonly usageTrackers = new Map<string, LLMUsageTracker>();

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

  /**
   * Test-only helper (underscore prefix = internal API).
   * Returns the workflow's per-run LLMUsageTracker, or undefined when
   * the runId is unknown to this engine instance.
   */
  _getUsageTracker(workflowRunId: string): LLMUsageTracker | undefined {
    return this.usageTrackers.get(workflowRunId);
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
      ...(input.costCapUsd !== undefined && { costCapUsd: input.costCapUsd }),
      createdAt: now,
      updatedAt: now
    });

    // Plan G Task 4: provision a per-run usage tracker so every ritual
    // (the planner and every node ritual) of this workflow shares one
    // accumulator. Created unconditionally — Plan G's cost cap only
    // fires when costCapUsd is set, but having the tracker always
    // available means roles can record usage uniformly without
    // branching on cap presence.
    const usageTracker: LLMUsageTracker = new InMemoryUsageTracker();
    this.usageTrackers.set(runId, usageTracker);

    // 2. Launch workflow-planner ritual
    const plannerRitualId = await ritualEngine.start({
      userTurn: input.prompt,
      editClass: "structural",
      projectId: input.projectId,
      userId: input.userId,
      priorArtifact: input.artifactKindHint
        ? { suggestedKinds: [input.artifactKindHint] }
        : undefined,
      usageTracker
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
        if (edit.summary !== undefined) {
          await nodeRepo.updateSummary(workflowRunId, edit.nodeId, edit.summary);
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
    const scheduler = new WorkflowScheduler(
      snapshot,
      this.buildSchedulerDeps(workflowRunId, runRow.projectId, snapshot.costCapUsd)
    );

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

    const scheduler = new WorkflowScheduler(
      snapshot,
      this.buildSchedulerDeps(workflowRunId, runRow.projectId, snapshot.costCapUsd)
    );

    // F4: fire-and-forget for retryNode too
    const retrySchedulerPromise = scheduler.execute().catch((err) => {
      console.error("[workflow-engine] retry scheduler failed:", err);
    });
    this.runningSchedulers.set(workflowRunId, retrySchedulerPromise);
    void retrySchedulerPromise.finally(() => {
      this.runningSchedulers.delete(workflowRunId);
    });
  }

  // ---------------------------------------------------------------------------
  // Plan G Task 5 — shared scheduler-deps builder. Centralizes the wiring
  // approvePlan() and retryNode() previously duplicated, and adds the
  // cost-cap + tracker-cleanup callbacks.
  // ---------------------------------------------------------------------------

  private buildSchedulerDeps(
    workflowRunId: string,
    projectId: string,
    costCapUsd: number | undefined
  ): import("./scheduler.js").SchedulerDeps {
    const { runRepo, nodeRepo, ritualEngine, broker } = this.opts;
    const tracker = this.usageTrackers.get(workflowRunId);
    const capActive = costCapUsd !== undefined && tracker !== undefined;

    return {
      launchRitual: this.makeLaunchRitual(workflowRunId),
      awaitRitual: this.makeAwaitRitual(),
      persistNodeState: async (nodeId, update) => {
        if (update.status) {
          await nodeRepo.updateStatus(workflowRunId, nodeId, update.status, {
            ...(update.ritualId && { ritualId: update.ritualId }),
            ...(update.failure && { failure: update.failure })
          });
          this.emitNodeStatus(projectId, workflowRunId, nodeId, update.status, {
            ...(update.ritualId !== undefined && { ritualId: update.ritualId }),
            ...(update.artifact !== undefined && { artifact: update.artifact }),
            ...(update.failure !== undefined && { failure: update.failure })
          });
        }
        if (update.artifact !== undefined) {
          await nodeRepo.setArtifact(workflowRunId, nodeId, update.artifact, "1");
        }
      },
      persistWorkflowStatus: async (status) => {
        await runRepo.updateStatus(workflowRunId, status);
        this.emitRunStatus(projectId, workflowRunId, status);
      },
      // Plan G Task 5 — only configure the cap callback when both a cap
      // and a tracker are present. Without a cap, the scheduler runs to
      // natural completion exactly as it did pre-Plan-G.
      ...(capActive
        ? {
            checkCostCap: () => {
              const totalUsd = tracker!.totalUsd();
              if (totalUsd > costCapUsd!) {
                return {
                  exceeded: true,
                  message: `cost cap exceeded: $${totalUsd.toFixed(4)} > $${costCapUsd!.toFixed(4)}`
                };
              }
              return { exceeded: false, message: "" };
            },
            abortInFlightRituals: async (ritualIds, reason) => {
              // Fire abort on each in-flight ritual; surface a single SSE
              // event with the reason so the UI can display it without a
              // schema change to workflow_runs.
              await Promise.allSettled(
                ritualIds.map((rid) => ritualEngine.abort(rid, reason))
              );
              if (broker) {
                void broker
                  .publish({
                    projectId,
                    ritualId: workflowRunId,
                    type: "workflow.run.aborted",
                    payload: { workflowRunId, reason },
                    ts: Date.now()
                  })
                  .catch((err) => {
                    console.error("[workflow-engine] broker emit (run aborted) failed:", err);
                  });
              }
            }
          }
        : {}),
      // Plan G Task 5 — release the per-run tracker on terminal status to
      // avoid the memory leak Task 4 flagged. Runs for completed, escalated,
      // and aborted alike.
      onSchedulerExit: () => {
        this.usageTrackers.delete(workflowRunId);
      }
    };
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
   * Plan D Task 8.5: real launchRitual — calls ritualEngine.start() with a
   * priorArtifact merged from each upstream node's persisted artifact (per
   * node.consumes) plus the run's dependencyProfile. Returns the real
   * ritualId from the ritual engine.
   *
   * F3: also calls checkpointRecorder.registerRitualForNode when a recorder
   * is present, so broker events from the new ritual route to checkpoints.
   */
  private makeLaunchRitual(workflowRunId: string) {
    const { ritualEngine, nodeRepo, checkpointRecorder: recorder } = this.opts;
    return async (node: WorkflowNode, run: WorkflowRunSnapshot): Promise<string> => {
      // 1. Gather upstream artifacts from declared consumes.
      const allRows = await nodeRepo.findByRunId(workflowRunId);
      const byId = new Map(allRows.map((r) => [r.id, r] as const));
      const upstream: Record<string, unknown> = {};
      for (const upstreamId of node.consumes) {
        const upstreamRow = byId.get(upstreamId);
        if (
          upstreamRow &&
          upstreamRow.artifact !== undefined &&
          upstreamRow.artifact !== null
        ) {
          upstream[upstreamId] = upstreamRow.artifact;
        }
        // If an upstream finished without persisting an artifact (e.g. a role
        // that doesn't emit one yet), we omit it. Downstream roles see
        // priorArtifact.upstream[id] === undefined and decide what to do.
      }

      // 2. Plan D.2: cross-stack — generate the typed api-client when a
      //    frontend-app node consumes a single backend-rest-api upstream.
      //    Multi-backend cross-stack is Plan D.3.
      let generatedFiles: Array<{ path: string; contents: string }> | undefined;
      if (node.artifactKind === "frontend-app") {
        const backendUpstreams = Object.values(upstream).filter(
          (a): a is { kind: string; openApiSpec: unknown } =>
            !!a &&
            typeof a === "object" &&
            (a as { kind?: unknown }).kind === "backend-rest-api" &&
            "openApiSpec" in (a as object)
        );
        if (backendUpstreams.length > 1) {
          throw new Error(
            `Plan D.2 v1: multiple backend upstreams not supported (frontend node "${node.id}" consumes ${backendUpstreams.length} backend-rest-api artifacts). Multi-backend cross-stack is Plan D.3.`
          );
        }
        if (backendUpstreams.length === 1) {
          const generated = await generateApiClient(backendUpstreams[0]!.openApiSpec);
          generatedFiles = [generated];
        }
      }

      // 3. Build priorArtifact for the downstream ritual. Plan D ships the
      //    minimum shape per docs/superpowers/specs/2026-05-29-plan-d-...md §2.
      const priorArtifact = {
        upstream,
        dependencyProfile: run.dependencyProfile,
        ...(generatedFiles ? { generatedFiles } : {})
      };

      // 4. Call the real ritual engine.
      //    Plan E Task 5 + Plan F Task 7 — for artifact-kinds that are NOT
      //    product-code generation (tests, iac, deploy), route directly to
      //    a single dedicated role. The full architect → developer chain
      //    isn't a fit for these: we're not generating new product code,
      //    we're generating tests / infrastructure-as-code / deployment
      //    wiring from already-emitted upstream artifacts.
      //    Plan G Task 4 — thread the per-run usage tracker so roles can
      //    record token usage; the workflow engine will enforce the cap
      //    in a follow-up task.
      const roleChain = ROLE_CHAIN_BY_KIND[node.artifactKind];
      const usageTracker = this.usageTrackers.get(workflowRunId);
      const ritualId = await ritualEngine.start({
        userTurn: node.summary,
        editClass: "structural",
        projectId: run.projectId,
        userId: run.userId,
        priorArtifact,
        ...(roleChain ? { roleChain } : {}),
        ...(usageTracker ? { usageTracker } : {})
      });

      // 5. Wire the recorder so broker events route to checkpoints.
      if (recorder) {
        recorder.registerRitualForNode(ritualId, workflowRunId, node.id);
      }

      return ritualId;
    };
  }

  /**
   * Plan D Task 2: real awaitRitual — polls the ritualEngine until the ritual
   * reaches a terminal state, then scans roleEvents for ritual.artifact_emitted
   * and validates the payload artifact against the registered schema for the
   * expected artifactKind. Falls back to GenericArtifactSchema if the kind isn't
   * registered. If no artifact event is present on a completed ritual, returns a
   * synthesized generic placeholder so frontend/test rituals that don't yet emit
   * artifact events keep working.
   */
  private makeAwaitRitual() {
    return (ritualId: string, expectedKind: string) =>
      awaitRitualImpl(this.opts.ritualEngine, ritualId, expectedKind, {});
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

    // Plan G — normalize costCapUsd from either string (drizzle numeric) or
    // number (in-memory fakes) to a finite number; null/undefined → omit.
    const costCapUsdRaw = (runRow as { costCapUsd?: unknown }).costCapUsd;
    const costCapUsd =
      typeof costCapUsdRaw === "string"
        ? Number(costCapUsdRaw)
        : typeof costCapUsdRaw === "number"
          ? costCapUsdRaw
          : undefined;

    // Plan G Task 7 — surface the running USD cost so the SSE-driven UI
    // can read it without new events. Reads the per-run usage tracker's
    // current total. After terminal status, onSchedulerExit cleared the
    // tracker, so this is undefined (v1 trade-off — freezing the final
    // cost onto the run row is a future refinement requiring a schema
    // column).
    const tracker = this.usageTrackers.get(workflowRunId);
    const totalCostUsd = tracker?.totalUsd();

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
      ...(costCapUsd !== undefined && Number.isFinite(costCapUsd)
        ? { costCapUsd }
        : {}),
      ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
      createdAt,
      updatedAt
    };
  }
}

// ---------------------------------------------------------------------------
// Plan D Task 2: module-scope awaitRitual implementation.
// Exposed under a `_` prefix for tests to drive without constructing a
// full WorkflowEngine + scheduler.
// ---------------------------------------------------------------------------

export interface AwaitRitualOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export type AwaitRitualResult =
  | { kind: "done"; artifact: unknown; artifactKind: string }
  | { kind: "failed"; error: string };

async function awaitRitualImpl(
  ritualEngine: IRitualEngine,
  ritualId: string,
  expectedKind: string,
  opts: AwaitRitualOptions
): Promise<AwaitRitualResult> {
  const pollMs = opts.pollMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  let snapshot: Awaited<ReturnType<IRitualEngine["getRitual"]>> | undefined;
  while (Date.now() < deadline) {
    snapshot = await ritualEngine.getRitual(ritualId);
    if (
      snapshot &&
      (snapshot.state === "completed" ||
        snapshot.state === "failed" ||
        snapshot.state === "aborted")
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  if (
    !snapshot ||
    (snapshot.state !== "completed" &&
      snapshot.state !== "failed" &&
      snapshot.state !== "aborted")
  ) {
    return { kind: "failed", error: `awaitRitual timed out after ${timeoutMs}ms` };
  }
  if (snapshot.state === "failed" || snapshot.state === "aborted") {
    return { kind: "failed", error: `ritual ended in state "${snapshot.state}"` };
  }

  for (let i = snapshot.roleEvents.length - 1; i >= 0; i--) {
    const ev = snapshot.roleEvents[i];
    if (!ev || ev.eventType !== "ritual.artifact_emitted") continue;
    const payload = ev.payload as { artifact?: unknown } | null | undefined;
    const artifact = payload?.artifact;
    const schema = ArtifactContractRegistry.get(expectedKind);
    if (!schema) {
      const parsed = GenericArtifactSchema.safeParse(artifact);
      if (!parsed.success) {
        return {
          kind: "failed",
          error: `emitted artifact failed generic validation: ${parsed.error.message}`
        };
      }
      return { kind: "done", artifact: parsed.data, artifactKind: "generic" };
    }
    const parsed = schema.safeParse(artifact);
    if (!parsed.success) {
      return {
        kind: "failed",
        error: `emitted artifact failed "${expectedKind}" validation: ${parsed.error.message}`
      };
    }
    return { kind: "done", artifact: parsed.data, artifactKind: expectedKind };
  }

  // No artifact event emitted — synthesize a generic placeholder so existing
  // frontend/test rituals that don't emit artifacts yet keep their old behaviour.
  return {
    kind: "done",
    artifact: { schemaVersion: "1", kind: "generic", payload: {} },
    artifactKind: "generic"
  };
}

export const _awaitRitualForTesting = awaitRitualImpl;
