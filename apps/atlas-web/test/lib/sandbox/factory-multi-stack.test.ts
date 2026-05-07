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
});
