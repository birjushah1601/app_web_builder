import { describe, it, expect } from "vitest";
import "../src/artifact-contracts/backend-rest-api.js"; // ensures registry has the kind
import { _awaitRitualForTesting } from "../src/engine.js";

function makeRitualEngine(
  states: Array<{ state: string; roleEvents: Array<{ eventType: string; payload: unknown }> }>
) {
  let i = 0;
  return {
    async start() { return "ritual-1"; },
    async getRitual() {
      const s = states[Math.min(i, states.length - 1)]!;
      i++;
      return s;
    },
    async abort() {}
  };
}

const VALID_BACKEND = {
  schemaVersion: "1",
  kind: "backend-rest-api",
  openApiSpec: { openapi: "3.1.0", paths: {} },
  routes: [],
  envContract: [],
  sandboxId: "sb-1"
};

describe("awaitRitual (Plan D)", () => {
  it("returns the validated artifact when the ritual completes with a matching event", async () => {
    const re = makeRitualEngine([
      { state: "running", roleEvents: [] },
      {
        state: "completed",
        roleEvents: [
          { eventType: "ritual.artifact_emitted", payload: { fromRole: "backend-artifact", artifact: VALID_BACKEND } }
        ]
      }
    ]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1 });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("unreachable");
    expect(result.artifactKind).toBe("backend-rest-api");
    expect((result.artifact as { kind: string }).kind).toBe("backend-rest-api");
  });

  it("falls back to a synthesized generic artifact when no event was emitted", async () => {
    const re = makeRitualEngine([
      { state: "completed", roleEvents: [] }
    ]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "frontend-app", { pollMs: 1 });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") throw new Error("unreachable");
    expect(result.artifactKind).toBe("generic");
    expect((result.artifact as { kind: string }).kind).toBe("generic");
  });

  it("rejects with kind=failed when the ritual ends in failed state", async () => {
    const re = makeRitualEngine([{ state: "failed", roleEvents: [] }]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1 });
    expect(result.kind).toBe("failed");
  });

  it("rejects with kind=failed when the emitted artifact fails schema validation", async () => {
    const re = makeRitualEngine([
      {
        state: "completed",
        roleEvents: [
          { eventType: "ritual.artifact_emitted", payload: { fromRole: "x", artifact: { kind: "backend-rest-api", schemaVersion: "1" } } }
        ]
      }
    ]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1 });
    expect(result.kind).toBe("failed");
  });

  it("returns failed with a timeout error when getRitual never reaches terminal state", async () => {
    const re = makeRitualEngine([{ state: "running", roleEvents: [] }]);
    const result = await _awaitRitualForTesting(re, "ritual-1", "backend-rest-api", { pollMs: 1, timeoutMs: 20 });
    expect(result.kind).toBe("failed");
  });
});
