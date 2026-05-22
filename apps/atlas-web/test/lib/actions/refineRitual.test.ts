import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const refineMock = vi.fn();
const getRitualMock = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: vi.fn(async () => ({ userId: "u-1" }))
}));
vi.mock("@/lib/engine/factory", () => ({
  getRitualEngine: vi.fn(async () => ({ refine: refineMock, getRitual: getRitualMock }))
}));

describe("refineRitual Server Action — Plan K Task 5", () => {
  beforeEach(() => {
    refineMock.mockReset();
    getRitualMock.mockReset();
  });
  afterEach(() => { delete process.env.ATLAS_FF_MULTI_TURN; });

  it("flag-OFF: throws a clear error", async () => {
    const { refineRitual } = await import("@/lib/actions/refineRitual");
    await expect(
      refineRitual({ projectId: "p", parentRitualId: "r-parent", userTurn: "x" })
    ).rejects.toThrow(/multi-turn refinement is disabled/i);
  });

  it("flag-ON: calls engine.refine + returns the child snapshot", async () => {
    process.env.ATLAS_FF_MULTI_TURN = "true";
    refineMock.mockResolvedValue("r-child");
    getRitualMock.mockResolvedValue({
      projectId: "p", userId: "u-1", state: "done", roleEvents: [],
      parentRitualId: "r-parent",
      developerOutput: { diff: "x" }
    });
    const { refineRitual } = await import("@/lib/actions/refineRitual");
    const result = await refineRitual({ projectId: "p", parentRitualId: "r-parent", userTurn: "rename foo" });
    expect(refineMock).toHaveBeenCalledWith(expect.objectContaining({
      parentRitualId: "r-parent",
      projectId: "p",
      userTurn: "rename foo"
    }));
    expect(result.ritualId).toBe("r-child");
    expect(result.parentRitualId).toBe("r-parent");
  });

  it("propagates engine.refine errors (parent not found, etc.)", async () => {
    process.env.ATLAS_FF_MULTI_TURN = "true";
    refineMock.mockRejectedValue(new Error("parent ritual r-? not found"));
    const { refineRitual } = await import("@/lib/actions/refineRitual");
    await expect(
      refineRitual({ projectId: "p", parentRitualId: "r-?", userTurn: "x" })
    ).rejects.toThrow(/not found/);
  });
});
