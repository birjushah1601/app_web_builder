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

describe("RitualEngine.start — Plan PFP artifactKindHint threading", () => {
  it("threads artifactKindHint into the architect's priorArtifact when supplied", async () => {
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
      projectId: "p1",
      userId: "u-1",
      userTurn: "build a todo app",
      editClass: "structural",
      artifactKindHint: "frontend-app"
    });

    // Architect dispatch is the FIRST call; its second arg carries priorArtifact.
    const firstCall = dispatch.mock.calls[0]!;
    const opts = firstCall[1] as DispatchOpts | undefined;
    expect(opts?.priorArtifact).toMatchObject({ artifactKindHint: "frontend-app" });
  });

  it("omits artifactKindHint from priorArtifact when the hint is absent (no behavior change)", async () => {
    const dispatch = vi.fn(async (_req: unknown, _opts?: DispatchOpts) => ({
      roleId: "architect",
      output: {
        events: [{
          eventType: "architect.pass2.completed",
          payload: { artifact: {} }
        }],
        diff: { kind: "none" as const }
      }
    }));
    const engine = makeEngine(dispatch);

    await engine.start({
      projectId: "p1",
      userId: "u-1",
      userTurn: "build a todo app",
      editClass: "structural"
    });

    const firstCall = dispatch.mock.calls[0]!;
    const opts = firstCall[1] as DispatchOpts | undefined;
    // When hint is unset, the engine should NOT inject an artifactKindHint key.
    // priorArtifact may be undefined (no priorContext, no hint) — that's also fine.
    const prior = opts?.priorArtifact as { artifactKindHint?: unknown } | undefined;
    expect(prior?.artifactKindHint).toBeUndefined();
  });
});
