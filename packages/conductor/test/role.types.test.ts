import { describe, it, expect, expectTypeOf } from "vitest";
import { TestRole, type Role, type RoleInvocation, type RoleOutput } from "../src/role.js";
import { type DispatchContext, type RitualId, DispatchContextSchema } from "../src/dispatch-context.js";
import { DEFAULT_DISPATCH_RETRY, STRICT_DISPATCH_RETRY, NO_DISPATCH_RETRY } from "../src/retry-policy.js";
import { RitualEscalatedError } from "../src/errors.js";

describe("Role + DispatchContext types", () => {
  it("Role interface is shaped correctly", () => {
    expectTypeOf<Role["run"]>().returns.toMatchTypeOf<Promise<RoleOutput>>();
  });

  it("TestRole is constructable and returns stubbed output", async () => {
    const role = new TestRole({ roleId: "developer" });
    const out = await role.run({
      ritualId: "r-1",
      intent: "add checkout",
      graphSlice: { bytes: "{}", hash: "sha256:x" },
      userTurn: "please do"
    });
    expect(out.events.length).toBeGreaterThan(0);
  });

  it("DispatchContextSchema validates happy input", () => {
    const ctx: DispatchContext = {
      ritualId: "r-1" as RitualId,
      graphVersion: 1,
      userTurn: "hi",
      projectId: "11111111-1111-4111-8111-111111111111"
    };
    expect(DispatchContextSchema.parse(ctx)).toEqual(ctx);
  });

  it("canonical retry policies expose expected shapes", () => {
    expect(DEFAULT_DISPATCH_RETRY.maxAttempts).toBe(3);
    expect(NO_DISPATCH_RETRY.maxAttempts).toBe(1);
    expect(STRICT_DISPATCH_RETRY.maxAttempts).toBeGreaterThan(3);
  });

  it("RitualEscalatedError carries the failed ritual id", () => {
    const err = new RitualEscalatedError("r-1" as RitualId, "3 consecutive failures");
    expect(err.name).toBe("RitualEscalatedError");
    expect(err.ritualId).toBe("r-1");
  });

  it("RitualEscalatedError surfaces lastError.message inline so callers that only forward .message still see the cause", () => {
    // This is the regression for the user-reported "ritual ... failed 3 times"
    // alert that hid "fetch failed" from the architect→proxy call. Server
    // Actions and ChatPanel only forward .message; the inner cause must
    // ride along inside the message text itself.
    const cause = new Error("triage LLM call failed: fetch failed");
    const err = new RitualEscalatedError("r-1" as RitualId, "role architect failed 3 times", cause);
    expect(err.message).toBe(
      "ritual r-1 escalated: role architect failed 3 times: triage LLM call failed: fetch failed"
    );
    expect(err.lastError).toBe(cause);
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("RitualEscalatedError without lastError keeps the legacy short message (back-compat)", () => {
    const err = new RitualEscalatedError("r-1" as RitualId, "3 consecutive failures");
    expect(err.message).toBe("ritual r-1 escalated: 3 consecutive failures");
    expect(err.lastError).toBeUndefined();
  });
});
