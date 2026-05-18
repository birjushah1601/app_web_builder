import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// React's `cache` is a server-component primitive — not present in vitest's
// jsdom environment. Stub it as a pass-through so the factory's `cache(...)`
// wrapper just calls through to the underlying function.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: (...args: unknown[]) => unknown) => fn };
});

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("factory designer integration", () => {
  it("getDesignerRole returns null when ATLAS_FF_DESIGNER is not set", async () => {
    delete process.env.ATLAS_FF_DESIGNER;
    const { getDesignerRole } = await import("@/lib/llm/factory");
    const role = await getDesignerRole();
    expect(role).toBeNull();
  });

  it("getDesignerRole returns a DesignerRole when ATLAS_FF_DESIGNER=true and LLM configured", async () => {
    process.env.ATLAS_FF_DESIGNER = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getDesignerRole } = await import("@/lib/llm/factory");
    const role = await getDesignerRole();
    expect(role).not.toBeNull();
    expect(role!.id).toBe("designer");
  });

  it("getDesignerRole returns null when ATLAS_FF_DESIGNER=true but no LLM configured", async () => {
    process.env.ATLAS_FF_DESIGNER = "true";
    delete process.env.ATLAS_LLM_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    const { getDesignerRole } = await import("@/lib/llm/factory");
    const role = await getDesignerRole();
    expect(role).toBeNull();
  });

  it("getDesignerRole returns null when ATLAS_FF_DESIGNER is set to a falsy value", async () => {
    process.env.ATLAS_FF_DESIGNER = "false";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getDesignerRole } = await import("@/lib/llm/factory");
    const role = await getDesignerRole();
    expect(role).toBeNull();
  });
});
