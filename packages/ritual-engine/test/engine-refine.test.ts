import { describe, it, expect, vi } from "vitest";
import { RitualEngine, isPriorRitualContext } from "../src/index.js";

interface DispatchOpts { forceRoleId?: string; priorArtifact?: unknown }

function makeEngine(dispatchImpl: (req: unknown, opts?: DispatchOpts) => unknown) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
  });
}

function seedParent(engine: RitualEngine, parentId: string, fields: Record<string, unknown>) {
  (engine as never as { rituals: Map<string, unknown> }).rituals.set(parentId, {
    state: "done", projectId: "p", userId: "u", roleEvents: [], ...fields
  });
}

describe("RitualEngine.refine — Plan K Task 3", () => {
  it("creates a NEW ritualId (not the parent's)", async () => {
    const engine = makeEngine(async () => ({
      roleId: "architect",
      output: { events: [], diff: { kind: "none" } }
    }));
    seedParent(engine, "r-parent", {});
    const childId = await engine.refine({
      parentRitualId: "r-parent", projectId: "p", userId: "u", userTurn: "rename foo"
    });
    expect(childId).not.toBe("r-parent");
    expect(childId).toMatch(/^r-/);
  });

  it("threads parent's developerOutput + artifact into the architect's priorArtifact as PriorRitualContext", async () => {
    const dispatch = vi.fn(async (_req: unknown, _opts?: DispatchOpts) => ({
      roleId: "architect",
      output: { events: [], diff: { kind: "none" } }
    }));
    const engine = makeEngine(dispatch);
    seedParent(engine, "r-parent", {
      artifact: { kind: "plan", title: "build foo" },
      developerOutput: { diff: "diff --git a/foo b/foo", summary: "added foo" },
      roleEvents: [{ eventType: "architect.pass2.completed", payload: {} }]
    });
    await engine.refine({
      parentRitualId: "r-parent", projectId: "p", userId: "u", userTurn: "rename foo to bar"
    });
    // Architect dispatch is the FIRST call; its second arg carries priorArtifact.
    const firstCall = dispatch.mock.calls[0]!;
    const opts = firstCall[1] as DispatchOpts | undefined;
    expect(isPriorRitualContext(opts?.priorArtifact)).toBe(true);
    const ctx = opts!.priorArtifact as { parentDeveloperOutput?: { diff: string } };
    expect(ctx.parentDeveloperOutput?.diff).toContain("foo");
  });

  it("rejects when the parent ritualId is unknown", async () => {
    const engine = makeEngine(async () => ({
      roleId: "architect", output: { events: [], diff: { kind: "none" } }
    }));
    await expect(engine.refine({
      parentRitualId: "r-missing", projectId: "p", userId: "u", userTurn: "x"
    })).rejects.toThrow(/parent.*not found/i);
  });

  it("rejects when the parent's projectId does not match input.projectId (cross-project denial)", async () => {
    const engine = makeEngine(async () => ({
      roleId: "architect", output: { events: [], diff: { kind: "none" } }
    }));
    seedParent(engine, "r-parent", { projectId: "p-A" });
    // Override: seedParent uses projectId "p" by default; override here.
    (engine as never as { rituals: Map<string, unknown> }).rituals.get("r-parent")! as unknown as { projectId: string };
    (engine as never as { rituals: Map<string, { projectId: string }> }).rituals.get("r-parent")!.projectId = "p-A";
    await expect(engine.refine({
      parentRitualId: "r-parent", projectId: "p-B", userId: "u", userTurn: "x"
    })).rejects.toThrow(/project mismatch/i);
  });

  it("the child ritual's snapshot has parentRitualId set to the parent's ritualId", async () => {
    const engine = makeEngine(async () => ({
      roleId: "architect",
      output: {
        events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }],
        diff: { kind: "none" }
      }
    }));
    seedParent(engine, "r-parent", {});
    const childId = await engine.refine({
      parentRitualId: "r-parent", projectId: "p", userId: "u", userTurn: "x"
    });
    const childSnap = await engine.getRitual(childId);
    expect(childSnap?.parentRitualId).toBe("r-parent");
  });

  it("ritual.started event for the child includes parentRitualId in payload (lineage trail)", async () => {
    const sink = { emit: vi.fn() };
    const engine = new RitualEngine({
      conductor: { dispatch: vi.fn(async () => ({
        roleId: "architect", output: { events: [], diff: { kind: "none" } }
      })) } as never,
      eventSink: sink as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });
    (engine as never as { rituals: Map<string, unknown> }).rituals.set("r-parent", {
      state: "done", projectId: "p", userId: "u", roleEvents: []
    });
    await engine.refine({
      parentRitualId: "r-parent", projectId: "p", userId: "u", userTurn: "x"
    });
    const startedCall = sink.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "ritual.started");
    expect(startedCall).toBeDefined();
    const startedPayload = (startedCall![0] as { payload: { parentRitualId?: string } }).payload;
    expect(startedPayload.parentRitualId).toBe("r-parent");
  });
});
