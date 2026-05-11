import { describe, it, expect, vi } from "vitest";
import { SpecEventsHydrator } from "@/lib/engine/spec-events-hydrator";

const ROW_STARTED = {
  id: BigInt(1),
  eventType: "ritual.started",
  payload: { ritualId: "r-1", ts: 1, projectId: "p-1", userId: "u-1" },
  actor: null
};

describe("SpecEventsHydrator — composes SpecEventRepo + replay (Plan H Task 8)", () => {
  it("returns a snapshot when listByRitual returns matching rows", async () => {
    const repo = { listByRitual: vi.fn(async () => [ROW_STARTED]) };
    const hyd = new SpecEventsHydrator(repo as never, "p-1");
    const snap = await hyd.hydrate("r-1");
    expect(snap?.projectId).toBe("p-1");
    expect(repo.listByRitual).toHaveBeenCalledWith("p-1", "r-1");
  });

  it("returns null when listByRitual returns []", async () => {
    const repo = { listByRitual: vi.fn(async () => []) };
    const hyd = new SpecEventsHydrator(repo as never, "p-1");
    expect(await hyd.hydrate("r-missing")).toBeNull();
  });

  it("returns null and logs when listByRitual rejects (degrades silently per Design Decision 6)", async () => {
    const repo = { listByRitual: vi.fn(async () => { throw new Error("RLS denied"); }) };
    const hyd = new SpecEventsHydrator(repo as never, "p-1");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hyd.hydrate("r-1")).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
