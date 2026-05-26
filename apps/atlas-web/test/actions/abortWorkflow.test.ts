import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("abortWorkflow action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { abortWorkflow } = await import("@/lib/actions/abortWorkflow");
    await expect(
      abortWorkflow({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { abortWorkflow } = await import("@/lib/actions/abortWorkflow");
    await expect(
      abortWorkflow({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls engine.abort with default reason when none provided", async () => {
    const abort = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ abort })
    }));
    const { abortWorkflow } = await import("@/lib/actions/abortWorkflow");
    await abortWorkflow({ projectId: "p-1", workflowRunId: "wfr-1" });
    expect(abort).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledWith("wfr-1", "user requested abort");
  });

  it("forwards custom reason to engine.abort", async () => {
    const abort = vi.fn(async () => undefined);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ abort })
    }));
    const { abortWorkflow } = await import("@/lib/actions/abortWorkflow");
    await abortWorkflow({ projectId: "p-1", workflowRunId: "wfr-1", reason: "timeout exceeded" });
    expect(abort).toHaveBeenCalledWith("wfr-1", "timeout exceeded");
  });
});
