import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("retryAllFailedNodes action", () => {
  it("throws when ATLAS_FF_WORKFLOW is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({
      auth: async () => ({ userId: "u-1" })
    }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { retryAllFailedNodes } = await import(
      "@/lib/actions/retryAllFailedNodes"
    );
    await expect(
      retryAllFailedNodes({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({
      auth: async () => ({ userId: null })
    }));
    vi.doMock("@/lib/engine/factory", () => ({ getWorkflowEngine: vi.fn() }));
    const { retryAllFailedNodes } = await import(
      "@/lib/actions/retryAllFailedNodes"
    );
    await expect(
      retryAllFailedNodes({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls retryNode for each failed node in the snapshot", async () => {
    const retryNode = vi.fn(async () => {});
    const getRun = vi.fn(async () => ({
      id: "wfr-1",
      projectId: "p-1",
      userId: "u-1",
      prompt: "p",
      status: "escalated",
      nodes: [
        {
          id: "n1",
          artifactKind: "x",
          summary: "s",
          dependsOn: [],
          consumes: [],
          policy: { priority: 0, runMode: "active" },
          status: "failed"
        },
        {
          id: "n2",
          artifactKind: "x",
          summary: "s",
          dependsOn: [],
          consumes: [],
          policy: { priority: 0, runMode: "active" },
          status: "done"
        },
        {
          id: "n3",
          artifactKind: "x",
          summary: "s",
          dependsOn: [],
          consumes: [],
          policy: { priority: 0, runMode: "active" },
          status: "failed"
        }
      ],
      edges: [],
      dependencyProfile: { schemaVersion: "1" },
      createdAt: "",
      updatedAt: ""
    }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({
      auth: async () => ({ userId: "u-1" })
    }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ getRun, retryNode })
    }));
    const { retryAllFailedNodes } = await import(
      "@/lib/actions/retryAllFailedNodes"
    );
    const r = await retryAllFailedNodes({
      projectId: "p-1",
      workflowRunId: "wfr-1"
    });
    expect(r.retriedCount).toBe(2);
    expect(r.errors).toEqual([]);
    expect(retryNode).toHaveBeenCalledTimes(2);
    expect(retryNode).toHaveBeenCalledWith("wfr-1", "n1");
    expect(retryNode).toHaveBeenCalledWith("wfr-1", "n3");
  });

  it("aggregates per-node retry errors; continues across failures", async () => {
    const retryNode = vi.fn(async (_w: string, nid: string) => {
      if (nid === "n1") throw new Error("transient");
    });
    const getRun = vi.fn(async () => ({
      id: "wfr-1",
      projectId: "p-1",
      userId: "u-1",
      prompt: "p",
      status: "escalated",
      nodes: [
        {
          id: "n1",
          artifactKind: "x",
          summary: "s",
          dependsOn: [],
          consumes: [],
          policy: { priority: 0, runMode: "active" },
          status: "failed"
        },
        {
          id: "n2",
          artifactKind: "x",
          summary: "s",
          dependsOn: [],
          consumes: [],
          policy: { priority: 0, runMode: "active" },
          status: "failed"
        }
      ],
      edges: [],
      dependencyProfile: { schemaVersion: "1" },
      createdAt: "",
      updatedAt: ""
    }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({
      auth: async () => ({ userId: "u-1" })
    }));
    vi.doMock("@/lib/engine/factory", () => ({
      getWorkflowEngine: async () => ({ getRun, retryNode })
    }));
    const { retryAllFailedNodes } = await import(
      "@/lib/actions/retryAllFailedNodes"
    );
    const r = await retryAllFailedNodes({
      projectId: "p-1",
      workflowRunId: "wfr-1"
    });
    expect(r.retriedCount).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ nodeId: "n1" });
    expect(r.errors[0]?.error).toMatch(/transient/);
  });
});
