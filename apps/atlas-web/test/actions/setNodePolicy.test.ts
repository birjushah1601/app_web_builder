import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("setNodePolicy action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { setNodePolicy } = await import("@/lib/actions/setNodePolicy");
    await expect(
      setNodePolicy({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1", policy: {} })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { setNodePolicy } = await import("@/lib/actions/setNodePolicy");
    await expect(
      setNodePolicy({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1", policy: {} })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls engine.setNodePolicy with the right args", async () => {
    const setNodePolicyFn = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ setNodePolicy: setNodePolicyFn })
    }));
    const policy = { runMode: "deferred" as const };
    const { setNodePolicy } = await import("@/lib/actions/setNodePolicy");
    await setNodePolicy({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1", policy });
    expect(setNodePolicyFn).toHaveBeenCalledOnce();
    expect(setNodePolicyFn).toHaveBeenCalledWith("wfr-1", "n-1", policy);
  });
});
