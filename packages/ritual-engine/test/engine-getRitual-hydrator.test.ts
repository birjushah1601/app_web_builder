import { describe, it, expect, vi } from "vitest";
import { RitualEngine, type RitualHydrator, type RitualSnapshot } from "../src/index.js";

function makeEngine(hydrator?: RitualHydrator) {
  return new RitualEngine({
    conductor: { dispatch: vi.fn() } as never,
    eventSink: { emit: vi.fn() } as never,
    personaPreferences: { resolveFor: vi.fn() } as never,
    hydrator
  });
}

const SNAP: RitualSnapshot = {
  state: "done",
  projectId: "p-1",
  userId: "u-1",
  roleEvents: [],
  artifact: { kind: "plan" }
};

describe("RitualEngine.getRitual — hydrator fallback (Plan H Task 7)", () => {
  it("returns undefined when ritualId is unknown AND no hydrator is configured (today's behavior)", async () => {
    const engine = makeEngine();
    expect(await engine.getRitual("r-missing")).toBeUndefined();
  });

  it("falls back to the hydrator when configured AND in-memory miss", async () => {
    const hydrator: RitualHydrator = { hydrate: vi.fn(async () => SNAP) };
    const engine = makeEngine(hydrator);
    const result = await engine.getRitual("r-missing");
    expect(result).toEqual(SNAP);
    expect(hydrator.hydrate).toHaveBeenCalledWith("r-missing");
  });

  it("returns undefined when hydrator returns null (corruption / unknown)", async () => {
    const hydrator: RitualHydrator = { hydrate: vi.fn(async () => null) };
    const engine = makeEngine(hydrator);
    expect(await engine.getRitual("r-missing")).toBeUndefined();
  });

  it("does NOT call hydrator when in-memory hit (no extra DB read on warm path)", async () => {
    const hydrator: RitualHydrator = { hydrate: vi.fn(async () => SNAP) };
    const engine = makeEngine(hydrator);
    // Manually seed the in-memory map by reaching into the private field
    // for test purposes — simulates the engine having dispatched a ritual.
    (engine as unknown as { rituals: Map<string, unknown> }).rituals.set("r-warm", {
      state: "visualize",
      projectId: "p",
      userId: "u",
      roleEvents: []
    });
    const result = await engine.getRitual("r-warm");
    expect(result).toBeDefined();
    expect(hydrator.hydrate).not.toHaveBeenCalled();
  });
});
