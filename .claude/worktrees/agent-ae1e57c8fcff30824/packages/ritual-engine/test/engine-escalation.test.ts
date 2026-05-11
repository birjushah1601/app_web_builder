import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor } from "@atlas/conductor";

const minimalConductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: {} } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("RitualEngine escalation", () => {
  it("escalate() transitions to 'escalated' and emits both events", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: minimalConductor,
      eventSink: sink,
      personaPreferences: { async getPersona() { return "ama"; } }
    });
    const ritualId = await engine.start({
      userTurn: "x", editClass: "structural", projectId: "p", userId: "u"
    });

    await engine.escalate(ritualId, "needs Priya review", "u-ama");
    expect(engine.state(ritualId)).toBe("escalated");
    const types = sink.events().map((e) => e.type);
    expect(types).toContain("ritual.escalation_requested");
    expect(types.filter((t) => t === "ritual.completed")).toHaveLength(1);
    const completed = sink.events().find((e) => e.type === "ritual.completed");
    expect((completed!.payload as { finalState: string }).finalState).toBe("escalated");
  });
});
