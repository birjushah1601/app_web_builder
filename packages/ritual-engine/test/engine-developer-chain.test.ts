import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/engine.js";
import { InMemoryEventSink } from "../src/events.js";
import type { Conductor, DispatchOptions, DispatchContext } from "@atlas/conductor";
import type { SandboxApplier, SandboxApplyResult } from "../src/engine.js";

const VALID_HASH = "sha256:" + "0".repeat(64);
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const ARCHITECT_ARTIFACT = {
  scope: "new-feature" as const,
  diffPlan: { summary: "add forgot-password", tasks: [{ title: "form" }] },
  graphSlice: { bytes: "{}", hash: VALID_HASH }
};

const DEVELOPER_DIFF =
  "diff --git a/src/login.tsx b/src/login.tsx\n--- a/src/login.tsx\n+++ b/src/login.tsx\n@@ -0,0 +1,3 @@\n+export function Login() {}\n";

/** Build a Conductor that hands back architect output on the first dispatch
 *  call and the supplied developer behavior on the second. Verifies the engine
 *  routes the second call with forceRoleId="developer" + priorArtifact. */
function chainConductor(opts: {
  developerOutput?: { events: Array<{ eventType: string; payload: unknown }>; diff: { kind: "patch"; body: string } | { kind: "none" } };
  developerThrow?: Error;
}): Conductor {
  const dispatch = vi.fn(async (_ctx: DispatchContext, options: DispatchOptions = {}) => {
    if (options.forceRoleId === "developer") {
      if (opts.developerThrow) throw opts.developerThrow;
      return {
        roleId: "developer",
        attempts: 1,
        output: opts.developerOutput ?? {
          events: [{ eventType: "developer.completed", payload: { summary: "wrote login form" } }],
          diff: { kind: "patch" as const, body: DEVELOPER_DIFF }
        }
      };
    }
    // First call (no forceRoleId) — return architect output
    return {
      roleId: "architect",
      attempts: 1,
      output: {
        events: [
          { eventType: "architect.pass1.completed", payload: { passed: true, scope: "new-feature" } },
          { eventType: "architect.pass2.completed", payload: { scope: "new-feature", artifact: ARCHITECT_ARTIFACT } }
        ],
        diff: { kind: "none" as const }
      }
    };
  });
  return { dispatch } as unknown as Conductor;
}

function makeEngine(conductor: Conductor) {
  return new RitualEngine({
    conductor,
    eventSink: new InMemoryEventSink(),
    personaPreferences: { async getPersona() { return "diego"; } }
  });
}

describe("RitualEngine — architect → developer chain (plan B)", () => {
  it("dispatches developer with forceRoleId + priorArtifact = architect's artifact", async () => {
    const conductor = chainConductor({});
    const engine = makeEngine(conductor);

    await engine.start({
      userTurn: "add login",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const dispatch = conductor.dispatch as unknown as ReturnType<typeof vi.fn>;
    expect(dispatch).toHaveBeenCalledTimes(2);

    // First call: architect (no forceRoleId)
    const [, firstOpts] = dispatch.mock.calls[0]!;
    expect(firstOpts?.forceRoleId).toBeUndefined();

    // Second call: developer with priorArtifact
    const [, secondOpts] = dispatch.mock.calls[1]!;
    expect(secondOpts?.forceRoleId).toBe("developer");
    expect(secondOpts?.priorArtifact).toEqual(ARCHITECT_ARTIFACT);
  });

  it("captures developerOutput { diff, summary } into the ritual snapshot", async () => {
    const conductor = chainConductor({});
    const engine = makeEngine(conductor);

    const ritualId = await engine.start({
      userTurn: "add login",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const snapshot = await engine.getRitual(ritualId);
    expect(snapshot?.developerOutput?.diff).toBe(DEVELOPER_DIFF);
    expect(snapshot?.developerOutput?.summary).toBe("wrote login form");
  });

  it("snapshot.roleEvents concatenates events from BOTH dispatches in order", async () => {
    const conductor = chainConductor({});
    const engine = makeEngine(conductor);

    const ritualId = await engine.start({
      userTurn: "add login",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const snapshot = await engine.getRitual(ritualId);
    const types = (snapshot?.roleEvents ?? []).map((e) => e.eventType);
    expect(types).toEqual([
      "architect.pass1.completed",
      "architect.pass2.completed",
      "developer.completed"
    ]);
  });

  it("when developer dispatch throws, ritual completes and developer.dispatch.failed event is recorded", async () => {
    const conductor = chainConductor({ developerThrow: new Error("unknown role: developer") });
    const engine = makeEngine(conductor);

    // Critical: this should NOT throw — developer failures are caught,
    // architect plan still surfaces to the user.
    const ritualId = await engine.start({
      userTurn: "add login",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const snapshot = await engine.getRitual(ritualId);
    // Developer never produced output
    expect(snapshot?.developerOutput).toBeUndefined();
    // Architect artifact still made it through
    expect(snapshot?.artifact).toEqual(ARCHITECT_ARTIFACT);
    // Synthetic event captures the cause
    const failedEvent = snapshot?.roleEvents.find((e) => e.eventType === "developer.dispatch.failed");
    expect(failedEvent).toBeDefined();
    expect((failedEvent?.payload as { error?: string }).error).toContain("unknown role: developer");
  });

  it("cosmetic edit-class skips developer dispatch entirely", async () => {
    const conductor = chainConductor({});
    const engine = makeEngine(conductor);

    await engine.start({
      userTurn: "tweak the button color",
      editClass: "cosmetic",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const dispatch = conductor.dispatch as unknown as ReturnType<typeof vi.fn>;
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [, opts] = dispatch.mock.calls[0]!;
    expect(opts?.forceRoleId).toBeUndefined();
  });

  it("architect with no artifact (triage blocked) skips developer dispatch", async () => {
    const conductor = {
      dispatch: vi.fn(async () => ({
        roleId: "architect",
        attempts: 1,
        output: {
          events: [
            { eventType: "architect.pass1.completed", payload: { passed: false, scope: "new-feature" } },
            { eventType: "architect.triage.needs_input", payload: { question: "Which framework?", reason: "" } }
          ],
          // No pass2.completed → no artifact extracted
          diff: { kind: "none" as const }
        }
      }))
    } as unknown as Conductor;
    const engine = makeEngine(conductor);

    const ritualId = await engine.start({
      userTurn: "build something",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const dispatch = conductor.dispatch as unknown as ReturnType<typeof vi.fn>;
    expect(dispatch).toHaveBeenCalledTimes(1); // only architect, no developer
    const snapshot = await engine.getRitual(ritualId);
    expect(snapshot?.artifact).toBeUndefined();
    expect(snapshot?.developerOutput).toBeUndefined();
    // Triage questions still preserved for the UI
    expect(snapshot?.roleEvents.find((e) => e.eventType === "architect.triage.needs_input")).toBeDefined();
  });

  it("developer dispatch with diff.kind='none' (no patch produced) leaves developerOutput unset", async () => {
    const conductor = chainConductor({
      developerOutput: {
        events: [{ eventType: "developer.completed", payload: { summary: "no changes needed" } }],
        diff: { kind: "none" as const }
      }
    });
    const engine = makeEngine(conductor);

    const ritualId = await engine.start({
      userTurn: "x",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const snapshot = await engine.getRitual(ritualId);
    // diff.kind="none" → no developerOutput record (pattern: no patch, no display)
    expect(snapshot?.developerOutput).toBeUndefined();
    // Events still flow through for diagnostics
    expect(snapshot?.roleEvents.find((e) => e.eventType === "developer.completed")).toBeDefined();
  });
});

const VALID_APPLY: SandboxApplyResult = {
  ok: true,
  parsed: 2,
  written: 2,
  failed: 0,
  skipped: 0,
  files: [
    { path: "src/login.tsx", status: "written", bytesWritten: 50 },
    { path: "src/auth.ts", status: "written", bytesWritten: 30 }
  ]
};

function applierThat(behaviour: () => Promise<SandboxApplyResult>): SandboxApplier {
  return { apply: vi.fn(async () => behaviour()) };
}

function makeEngineWithApplier(conductor: Conductor, applier: SandboxApplier) {
  return new RitualEngine({
    conductor,
    eventSink: new InMemoryEventSink(),
    personaPreferences: { async getPersona() { return "diego"; } },
    sandboxApplier: applier
  });
}

describe("RitualEngine — sandbox apply (plan C)", () => {
  it("calls applier.apply(projectId, diff) when developer produced a diff", async () => {
    const conductor = chainConductor({});
    const apply = vi.fn(async () => VALID_APPLY);
    const engine = makeEngineWithApplier(conductor, { apply });

    const ritualId = await engine.start({
      userTurn: "add login",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(PROJECT_ID, DEVELOPER_DIFF);
    const snapshot = await engine.getRitual(ritualId);
    expect(snapshot?.sandboxApplyResult).toEqual(VALID_APPLY);
  });

  it("does NOT call applier when developer produced no diff (diff.kind=none)", async () => {
    const conductor = chainConductor({
      developerOutput: {
        events: [{ eventType: "developer.completed", payload: { summary: "no changes" } }],
        diff: { kind: "none" as const }
      }
    });
    const apply = vi.fn();
    const engine = makeEngineWithApplier(conductor, { apply: apply as never });

    await engine.start({
      userTurn: "x",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    expect(apply).not.toHaveBeenCalled();
  });

  it("ritual still completes when applier returns ok:false (no throw, snapshot captures the failure)", async () => {
    const failApply: SandboxApplyResult = {
      ok: false, parsed: 1, written: 0, failed: 0, skipped: 0,
      files: [], parseError: "sandbox unavailable: ECONNREFUSED"
    };
    const conductor = chainConductor({});
    const engine = makeEngineWithApplier(conductor, applierThat(async () => failApply));

    const ritualId = await engine.start({
      userTurn: "x",
      editClass: "structural",
      projectId: PROJECT_ID,
      userId: "u-1"
    });

    const snapshot = await engine.getRitual(ritualId);
    expect(snapshot?.sandboxApplyResult).toEqual(failApply);
    expect(snapshot?.developerOutput?.diff).toBe(DEVELOPER_DIFF);
  });
});
