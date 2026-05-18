import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RitualEvent } from "@/lib/events/EventBroker";

const mockUseEventStream = vi.fn<() => { events: RitualEvent[]; status: string; lastEventId: string | null }>();

vi.mock("@/lib/events/EventSourceProvider", () => ({
  useEventStream: () => mockUseEventStream()
}));

import { useResearcherBrief, type BriefPayload } from "@/lib/research/useResearcherBrief";

const sampleBrief: BriefPayload = {
  category: "saas-landing",
  audienceCues: ["devs", "indie-hackers"],
  references: [
    {
      name: "Linear",
      url: "https://linear.app",
      why: "Crisp typography + restrained palette",
      sourceTier: "local-catalog",
      palettePreview: ["#5E6AD2", "#0E0F11"],
      typographyPreview: { primary: "Inter", secondary: "JetBrains Mono" }
    }
  ],
  patternsThatWin: ["above-the-fold product screenshot"],
  patternsThatLose: ["wall-of-features grid"]
};

const evt = (type: RitualEvent["type"], ritualId: string, payload: Record<string, unknown>, ts: number, n = 1): RitualEvent => ({
  id: `p-1:${n}`, projectId: "p-1", ritualId, type, payload, ts
});

describe("useResearcherBrief", () => {
  beforeEach(() => mockUseEventStream.mockReset());

  it("returns an empty map when no events have arrived", () => {
    mockUseEventStream.mockReturnValue({ events: [], status: "open", lastEventId: null });
    const { result } = renderHook(() => useResearcherBrief());
    expect(result.current.briefByRitualId).toEqual({});
  });

  it("captures a researcher.brief.completed payload keyed by ritualId", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("ritual.started", "r-1", { intent: "build" }, 100, 1),
        evt("researcher.brief.completed", "r-1", { brief: sampleBrief, fastMode: false, attempt: 1, roleId: "researcher" }, 200, 2)
      ],
      status: "open",
      lastEventId: "p-1:2"
    });
    const { result } = renderHook(() => useResearcherBrief());
    expect(result.current.briefByRitualId["r-1"]).toBeDefined();
    expect(result.current.briefByRitualId["r-1"]?.category).toBe("saas-landing");
    expect(result.current.briefByRitualId["r-1"]?.references).toHaveLength(1);
    expect(result.current.briefByRitualId["r-1"]?.references[0]?.palettePreview).toEqual(["#5E6AD2", "#0E0F11"]);
  });

  it("keeps the LATEST brief per ritualId when multiple completed events arrive", () => {
    const second: BriefPayload = { ...sampleBrief, category: "marketing-site" };
    mockUseEventStream.mockReturnValue({
      events: [
        evt("researcher.brief.completed", "r-1", { brief: sampleBrief }, 100, 1),
        evt("researcher.brief.completed", "r-1", { brief: second }, 200, 2)
      ],
      status: "open",
      lastEventId: "p-1:2"
    });
    const { result } = renderHook(() => useResearcherBrief());
    expect(result.current.briefByRitualId["r-1"]?.category).toBe("marketing-site");
  });

  it("ignores events that are not researcher.brief.completed", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("role.completed", "r-1", { roleId: "architect" }, 100, 1),
        evt("researcher.brief.failed", "r-1", { error: "boom" }, 200, 2),
        evt("researcher.brief.started", "r-1", { category: "x" }, 300, 3)
      ],
      status: "open",
      lastEventId: "p-1:3"
    });
    const { result } = renderHook(() => useResearcherBrief());
    expect(result.current.briefByRitualId).toEqual({});
  });

  it("drops malformed brief payloads silently", () => {
    mockUseEventStream.mockReturnValue({
      events: [
        evt("researcher.brief.completed", "r-1", { brief: { /* missing category */ references: [] } }, 100, 1),
        evt("researcher.brief.completed", "r-2", { /* missing brief altogether */ }, 200, 2)
      ],
      status: "open",
      lastEventId: "p-1:2"
    });
    const { result } = renderHook(() => useResearcherBrief());
    expect(result.current.briefByRitualId).toEqual({});
  });

  it("partitions briefs across multiple rituals", () => {
    const briefB: BriefPayload = { ...sampleBrief, category: "docs-site" };
    mockUseEventStream.mockReturnValue({
      events: [
        evt("researcher.brief.completed", "r-1", { brief: sampleBrief }, 100, 1),
        evt("researcher.brief.completed", "r-2", { brief: briefB }, 200, 2)
      ],
      status: "open",
      lastEventId: "p-1:2"
    });
    const { result } = renderHook(() => useResearcherBrief());
    expect(result.current.briefByRitualId["r-1"]?.category).toBe("saas-landing");
    expect(result.current.briefByRitualId["r-2"]?.category).toBe("docs-site");
  });
});
