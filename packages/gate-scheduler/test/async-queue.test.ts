import { describe, it, expect } from "vitest";
import { InMemoryAsyncQueue, type AsyncGateJob } from "../src/async-queue.js";

const job = (id: string, layer: "L3" | "L4" | "L5"): AsyncGateJob => ({
  id, layer, ritualId: "r", projectId: "p", commitSha: "abc", graphSliceHash: "sha256:" + "0".repeat(64),
  enqueuedAt: new Date().toISOString()
});

describe("InMemoryAsyncQueue", () => {
  it("enqueue + dequeue FIFO", async () => {
    const q = new InMemoryAsyncQueue();
    await q.enqueue(job("a", "L3"));
    await q.enqueue(job("b", "L4"));
    expect((await q.dequeue())?.id).toBe("a");
    expect((await q.dequeue())?.id).toBe("b");
    expect(await q.dequeue()).toBeNull();
  });

  it("size reflects enqueued count", async () => {
    const q = new InMemoryAsyncQueue();
    expect(await q.size()).toBe(0);
    await q.enqueue(job("a", "L3"));
    expect(await q.size()).toBe(1);
    await q.dequeue();
    expect(await q.size()).toBe(0);
  });
});
