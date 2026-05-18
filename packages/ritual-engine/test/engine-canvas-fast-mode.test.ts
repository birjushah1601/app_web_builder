import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";

const personaPrefs = { getPersona: async () => "diego" as const };

describe("Engine canvas flow — mode=fast", () => {
  it("skips Researcher dispatch when mode=fast", async () => {
    const sink = new InMemoryEventSink();
    const reg = new CanvasPauseRegistry();
    const researcherRun = vi.fn();

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
                  graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
                  canvasManifest: {
                    artifactKind: "frontend-app",
                    modes: [
                      { id: "designing", renderer: "designing", audience: ["diego"], default: true, blockingFor: "design" }
                    ]
                  }
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
        return {
          events: [
            {
              eventType: "designer.proposal.emitted",
              payload: {
                proposal: {
                  recommended: { id: "x", tokens: {} },
                  alternates: [{}, {}]
                }
              }
            }
          ],
          diff: { kind: "none" as const }
        };
      }
    };
    const developer: Role = {
      id: "developer",
      async run() {
        return {
          events: [{ eventType: "developer.completed", payload: {} }],
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

    const engine = new RitualEngine({
      conductor,
      eventSink: sink,
      personaPreferences: personaPrefs,
      canvasFlowEnabled: true,
      canvasPauseRegistry: reg,
      canvasPauseTimeoutMs: 1000,
      ritualMode: "fast"
    });

    const interval = setInterval(() => {
      const ev = sink.events().find((e) => e.type === "ritual.started");
      if (ev && reg.pendingCount() > 0) {
        clearInterval(interval);
        reg.resolveOption(ev.ritualId, { directionId: "x", tokens: {} });
      }
    }, 5);

    await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });
    clearInterval(interval);
    expect(researcherRun).not.toHaveBeenCalled();
  });
});
