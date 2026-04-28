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
