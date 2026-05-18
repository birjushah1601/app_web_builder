import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";
import type { ChecklistRunner } from "../src/checkpoint.js";

const passingRunner: ChecklistRunner = {
  async run(_items, _persona) {
    return {
      passed: true,
      itemResults: [
        { key: "compliance_class", passed: true },
        { key: "data_residency_region", passed: true },
        { key: "auth_provider", passed: true },
        { key: "db_provider", passed: true },
        { key: "persona_tier", passed: true },
        { key: "intuition_check", passed: true }
      ]
    };
  }
};

describe("BootstrapCheckpoint first ritual", () => {
  it("intercepts first-ritual transitioned event, runs runner, marks store passed", async () => {
    const store = new InMemoryCheckpointStore();
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store,
      runner: passingRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    // Engine emits ritual.transitioned visualize→agree for project p-1
    await cp.onRitualEvent({
      type: "ritual.transitioned",
      ritualId: "r-1",
      ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    // Should have emitted required + passed (in order)
    const calls = sink.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).toContain("bootstrap.required");
    expect(calls).toContain("bootstrap.passed");
    expect(calls.indexOf("bootstrap.required")).toBeLessThan(calls.indexOf("bootstrap.passed"));

    // Store now records the project
    expect(await store.hasPassed("p-1")).toBe(true);
  });
});
