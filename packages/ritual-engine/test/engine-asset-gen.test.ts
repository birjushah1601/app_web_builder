import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";
import type { PersonaPreferences } from "../src/personas.js";

const personaPrefs: PersonaPreferences = { getPersona: async () => "diego" };

/** Plan SPU — verifies the engine dispatches AssetGenerator AFTER the canvas
 *  pause resolves and folds the resulting assetManifest into the developer's
 *  priorArtifact. Mirrors the wider canvas-flow test setup but adds an
 *  "asset-generator" role into the conductor's registry so `hasRole()` returns
 *  true and the new branch fires. */
describe("Engine — AssetGenerator dispatch", () => {
  it("dispatches asset-generator after canvas pause + folds manifest into developer priorArtifact", async () => {
    const sink = new InMemoryEventSink();
    const pauseRegistry = new CanvasPauseRegistry();

    const architectArtifact = {
      scope: "new-app",
      specGraph: {},
      runnablePlan: { tasks: [] },
      designIntent: { category: "frontend-app", audienceCues: [] },
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [
          { id: "designing", renderer: "designing", audience: ["ama"], default: true, blockingFor: "design" }
        ]
      },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
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
          events: [{ eventType: "researcher.brief.completed", payload: { brief: { summary: "stub brief" } } }],
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
                  recommended: { id: "x", tokens: { palette: { primary: "#000" } } },
                  alternates: []
                }
              }
            }
          ],
          diff: { kind: "none" as const }
        };
      }
    };
    // AssetGenerator returns artifact.assetManifest — same shape as
    // @atlas/role-asset-generator emits at runtime via withArtifact().
    const assetGenerator: Role = {
      id: "asset-generator",
      async run() {
        return {
          events: [
            {
              eventType: "asset.gen.completed",
              payload: {
                manifest: {
                  hero: { slot: "hero", url: "/atlas-assets/abc.jpg", alt: "h" },
                  sections: []
                }
              }
            }
          ],
          diff: { kind: "none" as const },
          // Engine reads artifact.assetManifest off the role's output object
          // (role.ts attaches it via withArtifact); preserve that contract here.
          artifact: {
            assetManifest: {
              hero: { slot: "hero", url: "/atlas-assets/abc.jpg", alt: "h" },
              sections: []
            }
          }
        } as unknown as Awaited<ReturnType<Role["run"]>>;
      }
    };
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
        ["asset-generator", assetGenerator],
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

    // Resolve the pause asynchronously — mirrors the canvas-flow test pattern.
    const interval = setInterval(() => {
      const started = sink.events().find((e) => e.type === "ritual.started");
      if (started && pauseRegistry.pendingCount() > 0) {
        clearInterval(interval);
        pauseRegistry.resolveOption(started.ritualId, {
          directionId: "x",
          tokens: { palette: { primary: "#000" } }
        });
      }
    }, 5);

    await engine.start({
      userTurn: "build x",
      editClass: "structural",
      projectId: "11111111-1111-1111-1111-111111111111",
      userId: "u1"
    });
    clearInterval(interval);

    // Developer received the merged priorArtifact (architect output +
    // selectedTokens + assetManifest from AssetGenerator).
    expect(developerRunSpy).toHaveBeenCalledOnce();
    const priorArtifact = developerRunSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(priorArtifact).toMatchObject({
      assetManifest: {
        hero: { url: "/atlas-assets/abc.jpg" }
      }
    });
  });

  it("emits asset.gen.failed and proceeds when AssetGenerator throws", async () => {
    const sink = new InMemoryEventSink();
    const pauseRegistry = new CanvasPauseRegistry();

    const architectArtifact = {
      designIntent: { category: "frontend-app", audienceCues: [] },
      canvasManifest: {
        artifactKind: "frontend-app",
        modes: [
          { id: "designing", renderer: "designing", audience: ["ama"], default: true, blockingFor: "design" }
        ]
      }
    };

    const makeRole = (id: string, events: Array<{ eventType: string; payload: Record<string, unknown> }>): Role => ({
      id,
      async run() {
        return { events, diff: { kind: "none" as const } };
      }
    });

    const architect = makeRole("architect", [
      { eventType: "architect.pass2.completed", payload: { artifact: architectArtifact } }
    ]);
    const researcher = makeRole("researcher", [
      { eventType: "researcher.brief.completed", payload: { brief: {} } }
    ]);
    const designer = makeRole("designer", [
      {
        eventType: "designer.proposal.emitted",
        payload: {
          proposal: {
            recommended: { id: "x", tokens: { palette: { primary: "#000" } } },
            alternates: []
          }
        }
      }
    ]);
    // Always-throwing AssetGenerator — engine should swallow the throw via the
    // RitualEscalatedError that the conductor wraps it in and record
    // asset.gen.failed into roleEvents.
    const assetGenerator: Role = {
      id: "asset-generator",
      async run() {
        throw new Error("boom");
      }
    };
    const developer: Role = {
      id: "developer",
      async run() {
        return {
          events: [{ eventType: "developer.completed", payload: { summary: "ok" } }],
          diff: { kind: "patch" as const, body: "x" }
        };
      }
    };

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["architect", architect],
        ["researcher", researcher],
        ["designer", designer],
        ["asset-generator", assetGenerator],
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

    const interval = setInterval(() => {
      const started = sink.events().find((e) => e.type === "ritual.started");
      if (started && pauseRegistry.pendingCount() > 0) {
        clearInterval(interval);
        pauseRegistry.resolveOption(started.ritualId, {
          directionId: "x",
          tokens: { palette: { primary: "#000" } }
        });
      }
    }, 5);

    const ritualId = await engine.start({
      userTurn: "build x",
      editClass: "structural",
      projectId: "11111111-1111-1111-1111-111111111111",
      userId: "u1"
    });
    clearInterval(interval);

    const snap = await engine.getRitual(ritualId);
    expect(snap?.roleEvents.some((e) => e.eventType === "asset.gen.failed")).toBe(true);
  });
});
