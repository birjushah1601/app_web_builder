import { describe, it, expect, vi } from "vitest";
import { AsyncGateWorker } from "../src/async-worker.js";
import { InMemoryAsyncQueue } from "../src/async-queue.js";

describe("AsyncGateWorker drain", () => {
  it("processes every queued job in order until queue is empty", async () => {
    const q = new InMemoryAsyncQueue();
    await q.enqueue({ id: "j1", layer: "L4", ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "h", enqueuedAt: "t" });
    await q.enqueue({ id: "j2", layer: "L5", ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "h", enqueuedAt: "t" });
    const runner = { L4: vi.fn(async () => ({ layer: "L4" as const, status: "passed" as const, summary: "ok" })),
                     L5: vi.fn(async () => ({ layer: "L5" as const, status: "passed" as const, summary: "ok" })) };
    const notify = vi.fn(async () => {});
    const worker = new AsyncGateWorker({
      queue: q,
      runners: new Map(Object.entries(runner) as never),
      notify
    });
    await worker.drainOnce();
    expect(runner.L4).toHaveBeenCalledOnce();
    expect(runner.L5).toHaveBeenCalledOnce();
    expect(await q.size()).toBe(0);
  });
});
