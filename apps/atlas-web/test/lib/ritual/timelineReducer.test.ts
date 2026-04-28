import { describe, it, expect, expectTypeOf } from "vitest";
import {
  initialTimelineState,
  timelineReducer,
  type Phase,
  type RowState,
  type TimelineState
} from "@/lib/ritual/timelineReducer";

describe("TimelineState — types and initial value", () => {
  it("Phase is exactly the 3-value union architect | developer | sandbox", () => {
    expectTypeOf<Phase>().toEqualTypeOf<"architect" | "developer" | "sandbox">();
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

  it("TimelineState has rows keyed by phase + escalated boolean", () => {
    expectTypeOf<TimelineState>().toEqualTypeOf<{
      rows: Record<Phase, RowState>;
      escalated: boolean;
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
      // @ts-expect-error — runtime mutation must throw under Object.freeze
      initialTimelineState.escalated = true;
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
      rows: {
        architect: { phase: "architect", status: "done", retries: 5 },
        developer: { phase: "developer", status: "failed", retries: 1 },
        sandbox:   { phase: "sandbox",   status: "active", retries: 0 }
      }
    };
    const out = timelineReducer(polluted, evt("ritual.started"));
    expect(out).toEqual(initialTimelineState);
  });

  it("ritual.escalated flips state.escalated to true (rows untouched)", () => {
    const before: TimelineState = {
      escalated: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 0, durationMs: 1200 },
        developer: { phase: "developer", status: "active", retries: 1 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 }
      }
    };
    const after = timelineReducer(before, evt("ritual.escalated", { gate: "ritual" }));
    expect(after.escalated).toBe(true);
    expect(after.rows).toEqual(before.rows); // rows unchanged
  });

  it("ritual.completed marks all non-failed pending|active rows as done", () => {
    const before: TimelineState = {
      escalated: false,
      rows: {
        architect: { phase: "architect", status: "done", retries: 0, durationMs: 1200 },
        developer: { phase: "developer", status: "active", retries: 0, startedAt: 500 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 }
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
      rows: {
        architect: { phase: "architect", status: "failed", retries: 2, lastError: "oops" },
        developer: { phase: "developer", status: "pending", retries: 0 },
        sandbox:   { phase: "sandbox",   status: "pending", retries: 0 }
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
