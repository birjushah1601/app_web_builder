import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

const makeRepo = (rows: unknown[]) => ({
  listForRun: vi.fn(async () => rows),
  listForNode: vi.fn(async () => rows)
});

describe("getWorkflowEventLog action", () => {
  it("throws when ATLAS_FF_WORKFLOW feature flag is off", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { getWorkflowEventLog } = await import("@/lib/actions/getWorkflowEventLog");
    await expect(
      getWorkflowEventLog({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/not yet enabled/i);
  });

  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    const { getWorkflowEventLog } = await import("@/lib/actions/getWorkflowEventLog");
    await expect(
      getWorkflowEventLog({ projectId: "p-1", workflowRunId: "wfr-1" })
    ).rejects.toThrow(/unauthorized/i);
  });

  it("calls repo.listForRun and maps rows to serializable entries", async () => {
    const row = {
      id: "cp-1",
      workflowRunId: "wfr-1",
      nodeId: "n-1",
      kind: "node.completed",
      payload: { result: "ok" },
      ritualEventId: "re-1",
      createdAt: new Date("2025-01-01T00:00:00Z")
    };
    const repo = makeRepo([row]);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("pg", () => ({ Pool: vi.fn(() => ({})) }));
    vi.doMock("@atlas/spec-graph-data", () => ({
      WorkflowCheckpointRepo: vi.fn(() => repo)
    }));
    const { getWorkflowEventLog } = await import("@/lib/actions/getWorkflowEventLog");
    const result = await getWorkflowEventLog({ projectId: "p-1", workflowRunId: "wfr-1" });
    expect(repo.listForRun).toHaveBeenCalledOnce();
    expect(repo.listForRun).toHaveBeenCalledWith("wfr-1");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "cp-1",
      workflowRunId: "wfr-1",
      nodeId: "n-1",
      kind: "node.completed",
      payload: { result: "ok" },
      ritualEventId: "re-1",
      createdAt: "2025-01-01T00:00:00.000Z"
    });
  });

  it("calls repo.listForNode when nodeId is provided", async () => {
    const repo = makeRepo([]);
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("pg", () => ({ Pool: vi.fn(() => ({})) }));
    vi.doMock("@atlas/spec-graph-data", () => ({
      WorkflowCheckpointRepo: vi.fn(() => repo)
    }));
    const { getWorkflowEventLog } = await import("@/lib/actions/getWorkflowEventLog");
    await getWorkflowEventLog({ projectId: "p-1", workflowRunId: "wfr-1", nodeId: "n-2" });
    expect(repo.listForNode).toHaveBeenCalledOnce();
    expect(repo.listForNode).toHaveBeenCalledWith("wfr-1", "n-2");
    expect(repo.listForRun).not.toHaveBeenCalled();
  });
});
