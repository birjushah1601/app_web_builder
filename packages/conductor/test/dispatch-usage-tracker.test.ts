import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole, type RoleInvocation } from "../src/role.js";
import type { DispatchContext } from "../src/dispatch-context.js";

describe("Conductor.dispatch — usageTracker pass-through (Plan G.4 Task 1)", () => {
  it("threads options.usageTracker into RoleInvocation so role.run can record per-role usage", async () => {
    const spy = {
      record: vi.fn<(provider: string, model: string, usage: { inputTokens: number; outputTokens: number }, opts?: { roleId?: string }) => void>()
    };

    let capturedInvocation: RoleInvocation | undefined;
    const role = new TestRole({
      roleId: "tester",
      onRun: async (inv) => {
        capturedInvocation = inv;
        // Simulate a role recording its LLM usage with its own roleId.
        inv.usageTracker?.record(
          "anthropic",
          "claude-haiku-4-5",
          { inputTokens: 100, outputTokens: 50 },
          { roleId: "tester" }
        );
        return {
          events: [{ eventType: "tester.ran", payload: {} }],
          diff: { kind: "none" as const }
        };
      }
    });

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "tester", confidence: 1 }) },
      roles: new Map([["tester", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    const ctx: DispatchContext = {
      ritualId: "r-tracker-1" as never,
      graphVersion: 0,
      userTurn: "anything",
      projectId: "11111111-1111-4111-8111-111111111111"
    };

    await conductor.dispatch(ctx, { usageTracker: spy });

    expect(capturedInvocation).toBeDefined();
    expect(capturedInvocation?.usageTracker).toBe(spy);
    expect(spy.record).toHaveBeenCalledOnce();
    expect(spy.record).toHaveBeenCalledWith(
      "anthropic",
      "claude-haiku-4-5",
      { inputTokens: 100, outputTokens: 50 },
      { roleId: "tester" }
    );
  });

  it("omits usageTracker on RoleInvocation when not provided in DispatchOptions", async () => {
    let capturedInvocation: RoleInvocation | undefined;
    const role = new TestRole({
      roleId: "tester",
      onRun: async (inv) => {
        capturedInvocation = inv;
        return {
          events: [{ eventType: "tester.ran", payload: {} }],
          diff: { kind: "none" as const }
        };
      }
    });

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "tester", confidence: 1 }) },
      roles: new Map([["tester", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    await conductor.dispatch({
      ritualId: "r-tracker-2" as never,
      graphVersion: 0,
      userTurn: "anything",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(capturedInvocation).toBeDefined();
    expect(capturedInvocation?.usageTracker).toBeUndefined();
  });
});
