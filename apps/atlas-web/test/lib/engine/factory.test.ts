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

const developerCtor = vi.fn();
vi.mock("@atlas/role-developer", () => ({
  DeveloperRole: class {
    constructor(opts: {
      anthropic: { name: string };
      google: { name: string };
      reviewer: { name: string };
      parallelMode?: "parallel" | "sequential";
    }) {
      developerCtor(opts);
    }
  }
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

const ritualEngineCtor = vi.fn();

vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: class {
    conductor: { roles: Map<string, unknown> };
    sandboxApplier?: { apply: unknown };
    constructor(opts: {
      conductor: { roles: Map<string, unknown> };
      sandboxApplier?: { apply: unknown };
    }) {
      ritualEngineCtor(opts);
      this.conductor = opts.conductor;
      this.sandboxApplier = opts.sandboxApplier;
    }
  }
}));

const ENV_KEYS = [
  "ATLAS_LLM_BASE_URL",
  "ATLAS_LLM_API_KEY",
  "ATLAS_LLM_TRIAGE_MODEL",
  "ATLAS_LLM_DEEP_MODEL",
  "ANTHROPIC_API_KEY",
  "ATLAS_DEVELOPER_SEQUENTIAL",
  "ATLAS_LLM_DEVELOPER_MODEL"
] as const;

describe("getRitualEngine — provider precedence", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    architectCtor.mockClear();
    developerCtor.mockClear();
    ritualEngineCtor.mockClear();
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

describe("getRitualEngine — DeveloperRole registration (plan B)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    architectCtor.mockClear();
    developerCtor.mockClear();
    ritualEngineCtor.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("registers BOTH architect and developer roles when an LLM is configured", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("architect")).toBe(true);
    expect(engine.conductor.roles.has("developer")).toBe(true);
    expect(developerCtor).toHaveBeenCalledOnce();
  });

  it("registers no developer role when no LLM is configured (parity with architect)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("developer")).toBe(false);
    expect(developerCtor).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("DeveloperRole receives the same provider in all three slots in single-provider setup", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as {
      anthropic: { name: string };
      google: { name: string };
      reviewer: { name: string };
    };
    // All three slots point at the same OpenAICompatProvider instance.
    expect(opts.anthropic.name).toBe("openai-compat");
    expect(opts.google.name).toBe("openai-compat");
    expect(opts.reviewer.name).toBe("openai-compat");
    expect(opts.anthropic).toBe(opts.google);
    expect(opts.anthropic).toBe(opts.reviewer);
  });

  it("ATLAS_DEVELOPER_SEQUENTIAL=true wires DeveloperRole.parallelMode='sequential'", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_DEVELOPER_SEQUENTIAL = "true";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { parallelMode?: string };
    expect(opts.parallelMode).toBe("sequential");
  });

  it("DeveloperRole.parallelMode defaults to 'parallel' when ATLAS_DEVELOPER_SEQUENTIAL unset", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    // ATLAS_DEVELOPER_SEQUENTIAL deliberately unset

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { parallelMode?: string };
    expect(opts.parallelMode).toBe("parallel");
  });

  it("ATLAS_LLM_DEVELOPER_MODEL overrides the developer model (escapes proxy timeout for sonnet-tier requests)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_DEEP_MODEL = "claude-sonnet-4";
    process.env.ATLAS_LLM_DEVELOPER_MODEL = "claude-haiku-4-5";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as {
      anthropicModel?: string;
      googleModel?: string;
      reviewerModel?: string;
    };
    // All three slots use the developer model when overridden
    expect(opts.anthropicModel).toBe("claude-haiku-4-5");
    expect(opts.googleModel).toBe("claude-haiku-4-5");
    expect(opts.reviewerModel).toBe("claude-haiku-4-5");
  });

  it("DeveloperRole model defaults to ATLAS_LLM_DEEP_MODEL when ATLAS_LLM_DEVELOPER_MODEL unset (back-compat)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_DEEP_MODEL = "claude-sonnet-4";
    // ATLAS_LLM_DEVELOPER_MODEL deliberately unset

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { anthropicModel?: string };
    expect(opts.anthropicModel).toBe("claude-sonnet-4");
  });

  it("ATLAS_DEVELOPER_SEQUENTIAL=anything-other-than-'true' is treated as parallel (strict opt-in)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_DEVELOPER_SEQUENTIAL = "1"; // truthy-ish, but not the literal "true"

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { parallelMode?: string };
    expect(opts.parallelMode).toBe("parallel");
  });

  it("wires a sandboxApplier into RitualEngineOptions when llm is configured (plan C)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    await getRitualEngine("p-1");

    const opts = ritualEngineCtor.mock.calls.at(-1)?.[0] as {
      sandboxApplier?: { apply: unknown };
    };
    expect(opts.sandboxApplier).toBeDefined();
    expect(typeof opts.sandboxApplier?.apply).toBe("function");
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
