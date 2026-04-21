import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("setPersonaOverride", () => {
  it("upserts override via PreferencesRepo", async () => {
    const upsert = vi.fn(async () => {});
    vi.doMock("@atlas/spec-graph-data", () => ({
      PreferencesRepo: class { upsertOverride = upsert; }
    }));
    vi.doMock("pg", () => ({ Pool: class { query() {} } }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-1" }) }));
    const { setPersonaOverride } = await import("@/lib/actions/setPersonaOverride.js");
    await setPersonaOverride({ projectId: "p-1", persona: "diego" });
    expect(upsert).toHaveBeenCalledWith("u-1", "p-1", "diego");
  });
});
