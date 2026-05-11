import { describe, it, expect } from "vitest";
import { Conductor } from "../src/conductor.js";
import { TestRole } from "../src/role.js";
import { RitualEscalatedError } from "../src/errors.js";

describe("Conductor.dispatch (retry exhausted)", () => {
  it("throws RitualEscalatedError after 3 failed attempts and emits ritual.escalated", async () => {
    let attempts = 0;
    const alwaysFails = async () => {
      attempts += 1;
      throw new Error("persistent boom");
    };
    const role = new TestRole({ roleId: "developer", onRun: alwaysFails });
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 1 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { events.push(e as never); } },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:x" }),
      sleep: async () => {}
    });

    await expect(conductor.dispatch({
      ritualId: "r-4" as never,
      graphVersion: 0,
      userTurn: "fail",
      projectId: "11111111-1111-4111-8111-111111111111"
    })).rejects.toBeInstanceOf(RitualEscalatedError);

    expect(attempts).toBe(3);
    const failed = events.filter((e) => e.eventType === "role.failed");
    expect(failed).toHaveLength(3);
    const escalated = events.find((e) => e.eventType === "ritual.escalated");
    expect(escalated).toBeDefined();
    expect((escalated?.payload as { attempts: number }).attempts).toBe(3);
  });
});
