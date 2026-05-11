import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

interface DispatchOpts { forceRoleId?: string; priorArtifact?: unknown }

const ARTIFACT_EVENT = {
  eventType: "architect.pass2.completed",
  payload: { artifact: { kind: "plan" } }
};

function makeEngine(opts: { autoFixEnabled?: boolean }, dispatchImpl: (req: unknown, opts?: DispatchOpts) => unknown, sink?: { emit: ReturnType<typeof vi.fn> }) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn(dispatchImpl) } as never,
    eventSink: (sink ?? { emit: vi.fn() }) as never,
    personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
    postDeveloperChain: ["security"],
    autoFixLoopEnabled: opts.autoFixEnabled ?? false
  });
}

describe("RitualEngine auto-fix loop — Plan L Task 4", () => {
  it("flag-OFF: gate failure escalates and stops (Plan I behavior preserved)", async () => {
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") return {
        roleId: "developer",
        output: { events: [{ eventType: "developer.completed", payload: { diff: "diff x" } }], diff: { kind: "patch", body: "diff x" } }
      };
      if (opts.forceRoleId === "security") return {
        roleId: "security",
        output: {
          events: [{ eventType: "security.completed", payload: { passed: false, report: { passed: false, issues: [{ severity: "critical", message: "x" }] } } }],
          diff: { kind: "none" }
        }
      };
      throw new Error(`unexpected: ${opts.forceRoleId}`);
    });
    const engine = makeEngine({ autoFixEnabled: false }, dispatch);
    const id = await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const snap = await engine.getRitual(id);
    expect(snap?.state).toBe("escalated");
    expect(snap?.fixAttempts ?? 0).toBe(0);
  });

  it("flag-ON + first attempt: triggers refine() — second architect dispatch fires", async () => {
    let architectCallCount = 0;
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) {
        architectCallCount++;
        return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } };
      }
      if (opts.forceRoleId === "developer") return {
        roleId: "developer",
        output: { events: [{ eventType: "developer.completed", payload: { diff: `diff for arch ${architectCallCount}` } }], diff: { kind: "patch", body: "x" } }
      };
      if (opts.forceRoleId === "security") {
        // first call fails; second passes (post-fix)
        const passed = architectCallCount === 2;
        return {
          roleId: "security",
          output: {
            events: [{ eventType: "security.completed", payload: { passed, report: { passed, issues: passed ? [] : [{ severity: "critical", message: "secret leak" }] } } }],
            diff: { kind: "none" }
          }
        };
      }
      throw new Error(`unexpected: ${opts.forceRoleId}`);
    });
    const engine = makeEngine({ autoFixEnabled: true }, dispatch);
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    expect(architectCallCount).toBe(2);
  });

  it("flag-ON + budget exhausted: emits auto_fix.budget_exhausted event", async () => {
    const sink = { emit: vi.fn() };
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } };
      if (opts.forceRoleId === "developer") return {
        roleId: "developer",
        output: { events: [{ eventType: "developer.completed", payload: { diff: "x" } }], diff: { kind: "patch", body: "x" } }
      };
      if (opts.forceRoleId === "security") return {
        roleId: "security",
        output: {
          events: [{ eventType: "security.completed", payload: { passed: false, report: { passed: false, issues: [{ severity: "critical", message: "x" }] } } }],
          diff: { kind: "none" }
        }
      };
      throw new Error(`unexpected`);
    });
    const engine = makeEngine({ autoFixEnabled: true }, dispatch, sink);
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const exhaustedCall = sink.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "auto_fix.budget_exhausted");
    expect(exhaustedCall).toBeDefined();
  });

  it("flag-ON: emits auto_fix.attempted event with attemptNumber=1 on first auto-fix", async () => {
    const sink = { emit: vi.fn() };
    let architectCallCount = 0;
    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) { architectCallCount++; return { roleId: "architect", output: { events: [ARTIFACT_EVENT], diff: { kind: "none" } } }; }
      if (opts.forceRoleId === "developer") return {
        roleId: "developer",
        output: { events: [{ eventType: "developer.completed", payload: { diff: "x" } }], diff: { kind: "patch", body: "x" } }
      };
      if (opts.forceRoleId === "security") {
        const passed = architectCallCount === 2;
        return {
          roleId: "security",
          output: { events: [{ eventType: "security.completed", payload: { passed, report: { passed, issues: passed ? [] : [{ severity: "critical", message: "x" }] } } }], diff: { kind: "none" } }
        };
      }
      throw new Error(`unexpected`);
    });
    const engine = makeEngine({ autoFixEnabled: true }, dispatch, sink);
    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });
    const attemptedCall = sink.emit.mock.calls.find((c) => (c[0] as { type: string }).type === "auto_fix.attempted");
    expect(attemptedCall).toBeDefined();
    const payload = (attemptedCall![0] as { payload: { attemptNumber: number; gate: string } }).payload;
    expect(payload.attemptNumber).toBe(1);
    expect(payload.gate).toBe("L4-security");
  });
});
