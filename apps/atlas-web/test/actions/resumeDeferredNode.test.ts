import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("resumeDeferredNode action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { resumeDeferredNode } = await import("@/lib/actions/resumeDeferredNode");
    await expect(
      resumeDeferredNode({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    const { resumeDeferredNode } = await import("@/lib/actions/resumeDeferredNode");
    await expect(
      resumeDeferredNode({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls setNodePolicy with runMode=active", async () => {
    const setNodePolicyFn = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ setNodePolicy: setNodePolicyFn })
    }));
    const { resumeDeferredNode } = await import("@/lib/actions/resumeDeferredNode");
    await resumeDeferredNode({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-1" });
    expect(setNodePolicyFn).toHaveBeenCalledOnce();
    expect(setNodePolicyFn).toHaveBeenCalledWith("wfr-1", "n-1", { runMode: "active" });
  });
});
