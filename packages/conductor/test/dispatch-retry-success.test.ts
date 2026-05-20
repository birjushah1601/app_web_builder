import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";

describe("Conductor.dispatch (retry success)", () => {
  it("recovers when first attempt throws transient error", async () => {
    let attempts = 0;
    const failingThenSucceeds = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient boom");
      return { events: [{ eventType: "developer.ran", payload: {} }], diff: { kind: "none" as const } };
    };
    const role = new TestRole({ roleId: "developer", onRun: failingThenSucceeds });
    const events: unknown[] = [];

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { events.push(e); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {} // instant retry for test speed
    });

    const result = await conductor.dispatch({
      ritualId: "r-3" as never,
      graphVersion: 0,
      userTurn: "ok",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.attempts).toBe(2);
    expect(attempts).toBe(2);
    // First attempt should have logged role.failed; completion should have logged dispatch.completed
    const types = (events as Array<{ eventType: string }>).map((e) => e.eventType);
    expect(types).toContain("role.failed");
    expect(types).toContain("dispatch.completed");
  });
});
