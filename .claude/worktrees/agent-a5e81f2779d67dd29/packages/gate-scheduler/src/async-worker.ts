import type { AsyncGateQueue, AsyncGateJob } from "./async-queue.js";
import type { GateRunner } from "./types.js";
import { RollbackArm, executeRollback, type GitRevertFn } from "./rollback-arm.js";

export interface AsyncGateNotification {
  jobId: string;
  layer: string;
  status: "passed" | "failed";
  summary: string;
  severity: "notice" | "alert" | "critical";
  rollbackExecuted: boolean;
}

export interface AsyncGateWorkerOptions {
  queue: AsyncGateQueue;
  runners: Map<string, GateRunner["run"]>;
  notify: (note: AsyncGateNotification) => Promise<void>;
  registerArm?: (commitSha: string) => RollbackArm;
  gitRevert?: GitRevertFn;
}

export class AsyncGateWorker {
  private readonly queue: AsyncGateQueue;
  private readonly runners: Map<string, GateRunner["run"]>;
  private readonly notify: (n: AsyncGateNotification) => Promise<void>;
  private readonly registerArm?: (commitSha: string) => RollbackArm;
  private readonly gitRevert?: GitRevertFn;

  constructor(opts: AsyncGateWorkerOptions) {
    this.queue = opts.queue;
    this.runners = opts.runners;
    this.notify = opts.notify;
    this.registerArm = opts.registerArm;
    this.gitRevert = opts.gitRevert;
  }

  async drainOnce(): Promise<void> {
    while (true) {
      const job = await this.queue.dequeue();
      if (!job) return;
      await this.runJob(job);
    }
  }

  private async runJob(job: AsyncGateJob): Promise<void> {
    const runner = this.runners.get(job.layer);
    if (!runner) {
      await this.notify({
        jobId: job.id, layer: job.layer, status: "failed",
        summary: `no runner registered for layer ${job.layer}`,
        severity: "alert", rollbackExecuted: false
      });
      return;
    }
    const result = await runner({
      ritualId: job.ritualId, projectId: job.projectId,
      commitSha: job.commitSha, graphSlice: { bytes: "", hash: job.graphSliceHash }
    });

    let severity: AsyncGateNotification["severity"] = "notice";
    let rollbackExecuted = false;
    if (result.status === "failed") {
      const hasCritical = result.issues?.some((i) => i.severity === "critical") ?? false;
      severity = hasCritical ? "critical" : "alert";
      if (hasCritical && this.registerArm && this.gitRevert) {
        const arm = this.registerArm(job.commitSha);
        const r = await executeRollback(arm, this.gitRevert);
        rollbackExecuted = r.success;
      }
    }
    await this.notify({
      jobId: job.id, layer: job.layer,
      status: result.status, summary: result.summary,
      severity, rollbackExecuted
    });
  }
}
