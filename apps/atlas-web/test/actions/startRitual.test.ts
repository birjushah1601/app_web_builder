import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("startRitual action", () => {
  it("returns ritualId + artifact + roleEvents from engine.getRitual snapshot", async () => {
    const start = vi.fn(async () => "r-123");
    const sampleEvents = [
      { eventType: "architect.pass1.completed", payload: { passed: true, scope: "feature" } },
      { eventType: "architect.pass2.completed", payload: { scope: "feature", artifact: { plan: "do x then y" } } }
    ];
    const getRitual = vi.fn(() => ({
      state: "agree",
      projectId: "p-1",
      userId: "u-1",
      artifact: { plan: "do x then y" },
      roleEvents: sampleEvents
    }));
    vi.doMock("@/lib/engine/factory.js", () => ({
      getRitualEngine: async () => ({ start, getRitual })
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");

    const r = await startRitual({ projectId: "p-1", userTurn: "add forgot-password", editClass: "structural" });

    expect(r.ritualId).toBe("r-123");
    expect(r.artifact).toEqual({ plan: "do x then y" });
    expect(r.roleEvents).toEqual(sampleEvents);
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      userTurn: "add forgot-password",
      editClass: "structural",
      projectId: "p-1",
      userId: "u-1"
    }));
    expect(getRitual).toHaveBeenCalledWith("r-123");
  });

  it("returns empty roleEvents when the engine has no snapshot for the ritualId", async () => {
    const start = vi.fn(async () => "r-456");
    const getRitual = vi.fn(() => undefined);
    vi.doMock("@/lib/engine/factory.js", () => ({
      getRitualEngine: async () => ({ start, getRitual })
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    const r = await startRitual({ projectId: "p-1", userTurn: "x", editClass: "cosmetic" });
    expect(r.ritualId).toBe("r-456");
    expect(r.artifact).toBeUndefined();
    expect(r.roleEvents).toEqual([]);
  });

  it("rejects unauthed callers", async () => {
    vi.doMock("@/lib/engine/factory.js", () => ({
      getRitualEngine: async () => ({ start: vi.fn(), getRitual: vi.fn() })
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    await expect(startRitual({ projectId: "p-1", userTurn: "x", editClass: "cosmetic" })).rejects.toThrow(/unauth/i);
  });
});
