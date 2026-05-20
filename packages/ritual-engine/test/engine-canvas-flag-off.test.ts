import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";
import type { PersonaPreferences } from "../src/personas.js";

const personaPrefs: PersonaPreferences = { getPersona: async () => "diego" };

describe("Engine canvas flow (flag OFF)", () => {
  it("does NOT dispatch researcher or designer when canvasFlowEnabled is false", async () => {
    const sink = new InMemoryEventSink();
    const researcherRun = vi.fn();
    const designerRun = vi.fn();

    const architect: Role = {
      id: "architect",
      async run() {
        return {
          events: [
            {
              eventType: "architect.pass2.completed",
              payload: {
                artifact: {
                  scope: "new-app",
                  specGraph: {},
                  runnablePlan: { tasks: [] },
                  graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
                }
              }
            }
          ],
          diff: { kind: "none" as const }
        };
      }
    };
    const researcher: Role = {
      id: "researcher",
      async run() {
        researcherRun();
        return { events: [], diff: { kind: "none" as const } };
      }
    };
    const designer: Role = {
      id: "designer",
      async run() {
        designerRun();
        return { events: [], diff: { kind: "none" as const } };
      }
    };
    const developer: Role = {
      id: "developer",
      async run() {
        return {
          events: [{ eventType: "developer.completed", payload: { summary: "ok" } }],
          diff: { kind: "none" as const }
        };
      }
    };

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["architect", architect],
        ["researcher", researcher],
        ["designer", designer],
        ["developer", developer]
      ]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    const engine = new RitualEngine({ conductor, eventSink: sink, personaPreferences: personaPrefs });
    // canvasFlowEnabled defaults to false; no canvasPauseRegistry passed.

    await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });

    expect(researcherRun).not.toHaveBeenCalled();
    expect(designerRun).not.toHaveBeenCalled();
    expect(sink.events().some((e) => e.type === "canvas.options.requested")).toBe(false);
  });
});
