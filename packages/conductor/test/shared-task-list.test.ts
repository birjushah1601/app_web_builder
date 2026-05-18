import { describe, it, expect } from "vitest";
import { SharedTaskList } from "../src/shared-task-list.js";

interface TestTask { id: string; label: string; }

describe("SharedTaskList", () => {
  it("enqueue + dequeue in FIFO order", () => {
    const q = new SharedTaskList<TestTask>();
    q.enqueue({ id: "a", label: "first" });
    q.enqueue({ id: "b", label: "second" });
    expect(q.dequeue()?.id).toBe("a");
    expect(q.dequeue()?.id).toBe("b");
    expect(q.dequeue()).toBeUndefined();
  });

  it("lock/unlock prevents dequeue of locked task", () => {
    const q = new SharedTaskList<TestTask>();
    q.enqueue({ id: "a", label: "x" });
    q.enqueue({ id: "b", label: "y" });
    const token = q.lock("a");
    expect(q.dequeue()?.id).toBe("b"); // skipped locked a
    q.unlock("a", token);
    expect(q.dequeue()?.id).toBe("a");
  });

  it("unlock with wrong token throws", () => {
    const q = new SharedTaskList<TestTask>();
    q.enqueue({ id: "a", label: "x" });
    q.lock("a");
    expect(() => q.unlock("a", "wrong-token")).toThrow(/token/);
  });

  it("size() reflects enqueued count minus dequeued", () => {
    const q = new SharedTaskList<TestTask>();
    expect(q.size()).toBe(0);
    q.enqueue({ id: "a", label: "x" });
    q.enqueue({ id: "b", label: "y" });
    expect(q.size()).toBe(2);
    q.dequeue();
    expect(q.size()).toBe(1);
  });
});
