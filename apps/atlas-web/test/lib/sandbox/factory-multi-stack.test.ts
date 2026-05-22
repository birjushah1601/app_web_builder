import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => { originalEnv = { ...process.env }; vi.resetModules(); });
afterEach(() => { process.env = originalEnv; });

describe("sandbox factory + template-router integration", () => {
  it("flag-OFF: ignores artifactKind, returns env default", async () => {
    delete process.env.ATLAS_FF_MULTI_STACK;
    process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE = "atlas-next-ts-v2";
    const { resolveTemplateForRitual } = await import("@/lib/sandbox/factory");
    const t = resolveTemplateForRitual({ artifactKind: "backend-rest-api" });
    expect(t).toBe("atlas-next-ts-v2");
  });

  it("flag-ON + artifactKind=backend-rest-api → atlas-fastapi", async () => {
    process.env.ATLAS_FF_MULTI_STACK = "true";
    delete process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE;
    const { resolveTemplateForRitual } = await import("@/lib/sandbox/factory");
    const t = resolveTemplateForRitual({ artifactKind: "backend-rest-api" });
    expect(t).toBe("atlas-fastapi");
  });

  it("flag-ON: per-project ATLAS_DEFAULT_SANDBOX_TEMPLATE wins over routing", async () => {
    process.env.ATLAS_FF_MULTI_STACK = "true";
    process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE = "atlas-some-pinned-template";
    const { resolveTemplateForRitual } = await import("@/lib/sandbox/factory");
    const t = resolveTemplateForRitual({ artifactKind: "backend-rest-api" });
    expect(t).toBe("atlas-some-pinned-template");
  });

  it("DeveloperRole accepts the resolved targetTemplate for the right SANDBOX_CONTEXT_PROMPT", async () => {
    // Plan T.1 task 12 — smoke test that the resolved template name flows
    // into DeveloperRoleOptions.targetTemplate without crashing the role
    // constructor, and that the role exposes the right per-template prompt
    // via getSandboxContextPromptFor (the same lookup the passes use).
    process.env.ATLAS_FF_MULTI_STACK = "true";
    delete process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE;
    const { resolveTemplateForRitual } = await import("@/lib/sandbox/factory");
    const { DeveloperRole, getSandboxContextPromptFor } = await import("@atlas/role-developer");
    const targetTemplate = resolveTemplateForRitual({ artifactKind: "backend-rest-api" });
    expect(targetTemplate).toBe("atlas-fastapi");
    const stubLlm = {
      complete: async () => ({ content: "" }),
      completeWithToolUse: async () => ({ toolName: "x", input: {} })
    } as unknown as ConstructorParameters<typeof DeveloperRole>[0]["anthropic"];
    const stubSkills = { get: () => undefined } as unknown as ConstructorParameters<typeof DeveloperRole>[0]["skills"];
    const role = new DeveloperRole({
      anthropic: stubLlm,
      google: stubLlm,
      reviewer: stubLlm,
      skills: stubSkills,
      targetTemplate
    });
    expect(role.id).toBe("developer");
    // The per-template fragment for atlas-fastapi includes "FastAPI" and
    // not "Next.js" — proves the registry lookup picked the right entry.
    const prompt = getSandboxContextPromptFor(targetTemplate);
    expect(prompt).toContain("FastAPI");
    expect(prompt).not.toContain("Next.js");
  });
});
