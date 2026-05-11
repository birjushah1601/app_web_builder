import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pg so the spend reader/recorder doesn't try to talk to Postgres.
vi.mock("pg", () => ({ default: { Pool: class { async query() { return { rows: [] }; } } } }));
vi.mock("@atlas/spec-graph-data", () => ({
  SandboxSpendRepo: class {
    async getRollingAverageSpend() { return 0; }
    async getAccumulatedSpend() { return 0; }
    async record() {}
  }
}));

// Capture E2BLifecycle constructor + provision calls so we can verify env-var
// precedence shows up in the actual provision request.
const e2bConstructor = vi.fn();
const provisionSpy = vi.fn(async (templateId: string, projectId: string) => ({
  sandboxId: `sb_${projectId.slice(0, 6)}`,
  templateId,
  projectId,
  provisionedAt: new Date().toISOString(),
  status: "running" as const
}));

vi.mock("@atlas/sandbox-e2b", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/sandbox-e2b")>();
  return {
    ...actual,
    E2BLifecycle: class {
      constructor(opts: unknown) { e2bConstructor(opts); }
      provision = provisionSpy;
      terminate = vi.fn();
      restart = vi.fn();
    },
    // checkSpendCap is also exported from this module — let it pass through (no-op for tests)
    checkSpendCap: vi.fn(async () => {})
  };
});

const ENV_KEYS = [
  "E2B_API_KEY",
  "ATLAS_DEFAULT_SANDBOX_TEMPLATE",
  "ATLAS_DEFAULT_SANDBOX_PORT",
  "DATABASE_URL"
] as const;

describe("getSandboxFactory — env-driven template + port", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    e2bConstructor.mockClear();
    provisionSpy.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("provisions with atlas-next-ts when ATLAS_DEFAULT_SANDBOX_TEMPLATE is unset", async () => {
    process.env.E2B_API_KEY = "e2b_dummy";
    const { getSandboxFactory, _resetSandboxFactoryForTests } = await import("@/lib/sandbox/factory");
    _resetSandboxFactoryForTests();
    const session = await getSandboxFactory().getOrProvision("p-1111");
    expect(provisionSpy).toHaveBeenCalledWith("atlas-next-ts", "p-1111");
    // Default port for atlas-next-ts is 3000 → previewUrl uses port 3000
    expect(session.previewUrl).toBe("https://3000-sb_p-1111.e2b.app");
  });

  it("provisions with an arbitrary template ID from ATLAS_DEFAULT_SANDBOX_TEMPLATE", async () => {
    process.env.E2B_API_KEY = "e2b_dummy";
    process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE = "6f5mwsacoiiqt0qj1bgx";
    const { getSandboxFactory, _resetSandboxFactoryForTests } = await import("@/lib/sandbox/factory");
    _resetSandboxFactoryForTests();
    await getSandboxFactory().getOrProvision("p-2222");
    expect(provisionSpy).toHaveBeenCalledWith("6f5mwsacoiiqt0qj1bgx", "p-2222");
  });

  it("synthesizes previewUrl with port 3000 fallback for unknown templates without explicit port", async () => {
    // Pre-fix this would have been "https://undefined-<id>.e2b.app".
    process.env.E2B_API_KEY = "e2b_dummy";
    process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE = "6f5mwsacoiiqt0qj1bgx";
    const { getSandboxFactory, _resetSandboxFactoryForTests } = await import("@/lib/sandbox/factory");
    _resetSandboxFactoryForTests();
    const session = await getSandboxFactory().getOrProvision("p-3333");
    expect(session.previewUrl).toBe("https://3000-sb_p-3333.e2b.app");
    expect(session.previewUrl).not.toContain("undefined");
  });

  it("honours ATLAS_DEFAULT_SANDBOX_PORT for non-Next workloads", async () => {
    process.env.E2B_API_KEY = "e2b_dummy";
    process.env.ATLAS_DEFAULT_SANDBOX_TEMPLATE = "user-fastapi";
    process.env.ATLAS_DEFAULT_SANDBOX_PORT = "8000";
    const { getSandboxFactory, _resetSandboxFactoryForTests } = await import("@/lib/sandbox/factory");
    _resetSandboxFactoryForTests();
    const session = await getSandboxFactory().getOrProvision("p-4444");
    expect(session.previewUrl).toBe("https://8000-sb_p-4444.e2b.app");
  });

  it("propagates E2B_API_KEY into the lifecycle", async () => {
    process.env.E2B_API_KEY = "e2b_test_key_123";
    const { getSandboxFactory, _resetSandboxFactoryForTests } = await import("@/lib/sandbox/factory");
    _resetSandboxFactoryForTests();
    getSandboxFactory();
    const lifecycleOpts = e2bConstructor.mock.calls.at(-1)?.[0] as { apiKey: string };
    expect(lifecycleOpts.apiKey).toBe("e2b_test_key_123");
  });
});
