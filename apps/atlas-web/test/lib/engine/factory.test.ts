import { describe, it, expect, vi } from "vitest";

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

describe("getRitualEngine", () => {
  it("imports without throwing under mocked deps", async () => {
    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = await getRitualEngine("p-1");
    expect(engine).toBeDefined();
  });
});
