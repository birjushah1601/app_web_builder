import { describe, it, expect, vi } from "vitest";
import { AsyncGateWorker } from "../src/async-worker.js";
import { InMemoryAsyncQueue } from "../src/async-queue.js";
import { RollbackArm } from "../src/rollback-arm.js";

describe("AsyncGateWorker auto-rollback on critical failure", () => {
  it("critical-severity failure triggers executeRollback automatically", async () => {
    const q = new InMemoryAsyncQueue();
    const job = { id: "j1", layer: "L4" as const, ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "h", enqueuedAt: "t" };
    await q.enqueue(job);
    const runner = vi.fn(async () => ({
      layer: "L4" as const,
      status: "failed" as const,
      summary: "CVE",
      issues: [{ severity: "critical" as const, message: "react@18.0.0 has CVE-2026-XYZ" }]
    }));
    const gitRevert = vi.fn(async () => "reverted abc");
    const notify = vi.fn(async () => {});
    const worker = new AsyncGateWorker({
      queue: q,
      runners: new Map([["L4", runner]] as never),
      notify,
      registerArm: (commit) => new RollbackArm(commit, "auto critical"),
      gitRevert
    });
    await worker.drainOnce();
    expect(gitRevert).toHaveBeenCalledWith("abc");
    expect(notify).toHaveBeenCalled();
    const notification = notify.mock.calls[0][0] as { severity: string; rollbackExecuted: boolean };
    expect(notification.severity).toBe("critical");
    expect(notification.rollbackExecuted).toBe(true);
  });
});
