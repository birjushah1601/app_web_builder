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
    constructor(opts: { roles: Map<string, unknown>; checkpointSink: { emit: (e: unknown) => Promise<void> } }) {
      this.roles = opts.roles;
      (globalThis as { __lastConductorOpts?: typeof opts }).__lastConductorOpts = opts;
    }
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

// Mocks added 2026-05-23 to keep up with factory.ts's growing dynamic-import
// surface. Each entry stubs a module factory.ts pulls in during getRitualEngine.
vi.mock("@/lib/engine/openai-compat-provider", () => ({
  OpenAICompatProvider: class { readonly name = "openai-compat"; constructor(_opts: unknown) {} }
}));
vi.mock("@/lib/engine/spec-events-hydrator", () => ({
  SpecEventsHydrator: class { constructor(_opts: unknown) {} }
}));
vi.mock("@/lib/engine/canvas-pause-singleton", () => ({
  getCanvasPauseRegistry: () => ({})
}));
vi.mock("@/lib/feature-flags-server", () => ({
  isFeatureEnabledForRequest: async () => false
}));
vi.mock("@/lib/sandbox/apply-diff", () => ({ applyDiff: async () => ({ ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: [] }) }));
vi.mock("@/lib/sandbox/sandbox-fs-adapter", () => ({ createSandboxFsAdapter: () => ({}) }));
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({ getOrProvision: async () => ({ exec: { runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }) } }) }),
  resolveTemplateForRitual: () => "atlas-next-ts"
}));
vi.mock("@/lib/assets/image-cache", () => ({ cacheImage: async (url: string) => url }));
vi.mock("@atlas/role-schema-architect", () => ({
  SchemaArchitectRole: class { constructor(_opts: unknown) {} }
}));
vi.mock("@atlas/role-asset-generator", () => ({
  AssetGeneratorRole: class { constructor(_opts: unknown) {} }
}));
vi.mock("@atlas/role-security", () => ({
  SecurityRole: class { constructor(_opts: unknown) {} }
}));
vi.mock("@atlas/role-accessibility", () => ({
  AccessibilityRole: class { constructor(_opts: unknown) {} }
}));
vi.mock("@atlas/gate-build", () => ({
  BuildGateRole: class { constructor(_opts: unknown) {} }
}));
vi.mock("@atlas/gate-visual-quality", () => ({
  VisualQualityRole: class { constructor(_opts: unknown) {} }
}));
vi.mock("@/lib/llm/factory", () => ({
  getResearcherRole: async () => ({ id: "researcher", run: async () => ({ events: [], diff: { kind: "none" } }) }),
  getDesignerRole: async () => ({ id: "designer", run: async () => ({ events: [], diff: { kind: "none" } }) })
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

// factory.ts pins the engine map on globalThis under a string key. Clear it
// before EVERY test in this file (across all describe blocks) so each gets a
// fresh registry. Without this, the first test of any describe caches and
// later tests skip the factory body entirely.
beforeEach(() => {
  delete (globalThis as { __atlas_ritual_engines__?: Map<string, unknown> }).__atlas_ritual_engines__;
});

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
    // factory.ts pins the engine map on globalThis under a string key; clear
    // it between tests so each gets a fresh registry. Without this, the
    // first test's engine caches and subsequent tests' projectId matches
    // skip the entire factory body — including ArchitectRole construction.
    delete (globalThis as { __atlas_ritual_engines__?: Map<string, unknown> }).__atlas_ritual_engines__;
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("architect")).toBe(true);
    expect(engine.conductor.roles.has("developer")).toBe(true);
    expect(developerCtor).toHaveBeenCalledOnce();
  });

  it("registers no developer role when no LLM is configured (parity with architect)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = (await getRitualEngine("p-1")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("developer")).toBe(false);
    expect(developerCtor).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("DeveloperRole receives the same provider in all three slots in single-provider setup", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { parallelMode?: string };
    expect(opts.parallelMode).toBe("sequential");
  });

  it("DeveloperRole.parallelMode defaults to 'parallel' when ATLAS_DEVELOPER_SEQUENTIAL unset", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    // ATLAS_DEVELOPER_SEQUENTIAL deliberately unset

    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { parallelMode?: string };
    expect(opts.parallelMode).toBe("parallel");
  });

  it("ATLAS_LLM_DEVELOPER_MODEL overrides the developer model (escapes proxy timeout for sonnet-tier requests)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_LLM_DEEP_MODEL = "claude-sonnet-4";
    process.env.ATLAS_LLM_DEVELOPER_MODEL = "claude-haiku-4-5";

    const { getRitualEngine } = await import("@/lib/engine/factory");
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

    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { anthropicModel?: string };
    expect(opts.anthropicModel).toBe("claude-sonnet-4");
  });

  it("ATLAS_DEVELOPER_SEQUENTIAL=anything-other-than-'true' is treated as parallel (strict opt-in)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_DEVELOPER_SEQUENTIAL = "1"; // truthy-ish, but not the literal "true"

    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");

    const opts = developerCtor.mock.calls[0]![0] as { parallelMode?: string };
    expect(opts.parallelMode).toBe("parallel");
  });

  it("wires a sandboxApplier into RitualEngineOptions when llm is configured (plan C)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";

    const { getRitualEngine } = await import("@/lib/engine/factory");
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
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p-1");
    expect(engine).toBeDefined();
  });
});

describe("getRitualEngine — SchemaArchitectRole conditional registration (T15)", () => {
  const saved: Record<string, string | undefined> = {};
  const schemaArchitectCtor = vi.fn();
  const designerStubCtor = vi.fn();

  beforeEach(() => {
    for (const k of [...ENV_KEYS, "ATLAS_FF_SCHEMA_ARCHITECT", "ATLAS_FF_DESIGNER"] as const) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    schemaArchitectCtor.mockClear();
    designerStubCtor.mockClear();
    architectCtor.mockClear();
    developerCtor.mockClear();
    ritualEngineCtor.mockClear();
    vi.resetModules();
    vi.doMock("@atlas/role-schema-architect", () => ({
      SchemaArchitectRole: class {
        constructor(opts: unknown) { schemaArchitectCtor(opts); }
      }
    }));
    // Stub getDesignerRole so the third test (Designer remains alongside)
    // doesn't depend on resolving + constructing the real @atlas/role-designer
    // package during unit tests. Sentinel role-shaped object is sufficient
    // — we're asserting the registration gating, not the role construction.
    vi.doMock("@/lib/llm/factory", async () => {
      const actual = await vi.importActual<typeof import("@/lib/llm/factory")>("@/lib/llm/factory");
      return {
        ...actual,
        getDesignerRole: vi.fn(async () => {
          designerStubCtor();
          return { id: "designer", name: "designer-stub" } as never;
        })
      };
    });
  });

  afterEach(() => {
    for (const k of [...ENV_KEYS, "ATLAS_FF_SCHEMA_ARCHITECT", "ATLAS_FF_DESIGNER"] as const) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unmock("@atlas/role-schema-architect");
    vi.unmock("@/lib/llm/factory");
  });

  it("registers SchemaArchitectRole when ATLAS_FF_SCHEMA_ARCHITECT=true", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_FF_SCHEMA_ARCHITECT = "true";

    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = (await getRitualEngine("p-schema-on")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("schema-architect")).toBe(true);
    expect(schemaArchitectCtor).toHaveBeenCalledOnce();
  });

  it("does NOT register SchemaArchitectRole when ATLAS_FF_SCHEMA_ARCHITECT is unset", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    // ATLAS_FF_SCHEMA_ARCHITECT deliberately unset

    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = (await getRitualEngine("p-schema-off")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("schema-architect")).toBe(false);
    expect(schemaArchitectCtor).not.toHaveBeenCalled();
  });

  it("DesignerRole remains registered alongside SchemaArchitectRole when both flags are on", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    process.env.ATLAS_FF_SCHEMA_ARCHITECT = "true";
    process.env.ATLAS_FF_DESIGNER = "true";

    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = (await getRitualEngine("p-schema-designer")) as unknown as {
      conductor: { roles: Map<string, unknown> };
    };

    expect(engine.conductor.roles.has("schema-architect")).toBe(true);
    expect(engine.conductor.roles.has("designer")).toBe(true);
  });
});

describe("factory — checkpointSink wires to broker + SpecEventsSink (plan E.0)", () => {
  beforeEach(async () => {
    const { __resetEventBrokerForTesting } = await import("@/lib/events/broker-singleton");
    __resetEventBrokerForTesting();
    delete (globalThis as { __lastConductorOpts?: unknown }).__lastConductorOpts;
  });

  it("publishes Conductor checkpoints into the EventBroker for the project", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    vi.resetModules();
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("proj-x");

    const conductorOpts = (globalThis as { __lastConductorOpts?: { checkpointSink: { emit: (e: unknown) => Promise<void> } } }).__lastConductorOpts;
    expect(conductorOpts).toBeDefined();

    const { getEventBroker } = await import("@/lib/events/broker-singleton");
    const ac = new AbortController();
    const sub = getEventBroker().subscribe("proj-x", { signal: ac.signal });
    const collector = (async () => {
      const out: unknown[] = [];
      for await (const e of sub) {
        out.push(e);
        break;
      }
      return out;
    })();

    await conductorOpts!.checkpointSink.emit({
      eventType: "role.completed",
      ritualId: "r-1",
      payload: { roleId: "architect", attempts: 1 },
      ts: new Date().toISOString()
    });

    const events = await collector;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      projectId: "proj-x",
      ritualId: "r-1",
      type: "role.completed"
    });
    ac.abort();
  });

  it("does NOT crash the engine when broker.publish rejects (logs + continues)", async () => {
    process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("proj-y");

    const conductorOpts = (globalThis as { __lastConductorOpts?: { checkpointSink: { emit: (e: unknown) => Promise<void> } } }).__lastConductorOpts;

    const { getEventBroker } = await import("@/lib/events/broker-singleton");
    const broker = getEventBroker();
    const origPublish = broker.publish.bind(broker);
    broker.publish = (async () => { throw new Error("simulated broker failure"); }) as never;

    await expect(conductorOpts!.checkpointSink.emit({
      eventType: "role.completed",
      ritualId: "r-1",
      payload: {},
      ts: new Date().toISOString()
    })).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    broker.publish = origPublish;
    errSpy.mockRestore();
  });
});
