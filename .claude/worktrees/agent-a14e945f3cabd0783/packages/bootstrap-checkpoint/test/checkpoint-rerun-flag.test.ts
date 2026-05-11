import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

describe("BootstrapCheckpoint rerun flag", () => {
  it("re-runs the checklist when ctx.rerun is true even if previously passed", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "yesterday", ritualId: "r-0" });
    const runner = { run: vi.fn(async () => ({ passed: true, itemResults: [{ key: "compliance_class", passed: true }] })) };
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "priya"; } }
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-2", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1", rerun: true });

    expect(runner.run).toHaveBeenCalledOnce();
    const types = sink.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("bootstrap.required");
    expect(types).toContain("bootstrap.passed");
  });
});
