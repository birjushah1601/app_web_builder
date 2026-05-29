// Plan E Task 5 — verifies the roleChain short-circuit in RitualEngine.start.
// When the caller passes roleChain=[<id>...], the engine dispatches those
// role IDs in order via Conductor.dispatch({ forceRoleId, priorArtifact })
// and SKIPS the default architect → developer chain. The final
// ritual.artifact_emitted event picks up the artifact from whichever
// chained role emitted one (TestsRole's contract).
import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

interface DispatchOpts {
  forceRoleId?: string;
  priorArtifact?: unknown;
}

function makeEngine(dispatchImpl: (req: unknown, opts?: DispatchOpts) => unknown) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
  });
}

describe("RitualEngine.start — roleChain short-circuit (Plan E Task 5)", () => {
  it("dispatches only the chained role IDs in order; skips architect/developer", async () => {
    const calls: Array<{ forceRoleId?: string; priorArtifact?: unknown }> = [];
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      calls.push({ forceRoleId: opts?.forceRoleId, priorArtifact: opts?.priorArtifact });
      return {
        roleId: opts?.forceRoleId ?? "auto",
        output: {
          events: [{
            eventType: "ritual.artifact_emitted",
            payload: { fromRole: opts?.forceRoleId, artifact: { schemaVersion: "1", kind: "tests", framework: "vitest", specs: [] } }
          }],
          diff: { kind: "none" }
        }
      };
    });
    const engine = makeEngine(dispatch as never);

    const priorArtifact = { upstream: { frontend: { kind: "frontend-app" } } };
    const ritualId = await engine.start({
      projectId: "p", userId: "u", userTurn: "Generate tests",
      editClass: "structural",
      roleChain: ["tester"],
      priorArtifact
    });

    // Exactly ONE dispatch call — the chained tester role. No architect, no developer.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.forceRoleId).toBe("tester");
    expect(calls[0]?.priorArtifact).toEqual(priorArtifact);

    // The artifact from the chained role bubbles to the ritual snapshot.
    const snap = await engine.getRitual(ritualId);
    expect(snap?.artifact).toMatchObject({ kind: "tests", framework: "vitest" });
    // roleEvents contains the chained role's emitted events.
    expect(snap?.roleEvents.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(true);
  });

  it("dispatches multiple chained roles in order", async () => {
    const calls: string[] = [];
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      calls.push(opts?.forceRoleId ?? "auto");
      return {
        roleId: opts?.forceRoleId ?? "auto",
        output: { events: [], diff: { kind: "none" } }
      };
    });
    const engine = makeEngine(dispatch as never);

    await engine.start({
      projectId: "p", userId: "u", userTurn: "x",
      editClass: "structural",
      roleChain: ["role-a", "role-b", "role-c"]
    });

    expect(calls).toEqual(["role-a", "role-b", "role-c"]);
  });

  it("records dispatch failures as synthetic events and stops the chain", async () => {
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (opts?.forceRoleId === "role-b") throw new Error("role-b is unknown");
      return {
        roleId: opts?.forceRoleId ?? "auto",
        output: { events: [], diff: { kind: "none" } }
      };
    });
    const engine = makeEngine(dispatch as never);

    const ritualId = await engine.start({
      projectId: "p", userId: "u", userTurn: "x",
      editClass: "structural",
      roleChain: ["role-a", "role-b", "role-c"]
    });

    const snap = await engine.getRitual(ritualId);
    // role-c was never dispatched after role-b's failure
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(snap?.roleEvents.some((e) => e.eventType === "role-b.dispatch.failed")).toBe(true);
  });

  it("empty roleChain falls through to default architect chain", async () => {
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      // Architect (auto-classified, no forceRoleId) returns no artifact → ritual completes empty.
      return {
        roleId: opts?.forceRoleId ?? "architect",
        output: { events: [], diff: { kind: "none" } }
      };
    });
    const engine = makeEngine(dispatch as never);

    await engine.start({
      projectId: "p", userId: "u", userTurn: "x",
      editClass: "structural",
      roleChain: []
    });

    // Architect dispatch was called (no forceRoleId).
    expect(dispatch).toHaveBeenCalled();
    const firstCallOpts = (dispatch.mock.calls[0]?.[1] ?? {}) as DispatchOpts;
    expect(firstCallOpts.forceRoleId).toBeUndefined();
  });
});
