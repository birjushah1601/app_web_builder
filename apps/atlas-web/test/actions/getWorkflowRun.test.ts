import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("getWorkflowRun action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { getWorkflowRun } = await import("@/lib/actions/getWorkflowRun");
    await expect(
      getWorkflowRun({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { getWorkflowRun } = await import("@/lib/actions/getWorkflowRun");
    await expect(
      getWorkflowRun({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls engine.getRun and returns the snapshot", async () => {
    const snapshot = { workflowRunId: "wfr-1", status: "running", nodes: [] };
    const getRun = vi.fn(async () => snapshot);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ getRun })
    }));
    const { getWorkflowRun } = await import("@/lib/actions/getWorkflowRun");
    const result = await getWorkflowRun({ projectId: "p-1", workflowRunId: "wfr-1" });
    expect(result).toEqual(snapshot);
    expect(getRun).toHaveBeenCalledOnce();
    expect(getRun).toHaveBeenCalledWith("wfr-1");
  });

  it("returns undefined when the run does not exist", async () => {
    const getRun = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ getRun })
    }));
    const { getWorkflowRun } = await import("@/lib/actions/getWorkflowRun");
    const result = await getWorkflowRun({ projectId: "p-1", workflowRunId: "wfr-missing" });
    expect(result).toBeUndefined();
  });
});
