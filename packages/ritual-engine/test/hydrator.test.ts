import { describe, it, expect } from "vitest";
import { replayEventsToSnapshot, type SpecEventRowLike } from "../src/hydrator.js";

function row(id: bigint, eventType: string, payload: object): SpecEventRowLike {
  return { id, eventType, payload, actor: null };
}

describe("replayEventsToSnapshot — pure fold (Plan H Tasks 3-5)", () => {
  it("returns null when the row list is empty", () => {
    expect(replayEventsToSnapshot([])).toBeNull();
  });

  it("returns null when the first event is NOT ritual.started (corruption / partial)", () => {
    const rows = [row(1n, "role.completed", { ritualId: "r-1", ts: 1 })];
    expect(replayEventsToSnapshot(rows)).toBeNull();
  });

  it("returns null when ritual.started payload lacks projectId or userId", () => {
    const rows = [row(1n, "ritual.started", { ritualId: "r-1", ts: 1 })];
    expect(replayEventsToSnapshot(rows)).toBeNull();
  });

  it("seeds projectId/userId/state from ritual.started payload", () => {
    const rows = [
      row(1n, "ritual.started", {
        ritualId: "r-1",
        ts: 1,
        intent: "build a thing",
        editClass: "structural",
        projectId: "p-1",
        userId: "u-1"
      })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap).not.toBeNull();
    expect(snap!.state).toBe("visualize");
    expect(snap!.projectId).toBe("p-1");
    expect(snap!.userId).toBe("u-1");
    expect(snap!.roleEvents).toEqual([]);
  });

  it("collects every role event into roleEvents in order", () => {
    const rows = [
      row(1n, "ritual.started", { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "role.started",   { ritualId: "r-1", ts: 2, role: "architect" }),
      row(3n, "role.completed", { ritualId: "r-1", ts: 3, role: "architect" })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.roleEvents.length).toBe(2);
    expect(snap!.roleEvents[0]!.eventType).toBe("role.started");
    expect(snap!.roleEvents[1]!.eventType).toBe("role.completed");
  });

  it("captures artifact from architect.*.pass2.completed payload", () => {
    const rows = [
      row(1n, "ritual.started",            { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "architect.pass2.completed", { ritualId: "r-1", ts: 2, artifact: { kind: "plan", graphSlice: {} } })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.artifact).toEqual({ kind: "plan", graphSlice: {} });
  });

  it("captures developerOutput from developer.completed payload", () => {
    const rows = [
      row(1n, "ritual.started",      { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "developer.completed", { ritualId: "r-1", ts: 2, diff: "diff --git a/x b/x", summary: "x" })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.developerOutput).toEqual({ diff: "diff --git a/x b/x", summary: "x" });
  });

  it("the latest matching event wins when the same field is emitted twice (last-write semantics)", () => {
    const rows = [
      row(1n, "ritual.started",            { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "architect.pass2.completed", { ritualId: "r-1", ts: 2, artifact: { kind: "first" } }),
      row(3n, "architect.pass2.completed", { ritualId: "r-1", ts: 3, artifact: { kind: "retry" } })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.artifact).toEqual({ kind: "retry" });
  });

  it("captures sandboxApplyResult from sandbox.apply.completed payload", () => {
    const rows = [
      row(1n, "ritual.started",          { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "sandbox.apply.completed", { ritualId: "r-1", ts: 2, ok: true, parsed: 1, written: 1, failed: 0, skipped: 0, files: [] })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.sandboxApplyResult?.ok).toBe(true);
    expect(snap!.sandboxApplyResult?.written).toBe(1);
  });

  it("flips state to 'escalated' when ritual.escalated event is replayed", () => {
    const rows = [
      row(1n, "ritual.started",   { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "ritual.escalated", { ritualId: "r-1", ts: 2, gate: "L4", cause: "secret leaked" })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.state).toBe("escalated");
  });

  it("flips state to 'done' when ritual.completed is replayed (terminal state in RitualStateSchema)", () => {
    const rows = [
      row(1n, "ritual.started",   { ritualId: "r-1", ts: 1, projectId: "p", userId: "u" }),
      row(2n, "ritual.completed", { ritualId: "r-1", ts: 2 })
    ];
    const snap = replayEventsToSnapshot(rows);
    expect(snap!.state).toBe("done");
  });
});
