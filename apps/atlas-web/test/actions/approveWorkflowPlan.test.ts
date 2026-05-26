import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("approveWorkflowPlan action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await expect(
      approveWorkflowPlan({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await expect(
      approveWorkflowPlan({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls engine.approvePlan with workflowRunId and no edits", async () => {
    const approvePlan = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ approvePlan })
    }));
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await approveWorkflowPlan({ projectId: "p-1", workflowRunId: "wfr-1" });
    expect(approvePlan).toHaveBeenCalledOnce();
    expect(approvePlan).toHaveBeenCalledWith("wfr-1", undefined);
  });

  it("forwards edits array to engine.approvePlan", async () => {
    const approvePlan = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ approvePlan })
    }));
    const edits = [{ nodeId: "n-1", patch: { label: "updated" } }] as any;
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await approveWorkflowPlan({ projectId: "p-1", workflowRunId: "wfr-1", edits });
    expect(approvePlan).toHaveBeenCalledWith("wfr-1", edits);
  });
});
