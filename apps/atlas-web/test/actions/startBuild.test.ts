import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  delete process.env.ATLAS_FF_WORKFLOW_KINDS;
});

const RITUAL_RESULT = {
  ritualId: "r-1",
  roleEvents: [],
  artifact: undefined,
  developerOutput: undefined,
  sandboxApplyResult: undefined,
  securityReport: undefined,
  accessibilityReport: undefined,
  fixAttempts: undefined
};

const WORKFLOW_RESULT = { workflowRunId: "wfr-1" };

describe("startBuild action", () => {
  it("flag off → calls startRitual and returns ritual result", async () => {
    const startRitual = vi.fn(async () => RITUAL_RESULT);
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow: vi.fn() }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry: vi.fn() }));
    vi.doMock("@/lib/llm/factory", () => ({ getLlmProvider: async () => null }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    const result = await startBuild({ projectId: "p-1", prompt: "Build a landing page" });

    expect(result).toEqual({ kind: "ritual", ritualId: "r-1" });
    expect(startRitual).toHaveBeenCalledOnce();
    expect(startRitual).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-1",
        userTurn: "Build a landing page",
        editClass: "structural"
      })
    );
  });

  it("flag on + classifier returns single-ritual → falls through to startRitual", async () => {
    const startRitual = vi.fn(async () => RITUAL_RESULT);
    const classifyEntry = vi.fn(async () => ({
      mode: "single-ritual" as const,
      reasoning: "it is a landing page"
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow: vi.fn() }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry }));
    vi.doMock("@/lib/llm/factory", () => ({
      getLlmProvider: async () => ({ completeWithToolUse: vi.fn() })
    }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    const result = await startBuild({ projectId: "p-1", prompt: "Build a landing page" });

    expect(result).toEqual({ kind: "ritual", ritualId: "r-1" });
    expect(classifyEntry).toHaveBeenCalledOnce();
    expect(startRitual).toHaveBeenCalledOnce();
  });

  it("flag on + classifier returns workflow with allowed kinds → calls startWorkflow", async () => {
    const startWorkflow = vi.fn(async () => WORKFLOW_RESULT);
    const classifyEntry = vi.fn(async () => ({
      mode: "workflow" as const,
      suggestedKinds: ["frontend-app", "backend-rest-api"],
      reasoning: "multi-tier SaaS"
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual: vi.fn() }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry }));
    vi.doMock("@/lib/llm/factory", () => ({
      getLlmProvider: async () => ({ completeWithToolUse: vi.fn() })
    }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    const result = await startBuild({ projectId: "p-1", prompt: "Build a SaaS" });

    expect(result).toEqual({
      kind: "workflow",
      workflowRunId: "wfr-1",
      suggestedKinds: ["frontend-app", "backend-rest-api"],
      reasoning: "multi-tier SaaS"
    });
    expect(startWorkflow).toHaveBeenCalledOnce();
    expect(startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-1",
        prompt: "Build a SaaS",
        suggestedKinds: ["frontend-app", "backend-rest-api"]
      })
    );
  });

  it("flag on + classifier throws → falls back to single-ritual (fail-safe)", async () => {
    const startRitual = vi.fn(async () => RITUAL_RESULT);
    const classifyEntry = vi.fn(async () => {
      throw new Error("LLM timeout");
    });
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow: vi.fn() }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry }));
    vi.doMock("@/lib/llm/factory", () => ({
      getLlmProvider: async () => ({ completeWithToolUse: vi.fn() })
    }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    const result = await startBuild({ projectId: "p-1", prompt: "Build a SaaS" });

    expect(result).toEqual({ kind: "ritual", ritualId: "r-1" });
    expect(startRitual).toHaveBeenCalledOnce();
  });

  it("flag on + ATLAS_FF_WORKFLOW_KINDS limits allow-list → filtered kinds", async () => {
    process.env.ATLAS_FF_WORKFLOW_KINDS = "frontend-app";
    const startWorkflow = vi.fn(async () => WORKFLOW_RESULT);
    const classifyEntry = vi.fn(async () => ({
      mode: "workflow" as const,
      suggestedKinds: ["frontend-app", "backend-rest-api"],
      reasoning: "multi-tier"
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual: vi.fn() }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry }));
    vi.doMock("@/lib/llm/factory", () => ({
      getLlmProvider: async () => ({ completeWithToolUse: vi.fn() })
    }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    const result = await startBuild({ projectId: "p-1", prompt: "Build a SaaS" });

    // backend-rest-api was filtered out; only frontend-app passes
    expect(result).toEqual({
      kind: "workflow",
      workflowRunId: "wfr-1",
      suggestedKinds: ["frontend-app"],
      reasoning: "multi-tier"
    });
    expect(startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedKinds: ["frontend-app"] })
    );
  });

  it("flag on + ATLAS_FF_WORKFLOW_KINDS filters all kinds → falls through to single-ritual", async () => {
    process.env.ATLAS_FF_WORKFLOW_KINDS = "deploy";
    const startRitual = vi.fn(async () => RITUAL_RESULT);
    const classifyEntry = vi.fn(async () => ({
      mode: "workflow" as const,
      suggestedKinds: ["frontend-app", "backend-rest-api"],
      reasoning: "multi-tier"
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => true }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow: vi.fn() }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry }));
    vi.doMock("@/lib/llm/factory", () => ({
      getLlmProvider: async () => ({ completeWithToolUse: vi.fn() })
    }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    const result = await startBuild({ projectId: "p-1", prompt: "Build a SaaS" });

    expect(result).toEqual({ kind: "ritual", ritualId: "r-1" });
    expect(startRitual).toHaveBeenCalledOnce();
  });

  it("throws unauthorized when no user signed in", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual: vi.fn() }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow: vi.fn() }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry: vi.fn() }));
    vi.doMock("@/lib/llm/factory", () => ({ getLlmProvider: async () => null }));

    const { startBuild } = await import("@/lib/actions/startBuild");
    await expect(
      startBuild({ projectId: "p-1", prompt: "Build something" })
    ).rejects.toThrow(/unauthorized/i);
  });
});
