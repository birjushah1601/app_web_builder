import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";
import type { PersonaPreferences } from "../src/personas.js";

const personaPrefs: PersonaPreferences = { getPersona: async () => "diego" };

function makeRole(roleId: string, events: Array<{ eventType: string; payload: Record<string, unknown> }>): Role {
  return {
    id: roleId,
    async run() {
      return {
        events,
        diff: { kind: "none" as const }
      };
    }
  };
}

describe("Engine canvas flow (architect → researcher → designer → pause → developer)", () => {
  it("dispatches Researcher then Designer; pauses; resumes after resolveOption; passes selectedTokens to developer", async () => {
    const sink = new InMemoryEventSink();
    const pauseRegistry = new CanvasPauseRegistry();

    const architectArtifact = {
      scope: "new-app",
      specGraph: {},
      runnablePlan: { tasks: [] },
      designIntent: { category: "restaurant-landing", audienceCues: ["premium"] },
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [
          { id: "designing", renderer: "designing", audience: ["ama", "diego", "priya"], default: true, blockingFor: "design" },
          { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] }
        ]
      },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    };

    const architect = makeRole("architect", [
      { eventType: "architect.pass2.completed", payload: { artifact: architectArtifact } }
    ]);
    const researcher = makeRole("researcher", [
      { eventType: "researcher.brief.completed", payload: { sourceTier: "local-only", referenceCount: 2, brief: { summary: "premium serif palettes" } } }
    ]);
    const designer = makeRole("designer", [
      {
        eventType: "designer.proposal.emitted",
        payload: {
          recommendedId: "editorial-dark",
          alternateIds: ["minimal-warm", "premium-serif"],
          proposal: {
            recommended: { id: "editorial-dark", tokens: { palette: { primary: "#000" } } },
            alternates: [
              { id: "minimal-warm", tokens: { palette: { primary: "#fff" } } },
              { id: "premium-serif", tokens: { palette: { primary: "#888" } } }
            ]
          }
        }
      }
    ]);

    const developerRunSpy = vi.fn();
    const developer: Role = {
      id: "developer",
      async run(inv) {
        developerRunSpy(inv.priorArtifact);
        return {
          events: [{ eventType: "developer.completed", payload: { summary: "ok" } }],
          diff: { kind: "patch" as const, body: "diff --git a/x b/x" }
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
      canvasPauseRegistry: pauseRegistry,
      canvasPauseTimeoutMs: 60_000
    });

    // Resolve the pause asynchronously to simulate a user clicking "Use this →".
    // Poll the sink for ritual.started (emitted before the canvas pause) to learn
    // the engine-generated ritualId, then resolve. setInterval fires while the
    // engine awaits inside CanvasPauseRegistry.waitForOption.
    const interval = setInterval(() => {
      const startedEvent = sink.events().find((e) => e.type === "ritual.started");
      if (startedEvent && pauseRegistry.pendingCount() > 0) {
        clearInterval(interval);
        pauseRegistry.resolveOption(startedEvent.ritualId, {
          directionId: "editorial-dark",
          tokens: { palette: { primary: "#0a0a0a", accent: "#fbbf24" } }
        });
      }
    }, 5);

    const ritualId = await engine.start({
      userTurn: "build me a premium restaurant landing page",
      editClass: "structural",
      projectId: "p-1",
      userId: "u-1"
    });
    clearInterval(interval);

    // Engine emitted canvas events
    const events = sink.events();
    expect(events.some((e) => e.type === "architect.canvas_manifest.emitted")).toBe(true);
    expect(events.some((e) => e.type === "canvas.options.requested")).toBe(true);
    expect(events.some((e) => e.type === "canvas.option.selected")).toBe(true);

    // Developer received the merged priorArtifact (architect output + selectedTokens)
    expect(developerRunSpy).toHaveBeenCalledOnce();
    const priorArtifact = developerRunSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(priorArtifact.selectedTokens).toBeDefined();
    expect((priorArtifact.selectedTokens as { palette: { accent: string } }).palette.accent).toBe("#fbbf24");

    expect(ritualId).toBeTruthy();
  });
});
