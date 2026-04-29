import { describe, it, expect, expectTypeOf } from "vitest";
import {
  initialTimelineState,
  timelineReducer,
  type Phase,
  type RowState,
  type TimelineState
} from "@/lib/ritual/timelineReducer";

describe("TimelineState — types and initial value", () => {
  it("Phase is the 5-value union (Plan P added security + accessibility for gate rows)", () => {
    expectTypeOf<Phase>().toEqualTypeOf<"architect" | "developer" | "sandbox" | "security" | "accessibility">();
  });

  it("RowState has the expected shape", () => {
    expectTypeOf<RowState>().toEqualTypeOf<{
      phase: Phase;
      status: "pending" | "active" | "done" | "failed";
      retries: number;
      lastError?: string;
      durationMs?: number;
      startedAt?: number;
      meta?: { winner?: string; filesWritten?: number };
    }>();
  });

  it("TimelineState has rows + escalated + Plan P autoFix fields", () => {
    expectTypeOf<TimelineState>().toEqualTypeOf<{
      rows: Record<Phase, RowState>;
      escalated: boolean;
      autoFixAttempts: number;
      autoFixExhausted: boolean;
      autoFixFailed?: string;
    }>();
  });

  it("initialTimelineState has all 3 rows pending, escalated=false", () => {
    expect(initialTimelineState.escalated).toBe(false);
    expect(initialTimelineState.rows.architect.status).toBe("pending");
    expect(initialTimelineState.rows.developer.status).toBe("pending");
    expect(initialTimelineState.rows.sandbox.status).toBe("pending");
    expect(initialTimelineState.rows.architect.retries).toBe(0);
    expect(initialTimelineState.rows.architect.phase).toBe("architect");
    expect(initialTimelineState.rows.sandbox.phase).toBe("sandbox");
  });

  it("initialTimelineState is frozen (cannot be mutated by careless code)", () => {
    expect(() => {
      (initialTimelineState as { escalated: boolean }).escalated = true;
    }).toThrow();
  });

  it("timelineReducer is callable with the initial state and an unknown event (no-op)", () => {
    const out = timelineReducer(initialTimelineState, {
      id: "x:1",
      projectId: "p-1",
      ritualId: "r-1",
      type: "stream.gap" as never,
      payload: {},
      ts: 1
    });
    expect(out).toBe(initialTimelineState); // unchanged reference for unknown type
  });
});

import type { RitualEvent, RitualEventType } from "@/lib/events/EventBroker";

/** Build a RitualEvent for table-driven tests with sane defaults. */
function evt(type: RitualEventType, payload: Record<string, unknown> = {}, ts = 1_000): RitualEvent {
  return { id: `p-1:${ts}`, projectId: "p-1", ritualId: "r-1", type, payload, ts };
}

describe("timelineReducer — ritual.* events", () => {
  it("ritual.started returns initialTimelineState (resets prior runs)", () => {
    const polluted: TimelineState = {
      escalated: true,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 5 },
        developer: { phase: "developer", status: "failed", retries: 1 },
        sandbox:   { phase: "sandbox",   status: "active", retries: 0 },
        security:      { phase: "security",      status: "pending", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    };
    const out = timelineReducer(polluted, evt("ritual.started"));
    expect(out).toEqual(initialTimelineState);
  });

  it("ritual.escalated flips state.escalated to true (rows untouched)", () => {
    const before: TimelineState = {
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 0, durationMs: 1200 },
        developer: { phase: "developer", status: "active", retries: 1 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 },
        security:      { phase: "security",      status: "pending", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.escalated", { gate: "ritual" }));
    expect(after.escalated).toBe(true);
    expect(after.rows).toEqual(before.rows); // rows unchanged
  });

  it("ritual.completed marks all non-failed pending|active rows as done", () => {
    const before: TimelineState = {
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 0, durationMs: 1200 },
        developer: { phase: "developer", status: "active", retries: 0, startedAt: 500 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 },
        security:      { phase: "security",      status: "pending", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.completed", {}, 2_000));
    expect(after.rows.architect.status).toBe("done");
    expect(after.rows.developer.status).toBe("done");
    expect(after.rows.sandbox.status).toBe("done");
    expect(after.rows.developer.durationMs).toBe(1_500); // 2000 - 500
  });

  it("ritual.completed leaves a failed row failed", () => {
    const before: TimelineState = {
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect: { phase: "architect", status: "failed", retries: 2, lastError: "oops" },
        developer: { phase: "developer", status: "pending", retries: 0 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 },
        security:      { phase: "security",      status: "pending", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.completed"));
    expect(after.rows.architect.status).toBe("failed");
    expect(after.rows.architect.lastError).toBe("oops");
  });
});

describe("timelineReducer — role.* events for architect", () => {
  it("role.started with payload.role='architect' marks architect active + stamps startedAt", () => {
    const out = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_500));
    expect(out.rows.architect.status).toBe("active");
    expect(out.rows.architect.startedAt).toBe(1_500);
    expect(out.rows.developer.status).toBe("pending");
  });

  it("role.completed with payload.role='architect' marks architect done + computes durationMs", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_000));
    const after2 = timelineReducer(after1, evt("role.completed", { role: "architect" }, 2_200));
    expect(after2.rows.architect.status).toBe("done");
    expect(after2.rows.architect.durationMs).toBe(1_200);
  });

  it("role.failed with payload.role='architect' marks architect failed + stores error string", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_000));
    const after2 = timelineReducer(after1, evt("role.failed", { role: "architect", error: "schema mismatch" }, 1_500));
    expect(after2.rows.architect.status).toBe("failed");
    expect(after2.rows.architect.lastError).toBe("schema mismatch");
    expect(after2.rows.architect.durationMs).toBe(500);
  });

  it("role.retrying with payload.role='architect' increments retries + stores last error", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "architect" }, 1_000));
    const after2 = timelineReducer(after1, evt("role.retrying", { role: "architect", error: "timeout 300s" }, 1_400));
    expect(after2.rows.architect.retries).toBe(1);
    expect(after2.rows.architect.lastError).toBe("timeout 300s");
    expect(after2.rows.architect.status).toBe("active"); // still in flight
  });

  // Regression: production conductor (packages/conductor/src/conductor.ts)
  // emits role.* checkpoints with `roleId`, not `role`. The reducer must
  // accept both — without this, the SSE pipeline delivers events but no
  // rows ever flip out of pending.
  it("role.started/completed with payload.roleId (conductor's actual key) light up rows", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { roleId: "architect" }, 1_000));
    expect(after1.rows.architect.status).toBe("active");
    expect(after1.rows.architect.startedAt).toBe(1_000);
    const after2 = timelineReducer(after1, evt("role.completed", { roleId: "architect" }, 2_500));
    expect(after2.rows.architect.status).toBe("done");
    expect(after2.rows.architect.durationMs).toBe(1_500);
  });
});

describe("timelineReducer — role.* events for developer", () => {
  it("role.started with payload.role='developer' marks developer active", () => {
    const after = timelineReducer(initialTimelineState, evt("role.started", { role: "developer" }, 3_000));
    expect(after.rows.developer.status).toBe("active");
    expect(after.rows.developer.startedAt).toBe(3_000);
    expect(after.rows.architect.status).toBe("pending"); // untouched
  });

  it("role.completed with payload.role='developer' surfaces meta.winner + meta.filesWritten", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "developer" }, 3_000));
    const after2 = timelineReducer(
      after1,
      evt("role.completed", { role: "developer", winner: "anthropic", filesWritten: 6 }, 11_400)
    );
    expect(after2.rows.developer.status).toBe("done");
    expect(after2.rows.developer.meta).toEqual({ winner: "anthropic", filesWritten: 6 });
    expect(after2.rows.developer.durationMs).toBe(8_400);
  });

  it("role.retrying with payload.role='developer' increments developer retries (architect untouched)", () => {
    const after1 = timelineReducer(initialTimelineState, evt("role.started", { role: "developer" }, 3_000));
    const after2 = timelineReducer(after1, evt("role.retrying", { role: "developer", error: "rate limit" }, 3_200));
    expect(after2.rows.developer.retries).toBe(1);
    expect(after2.rows.architect.retries).toBe(0);
  });

  it("role events with no payload.role and no prior active row are no-ops", () => {
    const after = timelineReducer(initialTimelineState, evt("role.started", {}, 1_000));
    expect(after).toBe(initialTimelineState);
  });
});

describe("timelineReducer — sandbox.* events", () => {
  it("sandbox.provisioning marks sandbox active + stamps startedAt", () => {
    const after = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    expect(after.rows.sandbox.status).toBe("active");
    expect(after.rows.sandbox.startedAt).toBe(4_000);
  });

  it("sandbox.provisioned marks sandbox active (still working — apply not yet started)", () => {
    const after1 = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const after2 = timelineReducer(after1, evt("sandbox.provisioned", { sandboxId: "sbx-1" }, 4_500));
    // We treat provisioned as "still active" — the row only completes on
    // sandbox.apply.completed. provisioned is a checkpoint, not a finish line.
    expect(after2.rows.sandbox.status).toBe("active");
    expect(after2.rows.sandbox.startedAt).toBe(4_000); // unchanged
  });

  it("sandbox.apply.started keeps sandbox active (or activates it if pending) + bumps startedAt only when pending", () => {
    // Case 1: row already active from provisioning — startedAt sticks
    const provisioning = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const applyStarted1 = timelineReducer(provisioning, evt("sandbox.apply.started", {}, 5_000));
    expect(applyStarted1.rows.sandbox.status).toBe("active");
    expect(applyStarted1.rows.sandbox.startedAt).toBe(4_000); // sticks

    // Case 2: never provisioned (rare — manual apply) — activate now
    const applyStarted2 = timelineReducer(initialTimelineState, evt("sandbox.apply.started", {}, 5_000));
    expect(applyStarted2.rows.sandbox.status).toBe("active");
    expect(applyStarted2.rows.sandbox.startedAt).toBe(5_000);
  });

  it("sandbox.apply.completed with payload.ok=true marks sandbox done + records filesWritten in meta", () => {
    const after1 = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const after2 = timelineReducer(after1, evt("sandbox.apply.completed", { ok: true, filesWritten: 6 }, 6_500));
    expect(after2.rows.sandbox.status).toBe("done");
    expect(after2.rows.sandbox.durationMs).toBe(2_500);
    expect(after2.rows.sandbox.meta).toEqual({ filesWritten: 6 });
  });

  it("sandbox.apply.completed with payload.ok=false marks sandbox failed + stores error", () => {
    const after1 = timelineReducer(initialTimelineState, evt("sandbox.provisioning", {}, 4_000));
    const after2 = timelineReducer(
      after1,
      evt("sandbox.apply.completed", { ok: false, parseError: "hunk mismatch in /code/src/page.tsx" }, 6_500)
    );
    expect(after2.rows.sandbox.status).toBe("failed");
    expect(after2.rows.sandbox.lastError).toBe("hunk mismatch in /code/src/page.tsx");
    expect(after2.rows.sandbox.durationMs).toBe(2_500);
  });
});

describe("timelineReducer — full happy-path event sequence", () => {
  it("Architect → Developer → Sandbox produces 3 done rows, no escalation", () => {
    const events: RitualEvent[] = [
      evt("ritual.started", {}, 100),
      evt("role.started", { role: "architect" }, 200),
      evt("role.completed", { role: "architect" }, 1_400),
      evt("role.started", { role: "developer" }, 1_500),
      evt("role.completed", { role: "developer", winner: "anthropic", filesWritten: 6 }, 9_900),
      evt("sandbox.provisioning", {}, 10_000),
      evt("sandbox.provisioned", { sandboxId: "sbx-1" }, 10_500),
      evt("sandbox.apply.started", {}, 10_600),
      evt("sandbox.apply.completed", { ok: true, filesWritten: 6 }, 11_100),
      evt("ritual.completed", {}, 11_200)
    ];
    const final = events.reduce(timelineReducer, initialTimelineState);
    expect(final.escalated).toBe(false);
    expect(final.rows.architect.status).toBe("done");
    expect(final.rows.architect.durationMs).toBe(1_200);
    expect(final.rows.developer.status).toBe("done");
    expect(final.rows.developer.meta).toEqual({ winner: "anthropic", filesWritten: 6 });
    expect(final.rows.sandbox.status).toBe("done");
    expect(final.rows.sandbox.meta).toEqual({ filesWritten: 6 });
  });
});
