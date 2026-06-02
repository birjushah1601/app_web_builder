import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";

/**
 * Plan G.4 Task 2 — RitualEngine must thread `input.usageTracker` into every
 * `conductor.dispatch(...)` call's options so RoleInvocation.usageTracker
 * reaches each role. Without this, the workflow-engine's per-run tracker
 * never sees a roleId and the cost breakdown collapses into `__unassigned__`.
 */
describe("RitualEngine — usageTracker pass-through to conductor.dispatch (Plan G.4 Task 2)", () => {
  it("forwards input.usageTracker into dispatch options on the roleChain path", async () => {
    const dispatchOptionsSeen: Array<Record<string, unknown> | undefined> = [];

    const dispatch = vi.fn(async (_req: unknown, opts?: Record<string, unknown>) => {
      dispatchOptionsSeen.push(opts);
      return {
        roleId: opts?.forceRoleId as string,
        output: {
          events: [{ eventType: "tester.ran", payload: {} }],
          diff: { kind: "none" as const }
        }
      };
    });

    const tracker = {
      record: vi.fn(),
      totalUsd: () => 0
    };

    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });

    await engine.start({
      projectId: "p",
      userId: "u",
      userTurn: "run tests",
      editClass: "structural",
      roleChain: ["tester"],
      usageTracker: tracker
    });

    expect(dispatchOptionsSeen).toHaveLength(1);
    expect(dispatchOptionsSeen[0]?.usageTracker).toBe(tracker);
  });

  it("forwards input.usageTracker into the architect dispatch (default flow)", async () => {
    const dispatchOptionsSeen: Array<Record<string, unknown> | undefined> = [];

    const dispatch = vi.fn(async (_req: unknown, opts?: Record<string, unknown>) => {
      dispatchOptionsSeen.push(opts);
      // No artifact emitted => engine stops after architect (no developer chain).
      return {
        roleId: "architect",
        output: {
          events: [],
          diff: { kind: "none" as const }
        }
      };
    });

    const tracker = {
      record: vi.fn(),
      totalUsd: () => 0
    };

    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });

    await engine.start({
      projectId: "p",
      userId: "u",
      userTurn: "build something",
      editClass: "structural",
      usageTracker: tracker
    });

    expect(dispatchOptionsSeen.length).toBeGreaterThanOrEqual(1);
    expect(dispatchOptionsSeen[0]?.usageTracker).toBe(tracker);
  });

  it("forwards input.usageTracker into the developer chain dispatch", async () => {
    const dispatchOptionsSeen: Array<Record<string, unknown> | undefined> = [];

    const VALID_DIFF = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+hi\n";

    const dispatch = vi.fn(async (_req: unknown, opts?: Record<string, unknown>) => {
      dispatchOptionsSeen.push(opts);
      if (!opts?.forceRoleId) {
        return {
          roleId: "architect",
          output: {
            events: [{ eventType: "architect.pass2.completed", payload: { artifact: { kind: "plan" } } }],
            diff: { kind: "none" as const }
          }
        };
      }
      if (opts.forceRoleId === "developer") {
        return {
          roleId: "developer",
          output: {
            events: [{ eventType: "developer.completed", payload: { diff: VALID_DIFF, summary: "x" } }],
            diff: { kind: "patch" as const, body: VALID_DIFF }
          }
        };
      }
      return {
        roleId: opts.forceRoleId as string,
        output: { events: [], diff: { kind: "none" as const } }
      };
    });

    const tracker = {
      record: vi.fn(),
      totalUsd: () => 0
    };

    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });

    await engine.start({
      projectId: "p",
      userId: "u",
      userTurn: "build app",
      editClass: "structural",
      usageTracker: tracker
    });

    // Every dispatch call should carry the tracker (architect + developer here).
    expect(dispatchOptionsSeen.length).toBeGreaterThanOrEqual(2);
    for (const opts of dispatchOptionsSeen) {
      expect(opts?.usageTracker).toBe(tracker);
    }
  });

  it("omits usageTracker key from dispatch options when StartInput.usageTracker is absent (back-compat)", async () => {
    const dispatchOptionsSeen: Array<Record<string, unknown> | undefined> = [];

    const dispatch = vi.fn(async (_req: unknown, opts?: Record<string, unknown>) => {
      dispatchOptionsSeen.push(opts);
      return {
        roleId: opts?.forceRoleId as string,
        output: {
          events: [{ eventType: "tester.ran", payload: {} }],
          diff: { kind: "none" as const }
        }
      };
    });

    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });

    await engine.start({
      projectId: "p",
      userId: "u",
      userTurn: "x",
      editClass: "structural",
      roleChain: ["tester"]
    });

    expect(dispatchOptionsSeen).toHaveLength(1);
    expect(dispatchOptionsSeen[0]?.usageTracker).toBeUndefined();
  });
});
