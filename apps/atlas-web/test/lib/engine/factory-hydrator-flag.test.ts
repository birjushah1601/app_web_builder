import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// react's `cache` is a server-only export; in vitest's jsdom environment it
// resolves to undefined. Replace with an identity-ish wrapper.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({})),
  SpecEventRepo: vi.fn().mockImplementation(() => ({
    listByRitual: vi.fn(async () => [])
  }))
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn(async () => ({})) }));

// Comprehensive factory mock set so dynamic imports resolve in jsdom.
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
    constructor(public opts: { hydrator?: unknown }) {}
  }
}));
vi.mock("@/lib/engine/openai-compat-provider", () => ({
  OpenAICompatProvider: class { readonly name = "openai-compat"; constructor(_o: unknown) {} }
}));
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
vi.mock("@atlas/role-security", () => ({ SecurityRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/role-accessibility", () => ({ AccessibilityRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/gate-build", () => ({ BuildGateRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/gate-visual-quality", () => ({ VisualQualityRole: class { constructor(_o: unknown) {} } }));
vi.mock("@/lib/llm/factory", () => ({
  getResearcherRole: async () => ({ id: "researcher", run: async () => ({ events: [], diff: { kind: "none" } }) }),
  getDesignerRole: async () => ({ id: "designer", run: async () => ({ events: [], diff: { kind: "none" } }) })
}));

// Spy on the SpecEventsHydrator constructor — its presence/absence in the
// factory's flow is the cleanest signal that the flag-gated wiring fired.
// (Spying on RitualEngine itself broke `new` invocation; this side-steps that.)
const hydratorCtorSpy = vi.fn();
vi.mock("@/lib/engine/spec-events-hydrator", () => ({
  SpecEventsHydrator: hydratorCtorSpy
}));

beforeEach(() => {
  delete (globalThis as { __atlas_ritual_engines__?: Map<string, unknown> }).__atlas_ritual_engines__;
});

describe("getRitualEngine — ritual-hydration flag wiring (Plan H Task 10)", () => {
  beforeEach(() => {
    vi.resetModules();
    hydratorCtorSpy.mockClear();
    process.env.ATLAS_LLM_BASE_URL = "http://localhost:3456";
  });
  afterEach(() => { delete process.env.ATLAS_RITUAL_HYDRATION; });

  it("flag-OFF: SpecEventsHydrator is NOT constructed (today's behavior preserved)", async () => {
    delete process.env.ATLAS_RITUAL_HYDRATION;
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-1");
    expect(hydratorCtorSpy).not.toHaveBeenCalled();
  });

  it("flag-ON: SpecEventsHydrator IS constructed with the project's repo + projectId", async () => {
    process.env.ATLAS_RITUAL_HYDRATION = "true";
    const { getRitualEngine } = await import("@/lib/engine/factory");
    await getRitualEngine("p-xyz");
    expect(hydratorCtorSpy).toHaveBeenCalledTimes(1);
    expect(hydratorCtorSpy.mock.calls[0]![1]).toBe("p-xyz");
  });
});
