import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("classifyAndCreateProject action", () => {
  it("throws unauthorized when no user is signed in", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));
    const { classifyAndCreateProject } = await import("@/lib/actions/classifyAndCreateProject");
    const fd = new FormData();
    fd.set("prompt", "Build me a thing");
    await expect(classifyAndCreateProject(fd)).rejects.toThrow(/unauthorized/i);
  });

  it("throws when prompt is empty", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { classifyAndCreateProject } = await import("@/lib/actions/classifyAndCreateProject");
    const fd = new FormData();
    fd.set("prompt", "   ");
    await expect(classifyAndCreateProject(fd)).rejects.toThrow(/prompt/i);
  });

  it("creates project + returns classifier verdict, does NOT start a ritual", async () => {
    const createProject = vi.fn(async () => ({ projectId: "proj-42", name: "test" }));
    const classifyEntry = vi.fn(async () => ({
      mode: "workflow" as const,
      suggestedKinds: ["backend-rest-api", "frontend-app"],
      reasoning: "API + UI requested"
    }));
    const llmProvider = { complete: vi.fn() };
    const startRitual = vi.fn();
    const startWorkflow = vi.fn();

    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("pg", () => ({ Pool: class { end() {} } }));
    vi.doMock("@atlas/spec-graph-data", () => ({
      ProjectsRepo: class { async create() { return createProject(); } }
    }));
    vi.doMock("@/lib/llm/classify-entry", () => ({ classifyEntry }));
    vi.doMock("@/lib/llm/factory", () => ({ getLlmProvider: async () => llmProvider }));
    vi.doMock("@/lib/sandbox/factory", () => ({
      getSandboxFactory: () => ({ getOrProvision: async () => ({ previewUrl: "x" }) })
    }));
    vi.doMock("@/lib/projects/derive-name", () => ({ deriveName: (p: string) => `name-${p.slice(0, 5)}` }));
    vi.doMock("@/lib/actions/startRitual", () => ({ startRitual }));
    vi.doMock("@/lib/actions/startWorkflow", () => ({ startWorkflow }));

    const { classifyAndCreateProject } = await import("@/lib/actions/classifyAndCreateProject");
    const fd = new FormData();
    fd.set("prompt", "Build an API + a UI");

    const result = await classifyAndCreateProject(fd);

    expect(result).toEqual({
      projectId: "proj-42",
      mode: "workflow",
      suggestedKinds: ["backend-rest-api", "frontend-app"],
      reasoning: "API + UI requested"
    });
    expect(startRitual).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(classifyEntry).toHaveBeenCalledOnce();
  });

  it("falls back to mode='ritual' when classifier throws", async () => {
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));
    vi.doMock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
    vi.doMock("pg", () => ({ Pool: class { end() {} } }));
    vi.doMock("@atlas/spec-graph-data", () => ({
      ProjectsRepo: class { async create() { return { projectId: "p1", name: "n" }; } }
    }));
    vi.doMock("@/lib/llm/classify-entry", () => ({
      classifyEntry: async () => { throw new Error("LLM down"); }
    }));
    vi.doMock("@/lib/llm/factory", () => ({ getLlmProvider: async () => ({ complete: vi.fn() }) }));
    vi.doMock("@/lib/sandbox/factory", () => ({
      getSandboxFactory: () => ({ getOrProvision: async () => ({}) })
    }));
    vi.doMock("@/lib/projects/derive-name", () => ({ deriveName: () => "n" }));

    const { classifyAndCreateProject } = await import("@/lib/actions/classifyAndCreateProject");
    const fd = new FormData();
    fd.set("prompt", "x");
    const result = await classifyAndCreateProject(fd);
    expect(result.mode).toBe("ritual");
    expect(result.suggestedKinds).toEqual([]);
    expect(result.projectId).toBe("p1");
  });
});
