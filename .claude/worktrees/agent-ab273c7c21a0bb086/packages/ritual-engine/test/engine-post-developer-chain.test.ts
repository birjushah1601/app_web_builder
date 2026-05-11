import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

interface DispatchOpts {
  forceRoleId?: string;
}

function makeEngineWith(chain: string[], dispatchImpl: (req: unknown, opts?: DispatchOpts) => unknown) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
    postDeveloperChain: chain
  });
}

const ARCHITECT_ARTIFACT_EVENT = {
  eventType: "architect.pass2.completed",
  payload: { artifact: { kind: "plan" } }
};

describe("RitualEngine.start — postDeveloperChain dispatch (Plan I Task 3)", () => {
  it("with empty chain (default), no extra dispatches happen after developer", async () => {
    const calls: string[] = [];
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      calls.push(opts?.forceRoleId ?? "auto");
      if (!opts?.forceRoleId) {
        return { roleId: "architect", output: { events: [ARCHITECT_ARTIFACT_EVENT], diff: { kind: "none" } } };
      }
      // developer
      return {
        roleId: "developer",
        output: {
          events: [{ eventType: "developer.completed", payload: { diff: "diff --git a/x b/x", summary: "x" } }],
          diff: { kind: "patch", body: "diff --git a/x b/x" }
        }
      };
    });
    const engine = makeEngineWith([], dispatch as never);
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    // Expect: architect (auto) + developer (forced) — but NO third dispatch.
    expect(calls).toEqual(["auto", "developer"]);
  });

  it("with chain ['security'], dispatches security with forceRoleId after developer; surfaces report", async () => {
    const calls: string[] = [];
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      calls.push(opts?.forceRoleId ?? "auto");
      if (!opts?.forceRoleId) return { roleId: "architect", output: { events: [ARCHITECT_ARTIFACT_EVENT], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") {
        return {
          roleId: "developer",
          output: {
            events: [{ eventType: "developer.completed", payload: { diff: "diff --git a/x b/x", summary: "x" } }],
            diff: { kind: "patch", body: "diff --git a/x b/x" }
          }
        };
      }
      if (opts.forceRoleId === "security") {
        return {
          roleId: "security",
          output: {
            events: [{ eventType: "security.completed", payload: { passed: true, report: { passed: true, issues: [] } } }],
            diff: { kind: "none" }
          }
        };
      }
      throw new Error(`unexpected role: ${opts.forceRoleId}`);
    });
    const engine = makeEngineWith(["security"], dispatch as never);
    const ritualId = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const snap = await engine.getRitual(ritualId);
    expect(calls).toContain("security");
    expect(snap?.securityReport).toEqual({ passed: true, issues: [] });
  });

  it("when a chain role's report has passed=false, the engine escalates and stops the chain", async () => {
    const calls: string[] = [];
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      calls.push(opts?.forceRoleId ?? "auto");
      if (!opts?.forceRoleId) return { roleId: "architect", output: { events: [ARCHITECT_ARTIFACT_EVENT], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") {
        return {
          roleId: "developer",
          output: {
            events: [{ eventType: "developer.completed", payload: { diff: "diff --git a/x b/x" } }],
            diff: { kind: "patch", body: "diff --git a/x b/x" }
          }
        };
      }
      if (opts.forceRoleId === "security") {
        return {
          roleId: "security",
          output: {
            events: [{
              eventType: "security.completed",
              payload: {
                passed: false,
                report: { passed: false, issues: [{ severity: "critical", message: "secret leaked" }] }
              }
            }],
            diff: { kind: "none" }
          }
        };
      }
      throw new Error("a11y should NOT have run after security failure");
    });
    const engine = makeEngineWith(["security", "accessibility"], dispatch as never);
    const ritualId = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const snap = await engine.getRitual(ritualId);
    expect(snap?.state).toBe("escalated");
    expect(snap?.securityReport).toBeDefined();
    expect(snap?.accessibilityReport).toBeUndefined();
    expect(calls).not.toContain("accessibility");
  });

  it("cosmetic edits skip the chain entirely (no developer dispatch, no chain)", async () => {
    const calls: string[] = [];
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      calls.push(opts?.forceRoleId ?? "auto");
      return { roleId: "architect", output: { events: [ARCHITECT_ARTIFACT_EVENT], diff: { kind: "none" } } };
    });
    const engine = makeEngineWith(["security", "accessibility"], dispatch as never);
    await engine.start({ projectId: "p", userId: "u", userTurn: "tweak the button color", editClass: "cosmetic" });
    expect(calls).toEqual(["auto"]);
  });
});
