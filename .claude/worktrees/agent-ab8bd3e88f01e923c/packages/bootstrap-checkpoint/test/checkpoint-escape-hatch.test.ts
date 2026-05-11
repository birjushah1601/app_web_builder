import { describe, it, expect, vi } from "vitest";
import { BootstrapCheckpoint } from "../src/checkpoint.js";
import { InMemoryCheckpointStore } from "../src/checkpoint-store.js";

const escalatingRunner = {
  run: async () => ({
    passed: false,
    itemResults: [
      { key: "compliance_class", passed: true },
      { key: "data_residency_region", passed: true },
      { key: "auth_provider", passed: true },
      { key: "db_provider", passed: true },
      { key: "persona_tier", passed: true },
      { key: "intuition_check", passed: false, notes: "Auth setup feels off, can't articulate why" }
    ]
  })
};

describe("BootstrapCheckpoint escape hatch", () => {
  it("intuition_check failed → emits bootstrap.escalation_requested with the free text", async () => {
    const store = new InMemoryCheckpointStore();
    const sink = vi.fn(async () => {});
    const cp = new BootstrapCheckpoint({
      store, runner: escalatingRunner,
      eventSink: { emit: sink },
      personaPreferences: { async getPersona() { return "ama"; } }
    });

    await cp.onRitualEvent({
      type: "ritual.transitioned", ritualId: "r-1", ts: "t",
      payload: { from: "visualize", to: "agree", transitionKind: "artifact_emitted" }
    }, { projectId: "p-1", userId: "u-1" });

    const types = sink.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("bootstrap.escalation_requested");
    const escalation = sink.mock.calls.find((c) => (c[0] as { type: string }).type === "bootstrap.escalation_requested");
    const payload = (escalation![0] as { payload: { freeText: string; requestedReviewer: string } }).payload;
    expect(payload.freeText).toContain("Auth setup");
    expect(payload.requestedReviewer).toBe("priya");
  });
});
