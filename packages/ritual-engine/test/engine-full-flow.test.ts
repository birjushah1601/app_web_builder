import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor } from "@atlas/conductor";

const conductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: { ok: true } } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("RitualEngine full Visualize→Agree→Build→done flow", () => {
  it("walks through every state and ends in 'done' after merge_gates_green", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    const r = await engine.start({ userTurn: "feature", editClass: "structural", projectId: "p", userId: "u" });
    expect(engine.state(r)).toBe("agree");

    await engine.approve(r, { kind: "approved", approvedBy: "u-diego", persona: "diego" });
    expect(engine.state(r)).toBe("build");

    // Simulate merge gates green
    await engine.markBuildComplete(r);
    expect(engine.state(r)).toBe("done");

    const types = sink.events().map((e) => e.type);
    expect(types).toContain("ritual.started");
    expect(types).toContain("ritual.artifact_emitted");
    expect(types).toContain("ritual.approved");
    expect(types).toContain("ritual.completed");
    const completed = sink.events().find((e) => e.type === "ritual.completed");
    expect((completed!.payload as { finalState: string }).finalState).toBe("done");
  });

  it("changes_requested at agree returns to visualize", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });
    const r = await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    await engine.approve(r, { kind: "changes_requested", requestedBy: "u-diego", notes: "Add accessibility check" });
    expect(engine.state(r)).toBe("visualize");
  });
});
