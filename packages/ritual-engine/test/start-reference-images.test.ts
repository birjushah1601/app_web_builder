import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

interface DispatchOpts { forceRoleId?: string; priorArtifact?: unknown }

function makeEngine(dispatchImpl: (req: unknown, opts?: DispatchOpts) => unknown) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
  });
}

describe("StartInput.referenceImages", () => {
  it("threads referenceImages into the architect's priorArtifact", async () => {
    const dispatch = vi.fn(async (_req: unknown, _opts?: DispatchOpts) => ({
      roleId: "architect",
      output: {
        events: [{
          eventType: "architect.pass2.completed",
          payload: { artifact: { canvasManifest: { artifactKind: "frontend-app", modes: [] } } }
        }],
        diff: { kind: "none" as const }
      }
    }));
    const engine = makeEngine(dispatch);

    await engine.start({
      projectId: "11111111-1111-1111-1111-111111111111",
      userTurn: "build a landing page",
      editClass: "structural",
      userId: "u1",
      referenceImages: [{ url: "https://example.com/ref.jpg", caption: "warm restaurant" }]
    });

    const firstCall = dispatch.mock.calls[0]!;
    const opts = firstCall[1] as DispatchOpts | undefined;
    expect(opts?.priorArtifact).toMatchObject({
      referenceImages: [{ url: "https://example.com/ref.jpg", caption: "warm restaurant" }]
    });
  });

  it("omits referenceImages from priorArtifact when absent", async () => {
    const dispatch = vi.fn(async (_req: unknown, _opts?: DispatchOpts) => ({
      roleId: "architect",
      output: {
        events: [{ eventType: "architect.pass2.completed", payload: { artifact: {} } }],
        diff: { kind: "none" as const }
      }
    }));
    const engine = makeEngine(dispatch);

    await engine.start({
      projectId: "11111111-1111-1111-1111-111111111111",
      userTurn: "build a landing page",
      editClass: "structural",
      userId: "u1"
    });

    const firstCall = dispatch.mock.calls[0]!;
    const opts = firstCall[1] as DispatchOpts | undefined;
    const prior = opts?.priorArtifact as { referenceImages?: unknown } | undefined;
    expect(prior?.referenceImages).toBeUndefined();
  });

  it("omits referenceImages when array is empty", async () => {
    const dispatch = vi.fn(async (_req: unknown, _opts?: DispatchOpts) => ({
      roleId: "architect",
      output: {
        events: [{ eventType: "architect.pass2.completed", payload: { artifact: {} } }],
        diff: { kind: "none" as const }
      }
    }));
    const engine = makeEngine(dispatch);

    await engine.start({
      projectId: "11111111-1111-1111-1111-111111111111",
      userTurn: "build a landing page",
      editClass: "structural",
      userId: "u1",
      referenceImages: []
    });

    const firstCall = dispatch.mock.calls[0]!;
    const opts = firstCall[1] as DispatchOpts | undefined;
    const prior = opts?.priorArtifact as { referenceImages?: unknown } | undefined;
    expect(prior?.referenceImages).toBeUndefined();
  });
});
