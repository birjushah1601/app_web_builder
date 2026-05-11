import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import { PersonaGateError } from "../src/errors.js";
import type { Conductor } from "@atlas/conductor";

const minimalConductor: Conductor = {
  dispatch: vi.fn(async () => ({
    roleId: "architect", attempts: 1,
    output: { events: [{ eventType: "architect.pass2.completed", payload: { artifact: {} } }], diff: { kind: "none" as const } }
  }))
} as unknown as Conductor;

describe("RitualEngine risk-accept", () => {
  it("Diego can risk-accept L4-security; event is persisted", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: minimalConductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "diego"; } }
    });
    const ritualId = await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    await engine.acceptRisk(ritualId, {
      gate: "L4-security",
      failureSummary: "wildcard CORS for legacy partner",
      acceptedBy: { personaTier: "diego", userId: "u-diego", timestamp: "2026-04-20T00:00:00Z" },
      rationale: "Sunset by 2026-06-01; tracked in JIRA-123",
      scope: "session"
    });
    const event = sink.events().find((e) => e.type === "ritual.risk_accepted");
    expect(event).toBeDefined();
    expect((event!.payload as { gate: string }).gate).toBe("L4-security");
  });

  it("Ama cannot risk-accept L4-security — throws PersonaGateError, no event emitted", async () => {
    const sink = new InMemoryEventSink();
    const engine = new RitualEngine({
      conductor: minimalConductor, eventSink: sink,
      personaPreferences: { async getPersona() { return "ama"; } }
    });
    const ritualId = await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    await expect(engine.acceptRisk(ritualId, {
      gate: "L4-security", failureSummary: "f",
      acceptedBy: { personaTier: "ama", userId: "u-ama", timestamp: "t" },
      rationale: "twenty character rationale here", scope: "session"
    })).rejects.toBeInstanceOf(PersonaGateError);
    expect(sink.events().filter((e) => e.type === "ritual.risk_accepted")).toHaveLength(0);
  });
});
