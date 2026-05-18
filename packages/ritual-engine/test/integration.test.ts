import { describe, it, expect, vi } from "vitest";
import { Conductor } from "@atlas/conductor";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";

describe("RitualEngine + real Conductor integration", () => {
  it("dispatches a ritual through a real Conductor with a stubbed Architect role", async () => {
    const stubArchitect = {
      id: "architect",
      run: async () => ({
        events: [
          { eventType: "architect.pass1.completed", payload: { passed: true, scope: "new-feature" } },
          { eventType: "architect.pass2.completed", payload: { artifact: { scope: "new-feature" } } }
        ],
        diff: { kind: "none" as const }
      })
    };

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
      roles: new Map([["architect", stubArchitect]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });

    const r = await engine.start({
      userTurn: "add forgot-password", editClass: "structural",
      projectId: "11111111-1111-4111-8111-111111111111", userId: "u-1"
    });
    await engine.approve(r, { kind: "approved", approvedBy: "u-1", persona: "diego" });
    await engine.markBuildComplete(r);

    expect(engine.state(r)).toBe("done");
    expect(engine.artifact(r)).toEqual({ scope: "new-feature" });

    const types = sink.events().map((e) => e.type);
    for (const expected of ["ritual.started", "ritual.artifact_emitted", "ritual.approved", "ritual.completed"]) {
      expect(types).toContain(expected);
    }
  });
});
