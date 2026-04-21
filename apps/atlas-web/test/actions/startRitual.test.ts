import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("startRitual action", () => {
  it("calls engine.start with the right inputs", async () => {
    const start = vi.fn(async () => "r-123");
    vi.doMock("@/lib/engine/factory.js", () => ({
      getRitualEngine: async () => ({ start })
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    const r = await startRitual({ projectId: "p-1", userTurn: "add forgot-password", editClass: "structural" });
    expect(r).toBe("r-123");
    expect(start).toHaveBeenCalledOnce();
    const arg = start.mock.calls[0][0];
    expect(arg).toMatchObject({ userTurn: "add forgot-password", editClass: "structural", projectId: "p-1", userId: "u-1" });
  });

  it("rejects unauthed callers", async () => {
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ start: vi.fn() }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    await expect(startRitual({ projectId: "p-1", userTurn: "x", editClass: "cosmetic" })).rejects.toThrow(/unauth/i);
  });
});
