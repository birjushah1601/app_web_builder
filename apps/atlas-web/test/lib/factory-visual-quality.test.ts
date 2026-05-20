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

// Heavy module mocks for the engine smoke test. Top-level vi.mock so Vite's
// import-analysis sees the stubs before resolving the real packages (some of
// which lack a built `dist/` in CI vitest, or have zod-circular import
// issues that crash at module load — see the canvas-runtime alias note in
// vitest.config.ts).
vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({})),
  SpecEventRepo: vi.fn().mockImplementation(() => ({}))
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn(async () => ({})) }));
vi.mock("@atlas/role-architect", () => ({
  ArchitectRole: vi.fn().mockImplementation(() => ({ id: "architect" })),
  ARCHITECT_TRIAGE_MODEL: "claude-haiku-4-5",
  ARCHITECT_DEEP_PLAN_MODEL: "claude-sonnet-4"
}));
vi.mock("@atlas/role-developer", () => ({
  DeveloperRole: vi.fn().mockImplementation(() => ({ id: "developer" }))
}));
vi.mock("@atlas/role-security", () => ({
  SecurityRole: vi.fn().mockImplementation(() => ({
    id: "security",
    run: async () => ({ events: [], diff: { kind: "none" } })
  }))
}));
vi.mock("@atlas/role-accessibility", () => ({
  AccessibilityRole: vi.fn().mockImplementation(() => ({
    id: "accessibility",
    run: async () => ({ events: [], diff: { kind: "none" } })
  }))
}));
vi.mock("@atlas/gate-visual-quality", () => ({
  // Capture constructor opts on the instance so the model-override test
  // can inspect what was passed in (mirrors the real role's `this.opts`).
  VisualQualityRole: vi.fn().mockImplementation((opts: unknown) => ({
    id: "visual-quality",
    opts,
    run: async () => ({ events: [], diff: { kind: "none" } })
  }))
}));
// SkillRegistry + loadSkillsFromDir: avoid disk I/O during the smoke test.
vi.mock("@atlas/skill-runtime", () => ({
  SkillRegistry: vi.fn().mockImplementation(() => ({})),
  loadSkillsFromDir: vi.fn().mockResolvedValue([])
}));
// Sandbox factory's getOrProvision is called when constructing the
// visual-quality role (lazy previewUrl resolution); stub to a benign null.
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: async () => null,
    evict: () => {}
  })
}));
// ritual-engine + conductor — both are imported at the top of factory.ts.
// Mock the bits the engine uses; postDeveloperChain is exposed as a public
// readable field on the instance.
vi.mock("@atlas/conductor", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@atlas/conductor");
  return { ...actual, Conductor: vi.fn().mockImplementation(() => ({})) };
});
vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: vi.fn().mockImplementation((opts: { postDeveloperChain?: string[] }) => ({
    postDeveloperChain: opts.postDeveloperChain ?? []
  }))
}));

describe("getRitualEngine — visual-quality flag wiring (Plan S.5)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ATLAS_LLM_BASE_URL = "http://localhost:3456";
  });

  it("with security + a11y + visual-quality flags ON, engine constructs and chain is ['security','accessibility','visual-quality']", async () => {
    process.env.ATLAS_FF_SECURITY_ROLE = "true";
    process.env.ATLAS_FF_A11Y_ROLE = "true";
    process.env.ATLAS_FF_VISUAL_QUALITY_GATE = "true";

    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p-smoke");
    expect(engine).toBeDefined();
    expect((engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain).toEqual([
      "security",
      "accessibility",
      "visual-quality"
    ]);

    delete process.env.ATLAS_FF_SECURITY_ROLE;
    delete process.env.ATLAS_FF_A11Y_ROLE;
    delete process.env.ATLAS_FF_VISUAL_QUALITY_GATE;
  });
});
