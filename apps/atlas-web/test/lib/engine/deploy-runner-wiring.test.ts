// Plan F.2 Task 5 — verifies atlas-web's factory wires DeployOrchestrator +
// a deployRunner closure into WorkflowEngine options when
// ATLAS_FF_DEPLOY_RUNTIME=true. Three scenarios:
//   1. flag-OFF: no deployRunner / deployApex options passed (today's behavior)
//   2. flag-ON + env missing: factory throws with a clear "missing env" message
//   3. flag-ON + env complete: deployRunner is a function, deployApex matches
//      ATLAS_DEPLOY_APEX, and invoking deployRunner calls through to the
//      DeployOrchestrator.deployFromArtifacts (mocked here).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// react's `cache` is server-only; in vitest jsdom it resolves undefined.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

// --- Common deps the factory's dynamic imports pull in ---------------------
vi.mock("pg", () => ({ Pool: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({})),
  SpecEventRepo: vi.fn().mockImplementation(() => ({})),
  WorkflowRunRepo: vi.fn().mockImplementation(() => ({})),
  WorkflowNodeRepo: vi.fn().mockImplementation(() => ({})),
  WorkflowCheckpointRepo: vi.fn().mockImplementation(() => ({})),
  EvalVerdictRepo: vi.fn().mockImplementation(() => ({}))
}));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn(async () => ({})) }));
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
vi.mock("@atlas/role-developer", () => ({
  DeveloperRole: class { constructor(_o: unknown) {} },
  BackendArtifactRole: class { constructor() {} }
}));
vi.mock("@atlas/role-tester", () => ({ TestsRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/role-iac", () => ({ IacRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/role-deployer", () => ({ DeployerRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/role-workflow-planner", () => ({ WorkflowPlannerRole: class { constructor(_o: unknown) {} } }));
vi.mock("@atlas/skill-runtime", () => ({
  SkillRegistry: class { constructor(_s: unknown[]) {} },
  loadSkillsFromDir: async () => []
}));
vi.mock("@atlas/conductor", () => ({
  Conductor: class {
    roles: Map<string, unknown>;
    constructor(opts: { roles: Map<string, unknown> }) { this.roles = opts.roles; }
    registerRole(id: string, role: unknown) { this.roles.set(id, role); }
  }
}));
type RitualEngineMockConductor = {
  roles: Map<string, unknown>;
  registerRole: (id: string, r: unknown) => void;
};
vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: class {
    conductor: RitualEngineMockConductor;
    constructor(opts: { conductor: RitualEngineMockConductor }) { this.conductor = opts.conductor; }
    getConductor() { return this.conductor; }
  }
}));

// --- WorkflowEngine mock — captures constructor opts so the test can assert
//     on deployRunner / deployApex presence. ------------------------------
const workflowEngineCtor = vi.fn();
vi.mock("@atlas/workflow-engine", () => ({
  WorkflowEngine: class {
    constructor(opts: unknown) { workflowEngineCtor(opts); }
  },
  CheckpointRecorder: class {
    constructor(_a: unknown, _b: unknown) {}
    async onEvent(_e: unknown) {}
    registerRitualForNode() {}
  }
}));

// --- Other factory deps ----------------------------------------------------
vi.mock("@/lib/engine/openai-compat-provider", () => ({
  OpenAICompatProvider: class { readonly name = "openai-compat"; constructor(_o: unknown) {} }
}));
vi.mock("@/lib/engine/spec-events-hydrator", () => ({
  SpecEventsHydrator: class { constructor(_o: unknown) {} }
}));
vi.mock("@/lib/engine/canvas-pause-singleton", () => ({ getCanvasPauseRegistry: () => ({}) }));
vi.mock("@/lib/feature-flags-server", () => ({ isFeatureEnabledForRequest: async () => false }));
vi.mock("@/lib/sandbox/apply-diff", () => ({ applyDiff: async () => ({ ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: [] }) }));
vi.mock("@/lib/sandbox/sandbox-fs-adapter", () => ({ createSandboxFsAdapter: () => ({}) }));
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: async () => ({
      record: { sandboxId: "sb-1", templateId: "atlas-next-ts-v2" },
      previewUrl: "https://preview/"
    }),
    evict: () => {}
  }),
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

// --- DeployOrchestrator + its k8s/cloudflare adapters ----------------------
type DeployFromArtifactsFn = (input: Record<string, unknown>) => Promise<{
  deployId: string;
  publicUrl: string;
  argoApplicationName: string;
  branchSchemaName: string;
  appliedManifests: unknown[];
  phase: "healthy" | "failed";
  startedAt: string;
}>;
const deployFromArtifactsSpy = vi.fn<DeployFromArtifactsFn>(
  async (_input: Record<string, unknown>) => ({
    deployId: "d-1",
    publicUrl: "https://x.atlas.dev",
    argoApplicationName: "x",
    branchSchemaName: "main",
    appliedManifests: [],
    phase: "healthy" as const,
    startedAt: "now"
  })
);
const deployOrchestratorCtor = vi.fn();
const k8sClientCtor = vi.fn();
const cloudflareClientCtor = vi.fn();
vi.mock("@atlas/deploy-orchestrator", () => ({
  DeployOrchestrator: class {
    constructor(opts: unknown) {
      deployOrchestratorCtor(opts);
    }
    deployFromArtifacts = deployFromArtifactsSpy;
  },
  K8sClientNodeClient: class {
    constructor(opts: unknown) { k8sClientCtor(opts); }
  },
  HttpCloudflareClient: class {
    constructor(opts: unknown) { cloudflareClientCtor(opts); }
  }
}));

// The factory only conditionally imports @kubernetes/client-node inside the
// flag-on branch; supply a minimal stub so the dynamic import resolves.
vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: class {
    loadFromDefault() {}
    makeApiClient(_ctor: unknown) { return {}; }
  },
  CustomObjectsApi: class {}
}));

const DEPLOY_ENV_KEYS = [
  "ATLAS_FF_DEPLOY_RUNTIME",
  "ATLAS_DEPLOY_APEX",
  "ATLAS_DEPLOY_INGRESS_TARGET",
  "ATLAS_DEPLOY_ISSUER_REF",
  "ATLAS_DEPLOY_MANIFEST_REPO_URL",
  "ATLAS_CLOUDFLARE_TOKEN",
  "ATLAS_CLOUDFLARE_ZONE_ID"
] as const;

function clearDeployEnv(): void {
  for (const k of DEPLOY_ENV_KEYS) delete process.env[k];
}

function setFullDeployEnv(): void {
  process.env.ATLAS_FF_DEPLOY_RUNTIME = "true";
  process.env.ATLAS_DEPLOY_APEX = "atlas.dev";
  process.env.ATLAS_DEPLOY_INGRESS_TARGET = "ingress.atlas.dev";
  process.env.ATLAS_DEPLOY_ISSUER_REF = "letsencrypt-prod";
  process.env.ATLAS_DEPLOY_MANIFEST_REPO_URL = "git@example.com:manifests.git";
  process.env.ATLAS_CLOUDFLARE_TOKEN = "cf-token";
  process.env.ATLAS_CLOUDFLARE_ZONE_ID = "cf-zone";
}

beforeEach(() => {
  vi.resetModules();
  workflowEngineCtor.mockClear();
  deployFromArtifactsSpy.mockClear();
  deployOrchestratorCtor.mockClear();
  k8sClientCtor.mockClear();
  cloudflareClientCtor.mockClear();
  clearDeployEnv();
  // Provide an LLM so getRitualEngine's role registration completes successfully.
  process.env.ATLAS_LLM_BASE_URL = "http://127.0.0.1:3456";
  // Reset the per-process engine maps the factory pins on globalThis.
  delete (globalThis as { __atlas_ritual_engines__?: Map<string, unknown> }).__atlas_ritual_engines__;
  delete (globalThis as { __atlas_workflow_engines__?: Map<string, unknown> }).__atlas_workflow_engines__;
});

afterEach(() => {
  clearDeployEnv();
  delete process.env.ATLAS_LLM_BASE_URL;
});

describe("getWorkflowEngine — Plan F.2 deploy runner wiring", () => {
  it("flag-OFF: WorkflowEngine constructed WITHOUT deployRunner / deployApex options", async () => {
    // ATLAS_FF_DEPLOY_RUNTIME deliberately unset (clearDeployEnv() above).
    const { getWorkflowEngine } = await import("@/lib/engine/factory");
    await getWorkflowEngine("p-deploy-off");

    expect(workflowEngineCtor).toHaveBeenCalledTimes(1);
    const opts = workflowEngineCtor.mock.calls[0]![0] as {
      deployRunner?: unknown;
      deployApex?: unknown;
    };
    expect(opts.deployRunner).toBeUndefined();
    expect(opts.deployApex).toBeUndefined();
    expect(deployOrchestratorCtor).not.toHaveBeenCalled();
    expect(k8sClientCtor).not.toHaveBeenCalled();
    expect(cloudflareClientCtor).not.toHaveBeenCalled();
  });

  it("flag-ON + ATLAS_DEPLOY_APEX missing: factory throws with a clear missing-env message", async () => {
    process.env.ATLAS_FF_DEPLOY_RUNTIME = "true";
    // intentionally leave ATLAS_DEPLOY_APEX (and others) unset
    const { getWorkflowEngine } = await import("@/lib/engine/factory");

    await expect(getWorkflowEngine("p-deploy-missing")).rejects.toThrow(
      /missing env.*ATLAS_DEPLOY_APEX/
    );
  });

  it("flag-ON + env fully configured: deployRunner + deployApex passed into WorkflowEngine", async () => {
    setFullDeployEnv();

    const { getWorkflowEngine } = await import("@/lib/engine/factory");
    await getWorkflowEngine("p-deploy-on");

    expect(workflowEngineCtor).toHaveBeenCalledTimes(1);
    const opts = workflowEngineCtor.mock.calls[0]![0] as {
      deployRunner?: (i: unknown) => Promise<unknown>;
      deployApex?: string;
    };
    expect(typeof opts.deployRunner).toBe("function");
    expect(opts.deployApex).toBe("atlas.dev");

    // DeployOrchestrator + clients constructed exactly once with env-sourced config.
    expect(deployOrchestratorCtor).toHaveBeenCalledTimes(1);
    expect(k8sClientCtor).toHaveBeenCalledTimes(1);
    expect(cloudflareClientCtor).toHaveBeenCalledTimes(1);
    const cfOpts = cloudflareClientCtor.mock.calls[0]![0] as { token: string; zoneId?: string };
    expect(cfOpts.token).toBe("cf-token");

    const orchOpts = deployOrchestratorCtor.mock.calls[0]![0] as {
      manifestRepoUrl: string;
      issuerRef: string;
      ingressTarget: string;
    };
    expect(orchOpts.manifestRepoUrl).toBe("git@example.com:manifests.git");
    expect(orchOpts.issuerRef).toBe("letsencrypt-prod");
    expect(orchOpts.ingressTarget).toBe("ingress.atlas.dev");
  });

  it("flag-ON: invoking the threaded deployRunner delegates to DeployOrchestrator.deployFromArtifacts", async () => {
    setFullDeployEnv();

    const { getWorkflowEngine } = await import("@/lib/engine/factory");
    await getWorkflowEngine("p-deploy-on-call");

    const opts = workflowEngineCtor.mock.calls[0]![0] as {
      deployRunner: (i: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    const sampleInput: Record<string, unknown> = {
      workflowRunId: "wf-1",
      projectId: "p-1",
      nodeId: "n-1",
      iacArtifact: { kind: "iac", schemaVersion: 1 },
      deployArtifact: { kind: "deploy", schemaVersion: 1 },
      branchId: "wf-1",
      subdomain: "wf-1sub",
      apex: "atlas.dev"
    };
    const result = await opts.deployRunner(sampleInput);

    expect(deployFromArtifactsSpy).toHaveBeenCalledTimes(1);
    const passed = deployFromArtifactsSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed.projectId).toBe("p-1");
    expect(passed.branchId).toBe("wf-1");
    expect(passed.subdomain).toBe("wf-1sub");
    expect(passed.apex).toBe("atlas.dev");
    expect(result.deployId).toBe("d-1");
  });
});
