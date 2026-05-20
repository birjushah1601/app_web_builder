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

// Spy on the SpecEventsHydrator constructor — its presence/absence in the
// factory's flow is the cleanest signal that the flag-gated wiring fired.
// (Spying on RitualEngine itself broke `new` invocation; this side-steps that.)
const hydratorCtorSpy = vi.fn();
vi.mock("@/lib/engine/spec-events-hydrator", () => ({
  SpecEventsHydrator: hydratorCtorSpy
}));

describe("getRitualEngine — ritual-hydration flag wiring (Plan H Task 10)", () => {
  beforeEach(() => {
    vi.resetModules();
    hydratorCtorSpy.mockClear();
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
