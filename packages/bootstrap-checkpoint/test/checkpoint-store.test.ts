import { describe, it, expect } from "vitest";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

describe("InMemoryCheckpointStore", () => {
  it("returns false for an unseen project", async () => {
    const store = new InMemoryCheckpointStore();
    expect(await store.hasPassed("p-1")).toBe(false);
  });

  it("returns true after markPassed", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "2026-04-20T00:00:00Z", ritualId: "r-1" });
    expect(await store.hasPassed("p-1")).toBe(true);
  });

  it("getRecord returns the stored record", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "t", ritualId: "r-1" });
    const rec = await store.getRecord("p-1");
    expect(rec?.ritualId).toBe("r-1");
  });
});
