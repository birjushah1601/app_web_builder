import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("acceptRiskAction", () => {
  it("forwards a Diego L4 risk-accept", async () => {
    const acceptRisk = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory", () => ({ getRitualEngine: async () => ({ acceptRisk }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-diego" }) }));
    const { acceptRiskAction } = await import("@/lib/actions/acceptRiskAction");
    await acceptRiskAction({
      projectId: "p-1", ritualId: "r-1",
      gate: "L4-security", persona: "diego",
      failureSummary: "wildcard CORS", rationale: "Sunset by 2026-06-01; tracked in JIRA-123", scope: "session"
    });
    expect(acceptRisk).toHaveBeenCalledOnce();
  });

  it("propagates PersonaGateError back to the caller", async () => {
    const { PersonaGateError } = await import("@atlas/ritual-engine");
    const acceptRisk = vi.fn(async () => { throw new PersonaGateError("L4-security", "ama", "diego"); });
    vi.doMock("@/lib/engine/factory", () => ({ getRitualEngine: async () => ({ acceptRisk }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u-ama" }) }));
    const { acceptRiskAction } = await import("@/lib/actions/acceptRiskAction");
    await expect(acceptRiskAction({
      projectId: "p-1", ritualId: "r-1",
      gate: "L4-security", persona: "ama",
      failureSummary: "f", rationale: "twenty character rationale here ok", scope: "session"
    })).rejects.toThrow(/persona/i);
  });
});
