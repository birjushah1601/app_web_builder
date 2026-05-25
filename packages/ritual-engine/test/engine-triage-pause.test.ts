import { describe, it, expect, vi } from "vitest";
import { Conductor, type Role, type RoleInvocation } from "@atlas/conductor";
import { RitualEngine, CanvasPauseRegistry } from "../src/index.js";
import { InMemoryEventSink } from "../src/events.js";

const personaPrefs = { getPersona: async () => "diego" as const };

/** Plan U slice 3b — engine-level pause-and-resume on architect pass-1's
 *  blocker questions. When pass-1 emits `architect.triage.needs_input` the
 *  engine MUST pause `_runRitual`, await `waitForTriageClarifications`, then
 *  re-dispatch architect with the user's answers folded into userTurn so
 *  pass-2 produces an artifact. Without this branch the ritual halts at
 *  pass-1 with no artifact and the developer never runs. */
describe("Engine triage clarification pause (Plan U slice 3b)", () => {
  function buildArchitect(opts: { firstNeedsInput: boolean }): {
    role: Role;
    calls: Array<{ userTurn: string; priorArtifact: unknown }>;
  } {
    const calls: Array<{ userTurn: string; priorArtifact: unknown }> = [];
    let firstCall = true;
    const role: Role = {
      id: "architect",
      async run(inv: RoleInvocation) {
        calls.push({ userTurn: inv.userTurn, priorArtifact: inv.priorArtifact });
        if (firstCall && opts.firstNeedsInput) {
          firstCall = false;
          return {
            events: [
              { eventType: "architect.pass1.started", payload: { ritualId: inv.ritualId } },
              {
                eventType: "architect.pass1.completed",
                payload: { passed: false, scope: "new-app", hintApplied: false }
              },
              {
                eventType: "architect.triage.needs_input",
                payload: {
                  question: "Does the app store personally identifiable information?",
                  reason: "Affects compliance scope",
                  widgetKind: "yes-no"
                }
              }
            ],
            diff: { kind: "none" as const }
          };
        }
        // Second-pass branch (or first-pass when firstNeedsInput=false) returns
        // the artifact directly. Skip canvasManifest so the canvas-flow branch
        // is a no-op and the test stays focused on the triage pause.
        return {
          events: [
            { eventType: "architect.pass1.started", payload: { ritualId: inv.ritualId } },
            { eventType: "architect.pass1.completed", payload: { passed: true, scope: "new-app" } },
            { eventType: "architect.pass2.started", payload: { scope: "new-app" } },
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
    return { role, calls };
  }

  function buildEngine(architectRole: Role, opts: { canvasPauseTimeoutMs: number; registry: CanvasPauseRegistry }) {
    const sink = new InMemoryEventSink();
    const developerRun = vi.fn();
    const developer: Role = {
      id: "developer",
      async run(inv) {
        developerRun(inv);
        return { events: [], diff: { kind: "none" as const } };
      }
    };
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "architect", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["architect", architectRole],
        ["developer", developer]
      ]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });
    const engine = new RitualEngine({
      conductor,
      eventSink: sink,
      personaPreferences: personaPrefs,
      canvasPauseRegistry: opts.registry,
      canvasPauseTimeoutMs: opts.canvasPauseTimeoutMs,
      ritualMode: "fast"
    });
    return { engine, sink, developerRun };
  }

  it("pauses on needs_input → resumes on resolveTriageClarifications → re-dispatches architect with answers", async () => {
    const reg = new CanvasPauseRegistry();
    const { role, calls } = buildArchitect({ firstNeedsInput: true });
    const { engine, sink, developerRun } = buildEngine(role, {
      canvasPauseTimeoutMs: 10_000,
      registry: reg
    });

    // Race: poll the registry until it has a pending waiter, then resolve.
    // The engine's _runRitual await is what registers the waiter, so the
    // poll guarantees we don't resolve before the engine paused.
    let resolved = false;
    const resumePromise = (async () => {
      while (reg.pendingCount() === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      resolved = true;
      reg.resolveTriageClarifications("__capture__", { q0: "No" });
    })();
    // The ritualId is generated inside engine.start; capture it via the
    // pending event before resolving. Easier path: intercept via the sink.
    const runPromise = engine.start({
      userTurn: "Build a marketing site for a coffee shop",
      editClass: "structural",
      projectId: "p1",
      userId: "u1"
    });

    // Wait for the awaiting_clarification event to land in the sink, grab
    // the ritualId, then resolve via the real ritualId.
    let realRitualId: string | undefined;
    while (!realRitualId) {
      await new Promise((r) => setTimeout(r, 5));
      const ev = sink.events().find((e) => e.type === "ritual.triage.awaiting_clarification");
      if (ev) realRitualId = ev.ritualId;
    }
    reg.resolveTriageClarifications(realRitualId, { q0: "No" });
    // Pull the bogus race-promise to completion so vitest doesn't warn.
    await resumePromise.catch(() => {});

    await runPromise;
    void resolved;

    // Architect was dispatched twice.
    expect(calls).toHaveLength(2);
    // Second call's userTurn carries the original prompt + the clarifications block.
    expect(calls[1]!.userTurn).toContain("Build a marketing site for a coffee shop");
    expect(calls[1]!.userTurn).toContain("USER CLARIFICATIONS");
    expect(calls[1]!.userTurn).toContain("Does the app store personally identifiable information?");
    expect(calls[1]!.userTurn).toContain("→ No");

    // Engine emitted both pause-lifecycle events.
    expect(sink.events().some((e) => e.type === "ritual.triage.awaiting_clarification")).toBe(true);
    const resolvedEv = sink.events().find((e) => e.type === "ritual.triage.clarification_resolved");
    expect(resolvedEv).toBeDefined();
    expect((resolvedEv!.payload as { autoResolved: boolean }).autoResolved).toBe(false);
    expect((resolvedEv!.payload as { answers: Record<string, string> }).answers).toEqual({ q0: "No" });

    // Developer ran (because artifact materialized after the re-dispatch).
    expect(developerRun).toHaveBeenCalledTimes(1);
  });

  it("times out → re-dispatches architect with fallback (empty answers → 'sensible defaults')", async () => {
    const reg = new CanvasPauseRegistry();
    const { role, calls } = buildArchitect({ firstNeedsInput: true });
    const { engine, sink } = buildEngine(role, {
      canvasPauseTimeoutMs: 30,
      registry: reg
    });

    await engine.start({
      userTurn: "Build something",
      editClass: "structural",
      projectId: "p1",
      userId: "u1"
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.userTurn).toContain("(use sensible defaults)");
    const resolvedEv = sink.events().find((e) => e.type === "ritual.triage.clarification_resolved");
    expect(resolvedEv).toBeDefined();
    expect((resolvedEv!.payload as { autoResolved: boolean }).autoResolved).toBe(true);
  });

  it("does NOT pause when pass-1 passes on first dispatch (no needs_input events)", async () => {
    const reg = new CanvasPauseRegistry();
    const { role, calls } = buildArchitect({ firstNeedsInput: false });
    const { engine, sink } = buildEngine(role, {
      canvasPauseTimeoutMs: 10_000,
      registry: reg
    });

    await engine.start({
      userTurn: "Build a site",
      editClass: "structural",
      projectId: "p1",
      userId: "u1"
    });

    expect(calls).toHaveLength(1);
    expect(sink.events().some((e) => e.type === "ritual.triage.awaiting_clarification")).toBe(false);
  });
});
