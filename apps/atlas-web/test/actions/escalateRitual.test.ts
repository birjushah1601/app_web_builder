import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("escalateRitual", () => {
  it("calls engine.escalate with reason + userId", async () => {
    const escalate = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory", () => ({ getRitualEngine: async () => ({ escalate }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { escalateRitual } = await import("@/lib/actions/escalateRitual");
    await escalateRitual({ projectId: "p-1", ritualId: "r-1", reason: "needs Priya review" });
    expect(escalate).toHaveBeenCalledWith("r-1", "needs Priya review", "u-1");
  });
});
