import { describe, it, expect } from "vitest";
import { runSyncGates } from "../src/sync-runner.js";
import type { GateRunner } from "../src/types.js";

const passing = (layer: string): GateRunner => ({ layer: layer as never, async run() { return { layer: layer as never, status: "passed", summary: "ok" }; } });
const failing = (layer: string): GateRunner => ({ layer: layer as never, async run() { return { layer: layer as never, status: "failed", summary: "boom" }; } });

const input = { ritualId: "r", projectId: "p", commitSha: "abc", graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } };

describe("runSyncGates", () => {
  it("runs all gates when all pass", async () => {
    const results = await runSyncGates([passing("L1"), passing("L2")], input);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "passed")).toBe(true);
  });

  it("short-circuits on first failure", async () => {
    const results = await runSyncGates([passing("L1"), failing("L2"), passing("L3")], input);
    expect(results).toHaveLength(2);
    expect(results[1].status).toBe("failed");
  });

  it("returns empty for empty input", async () => {
    expect(await runSyncGates([], input)).toEqual([]);
  });
});
