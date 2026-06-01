// src/scheduler.ts
import type { WorkflowNode, WorkflowRunSnapshot } from "./types.js";
import { findReadyNodes } from "./dag.js";

export interface SchedulerDeps {
  /** Launches a ritual for the node; returns the ritualId immediately. */
  launchRitual: (node: WorkflowNode, run: WorkflowRunSnapshot) => Promise<string>;
  /** Returns a promise that resolves when the given ritual terminates,
   *  with either a "done" + artifact OR a "failed" + error.
   *  The `artifactKind` is the workflow node's expected artifactKind — the
   *  callback uses it to look up the right schema in the ArtifactContractRegistry. */
  awaitRitual: (ritualId: string, artifactKind: string) => Promise<
    | { kind: "done"; artifact: unknown; artifactKind: string }
    | { kind: "failed"; error: string }
  >;
  /** Persists node state updates to Postgres (caller wires WorkflowNodeRepo). */
  persistNodeState: (
    nodeId: string,
    update: Partial<Pick<WorkflowNode, "status" | "ritualId" | "artifact" | "failure">>
  ) => Promise<void>;
  /** Persists final workflow status. */
  persistWorkflowStatus: (status: WorkflowRunSnapshot["status"]) => Promise<void>;
  /** Plan G Task 5 — invoked after every ritual completes. When it returns
   *  exceeded:true, the scheduler aborts the workflow with the supplied
   *  message (no more rituals are launched; in-flight rituals are aborted
   *  via abortInFlightRituals if provided). Optional — schedulers without
   *  a cap simply omit this and run to natural completion. */
  checkCostCap?: () => { exceeded: boolean; message: string };
  /** Plan G Task 5 — invoked when checkCostCap returns exceeded:true.
   *  Receives the list of ritualIds for nodes that were still "running" at
   *  cap-trip time so the caller can call ritualEngine.abort on each one.
   *  Optional — when absent, in-flight rituals continue (but the scheduler
   *  still won't launch new ones). */
  abortInFlightRituals?: (ritualIds: string[], reason: string) => Promise<void>;
  /** Plan G Task 5 — invoked exactly once at scheduler termination
   *  (whether completed, escalated, or aborted). Lets the caller release
   *  per-run resources (e.g. the LLMUsageTracker map entry) without
   *  leaking them across long-lived engine instances. Optional. */
  onSchedulerExit?: () => Promise<void> | void;
}

export class WorkflowScheduler {
  constructor(
    private readonly run: WorkflowRunSnapshot,
    private readonly deps: SchedulerDeps
  ) {}

  async execute(): Promise<void> {
    // Map from nodeId → a promise that resolves when that node is done (success or failure).
    // Each promise removes itself from the map on settlement so we can check liveness cheaply.
    const activePromises = new Map<string, Promise<void>>();
    const cap = this.run.concurrencyCap;
    let workflowFailed = false;
    // Plan G Task 5 — tripped once checkCostCap returns exceeded:true.
    // When set, the scheduler stops launching new rituals and aborts in-flight.
    let costCapTrippedMsg: string | undefined;

    try {
      while (true) {
        // If the cost cap has tripped, stop launching new rituals.
        if (costCapTrippedMsg === undefined) {
          // Find ready nodes (not deferred, deps satisfied)
          const ready = findReadyNodes(this.run.nodes);
          // Highest priority first; stable tie-break by id
          ready.sort((a, b) => b.policy.priority - a.policy.priority || a.id.localeCompare(b.id));

          while (ready.length > 0 && (cap === undefined || activePromises.size < cap)) {
            const node = ready.shift()!;
            node.status = "ready";
            await this.deps.persistNodeState(node.id, { status: "ready" });

            // Wrap launchAndAwait so it self-removes from the map on settlement.
            // This lets the outer loop detect completion without the broken isResolved trick.
            let resolveSlot!: () => void;
            const slot = new Promise<void>((res) => { resolveSlot = res; });

            const p: Promise<void> = this.launchAndAwait(node).then((failed) => {
              if (failed) workflowFailed = true;
              activePromises.delete(node.id);
              resolveSlot();
            });
            // Keep p alive (avoid unhandled rejection) by attaching a no-op catch;
            // launchAndAwait never throws (catches internally), but be safe.
            p.catch(() => { activePromises.delete(node.id); resolveSlot(); });

            activePromises.set(node.id, slot);
          }
        }

        if (activePromises.size === 0) break;

        // Wait for any active node to finish (its slot promise resolves).
        await Promise.race(activePromises.values());
        // The self-removal above already cleaned up the map; loop to find new ready nodes.

        // Plan G Task 5 — cost cap check fires after EVERY ritual completion.
        // Only check while we haven't already tripped; the check is a no-op
        // when no callback was supplied (no cap configured).
        if (costCapTrippedMsg === undefined && this.deps.checkCostCap) {
          const result = this.deps.checkCostCap();
          if (result.exceeded) {
            costCapTrippedMsg = result.message;
            // Abort any in-flight rituals (best-effort — engine swallows errors).
            const inFlightRitualIds = this.run.nodes
              .filter((n) => n.status === "running" && n.ritualId)
              .map((n) => n.ritualId!);
            if (inFlightRitualIds.length > 0 && this.deps.abortInFlightRituals) {
              await this.deps.abortInFlightRituals(inFlightRitualIds, costCapTrippedMsg)
                .catch((err) => {
                  // Never let an abort failure mask the cap-trip outcome.
                  console.error("[workflow-scheduler] abortInFlightRituals failed:", err);
                });
            }
            // Don't break yet — let any in-flight slots resolve so we don't
            // leave dangling promises. The outer loop's "no new launches"
            // guard above handles the rest.
          }
        }
      }

      // Terminal status: cost cap trip overrides everything else.
      let finalStatus: WorkflowRunSnapshot["status"];
      if (costCapTrippedMsg !== undefined) {
        finalStatus = "aborted";
      } else {
        const anyFailed = this.run.nodes.some((n) => n.status === "failed");
        finalStatus = anyFailed || workflowFailed ? "escalated" : "completed";
      }
      await this.deps.persistWorkflowStatus(finalStatus);
    } finally {
      // Plan G Task 5 — always release per-run resources (tracker, etc.),
      // even if persistWorkflowStatus throws. Best-effort: log + swallow.
      if (this.deps.onSchedulerExit) {
        try {
          await this.deps.onSchedulerExit();
        } catch (err) {
          console.error("[workflow-scheduler] onSchedulerExit failed:", err);
        }
      }
    }
  }

  private async launchAndAwait(node: WorkflowNode): Promise<boolean> {
    try {
      node.status = "running";
      const ritualId = await this.deps.launchRitual(node, this.run);
      node.ritualId = ritualId;
      await this.deps.persistNodeState(node.id, { status: "running", ritualId });
      const result = await this.deps.awaitRitual(ritualId, node.artifactKind);
      if (result.kind === "done") {
        node.status = "done";
        node.artifact = result.artifact;
        await this.deps.persistNodeState(node.id, { status: "done", artifact: result.artifact });
        return false;
      } else {
        node.status = "failed";
        node.failure = { error: result.error, attempts: (node.failure?.attempts ?? 0) + 1 };
        await this.deps.persistNodeState(node.id, { status: "failed", failure: node.failure });
        this.blockDependents(node.id);
        return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      node.status = "failed";
      node.failure = { error: msg, attempts: (node.failure?.attempts ?? 0) + 1 };
      await this.deps.persistNodeState(node.id, { status: "failed", failure: node.failure });
      this.blockDependents(node.id);
      return true;
    }
  }

  private blockDependents(failedNodeId: string): void {
    const blockedIds = new Set<string>([failedNodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of this.run.nodes) {
        if (n.status !== "pending") continue;
        if (n.dependsOn.some((d) => blockedIds.has(d))) {
          n.status = "blocked";
          blockedIds.add(n.id);
          changed = true;
          // Persist best-effort; a block persist failure must not crash the loop
          this.deps.persistNodeState(n.id, { status: "blocked" }).catch(() => {});
        }
      }
    }
  }
}
