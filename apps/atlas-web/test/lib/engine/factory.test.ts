import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mocks so they're applied before any module imports factory.ts
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: (...args: unknown[]) => unknown) => fn };
});
vi.mock("pg", () => ({ Pool: class { query() {} } }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: class { async getOverride() { return null; } },
  SpecEventRepo: class { async append() {} },
  SpecGraphRepo: class {}
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => ({ userId: "test-user-id" }),
  currentUser: async () => ({ publicMetadata: { defaultPersona: "diego" } })
}));

// Track which role gets registered with which provider
const architectCtor = vi.fn();

vi.mock("@atlas/role-architect", () => ({
  ArchitectRole: class {
    constructor(opts: { llm: { name: string }; triageModel?: string; deepPlanModel?: string }) {
      architectCtor(opts);
    }
  },
  ARCHITECT_TRIAGE_MODEL: "claude-haiku-4-5-20251001",
  ARCHITECT_DEEP_PLAN_MODEL: "claude-opus-4-7"
}));

vi.mock("@atlas/skill-runtime", () => ({
  SkillRegistry: class { constructor(_skills: unknown[]) {} },
  loadSkillsFromDir: async () => []
}));

// The real Anthropic SDK refuses to instantiate under jsdom. Stub it out.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic { constructor(_opts: unknown) {} }
}));

vi.mock("@atlas/llm-provider", () => ({
  AnthropicProvider: class { readonly name = "anthropic"; constructor(_opts: unknown) {} },
  createProviderMetrics: () => ({})
}));

vi.mock("prom-client", () => ({ Registry: class {} }));

vi.mock("@atlas/conductor", () => ({
  Conductor: class {
    roles: Map<string, unknown>;
    constructor(opts: { roles: Map<string, unknown> }) { this.roles = opts.roles; }
  }
}));

vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: class {
    conductor: { roles: Map<string, unknown> };
    constructor(opts: { conductor: { roles: Map<string, unknown> } }) {
      this.conductor = opts.conductor;
    }
  }
}));

const ENV_KEYS = [
  "ATLAS_LLM_BASE_URL",
  "ATLAS_LLM_API_KEY",
  "ATLAS_LLM_TRIAGE_MODEL",
  "ATLAS_LLM_DEEP_MODEL",
  "ANTHROPIC_API_KEY"
] as const;

describe("getRitualEngine — provider precedence", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    architectCtor.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("prefers ATLAS_LLM_BASE_URL over ANTHROPIC_API_KEY", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-be-ignored";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("architect")).toBe(true);
    expect(architectCtor).toHaveBeenCalledOnce();
    const opts = architectCtor.mock.calls[0]![0] as {
      llm: { name: string };
      triageModel: string;
      deepPlanModel: string;
    };
    expect(opts.llm.name).toBe("openai-compat");
  });

  it("uses proxy default triage + deep-plan model names when vars unset", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = architectCtor.mock.calls[0]![0] as {
      triageModel: string;
      deepPlanModel: string;
    };
    expect(opts.triageModel).toBe("claude-haiku-4-5");
    expect(opts.deepPlanModel).toBe("claude-sonnet-4");
  });

  it("honours ATLAS_LLM_TRIAGE_MODEL + ATLAS_LLM_DEEP_MODEL overrides", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_TRIAGE_MODEL = "custom-triage";
    process.env.ATLAS_LLM_DEEP_MODEL = "custom-deep";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = architectCtor.mock.calls[0]![0] as {
      triageModel: string;
      deepPlanModel: string;
    };
    expect(opts.triageModel).toBe("custom-triage");
    expect(opts.deepPlanModel).toBe("custom-deep");
  });

  it("falls back to ANTHROPIC_API_KEY when ATLAS_LLM_BASE_URL absent", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("architect")).toBe(true);
    expect(architectCtor).toHaveBeenCalledOnce();
    const opts = architectCtor.mock.calls[0]![0] as {
      llm: { name: string };
      triageModel: string;
      deepPlanModel: string;
    };
    // AnthropicProvider exposes name="anthropic" per @atlas/llm-provider.
    expect(opts.llm.name).toBe("anthropic");
    // Uses the role-architect module's canonical model constants
    expect(opts.triageModel).toBe("claude-haiku-4-5-20251001");
    expect(opts.deepPlanModel).toBe("claude-opus-4-7");
  });

  it("registers no architect role when neither provider is configured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("architect")).toBe(false);
    expect(architectCtor).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(msg).toMatch(/ATLAS_LLM_BASE_URL|ANTHROPIC_API_KEY/);
    warnSpy.mockRestore();
  });

  it("defaults ATLAS_LLM_API_KEY to sk-no-auth when only BASE_URL set", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    // ATLAS_LLM_API_KEY deliberately unset

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    // Just ensure construction succeeds — the unit tests for the provider
    // cover the default itself. This verifies factory wiring doesn't crash
    // when the auth var is missing.
    await expect(getRitualEngine("p-1")).resolves.toBeDefined();
  });
});

describe("getRitualEngine — smoke", () => {
  it("imports without throwing under mocked deps (legacy smoke)", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.resetModules();
    architectCtor.mockClear();
    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = await getRitualEngine("p-1");
    expect(engine).toBeDefined();
  });
});
