import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import type { DispatchContext } from "../src/dispatch-context.js";

describe("Conductor.dispatch (happy path)", () => {
  it("classifies intent, runs the chosen role, emits events through a checkpoint sink", async () => {
    const classify = vi.fn(async (_userTurn: string) => ({ roleId: "developer", confidence: 0.9 }));
    const checkpoints: unknown[] = [];
    const role = new TestRole({ roleId: "developer" });
    const conductor = new Conductor({
      classifier: { classify },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (evt) => { checkpoints.push(evt); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    const ctx: DispatchContext = {
      ritualId: "r-1" as never,
      graphVersion: 0,
      userTurn: "add a checkout page",
      projectId: "11111111-1111-4111-8111-111111111111"
    };
    const out = await conductor.dispatch(ctx);

    expect(classify).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledWith("add a checkout page");
    expect(out.roleId).toBe("developer");
    expect(out.output.events.length).toBeGreaterThan(0);
    // At minimum: classifier result + role-emitted event + dispatch completion are checkpointed
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(checkpoints.some((c) => (c as { eventType: string }).eventType === "dispatch.completed")).toBe(true);
  });

  it("rejects when classifier returns an unknown role id", async () => {
    const classify = vi.fn(async () => ({ roleId: "ghost", confidence: 0.5 }));
    const conductor = new Conductor({
      classifier: { classify },
      roles: new Map(),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });
    await expect(conductor.dispatch({
      ritualId: "r-2" as never,
      graphVersion: 0,
      userTurn: "anything",
      projectId: "11111111-1111-4111-8111-111111111111"
    })).rejects.toThrow(/unknown role.*ghost/);
  });
});
