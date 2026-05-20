import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";

const personaPrefs = { getPersona: async () => "diego" as const };

describe("Engine canvas pause — auto-select on timeout", () => {
  it("emits canvas.option.selected with autoSelected=true when timeout fires; developer still dispatches", async () => {
    const sink = new InMemoryEventSink();
    const reg = new CanvasPauseRegistry();
    const developerRun = vi.fn();

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
    const designer: Role = {
      id: "designer",
      async run() {
        return {
          events: [
            {
              eventType: "designer.proposal.emitted",
              payload: {
                proposal: {
                  recommended: { id: "rec-direction", tokens: { palette: { primary: "#abc" } } },
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
      async run(inv) {
        developerRun(inv.priorArtifact);
        return { events: [], diff: { kind: "none" as const } };
      }
    };

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["architect", architect],
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
      canvasPauseTimeoutMs: 50,
      ritualMode: "fast"
    });

    // No resolveOption call → timeout fires.
    await engine.start({ userTurn: "x", editClass: "structural", projectId: "p", userId: "u" });

    const selected = sink.events().find((e) => e.type === "canvas.option.selected");
    expect(selected).toBeDefined();
    expect((selected!.payload as { autoSelected: boolean }).autoSelected).toBe(true);
    expect((selected!.payload as { directionId: string }).directionId).toBe("rec-direction");

    // Developer received the recommended tokens
    const priorArtifact = developerRun.mock.calls[0]![0] as { selectedTokens: { palette: { primary: string } } };
    expect(priorArtifact.selectedTokens.palette.primary).toBe("#abc");
  });
});
