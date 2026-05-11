import { describe, it, expect } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import { NO_DISPATCH_RETRY, STRICT_DISPATCH_RETRY } from "../src/retry-policy.js";

describe("Conductor.dispatch (retry policy injection)", () => {
  it("NO_DISPATCH_RETRY fails on the first error without retrying", async () => {
    let attempts = 0;
    const role = new TestRole({
      roleId: "developer",
      onRun: async () => { attempts += 1; throw new Error("one-shot fail"); }
    });
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {}
    });
    await expect(conductor.dispatch(
      { ritualId: "r-5" as never, graphVersion: 0, userTurn: "x", projectId: "11111111-1111-4111-8111-111111111111" },
      { retry: NO_DISPATCH_RETRY }
    )).rejects.toThrow(/escalated/i);
    expect(attempts).toBe(1);
  });

  it("STRICT_DISPATCH_RETRY gives more than 3 attempts", async () => {
    let attempts = 0;
    const role = new TestRole({
      roleId: "developer",
      onRun: async () => {
        attempts += 1;
        if (attempts < 4) throw new Error("still going");
        return { events: [{ eventType: "developer.ran", payload: {} }], diff: { kind: "none" as const } };
      }
    });
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {}
    });
    const result = await conductor.dispatch(
      { ritualId: "r-6" as never, graphVersion: 0, userTurn: "x", projectId: "11111111-1111-4111-8111-111111111111" },
      { retry: STRICT_DISPATCH_RETRY }
    );
    expect(result.attempts).toBe(4);
  });
});
