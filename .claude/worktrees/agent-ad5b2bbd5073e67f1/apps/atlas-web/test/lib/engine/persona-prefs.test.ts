import { describe, it, expect, vi } from "vitest";
import { ClerkPersonaPreferences } from "@/lib/engine/persona-prefs";

describe("ClerkPersonaPreferences", () => {
  it("returns the per-project override when present", async () => {
    const repo = { getOverride: vi.fn(async () => "priya" as const), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: { defaultPersona: "diego" } };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("priya");
    expect(repo.getOverride).toHaveBeenCalledWith("user_a", "p-1");
  });

  it("falls back to Clerk metadata defaultPersona when no override", async () => {
    const repo = { getOverride: vi.fn(async () => null), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: { defaultPersona: "diego" } };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("diego");
  });

  it("falls back to 'ama' (least-privileged) when nothing is set", async () => {
    const repo = { getOverride: vi.fn(async () => null), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: {} };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("ama");
  });

  it("rejects an invalid metadata value", async () => {
    const repo = { getOverride: vi.fn(async () => null), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: { defaultPersona: "admin" } };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("ama");
  });
});
