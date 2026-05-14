import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { PersonaPreferences } from "../src/personas.js";

const personaPrefs: PersonaPreferences = { getPersona: async () => "diego" };

describe("Engine — layoutDirective threads to Developer priorArtifact", () => {
  it("folds the chosen direction's layoutDirective into Developer's priorArtifact as selectedLayoutDirective", async () => {
    const sink = new InMemoryEventSink();

    const architectArtifact = {
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [{ id: "designing", default: true, blockingFor: "design", audience: ["ama"] }]
      },
      designIntent: { category: "restaurant-landing", audienceCues: [] }
    };

    const architect: Role = {
      id: "architect",
      async run() {
        return {
          events: [{ eventType: "architect.pass2.completed", payload: { artifact: architectArtifact } }],
          diff: { kind: "none" as const }
        };
      }
    };

    const researcher: Role = {
      id: "researcher",
      async run() {
        return {
          events: [{ eventType: "researcher.brief.completed", payload: { brief: { category: "restaurant-landing" } } }],
          diff: { kind: "none" as const }
        };
      }
    };

    const proposalPayload = {
      recommended: {
        id: "rec",
        tokens: { palette: { primary: "#000" }, componentSet: "radix-bare" },
        layoutDirective: "Hero with food. Menu by category. NO testimonials."
      },
      alternates: [],
      reasoning: "x"
    };

    const designer: Role = {
      id: "designer",
      async run() {
        return {
          events: [{
            eventType: "designer.proposal.emitted",
            payload: { proposal: proposalPayload }
          }],
          diff: { kind: "none" as const }
        };
      }
    };

    const developerRunSpy = vi.fn();
    const developer: Role = {
      id: "developer",
      async run(inv) {
        developerRunSpy(inv.priorArtifact);
        return {
          events: [],
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

    // Use a simple pause-registry stub that auto-resolves with rec direction
    const pauseRegistry = {
      waitForOption: async () => ({
        directionId: "rec",
        tokens: { palette: { primary: "#000" }, componentSet: "radix-bare" },
        autoSelected: true
      }),
      pendingCount: () => 0
    };

    const engine = new RitualEngine({
      conductor,
      eventSink: sink,
      personaPreferences: personaPrefs,
      canvasFlowEnabled: true,
      canvasPauseRegistry: pauseRegistry as never
    });

    await engine.start({
      projectId: "11111111-1111-1111-1111-111111111111",
      userTurn: "build a restaurant",
      editClass: "structural",
      userId: "u1"
    });

    expect(developerRunSpy).toHaveBeenCalledOnce();
    const priorArtifact = developerRunSpy.mock.calls[0]![0] as { selectedLayoutDirective?: string };
    expect(priorArtifact.selectedLayoutDirective).toBe("Hero with food. Menu by category. NO testimonials.");
  });
});
