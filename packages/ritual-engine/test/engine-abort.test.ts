import { describe, it, expect } from "vitest";
import { Conductor, type Role, RitualAbortedError } from "@atlas/conductor";
import { RitualEngine } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";

const personaPrefs = { getPersona: async () => "diego" as const };

/** Plan A Task 9 — RitualEngine.abort() integration with Conductor.
 *  abort() marks the ritualId; conductor's isAborted hook causes the next
 *  role-attempt to throw RitualAbortedError; engine catches the unwind and
 *  marks the ritual escalated without emitting artifact_emitted. */
describe("RitualEngine.abort", () => {
  it("aborts mid-ritual: future role attempts throw RitualAbortedError; engine returns cleanly with escalated state", async () => {
    const sink = new InMemoryEventSink();
    let architectStarts = 0;
    const slowArchitect: Role = {
      id: "architect",
      async run() {
        architectStarts++;
        // Stall long enough that the outer abort() can land before completion.
        await new Promise((r) => setTimeout(r, 100));
        return {
          events: [
            { eventType: "architect.pass1.started", payload: {} },
            { eventType: "architect.pass1.completed", payload: { passed: true, scope: "new-app" } },
            { eventType: "architect.pass2.started", payload: {} },
            {
              eventType: "architect.pass2.completed",
              payload: {
                artifact: {
                  scope: "new-app",
                  specGraph: {},
                  runnablePlan: { tasks: [] },
                  graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
                }
              }
            }
          ],
          diff: { kind: "none" as const }
        };
      }
    };

    let engine!: RitualEngine;
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([["architect", slowArchitect]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) }),
      // Forward-declared lazy ref to mirror atlas-web/lib/engine/factory.ts.
      isAborted: (id) => engine?.isAborted(id) ?? false
    });

    engine = new RitualEngine({
      conductor,
      eventSink: sink,
      personaPreferences: personaPrefs,
      ritualMode: "fast"
    });

    const runPromise = engine.start({
      userTurn: "x",
      editClass: "structural",
      projectId: "00000000-0000-0000-0000-000000000001",
      userId: "u1"
    });

    // Let the first architect attempt start (it sleeps 100ms), then abort.
    await new Promise((r) => setTimeout(r, 25));
    const ritualIds = Array.from((engine as unknown as { rituals: Map<string, unknown> }).rituals.keys());
    expect(ritualIds.length).toBe(1);
    const ritualId = ritualIds[0]!;
    await engine.abort(ritualId, "test-cancel");

    const returned = await runPromise;
    expect(returned).toBe(ritualId);

    // The architect's in-flight attempt ran to completion (we can't kill the
    // promise mid-flight), but no further attempts happened.
    expect(architectStarts).toBeGreaterThanOrEqual(1);
    expect(architectStarts).toBeLessThanOrEqual(1);

    const snapshot = await engine.getRitual(ritualId);
    expect(snapshot?.state).toBe("escalated");
    expect(sink.events().some((e) => e.type === "ritual.escalation_requested")).toBe(true);
    expect(sink.events().some((e) => e.type === "ritual.artifact_emitted")).toBe(false);
  });

  it("isAborted returns false for unknown / un-aborted ritualIds; true after abort()", async () => {
    const engine = new RitualEngine({
      conductor: new Conductor({
        classifier: { classify: async () => ({ roleId: "x", confidence: 1 }) },
        roles: new Map(),
        checkpointSink: { emit: async () => {} },
        sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
      }),
      eventSink: new InMemoryEventSink(),
      personaPreferences: personaPrefs
    });
    expect(engine.isAborted("never-existed")).toBe(false);
    await engine.abort("never-existed", "test");
    expect(engine.isAborted("never-existed")).toBe(true);
  });

  it("conductor throws RitualAbortedError when isAborted returns true before role.run", async () => {
    const role: Role = {
      id: "architect",
      async run() {
        throw new Error("role.run should not be called when ritual is aborted before the attempt");
      }
    };
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([["architect", role]]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) }),
      isAborted: () => true
    });
    await expect(
      conductor.dispatch({
        ritualId: "r-x" as unknown as Parameters<typeof conductor.dispatch>[0]["ritualId"],
        graphVersion: 0,
        userTurn: "x",
        projectId: "00000000-0000-0000-0000-000000000001"
      })
    ).rejects.toBeInstanceOf(RitualAbortedError);
  });
});
