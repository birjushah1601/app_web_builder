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

const stubExec = {
  runCommand: async () => ({ stdout: "", exitCode: 0 })
};

describe("factory visual-quality integration", () => {
  it("getVisualQualityRole returns null when ATLAS_FF_VISUAL_QUALITY_GATE is not set", async () => {
    delete process.env.ATLAS_FF_VISUAL_QUALITY_GATE;
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: stubExec, previewUrl: "http://localhost:3001" });
    expect(role).toBeNull();
  });

  it("getVisualQualityRole returns a VisualQualityRole when flag=true and LLM configured", async () => {
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: stubExec, previewUrl: "http://localhost:3001" });
    expect(role).not.toBeNull();
    expect(role!.id).toBe("visual-quality");
  });

  it("getVisualQualityRole forwards ATLAS_VQ_GATE_MODEL override to the role", async () => {
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_API_KEY = "sk-test";
    process.env.ATLAS_VQ_GATE_MODEL = "claude-opus-4-7";
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: stubExec, previewUrl: "http://localhost:3001" });
    expect(role).not.toBeNull();
    // The role stores opts internally; the override is observable as the
    // `opts.model` field on the constructed role.
    const opts = (role as unknown as { opts: { model?: string } }).opts;
    expect(opts.model).toBe("claude-opus-4-7");
  });

  it("getVisualQualityRole returns null when flag=true but no LLM provider configured", async () => {
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";
    delete process.env.ATLAS_LLM_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
    const { getVisualQualityRole } = await import("@/lib/llm/factory");
    const role = await getVisualQualityRole({ exec: stubExec, previewUrl: "http://localhost:3001" });
    expect(role).toBeNull();
  });
});
