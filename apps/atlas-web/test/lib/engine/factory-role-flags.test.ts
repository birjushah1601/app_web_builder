import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// react's `cache` is server-only; in vitest jsdom it resolves undefined.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({})),
  SpecEventRepo: vi.fn().mockImplementation(() => ({}))
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn(async () => ({})) }));

// Comprehensive mock set so factory.ts's dynamic imports resolve in jsdom.
// See test/lib/engine/factory.test.ts for the canonical set.
vi.mock("@anthropic-ai/sdk", () => ({ default: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/llm-provider", () => ({
  AnthropicProvider: class { readonly name = "anthropic"; constructor(_o: unknown) {} },
  createProviderMetrics: () => ({})
}));
vi.mock("prom-client", () => ({ Registry: class {} }));
vi.mock("@atlas/role-architect", () => ({
  ArchitectRole: class { constructor(_o: unknown) {} },
  ARCHITECT_TRIAGE_MODEL: "claude-haiku-4-5-20251001",
  ARCHITECT_DEEP_PLAN_MODEL: "claude-opus-4-7"
}));
vi.mock("@atlas/role-developer", () => ({ DeveloperRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/skill-runtime", () => ({
  SkillRegistry: class { constructor(_s: unknown[]) {} },
  loadSkillsFromDir: async () => []
}));
vi.mock("@atlas/conductor", () => ({
  Conductor: class {
    roles: Map<string, unknown>;
    constructor(opts: { roles: Map<string, unknown> }) { this.roles = opts.roles; }
  }
}));
vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: class {
    conductor: { roles: Map<string, unknown> };
    postDeveloperChain: string[];
    constructor(opts: { conductor: { roles: Map<string, unknown> }; postDeveloperChain?: string[] }) {
      this.conductor = opts.conductor;
      this.postDeveloperChain = opts.postDeveloperChain ?? [];
    }
  }
}));
vi.mock("@/lib/engine/openai-compat-provider", () => ({
  OpenAICompatProvider: class { readonly name = "openai-compat"; constructor(_o: unknown) {} }
}));
vi.mock("@/lib/engine/spec-events-hydrator", () => ({ SpecEventsHydrator: class { constructor(_o: unknown) {} } }));
vi.mock("@/lib/engine/canvas-pause-singleton", () => ({ getCanvasPauseRegistry: () => ({}) }));
vi.mock("@/lib/feature-flags-server", () => ({ isFeatureEnabledForRequest: async () => false }));
vi.mock("@/lib/sandbox/apply-diff", () => ({ applyDiff: async () => ({ ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: [] }) }));
vi.mock("@/lib/sandbox/sandbox-fs-adapter", () => ({ createSandboxFsAdapter: () => ({}) }));
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({ getOrProvision: async () => ({ exec: { runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }) } }) }),
  resolveTemplateForRitual: () => "atlas-next-ts"
}));
vi.mock("@/lib/assets/image-cache", () => ({ cacheImage: async (u: string) => u }));
vi.mock("@atlas/role-schema-architect", () => ({ SchemaArchitectRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/role-asset-generator", () => ({ AssetGeneratorRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/gate-build", () => ({ BuildGateRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/gate-visual-quality", () => ({ VisualQualityRole: class { constructor(_o: unknown) {} } }));
vi.mock("@/lib/llm/factory", () => ({
  getResearcherRole: async () => ({ id: "researcher", run: async () => ({ events: [], diff: { kind: "none" } }) }),
  getDesignerRole: async () => ({ id: "designer", run: async () => ({ events: [], diff: { kind: "none" } }) })
}));

// Spy on SecurityRole + AccessibilityRole constructors — flag-OFF means
// the import itself shouldn't run, but easier to test via constructor
// invocation count after dynamic import + factory call.
const securityCtorSpy = vi.fn();
const a11yCtorSpy = vi.fn();
vi.mock("@atlas/role-security", () => ({
  SecurityRole: securityCtorSpy
}));
vi.mock("@atlas/role-accessibility", () => ({
  AccessibilityRole: a11yCtorSpy
}));

beforeEach(() => {
  // factory.ts pins the engine map on globalThis. Clear between tests.
  delete (globalThis as { __atlas_ritual_engines__?: Map<string, unknown> }).__atlas_ritual_engines__;
});

describe("getRitualEngine — security/a11y role flag wiring (Plan I Task 4)", () => {
  beforeEach(() => {
    vi.resetModules();
    securityCtorSpy.mockClear();
    a11yCtorSpy.mockClear();
    process.env.ATLAS_LLM_BASE_URL = "http://localhost:3456";
  });
  afterEach(() => {
    delete process.env.ATLAS_FF_SECURITY_ROLE;
    delete process.env.ATLAS_FF_A11Y_ROLE;
    delete process.env.ATLAS_FF_BUILD_GATE;
    delete process.env.ATLAS_LLM_BASE_URL;
  });

  it("flag-OFF for both: neither role constructed; chain stays empty", async () => {
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p");
    expect(securityCtorSpy).not.toHaveBeenCalled();
    expect(a11yCtorSpy).not.toHaveBeenCalled();
    expect((engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain).toEqual([]);
  });

  it("ATLAS_FF_SECURITY_ROLE=true: SecurityRole constructed; chain = ['security']", async () => {
    process.env.ATLAS_FF_SECURITY_ROLE = "true";
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p");
    expect(securityCtorSpy).toHaveBeenCalledTimes(1);
    expect(a11yCtorSpy).not.toHaveBeenCalled();
    expect((engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain).toEqual(["security"]);
  });

  it("ATLAS_FF_A11Y_ROLE=true: AccessibilityRole constructed; chain = ['accessibility']", async () => {
    process.env.ATLAS_FF_A11Y_ROLE = "true";
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p");
    expect(a11yCtorSpy).toHaveBeenCalledTimes(1);
    expect(securityCtorSpy).not.toHaveBeenCalled();
    expect((engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain).toEqual(["accessibility"]);
  });

  it("both flags on: both constructed; chain = ['security', 'accessibility'] (security first)", async () => {
    process.env.ATLAS_FF_SECURITY_ROLE = "true";
    process.env.ATLAS_FF_A11Y_ROLE = "true";
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p");
    expect(securityCtorSpy).toHaveBeenCalledTimes(1);
    expect(a11yCtorSpy).toHaveBeenCalledTimes(1);
    expect((engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain).toEqual(["security", "accessibility"]);
  });

  it("ATLAS_FF_BUILD_GATE unset: build-gate NOT in postDeveloperChain", async () => {
    delete process.env.ATLAS_FF_BUILD_GATE;
    vi.resetModules();
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p");
    expect((engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain).not.toContain("build-gate");
  });

  it("ATLAS_FF_BUILD_GATE=true: build-gate is FIRST entry in postDeveloperChain", async () => {
    process.env.ATLAS_FF_BUILD_GATE = "true";
    vi.resetModules();
    const { getRitualEngine } = await import("@/lib/engine/factory");
    const engine = await getRitualEngine("p");
    const chain = (engine as unknown as { postDeveloperChain: string[] }).postDeveloperChain;
    expect(chain[0]).toBe("build-gate");
  });
});
