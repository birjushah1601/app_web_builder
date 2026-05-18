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
});
