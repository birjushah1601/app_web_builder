import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("approveRitual action", () => {
  it("forwards approved decision to engine.approve", async () => {
    const approve = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ approve }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { approveRitual } = await import("@/lib/actions/approveRitual.js");
    await approveRitual({ projectId: "p-1", ritualId: "r-1", decision: { kind: "approved", persona: "diego" } });
    expect(approve).toHaveBeenCalledWith("r-1", expect.objectContaining({ kind: "approved", approvedBy: "u-1", persona: "diego" }));
  });

  it("forwards changes_requested with notes", async () => {
    const approve = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ approve }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { approveRitual } = await import("@/lib/actions/approveRitual.js");
    await approveRitual({ projectId: "p-1", ritualId: "r-1", decision: { kind: "changes_requested", notes: "fix a11y" } });
    expect(approve).toHaveBeenCalledWith("r-1", expect.objectContaining({ kind: "changes_requested", requestedBy: "u-1", notes: "fix a11y" }));
  });
});
