import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor } from "@atlas/conductor";

function mockConductor(): Conductor {
  return {
    dispatch: vi.fn(async () => ({
      roleId: "architect",
      attempts: 1,
      output: {
        events: [{
          eventType: "architect.pass2.completed",
          payload: { scope: "new-feature", artifact: { scope: "new-feature", diffPlan: { summary: "x", tasks: [] }, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } } }
        }],
        diff: { kind: "none" as const }
      }
    }))
  } as unknown as Conductor;
}

describe("RitualEngine.start (happy path)", () => {
  it("transitions visualize → agree after Architect emits artifact", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: mockConductor(),
      eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    const ritualId = await engine.start({
      userTurn: "add forgot-password",
      editClass: "structural",
      projectId: "11111111-1111-4111-8111-111111111111",
      userId: "u-1"
    });

    expect(ritualId).toMatch(/^r-/);
    const types = sink.events().map((e) => e.type);
    expect(types).toContain("ritual.started");
    expect(types).toContain("ritual.artifact_emitted");
    expect(types).toContain("ritual.transitioned");

    expect(engine.state(ritualId)).toBe("agree");
  });

  it("cosmetic edit-class skips agree and goes straight to build", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: mockConductor(),
      eventSink: sink,
      personaPreferences: { async getPersona() { return "ama"; } }
    });

    const ritualId = await engine.start({
      userTurn: "change button color",
      editClass: "cosmetic",
      projectId: "11111111-1111-4111-8111-111111111111",
      userId: "u-1"
    });

    expect(engine.state(ritualId)).toBe("build");
  });
});
