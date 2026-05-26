import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import type { DispatchContext } from "../src/dispatch-context.js";

describe("Conductor.registerRole (F6)", () => {
  const makeCtx = (turn = "do something"): DispatchContext => ({
    ritualId: "r-reg-1" as never,
    graphVersion: 0,
    userTurn: turn,
    projectId: "00000000-0000-0000-0000-000000000001"
  });

  it("registers a role that was not present at construction time, then dispatches to it", async () => {
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "late-role", confidence: 0.95 }) },
      roles: new Map(), // empty at construction
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    const lateRole = new TestRole({ roleId: "late-role" });
    conductor.registerRole("late-role", lateRole);

    const result = await conductor.dispatch(makeCtx());
    expect(result.roleId).toBe("late-role");
    expect(result.output.events.length).toBeGreaterThan(0);
  });

  it("last-write-wins: re-registering the same id replaces the role", async () => {
    const firstRole = new TestRole({ roleId: "switchable" });
    const secondRole = new TestRole({ roleId: "switchable" });
    const runSpy = vi.spyOn(secondRole, "run");

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "switchable", confidence: 1 }) },
      roles: new Map([["switchable", firstRole]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    conductor.registerRole("switchable", secondRole);
    await conductor.dispatch(makeCtx());

    expect(runSpy).toHaveBeenCalledOnce();
  });

  it("hasRole returns true after registerRole", () => {
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "x", confidence: 1 }) },
      roles: new Map(),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" })
    });

    expect(conductor.hasRole("new-role")).toBe(false);
    conductor.registerRole("new-role", new TestRole({ roleId: "new-role" }));
    expect(conductor.hasRole("new-role")).toBe(true);
  });
});
