import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("startWorkflow action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { startWorkflow } = await import("@/lib/actions/startWorkflow");
    await expect(
      startWorkflow({ projectId: "p-1", prompt: "build auth" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { startWorkflow } = await import("@/lib/actions/startWorkflow");
    await expect(
      startWorkflow({ projectId: "p-1", prompt: "build auth" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls engine.start with the right args and returns workflowRunId", async () => {
    const start = vi.fn(async () => "wfr-1");
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ start })
    }));
    const { startWorkflow } = await import("@/lib/actions/startWorkflow");
    const result = await startWorkflow({ projectId: "p-1", prompt: "build auth" });
    expect(result).toEqual({ workflowRunId: "wfr-1" });
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p-1",
      userId: "u-1",
      prompt: "build auth"
    }));
  });

  it("forwards suggestedKinds[0] as artifactKindHint when provided", async () => {
    const start = vi.fn(async () => "wfr-2");
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ start })
    }));
    const { startWorkflow } = await import("@/lib/actions/startWorkflow");
    await startWorkflow({ projectId: "p-1", prompt: "build auth", suggestedKinds: ["backend-rest-api"] });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      artifactKindHint: "backend-rest-api"
    }));
  });

  it("forwards concurrencyCap when provided", async () => {
    const start = vi.fn(async () => "wfr-3");
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ start })
    }));
    const { startWorkflow } = await import("@/lib/actions/startWorkflow");
    await startWorkflow({ projectId: "p-1", prompt: "build auth", concurrencyCap: 3 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      concurrencyCap: 3
    }));
  });
});
