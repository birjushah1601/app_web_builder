import { describe, it, expect, vi } from "vitest";
import { diffGraphs, classifyEdit } from "@atlas/edit-classifier";
import { scheduleGates } from "../src/schedule.js";
import { runSyncGates } from "../src/sync-runner.js";
import { AsyncGateWorker } from "../src/async-worker.js";
import { InMemoryAsyncQueue } from "../src/async-queue.js";
import type { GateRunner } from "../src/types.js";

const baseGraph = {
  schemaVersion: "1.0.0", projectId: "p", name: "demo",
  complianceClasses: ["baseline"],
  databaseProvider: { tier: "atlas-run", provider: "neon", region: "us-east-1", connectionStringRef: "env:DB" },
  templateDigest: "sha256:" + "0".repeat(64),
  createdAt: "t", updatedAt: "t",
  nodes: { "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" } },
  edges: []
};

const passing: GateRunner = { layer: "L1", async run() { return { layer: "L1", status: "passed", summary: "ok" }; } };

describe("integration: cosmetic edit → 2 sync, 3 async", () => {
  it("classifies a title-only change as cosmetic and schedules accordingly", async () => {
    const after = { ...baseGraph, nodes: { "page:home": { ...baseGraph.nodes["page:home"], title: "Welcome" } } };
    const changes = diffGraphs(baseGraph as never, after as never);
    const classification = classifyEdit(changes);
    expect(classification.class).toBe("cosmetic");

    const schedule = scheduleGates(classification);
    expect(schedule.sync).toEqual(["L1", "L2"]);
    expect(schedule.async).toEqual(["L3", "L4", "L5"]);

    const syncResults = await runSyncGates([passing, { ...passing, layer: "L2" }], {
      ritualId: "r", projectId: "p", commitSha: "abc",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });
    expect(syncResults).toHaveLength(2);
    expect(syncResults.every((r) => r.status === "passed")).toBe(true);

    // Enqueue async gates
    const queue = new InMemoryAsyncQueue();
    for (const layer of schedule.async) {
      await queue.enqueue({
        id: `${layer}-r`, layer, ritualId: "r", projectId: "p", commitSha: "abc",
        graphSliceHash: "sha256:" + "0".repeat(64), enqueuedAt: "t"
      });
    }
    const notifications: unknown[] = [];
    const worker = new AsyncGateWorker({
      queue,
      runners: new Map([
        ["L3", async () => ({ layer: "L3", status: "passed", summary: "ok" })],
        ["L4", async () => ({ layer: "L4", status: "passed", summary: "ok" })],
        ["L5", async () => ({ layer: "L5", status: "passed", summary: "ok" })]
      ] as never),
      notify: async (n) => { notifications.push(n); }
    });
    await worker.drainOnce();
    expect(notifications).toHaveLength(3);
  });
});
