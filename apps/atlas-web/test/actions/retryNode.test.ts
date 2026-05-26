import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("retryNode action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { retryNode } = await import("@/lib/actions/retryNode");
    await expect(
      retryNode({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { retryNode } = await import("@/lib/actions/retryNode");
    await expect(
      retryNode({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls engine.retryNode with workflowRunId and nodeId", async () => {
    const retryNodeFn = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ retryNode: retryNodeFn })
    }));
    const { retryNode } = await import("@/lib/actions/retryNode");
    await retryNode({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1" });
    expect(retryNodeFn).toHaveBeenCalledOnce();
    expect(retryNodeFn).toHaveBeenCalledWith("wfr-1", "n-1");
  });
});
