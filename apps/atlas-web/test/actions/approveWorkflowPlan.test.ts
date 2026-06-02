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

  // Plan G.2 — approval-time cost cap edit.
  it("calls engine.setCostCap before approvePlan when costCapUsd is provided", async () => {
    const order: string[] = [];
    const setCostCap = vi.fn(async () => {
      order.push("setCostCap");
    });
    const approvePlan = vi.fn(async () => {
      order.push("approvePlan");
    });
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ approvePlan, setCostCap })
    }));
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await approveWorkflowPlan({
      projectId: "p-1",
      workflowRunId: "wfr-1",
      costCapUsd: 7.5
    });
    expect(setCostCap).toHaveBeenCalledWith("wfr-1", 7.5);
    expect(approvePlan).toHaveBeenCalledWith("wfr-1", undefined);
    expect(order).toEqual(["setCostCap", "approvePlan"]);
  });

  it("passes through undefined costCapUsd to clear the cap", async () => {
    const setCostCap = vi.fn(async () => undefined);
    const approvePlan = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ approvePlan, setCostCap })
    }));
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await approveWorkflowPlan({
      projectId: "p-1",
      workflowRunId: "wfr-1",
      costCapUsd: null
    });
    expect(setCostCap).toHaveBeenCalledWith("wfr-1", undefined);
  });

  it("does not call setCostCap when costCapUsd is omitted", async () => {
    const setCostCap = vi.fn(async () => undefined);
    const approvePlan = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ approvePlan, setCostCap })
    }));
    const { approveWorkflowPlan } = await import("@/lib/actions/approveWorkflowPlan");
    await approveWorkflowPlan({ projectId: "p-1", workflowRunId: "wfr-1" });
    expect(setCostCap).not.toHaveBeenCalled();
    expect(approvePlan).toHaveBeenCalledWith("wfr-1", undefined);
  });
});
