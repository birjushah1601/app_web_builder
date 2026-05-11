import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const noopRunner = { run: vi.fn(async () => ({ passed: true, itemResults: [] })) };

describe("BootstrapCheckpoint skip on second ritual", () => {
  it("does not re-run the checklist if the project already passed", async () => {
    const store = new InMemoryCheckpointStore();
    await store.markPassed("p-1", { ts: "yesterday", ritualId: "r-0" });
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner: noopRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-2", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    expect(noopRunner.run).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });
});
