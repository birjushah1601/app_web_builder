import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const failingRunner = {
  run: async () => ({
    passed: false,
    itemResults: [
      { key: "compliance_class", passed: false, notes: "actually GDPR" },
      { key: "data_residency_region", passed: true },
      { key: "auth_provider", passed: true },
      { key: "db_provider", passed: true },
      { key: "persona_tier", passed: true },
      { key: "intuition_check", passed: true }
    ]
  })
};

describe("BootstrapCheckpoint failure path", () => {
  it("on failure, calls engine.approve(changes_requested) to route back to visualize", async () => {
    const store = new InMemoryCheckpointStore();
    const sink = vi.fn(async () => {});
    const approve = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner: failingRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "diego"; } },
      ritualEngine: { approve } as never
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-1", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    expect(approve).toHaveBeenCalledOnce();
    const call = approve.mock.calls[0];
    expect(call[0]).toBe("r-1");
    expect((call[1] as { kind: string }).kind).toBe("changes_requested");
    expect((call[1] as { notes: string }).notes).toContain("compliance_class");
  });
});
